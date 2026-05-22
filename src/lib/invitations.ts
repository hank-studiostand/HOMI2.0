import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────
// 초대 수락 — project_invitations → project_members 합류
//
// 미가입 상태로 이메일 초대된 팀원은 가입/로그인 후 이 함수를 통해
// 실제 프로젝트 멤버로 등록돼야 에셋 라이브러리 등 프로젝트 리소스를
// 공유받을 수 있다. (RLS는 is_project_member 기준이므로 멤버가 아니면
// 아무것도 못 본다.)
//
// 두 경로를 모두 수용:
//   1) token  — 초대 메일 링크(/auth?invitation=TOKEN&project=...)로 들어온 경우
//   2) email  — 토큰 없이 그냥 같은 이메일로 가입/로그인한 경우 (catch-all 스윕)
//
// admin(서비스롤) 클라이언트로 호출해야 함 — project_invitations RLS는
// 초대받은 당사자가 본인 client로 읽지 못하게 막혀 있다.
// ─────────────────────────────────────────────────────────────────

type Invitation = {
  id: string
  project_id: string
  email: string | null
  role: string | null
  accepted_at: string | null
}

export async function acceptPendingInvitations(
  admin: SupabaseClient,
  userId: string,
  email: string | null | undefined,
  token?: string | null,
): Promise<{ joinedProjectIds: string[]; tokenProjectId: string | null }> {
  const joined: string[] = []
  let tokenProjectId: string | null = null
  const lowEmail = (email ?? '').toLowerCase().trim()

  // id → invitation (중복 제거)
  const invMap = new Map<string, Invitation>()

  // 1) 이메일 매칭 — 아직 수락 안 된 초대 전부
  if (lowEmail) {
    const { data } = await admin
      .from('project_invitations')
      .select('id, project_id, email, role, accepted_at')
      .eq('email', lowEmail)
    for (const inv of (data ?? []) as Invitation[]) invMap.set(inv.id, inv)
  }

  // 2) 토큰 — 메일 링크로 들어온 명시적 초대 (이메일 일치 시에만 인정)
  if (token) {
    const { data } = await admin
      .from('project_invitations')
      .select('id, project_id, email, role, accepted_at')
      .eq('token', token)
      .maybeSingle()
    const inv = data as Invitation | null
    if (inv && (!lowEmail || (inv.email ?? '').toLowerCase() === lowEmail)) {
      invMap.set(inv.id, inv)
      tokenProjectId = inv.project_id
    }
  }

  for (const inv of invMap.values()) {
    const role = inv.role === 'viewer' ? 'viewer' : 'editor'

    // 멤버 추가 — unique(project_id,user_id) 기준 멱등
    const { error: memErr } = await admin
      .from('project_members')
      .upsert(
        { project_id: inv.project_id, user_id: userId, role },
        { onConflict: 'project_id,user_id', ignoreDuplicates: true },
      )

    // 초대 수락 표시 (이미 멤버여도)
    if (!inv.accepted_at) {
      await admin
        .from('project_invitations')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', inv.id)
    }

    if (!memErr) joined.push(inv.project_id)
    else console.error('[invitations] members.upsert 실패:', memErr)
  }

  return { joinedProjectIds: joined, tokenProjectId }
}
