import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-helper'

// GET — 최근 메시지 200건 (오래된 → 최신 순으로 반환)
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  const admin = createAdminClient()

  const { data: meMember } = await admin
    .from('project_members').select('id').eq('project_id', projectId).eq('user_id', me.id).maybeSingle()
  if (!meMember) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

  const { data, error } = await admin
    .from('project_messages')
    .select('id, project_id, user_id, content, scene_mentions, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const messages = (data ?? []).reverse()

  // user 정보 enrich
  const uniqUserIds = Array.from(new Set(messages.map(m => m.user_id)))
  const userMap = new Map<string, { email: string; name: string; avatar: string }>()
  await Promise.all(
    uniqUserIds.map(async (uid) => {
      const { data: u } = await admin.auth.admin.getUserById(uid)
      const meta = (u?.user?.user_metadata ?? {}) as Record<string, any>
      userMap.set(uid, {
        email: u?.user?.email ?? '',
        name: String(meta.display_name ?? meta.full_name ?? meta.name ?? ''),
        avatar: String(meta.avatar_url ?? ''),
      })
    }),
  )

  const enriched = messages.map(m => {
    const u = userMap.get(m.user_id)
    return {
      ...m,
      user_email: u?.email ?? '',
      user_display_name: u?.name ?? '',
      user_avatar_url: u?.avatar ?? '',
    }
  })

  return NextResponse.json({ messages: enriched })
}

// POST — { content, sceneMentions: [sceneId, ...] }
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  const { content, sceneMentions = [] } = await req.json()
  if (typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: '내용 비어있음' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: meMember } = await admin
    .from('project_members').select('id').eq('project_id', projectId).eq('user_id', me.id).maybeSingle()
  if (!meMember) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

  const safeMentions = Array.isArray(sceneMentions)
    ? sceneMentions.filter((x): x is string => typeof x === 'string').slice(0, 50)
    : []

  const { data, error } = await admin
    .from('project_messages')
    .insert({
      project_id: projectId,
      user_id: me.id,
      content: content.slice(0, 4000),
      scene_mentions: safeMentions,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ message: data })
}
