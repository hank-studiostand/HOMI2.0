import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser } from '@/lib/supabase/auth-helper'

type OwnerGuard =
  | { ok: true; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; status: number; msg: string }

async function assertOwner(projectId: string, userId: string): Promise<OwnerGuard> {
  const admin = createAdminClient()
  const { data: project } = await admin
    .from('projects').select('owner_id').eq('id', projectId).maybeSingle()
  if (!project) return { ok: false, status: 404, msg: '프로젝트 없음' }
  if (project.owner_id !== userId) return { ok: false, status: 403, msg: 'owner만 멤버를 변경할 수 있어요' }
  return { ok: true, admin }
}

// GET /api/projects/[id]/members  — 멤버 목록 (auth.users 정보 join + role_label + ownerId/meId)
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

  const { data: members, error } = await admin
    .from('project_members').select('id, user_id, role, role_label').eq('project_id', projectId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: project } = await admin
    .from('projects').select('owner_id').eq('id', projectId).maybeSingle()

  const enriched = await Promise.all(
    (members ?? []).map(async (m: any) => {
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

  return NextResponse.json({ members: enriched, ownerId: project?.owner_id ?? null, meId: me.id })
}

// POST /api/projects/[id]/members  — { userId, role, roleLabel? }
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  const guard = await assertOwner(projectId, me.id)
  if (!guard.ok) return NextResponse.json({ error: guard.msg }, { status: guard.status })

  const { userId, role = 'editor', roleLabel } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId 필요' }, { status: 400 })
  if (!['editor', 'viewer'].includes(role)) {
    return NextResponse.json({ error: 'role은 editor 또는 viewer' }, { status: 400 })
  }

  const insertRow: any = { project_id: projectId, user_id: userId, role }
  if (typeof roleLabel === 'string' && roleLabel.trim()) {
    insertRow.role_label = roleLabel.trim()
  }

  const { error } = await guard.admin
    .from('project_members')
    .insert(insertRow)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

// PATCH /api/projects/[id]/members  — { userId, role?, roleLabel? }
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await ctx.params
  const me = await getAuthUser()
  if (!me) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  const guard = await assertOwner(projectId, me.id)
  if (!guard.ok) return NextResponse.json({ error: guard.msg }, { status: guard.status })

  const { userId, role, roleLabel } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId 필요' }, { status: 400 })

  const updates: Record<string, any> = {}
  if (role !== undefined) {
    if (!['editor', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'role은 editor 또는 viewer' }, { status: 400 })
    }
    if (userId === me.id) {
      return NextResponse.json({ error: 'owner 본인의 역할은 변경할 수 없어요' }, { status: 400 })
    }
    updates.role = role
  }
  if (roleLabel !== undefined) {
    const trimmed = String(roleLabel).trim()
    updates.role_label = trimmed.length > 0 ? trimmed : null
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '변경할 항목 없음' }, { status: 400 })
  }

  const { error } = await guard.admin
    .from('project_members')
    .update(updates)
    .eq('project_id', projectId)
    .eq('user_id', userId)
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
