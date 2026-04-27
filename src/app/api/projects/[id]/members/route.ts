import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-helper'

type OwnerGuard =
  | { ok: true; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; status: number; msg: string }

// 요청자가 owner인지 확인 (멤버 추가/삭제는 owner만)
async function assertOwner(projectId: string, userId: string): Promise<OwnerGuard> {
  const admin = createAdminClient()
  const { data: project } = await admin
    .from('projects').select('owner_id').eq('id', projectId).maybeSingle()
  if (!project) return { ok: false, status: 404, msg: '프로젝트 없음' }
  if (project.owner_id !== userId) return { ok: false, status: 403, msg: 'owner만 멤버를 변경할 수 있어요' }
  return { ok: true, admin }
}

// GET /api/projects/[id]/members  — 멤버 목록 (auth.users 정보 join)
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  const admin = createAdminClient()

  // 요청자가 멤버인지 확인 (조회는 멤버 누구나)
  const { data: meMember } = await admin
    .from('project_members').select('id').eq('project_id', projectId).eq('user_id', me.id).maybeSingle()
  if (!meMember) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

  const { data: members, error } = await admin
    .from('project_members').select('id, user_id, role').eq('project_id', projectId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // auth.users 정보 가져오기
  const enriched = await Promise.all(
    (members ?? []).map(async (m) => {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id)
      const meta = (u?.user?.user_metadata ?? {}) as Record<string, any>
      return {
        ...m,
        email: u?.user?.email ?? '',
        display_name: String(meta.display_name ?? meta.full_name ?? meta.name ?? ''),
        avatar_url: String(meta.avatar_url ?? ''),
      }
    }),
  )

  return NextResponse.json({ members: enriched })
}

// POST /api/projects/[id]/members  — { userId, role } 추가
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  const guard = await assertOwner(projectId, me.id)
  if (!guard.ok) return NextResponse.json({ error: guard.msg }, { status: guard.status })

  const { userId, role = 'editor' } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId 필요' }, { status: 400 })
  if (!['editor', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'role은 editor 또는 viewer' }, { status: 400 })
  }

  const { error } = await guard.admin
    .from('project_members')
    .insert({ project_id: projectId, user_id: userId, role })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

// DELETE /api/projects/[id]/members?userId=...
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId 필요' }, { status: 400 })

  const guard = await assertOwner(projectId, me.id)
  if (!guard.ok) return NextResponse.json({ error: guard.msg }, { status: guard.status })

  // owner 자기 자신은 못 빼게
  if (userId === me.id) {
    return NextResponse.json({ error: 'owner는 본인을 제거할 수 없어요' }, { status: 400 })
  }

  const { error } = await guard.admin
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
