'use client'

import { useEffect, useState } from 'react'
import Sidebar from './Sidebar'
import ProjectTopBar from './ProjectTopBar'
import LiveCursors from './LiveCursors'
import ChatSidebar from './ChatSidebar'
import ResizeHandle from './ResizeHandle'
import GlobalAttemptListener from './GlobalAttemptListener'
import { MessageSquare } from 'lucide-react'

interface ProjectLayoutProps {
  children: React.ReactNode
  projectId: string
  projectName: string
}

const SIDEBAR_DEFAULT = 240
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 420
const CHAT_DEFAULT  = 360
const CHAT_MIN      = 280
const CHAT_MAX      = 640

function loadNum(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const v = window.localStorage.getItem(key)
    const n = v ? parseInt(v, 10) : NaN
    return Number.isFinite(n) ? n : fallback
  } catch { return fallback }
}
function saveNum(key: string, v: number) {
  try { window.localStorage.setItem(key, String(v)) } catch {}
}
function loadBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch { return fallback }
}
function saveBool(key: string, v: boolean) {
  try { window.localStorage.setItem(key, v ? '1' : '0') } catch {}
}

export default function ProjectLayout({ children, projectId, projectName }: ProjectLayoutProps) {
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [chatWidth, setChatWidth]       = useState(CHAT_DEFAULT)
  const [chatOpen, setChatOpen]         = useState(false)
  const [hydrated, setHydrated]         = useState(false)

  // localStorage 복원
  useEffect(() => {
    setSidebarWidth(loadNum('layout:sidebar-width', SIDEBAR_DEFAULT))
    setChatWidth(loadNum('layout:chat-width', CHAT_DEFAULT))
    setChatOpen(loadBool('layout:chat-open', false))
    setHydrated(true)
  }, [])
  useEffect(() => { if (hydrated) saveNum('layout:sidebar-width', sidebarWidth) }, [sidebarWidth, hydrated])
  useEffect(() => { if (hydrated) saveNum('layout:chat-width', chatWidth) }, [chatWidth, hydrated])
  useEffect(() => { if (hydrated) saveBool('layout:chat-open', chatOpen) }, [chatOpen, hydrated])

  return (
    <div className="flex flex-col h-full">
      <ProjectTopBar projectId={projectId} projectName={projectName} />

      <div className="flex flex-1 overflow-hidden">
        {/* 왼쪽 사이드바 */}
        <div
          className="relative shrink-0 h-full"
          style={{ width: sidebarWidth }}
        >
          <Sidebar projectId={projectId} projectName={projectName} />
          <ResizeHandle
            side="right"
            width={sidebarWidth}
            onChange={setSidebarWidth}
            min={SIDEBAR_MIN}
            max={SIDEBAR_MAX}
          />
        </div>

        {/* 메인 콘텐츠 — 채팅 열리면 자동으로 좁아짐 (flex-1) */}
        <main className="flex-1 overflow-auto min-w-0" style={{ background: 'var(--background)' }}>
          {children}
        </main>

        {/* 오른쪽 채팅 사이드바 — 열렸을 때만 width 차지 */}
        {chatOpen && (
          <div
            className="relative shrink-0 h-full"
            style={{ width: chatWidth, borderLeft: '1px solid var(--border)' }}
          >
            <ResizeHandle
              side="left"
              width={chatWidth}
              onChange={setChatWidth}
              min={CHAT_MIN}
              max={CHAT_MAX}
            />
            <ChatSidebar
              projectId={projectId}
              open={chatOpen}
              onClose={() => setChatOpen(false)}
            />
          </div>
        )}
      </div>

      {/* 채팅 닫혔을 때만 보이는 토글 버튼 */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed right-3 bottom-4 z-40 flex items-center gap-2 px-3 py-2 rounded-full shadow-lg hover:scale-105 transition-transform"
          style={{ background: 'var(--accent)', color: 'white' }}
          title="팀 채팅"
        >
          <MessageSquare size={14} />
          <span className="text-xs font-semibold">팀 채팅</span>
        </button>
      )}

      <LiveCursors projectId={projectId} />
      <GlobalAttemptListener projectId={projectId} />
    </div>
  )
}
