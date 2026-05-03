import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-helper'

// POST /api/projects/[id]/invite { email, role? }
//   - 이미 가입한 사용자면 project_members에 직접 insert
//   - 미가입자라면 project_invitations에 row 추가하고
//     supabase.auth.admin.inviteUserByEmail() 시도 (email_confirmed 안 된 경우)
//   - email 발송 자체는 Supabase 프로젝트 SMTP 설정에 의존 (환경 미설정시 row만 생성됨)

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  const { email, role = 'editor' } = (await req.json()) as { email?: string; role?: 'editor' | 'viewer' }
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: '올바른 이메일을 입력하세요' }, { status: 400 })
  }
  if (!['editor', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'role은 editor 또는 viewer' }, { status: 400 })
  }

  const admin = createAdminClient()

  // owner 가드
  const { data: project } = await admin.from('projects').select('owner_id, name').eq('id', projectId).maybeSingle()
  if (!project) return NextResponse.json({ error: '프로젝트 없음' }, { status: 404 })
  if (project.owner_id !== me.id) {
    return NextResponse.json({ error: 'owner만 초대할 수 있어요' }, { status: 403 })
  }

  // 1) 가입한 사용자인지 확인 (Supabase auth.users 검색)
  const { data: usersList, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listErr) {
    return NextResponse.json({ error: `사용자 조회 실패: ${listErr.message}` }, { status: 500 })
  }
  const existingUser = (usersList?.users ?? []).find(u => (u.email ?? '').toLowerCase() === email.toLowerCase())

  if (existingUser) {
    // 이미 멤버인지 확인
    const { data: alreadyMember } = await admin
      .from('project_members')
      .select('id').eq('project_id', projectId).eq('user_id', existingUser.id).maybeSingle()
    if (alreadyMember) {
      return NextResponse.json({ error: '이미 프로젝트 멤버입니다' }, { status: 400 })
    }
    const { error: insErr } = await admin
      .from('project_members')
      .insert({ project_id: projectId, user_id: existingUser.id, role })
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    return NextResponse.json({ success: true, kind: 'added', email })
  }

  // 2) 미가입자 — 초대 row 생성
  const { data: invitation, error: invErr } = await admin
    .from('project_invitations')
    .upsert(
      { project_id: projectId, email: email.toLowerCase(), role, invited_by: me.id, accepted_at: null },
      { onConflict: 'project_id,email' },
    )
    .select()
    .single()
  if (invErr) {
    return NextResponse.json({ error: `초대 저장 실패: ${invErr.message}` }, { status: 500 })
  }

  // 3) Supabase auth invite (옵션 — SMTP 미설정일 수 있어 실패는 무시)
  let emailSent = false
  try {
    const origin = req.headers.get('origin') ?? ''
    const redirectTo = `${origin}/auth?invitation=${invitation.token}&project=${projectId}`
    const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
    if (!mailErr) emailSent = true
  } catch {
    // ignore — invitation row는 저장됐으므로 owner가 수동으로 링크 공유 가능
  }

  return NextResponse.json({
    success: true,
    kind: 'invited',
    email,
    emailSent,
    token: invitation.token,
  })
}

// GET /api/projects/[id]/invite — 보류중인 초대 목록 (owner만)
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  const admin = createAdminClient()
  const { data: project } = await admin.from('projects').select('owner_id').eq('id', projectId).maybeSingle()
  if (!project) return NextResponse.json({ error: '프로젝트 없음' }, { status: 404 })
  if (project.owner_id !== me.id) {
    return NextResponse.json({ error: 'owner만 조회할 수 있어요' }, { status: 403 })
  }

  const { data: invitations, error } = await admin
    .from('project_invitations')
    .select('id, email, role, created_at, accepted_at, token')
    .eq('project_id', projectId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invitations: invitations ?? [] })
}

// DELETE /api/projects/[id]/invite?id=...
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const invId = searchParams.get('id')
  if (!invId) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

  const admin = createAdminClient()
  const { data: project } = await admin.from('projects').select('owner_id').eq('id', projectId).maybeSingle()
  if (project?.owner_id !== me.id) {
    return NextResponse.json({ error: 'owner만 취소할 수 있어요' }, { status: 403 })
  }

  const { error } = await admin
    .from('project_invitations')
    .delete()
    .eq('id', invId)
    .eq('project_id', projectId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
