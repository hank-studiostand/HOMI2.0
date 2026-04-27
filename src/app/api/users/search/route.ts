import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-helper'

// GET /api/users/search?q=hank&projectId=xxx
// — 로그인 유저가 projectId의 멤버일 때만 동작 (열거 방어)
// — 이메일/표시이름에 q가 포함된 가입자 반환 (이미 멤버인 사람 제외)
export async function GET(req: NextRequest) {
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()
  const projectId = searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId 필요' }, { status: 400 })
  if (q.length < 2) return NextResponse.json({ users: [] })

  const admin = createAdminClient()

  // 1) 요청자가 해당 프로젝트 멤버인지 확인
  const { data: meMember } = await admin
    .from('project_members').select('id').eq('project_id', projectId).eq('user_id', me.id).maybeSingle()
  if (!meMember) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

  // 2) 기존 멤버 ID 모음 (제외용)
  const { data: existing } = await admin
    .from('project_members').select('user_id').eq('project_id', projectId)
  const existingIds = new Set((existing ?? []).map(r => r.user_id))

  // 3) auth.users 검색 — 이메일 또는 user_metadata.display_name LIKE
  // Supabase Admin API는 listUsers만 제공 → 페이지네이션 + 클라이언트 필터링
  const lower = q.toLowerCase()
  const matched: { id: string; email: string; display_name: string; avatar_url: string }[] = []

  let page = 1
  const perPage = 1000
  // 1만명까지만 스캔 (그 이상은 별도 인덱스 필요)
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) {
      console.error('[users/search] listUsers 실패:', error.message)
      break
    }
    for (const u of data.users) {
      if (existingIds.has(u.id)) continue
      const email = u.email ?? ''
      const meta = (u.user_metadata ?? {}) as Record<string, any>
      const display = String(meta.display_name ?? meta.full_name ?? meta.name ?? '')
      const haystack = (email + ' ' + display).toLowerCase()
      if (haystack.includes(lower)) {
        matched.push({
          id: u.id,
          email,
          display_name: display,
          avatar_url: String(meta.avatar_url ?? ''),
        })
        if (matched.length >= 20) break
      }
    }
    if (matched.length >= 20 || data.users.length < perPage) break
    page += 1
  }

  return NextResponse.json({ users: matched })
}
