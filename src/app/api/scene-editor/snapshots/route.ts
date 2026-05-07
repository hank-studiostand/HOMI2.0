import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-helper'

// GET /api/scene-editor/snapshots?projectId=...&limit=50
//   최근 스냅샷 목록 (scenes_json 제외 — 메타데이터만)
export async function GET(req: NextRequest) {
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })
  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) return NextResponse.json({ error: 'projectId 필요' }, { status: 400 })
  const limit = Math.min(100, parseInt(new URL(req.url).searchParams.get('limit') ?? '50', 10) || 50)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scene_editor_snapshots')
    .select('id, created_at, created_by, note, scenes_json')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // scenes_json은 카운트만 노출 (목록에서 무거우니 카운트만)
  const list = (data ?? []).map((s: any) => ({
    id: s.id,
    created_at: s.created_at,
    created_by: s.created_by,
    note: s.note ?? null,
    sceneCount: Array.isArray(s.scenes_json) ? s.scenes_json.length : 0,
  }))
  return NextResponse.json({ snapshots: list })
}

// POST /api/scene-editor/snapshots  — { projectId, scenes, note? }
//   새 스냅샷 생성. 동일 프로젝트의 직전 스냅샷과 동일하면 skip (no-op 200).
export async function POST(req: NextRequest) {
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })
  const { projectId, scenes, note } = await req.json() as { projectId: string; scenes: any[]; note?: string }
  if (!projectId || !Array.isArray(scenes)) {
    return NextResponse.json({ error: 'projectId/scenes 필요' }, { status: 400 })
  }
  const admin = createAdminClient()

  // 직전 스냅샷과 동일하면 skip
  const { data: prev } = await admin
    .from('scene_editor_snapshots')
    .select('id, scenes_json')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (prev && JSON.stringify(prev.scenes_json) === JSON.stringify(scenes)) {
    return NextResponse.json({ skipped: true, snapshotId: prev.id })
  }

  const { data, error } = await admin
    .from('scene_editor_snapshots')
    .insert({ project_id: projectId, scenes_json: scenes, created_by: me.id, note: note ?? null })
    .select('id, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ snapshot: data })
}

// GET /api/scene-editor/snapshots/[id] — 스냅샷 상세 (scenes_json 포함)
//   별도 라우트로 분리. 여기선 처리하지 않음.
