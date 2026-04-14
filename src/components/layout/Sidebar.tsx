'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useTheme } from '@/components/theme/ThemeProvider'
import {
  FileText, Layers, Image, Video, Mic, Archive,
  FolderOpen, ChevronLeft, Settings, LogOut, Scissors,
  Clapperboard, LayoutGrid, GripVertical, Sun, Moon,
} from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: any
  step: string
  disabled?: boolean
  badge?: string
}

const DEFAULT_NAV: NavItem[] = [
  { href: 'totaltree',    label: '토탈트리',        icon: LayoutGrid,   step: '00' },
  { href: 'script',       label: '대본',            icon: FileText,     step: '01' },
  { href: 'scene-editor', label: '씬 경계 편집',    icon: Scissors,     step: '02' },
  { href: 'scenes',       label: '씬 분류',         icon: Layers,       step: '03' },
  { href: 'assets',       label: '에셋 라이브러리', icon: FolderOpen,   step: '04' },
  { href: 't2i',          label: 'T2I',             icon: Image,        step: '05' },
  { href: 'i2v',          label: 'I2V',             icon: Video,        step: '06' },
  { href: 'lipsync',      label: '립싱크',          icon: Mic,          step: '07' },
  { href: 'archive',      label: '아카이브',        icon: Archive,      step: '08' },
  { href: 't2v',          label: 'T2V',             icon: Clapperboard, step: '09', badge: '개발중' },
]

const STORAGE_KEY = 'sidebar-nav-order'

function loadOrder(): string[] | null {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(STORAGE_KEY) : null
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function saveOrder(hrefs: string[]) {
  try { window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(hrefs)) } catch {}
}
function getOrderedNav(savedOrder: string[] | null): NavItem[] {
  if (!savedOrder) return DEFAULT_NAV
  const map = new Map(DEFAULT_NAV.map(n => [n.href, n]))
  const ordered: NavItem[] = []
  for (const href of savedOrder) {
    const item = map.get(href)
    if (item) { ordered.push(item); map.delete(href) }
  }
  for (const item of map.values()) ordered.push(item)
  return ordered
}

interface SidebarProps {
  projectId: string
  projectName: string
}

export default function Sidebar({ projectId, projectName }: SidebarProps) {
  const pathname = usePathname()
  const { theme, toggle: toggleTheme } = useTheme()
  const [nav, setNav] = useState<NavItem[]>(DEFAULT_NAV)
  const [editMode, setEditMode] = useState(false)
  const dragItem = useRef<number | null>(null)
  const dragOverItem = useRef<number | null>(null)

  useEffect(() => { setNav(getOrderedNav(loadOrder())) }, [])

  function handleDragStart(idx: number) { dragItem.current = idx }
  function handleDragEnter(idx: number) { dragOverItem.current = idx }
  function handleDragEnd() {
    if (dragItem.current === null || dragOverItem.current === null) return
    const copy = [...nav]
    const [removed] = copy.splice(dragItem.current, 1)
    copy.splice(dragOverItem.current, 0, removed)
    const renumbered = copy.map((item, i) => ({ ...item, step: String(i).padStart(2, '0') }))
    setNav(renumbered)
    saveOrder(renumbered.map(n => n.href))
    dragItem.current = null
    dragOverItem.current = null
  }
  function resetOrder() {
    setNav(DEFAULT_NAV)
    saveOrder(DEFAULT_NAV.map(n => n.href))
    setEditMode(false)
  }

  return (
    <aside
      className="flex flex-col w-56 shrink-0 h-full border-r"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* ── Header ── */}
      <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-xs mb-2.5 hover:opacity-80 transition-opacity"
          style={{ color: 'var(--text-muted)' }}
        >
          <ChevronLeft size={13} />
          <span>모든 프로젝트</span>
        </Link>
        <div className="flex items-center gap-2 px-1">
          <div
            className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-[11px] font-bold"
            style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
          >
            A
          </div>
          <h2 className="text-[13px] font-semibold truncate flex-1" style={{ color: 'var(--text-primary)' }}>
            {projectName}
          </h2>
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 px-1.5 py-2 overflow-y-auto space-y-px">
        {nav.map(({ href, label, icon: Icon, step, disabled, badge }, idx) => {
          const active = pathname.includes(`/${href}`)

          const navItem = (
            <Link
              href={disabled ? '#' : `/project/${projectId}/${href}`}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-all group',
                active
                  ? 'font-medium'
                  : 'hover:opacity-100',
                disabled && 'opacity-40 pointer-events-none',
              )}
              style={
                active
                  ? { background: 'var(--accent-subtle)', color: 'var(--accent)' }
                  : { color: 'var(--text-secondary)', background: 'transparent' }
              }
              onMouseEnter={e => {
                if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'
              }}
              onMouseLeave={e => {
                if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              {editMode && <GripVertical size={11} className="shrink-0 opacity-30" />}
              <Icon size={14} className="shrink-0 opacity-70" />
              <span className="flex-1 truncate">{label}</span>
              {badge && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded shrink-0 font-medium"
                  style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
                >
                  {badge}
                </span>
              )}
              {!editMode && (
                <span className="text-[10px] opacity-0 group-hover:opacity-30 transition-opacity font-mono">
                  {step}
                </span>
              )}
            </Link>
          )

          return (
            <div
              key={href}
              draggable={editMode}
              onDragStart={() => handleDragStart(idx)}
              onDragEnter={() => handleDragEnter(idx)}
              onDragEnd={handleDragEnd}
              onDragOver={e => e.preventDefault()}
              className={cn(editMode && 'cursor-grab active:cursor-grabbing')}
            >
              {navItem}
            </div>
          )
        })}
      </nav>

      {/* ── Footer ── */}
      <div className="px-1.5 py-2 border-t space-y-px" style={{ borderColor: 'var(--border)' }}>
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-all"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {theme === 'dark'
            ? <Sun size={14} className="opacity-70" />
            : <Moon size={14} className="opacity-70" />
          }
          <span>{theme === 'dark' ? '라이트 모드' : '다크 모드'}</span>
        </button>

        {/* Menu order toggle */}
        <button
          onClick={() => setEditMode(v => !v)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-all"
          style={{ color: editMode ? 'var(--accent)' : 'var(--text-secondary)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <GripVertical size={14} className="opacity-70" />
          <span>{editMode ? '순서 편집 완료' : '메뉴 순서 편집'}</span>
        </button>

        {editMode && (
          <button
            onClick={resetOrder}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[12px] transition-all"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span className="pl-5">↺ 기본 순서로 초기화</span>
          </button>
        )}

        <div style={{ height: '1px', background: 'var(--border)', margin: '4px 8px' }} />

        <Link
          href={`/project/${projectId}/settings`}
          className="flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-all"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <Settings size={14} className="opacity-70" />
          <span>설정</span>
        </Link>

        <form action="/api/auth/signout" method="post">
          <button
            type="submit"
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-all"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <LogOut size={14} className="opacity-70" />
            <span>로그아웃</span>
          </button>
        </form>
      </div>
    </aside>
  )
}
