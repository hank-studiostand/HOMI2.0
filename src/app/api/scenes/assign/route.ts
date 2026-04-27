import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-helper'

// POST /api/scenes/assign  — { sceneId, assignedTo: uuid | null }
export async function POST(req: NextRequest) {
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  const { sceneId, assignedTo } = await req.json()
  if (!sceneId) return NextResponse.json({ error: 'sceneId 필요' }, { status: 400 })

  const admin = createAdminClient()

  // 씬의 프로젝트 찾고, 요청자가 멤버인지 확인
  const { data: scene } = await admin
    .from('scenes').select('project_id').eq('id', sceneId).maybeSingle()
  if (!scene) return NextResponse.json({ error: '씬 없음' }, { status: 404 })

  const { data: meMember } = await admin
    .from('project_members').select('id').eq('project_id', scene.project_id).eq('user_id', me.id).maybeSingle()
  if (!meMember) return NextResponse.json({ error: '권한 없음' }, { status: 403 })

  // assignedTo가 있으면, 그 사람도 프로젝트 멤버인지 확인
  if (assignedTo) {
    const { data: target } = await admin
      .from('project_members').select('id').eq('project_id', scene.project_id).eq('user_id', assignedTo).maybeSingle()
    if (!target) return NextResponse.json({ error: '대상자가 프로젝트 멤버가 아니에요' }, { status: 400 })
  }

  const { error } = await admin
    .from('scenes')
    .update({ assigned_to: assignedTo ?? null, updated_at: new Date().toISOString() })
    .eq('id', sceneId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
