import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  const { name, description } = await req.json()
  const cookieStore = await cookies()

  // 일반 클라이언트로 유저 확인
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인 필요' }, { status: 401 })

  // 서비스롤 클라이언트로 RLS 우회하여 생성
  const admin = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  )

  const { data: project, error } = await admin
    .from('projects')
    .insert({ name, description, owner_id: user.id })
    .select('id')
    .single()

  if (error || !project) return NextResponse.json({ error: error?.message }, { status: 500 })

  await admin.from('project_members').insert({ project_id: project.id, user_id: user.id, role: 'owner' })
  await admin.from('scripts').insert({ project_id: project.id, content: '' })

  return NextResponse.json({ projectId: project.id })
}
