'use client'

import Sidebar from './Sidebar'
import ProjectTopBar from './ProjectTopBar'
import LiveCursors from './LiveCursors'
import ChatSidebar from './ChatSidebar'

interface ProjectLayoutProps {
  children: React.ReactNode
  projectId: string
  projectName: string
}

export default function ProjectLayout({ children, projectId, projectName }: ProjectLayoutProps) {
  return (
    <div className="flex flex-col h-full">
      <ProjectTopBar projectId={projectId} projectName={projectName} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar projectId={projectId} projectName={projectName} />
        <main className="flex-1 overflow-auto" style={{ background: 'var(--background)' }}>
          {children}
        </main>
      </div>
      <LiveCursors projectId={projectId} />
      <ChatSidebar projectId={projectId} />
    </div>
  )
}
