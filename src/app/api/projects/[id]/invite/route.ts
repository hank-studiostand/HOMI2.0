import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-helper'

// POST /api/projects/[id]/invite { email, role? }
//   1) 가입한 사용자 → project_members에 직접 insert
//   2) 미가입자 → project_invitations row + Resend 또는 Supabase SMTP로 메일 전송
//   환경변수:
//     RESEND_API_KEY     — Resend 사용 시 (https://resend.com)
//     EMAIL_FROM         — 발신자 (기본: 'HOMI <noreply@homi.app>')
//     APP_URL            — 절대 URL (없으면 origin 헤더 사용)

async function findUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  const target = email.toLowerCase()
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`auth.users 조회 실패: ${error.message}`)
    const list = data?.users ?? []
    const hit = list.find(u => (u.email ?? '').toLowerCase() === target)
    if (hit) return hit
    if (list.length < 1000) break
  }
  return null
}

async function sendInviteEmail(opts: {
  to: string; projectName: string; inviterName: string; inviteUrl: string
}): Promise<{ ok: boolean; via: 'resend' | 'supabase' | 'none'; error?: string }> {
  const resendKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM || 'HOMI <noreply@homi.app>'

  if (resendKey) {
    try {
      const subject = `[HOMI] ${opts.inviterName}님이 "${opts.projectName}" 프로젝트에 초대했어요`
      const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1f2937;">
  <div style="font-size:13px;color:#9ca3af;letter-spacing:0.5px;margin-bottom:8px;">HOMI · AI 영상 협업툴</div>
  <h1 style="font-size:22px;font-weight:600;margin:0 0 16px;">프로젝트 초대</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">
    <strong>${opts.inviterName}</strong>님이 <strong>"${opts.projectName}"</strong> 프로젝트에 함께 작업할 사람으로 초대했습니다.
  </p>
  <a href="${opts.inviteUrl}" style="display:inline-block;padding:12px 24px;background:#d97706;color:#fff;text-decoration:none;border-radius:8px;font-weight:500;font-size:14px;">초대 수락하기</a>
  <p style="font-size:12px;color:#6b7280;margin:32px 0 0;line-height:1.6;">
    버튼이 작동하지 않으면 아래 링크를 복사해서 브라우저에 붙여넣으세요.<br/>
    <a href="${opts.inviteUrl}" style="color:#d97706;word-break:break-all;">${opts.inviteUrl}</a>
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px;"/>
  <p style="font-size:11px;color:#9ca3af;margin:0;">이 메일이 잘못 발송된 경우 무시해주세요.</p>
</div>`.trim()
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [opts.to], subject, html }),
      })
      if (r.ok) return { ok: true, via: 'resend' }
      const body = await r.text()
      return { ok: false, via: 'resend', error: `Resend ${r.status}: ${body.slice(0, 200)}` }
    } catch (e) {
      return { ok: false, via: 'resend', error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { ok: false, via: 'none', error: 'RESEND_API_KEY 미설정 — Supabase SMTP fallback' }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  let body: any = {}
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 }) }
  const email = (body.email ?? '').toString().trim()
  const role = (body.role ?? 'editor') as 'editor' | 'viewer'
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: '올바른 이메일을 입력하세요' }, { status: 400 })
  }
  if (!['editor', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'role은 editor 또는 viewer' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: project } = await admin.from('projects').select('owner_id, name').eq('id', projectId).maybeSingle()
  if (!project) return NextResponse.json({ error: '프로젝트 없음' }, { status: 404 })
  if (project.owner_id !== me.id) {
    return NextResponse.json({ error: 'owner만 초대할 수 있어요' }, { status: 403 })
  }

  let existingUser: { id: string; email?: string } | null = null
  try {
    const u = await findUserByEmail(admin, email)
    if (u) existingUser = { id: u.id, email: u.email ?? undefined }
  } catch (e) {
    console.error('[invite] findUserByEmail 실패:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : '사용자 조회 실패' }, { status: 500 })
  }

  if (existingUser) {
    const { data: alreadyMember } = await admin
      .from('project_members')
      .select('id').eq('project_id', projectId).eq('user_id', existingUser.id).maybeSingle()
    if (alreadyMember) {
      return NextResponse.json({ error: '이미 프로젝트 멤버입니다' }, { status: 400 })
    }
    const { error: insErr } = await admin
      .from('project_members')
      .insert({ project_id: projectId, user_id: existingUser.id, role })
    if (insErr) {
      console.error('[invite] members.insert 실패:', insErr)
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
    return NextResponse.json({ success: true, kind: 'added', email })
  }

  const { data: invitation, error: invErr } = await admin
    .from('project_invitations')
    .upsert(
      { project_id: projectId, email: email.toLowerCase(), role, invited_by: me.id, accepted_at: null },
      { onConflict: 'project_id,email' },
    )
    .select()
    .single()
  if (invErr) {
    console.error('[invite] invitations.upsert 실패:', invErr)
    return NextResponse.json({ error: `초대 저장 실패: ${invErr.message}` }, { status: 500 })
  }

  const origin = process.env.APP_URL || req.headers.get('origin') || ''
  const inviteUrl = `${origin}/auth?invitation=${invitation.token}&project=${projectId}`
  const inviterName = (me as any).user_metadata?.display_name
    || (me as any).user_metadata?.full_name
    || (me as any).email?.split('@')[0]
    || '팀원'

  let emailSent = false
  let emailVia: 'resend' | 'supabase' | 'none' = 'none'
  let emailError: string | null = null

  const resendResult = await sendInviteEmail({
    to: email,
    projectName: project.name ?? '프로젝트',
    inviterName,
    inviteUrl,
  })
  if (resendResult.ok) {
    emailSent = true
    emailVia = 'resend'
  } else {
    emailError = resendResult.error ?? null
    try {
      const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: inviteUrl })
      if (!mailErr) { emailSent = true; emailVia = 'supabase' }
      else if (!emailError) emailError = mailErr.message
    } catch (e) {
      if (!emailError) emailError = e instanceof Error ? e.message : String(e)
    }
  }

  return NextResponse.json({
    success: true,
    kind: 'invited',
    email,
    emailSent,
    emailVia,
    emailError: emailSent ? null : emailError,
    inviteUrl,
    token: invitation.token,
  })
}

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
