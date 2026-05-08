'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useTheme } from '@/components/theme/ThemeProvider'
import {
  FileText, Layers, Image as ImageIcon, Video, Mic, Archive,
  FolderOpen, ChevronLeft, Settings, LogOut, Scissors,
  Clapperboard, Package, Sparkles,
  Home, Frame, CheckCircle2, GitBranch, Sun, Moon, Trash2 } from 'lucide-react'

type IconCmp = React.ComponentType<{ size?: number | string; className?: string; style?: React.CSSProperties }>

interface NavItem {
  href: string
  label: string
  icon: IconCmp
  badge?: string
  // 부모 항목일 때 — 활성 경로일 때 children 자동 노출
  children?: { href: string; label: string; query?: string }[]
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'OVERVIEW',
    items: [
      { href: 'totaltree', label: '프로젝트 대시보드', icon: Home },
    ],
  },
  {
    label: 'PLANNING',
    items: [
      { href: 'script',       label: '대본',          icon: FileText },
      { href: 'scene-editor', label: '씬 경계 편집',  icon: Scissors },
    ],
  },
  {
    label: 'STRUCTURE',
    items: [
      { href: 'asset-make',  label: '에셋 메이킹',          icon: Sparkles },
      { href: 'root-assets', label: '루트 에셋',             icon: Package },
      { href: 'scenes',      label: '씬 분류 (Shot Board)', icon: Layers },
      { href: 'assets',      label: '에셋 라이브러리',       icon: FolderOpen },
    ],
  },
  {
    label: 'GENERATION',
    items: [
      {
        href: 'workspace', label: 'Shot Workspace', icon: Frame,
        children: [
          { href: 'workspace', label: 'T2I — 이미지', query: 'type=t2i' },
          { href: 'workspace', label: 'I2V — 영상',   query: 'type=i2v' },
          { href: 'workspace', label: 'T2V — 영상',   query: 'type=t2v' },
        ],
      },
      { href: 't2i',     label: '이미지 라이브러리', icon: ImageIcon },
      { href: 'i2v',     label: '영상 라이브러리',   icon: Video },
      { href: 'lipsync', label: '립싱크',           icon: Mic },
    ],
  },
  {
    label: 'REVIEW',
    items: [
      { href: 'review',  label: 'Review & Decision',     icon: CheckCircle2 },
      { href: 'version', label: 'Version & Provenance',  icon: GitBranch },
    ],
  },
  {
    label: 'DELIVERY',
    items: [
      { href: 'archive', label: '아카이브 / Export', icon: Archive },
      { href: 'trash',   label: '휴지통',            icon: Trash2 },
    ],
  },
]

interface SidebarProps {
  projectId: string
  projectName: string
}

export default function Sidebar({ projectId, projectName }: SidebarProps) {
  const pathname = usePathname()
  const { theme, toggle: toggleTheme } = useTheme()

  return (
    <aside
      className="flex flex-col w-full h-full overflow-hidden"
      style={{ background: 'var(--bg-1)', borderRight: '1px solid var(--line)' }}
    >
      {/* ── 프로젝트 헤더 ── */}
      <div className="px-3 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-xs mb-2.5 hover:opacity-80 transition-opacity"
          style={{ color: 'var(--ink-4)' }}
        >
          <ChevronLeft size={13} />
          <span>모든 프로젝트</span>
        </Link>
        <div className="flex items-center gap-2 px-1">
          <div
            className="av-1 shrink-0"
            style={{
              width: 24, height: 24,
              borderRadius: 6,
              display: 'grid', placeItems: 'center',
              fontSize: 12, fontWeight: 700,
            }}
          >
            {projectName?.[0]?.toUpperCase() ?? 'P'}
          </div>
          <h2 className="text-[13px] font-semibold truncate flex-1" style={{ color: 'var(--ink)' }}>
            {projectName}
          </h2>
        </div>
      </div>

      {/* ── Nav (그룹별) ── */}
      <nav className="flex-1 overflow-y-auto" style={{ padding: '8px 8px' }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-1">
            <div
              style={{
                padding: '8px 10px 4px',
                fontSize: 10, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                color: 'var(--ink-5)',
              }}
            >
              {group.label}
            </div>
            {group.items.map((item) => {
              const active = pathname.includes(`/${item.href}`)
              const Icon = item.icon
              return (
                <div key={item.href}>
                  <Link
                    href={`/project/${projectId}/${item.href}`}
                    className={cn('relative flex items-center gap-2.5 w-full text-left transition-colors')}
                    style={{
                      padding: '7px 10px',
                      borderRadius: 'var(--r-md)',
                      color: active ? 'var(--ink)' : 'var(--ink-3)',
                      background: active ? 'var(--bg-3)' : 'transparent',
                      fontSize: 13,
                    }}
                    onMouseEnter={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'
                    }}
                    onMouseLeave={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'
                    }}
                  >
                    {active && (
                      <span
                        style={{
                          position: 'absolute', left: -8, top: 8, bottom: 8,
                          width: 2, background: 'var(--accent)', borderRadius: '0 2px 2px 0',
                        }}
                      />
                    )}
                    <Icon size={16} style={{ opacity: 0.85, flexShrink: 0 }} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge && (
                      <span
                        style={{
                          marginLeft: 'auto',
                          padding: '1px 6px',
                          borderRadius: 999,
                          fontSize: 10, fontWeight: 600,
                          background: 'var(--accent-soft)',
                          color: 'var(--accent-2)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>

                  {/* 자식 항목 — 부모가 활성일 때만 노출 */}
                  {active && item.children && item.children.length > 0 && (
                    <div style={{ marginLeft: 22, marginTop: 2, marginBottom: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {item.children.map((child) => {
                        const childHref = `/project/${projectId}/${child.href}${child.query ? `?${child.query}` : ''}`
                        // 현재 path + query에서 type= 비교 (간단 매칭)
                        const typeMatch = (() => {
                          if (typeof window === 'undefined') return false
                          if (!child.query) return false
                          const q = new URLSearchParams(window.location.search)
                          const want = new URLSearchParams(child.query)
                          for (const [k, v] of want.entries()) {
                            if (q.get(k) !== v) return false
                          }
                          return true
                        })()
                        return (
                          <Link
                            key={child.label}
                            href={childHref}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 'var(--r-sm)',
                              color: typeMatch ? 'var(--accent)' : 'var(--ink-4)',
                              background: typeMatch ? 'var(--accent-soft)' : 'transparent',
                              fontSize: 12,
                              fontWeight: typeMatch ? 600 : 400,
                              transition: 'all 0.12s',
                            }}
                            onMouseEnter={(e) => {
                              if (!typeMatch) (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'
                            }}
                            onMouseLeave={(e) => {
                              if (!typeMatch) (e.currentTarget as HTMLElement).style.background = 'transparent'
                            }}
                          >
                            {child.label}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div
        className="flex items-center gap-2 px-3 py-3"
        style={{ borderTop: '1px solid var(--line)' }}
      >
        <button
          onClick={toggleTheme}
          className="flex-1 flex items-center gap-2 rounded"
          style={{
            padding: '6px 8px',
            color: 'var(--ink-3)',
            fontSize: 12,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          <span>{theme === 'dark' ? '라이트' : '다크'}</span>
        </button>

        <Link
          href={`/project/${projectId}/settings`}
          className="rounded"
          style={{ padding: 6, color: 'var(--ink-3)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          title="설정"
        >
          <Settings size={14} />
        </Link>
        <button
          className="rounded"
          style={{ padding: 6, color: 'var(--ink-3)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          title="로그아웃"
        >
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  )
}
