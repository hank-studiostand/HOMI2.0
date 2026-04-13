import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ProjectLayout from '@/components/layout/ProjectLayout'

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single()

  if (!project) redirect('/dashboard')

  return (
    <ProjectLayout projectId={id} projectName={project.name}>
      {children}
    </ProjectLayout>
  )
}
