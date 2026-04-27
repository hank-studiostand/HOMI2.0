import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const { sceneId, updates } = await req.json()
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('scene_settings').select('id').eq('scene_id', sceneId).maybeSingle()

  if (existing) {
    const { error } = await admin.from('scene_settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('scene_id', sceneId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // 새 레코드는 기본 엔진을 nanobanana로 명시 (DB default 변경 누락 대비)
    const { error } = await admin.from('scene_settings')
      .insert({ scene_id: sceneId, engine: 'nanobanana', ...updates })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
