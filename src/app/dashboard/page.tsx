import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Plus, Film, Users, Clock, Layers, LogOut } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const admin = createAdminClient()

  // 내가 멤버인 project_id 목록 조회
  const { data: memberships } = await admin
    .from('project_members')
    .select('project_id')
    .eq('user_id', user.id)

  const projectIds = memberships?.map((m: any) => m.project_id) ?? []

  let projects: any[] = []
  if (projectIds.length > 0) {
    // 프로젝트 + 씬 수 + 멤버 수 조회
    const { data } = await admin
      .from('projects')
      .select(`
        *,
        scenes(count),
        project_members(count)
      `)
      .in('id', projectIds)
      .order('updated_at', { ascending: false })

    projects = data ?? []
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--background)' }}>
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>프로젝트</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{user.email}</p>
          </div>
         <div className="flex items-center gap-2">
  <Link href="/dashboard/new"
    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all hover:opacity-90"
    style={{ background: 'var(--accent)' }}>
    <Plus size={16} /> 새 프로젝트
  </Link>
  <form action="/api/auth/signout" method="post">
    <button
      type="submit"
      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-80"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
    >
      <LogOut size={14} /> 로그아웃
    </button>
  </form>
</div>
</div>

        {/* Projects Grid */}
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 rounded-2xl border"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <Film size={40} className="mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>아직 프로젝트가 없습니다</p>
            <Link href="/dashboard/new"
              className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white"
              style={{ background: 'var(--accent)' }}>
              <Plus size={14} /> 첫 프로젝트 만들기
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project: any) => {
              const sceneCount = project.scenes?.[0]?.count ?? 0
              const memberCount = project.project_members?.[0]?.count ?? 0

              return (
                <Link key={project.id} href={`/project/${project.id}/script`}
                  className="rounded-2xl p-5 border transition-all hover:border-indigo-500/40 group block"
                  style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: 'var(--accent)' }}>
                      <Film size={18} className="text-white" />
                    </div>
                    {sceneCount > 0 && (
                      <span className="text-xs px-2 py-1 rounded-full"
                        style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>
                        씬 {sceneCount}개
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold mb-1 group-hover:text-indigo-400 transition-colors"
                    style={{ color: 'var(--text-primary)' }}>
                    {project.name}
                  </h3>
                  {project.description && (
                    <p className="text-xs mb-3 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                      {project.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                    <span className="flex items-center gap-1">
                      <Users size={11} /> {memberCount}명
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={11} /> {formatDate(project.updated_at)}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
