import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-helper'
import { acceptPendingInvitations } from '@/lib/invitations'

// POST /api/invitations/accept  { token? }
//   로그인된 사용자를 토큰/이메일 매칭 초대에 따라 프로젝트 멤버로 합류시킨다.
//   - token 있으면 해당 초대(이메일 일치 시) 수락
//   - 항상 본인 이메일로 온 미수락 초대도 함께 정리
export async function POST(req: NextRequest) {
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  let token: string | null = null
  try {
    const body = await req.json()
    token = typeof body?.token === 'string' && body.token.trim() ? body.token.trim() : null
  } catch {}

  const admin = createAdminClient()

  try {
    const { joinedProjectIds, tokenProjectId } = await acceptPendingInvitations(
      admin, me.id, me.email, token,
    )
    const redirectProjectId = tokenProjectId ?? joinedProjectIds[0] ?? null
    return NextResponse.json({ success: true, joined: joinedProjectIds, redirectProjectId })
  } catch (e) {
    console.error('[invitations/accept] 실패:', e)
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
