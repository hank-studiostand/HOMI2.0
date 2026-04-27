'use client'

import { useEffect, useState, useRef } from 'react'
import { User, X, ChevronDown } from 'lucide-react'

interface MemberLite {
  user_id: string
  email: string
  display_name: string
  avatar_url: string
}

interface Props {
  projectId: string
  sceneId: string
  assignedTo: string | null | undefined
  onAssigned?: (userId: string | null) => void
  size?: 'sm' | 'md'
}

const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6']
function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
function initials(s: string) {
  if (!s) return '?'
  if (s.includes('@')) return s[0].toUpperCase()
  const w = s.trim().split(/\s+/)
  return w.length >= 2 ? (w[0][0] + w[1][0]).toUpperCase() : s.slice(0,2).toUpperCase()
}

// 모듈 단위 캐시 — 한 페이지에 같은 프로젝트의 picker 여러 개여도 1번만 호출
const memberCache = new Map<string, { ts: number; members: MemberLite[] }>()
const CACHE_MS = 30_000

async function loadMembers(projectId: string): Promise<MemberLite[]> {
  const hit = memberCache.get(projectId)
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.members
  const r = await fetch(`/api/projects/${projectId}/members`)
  if (!r.ok) return hit?.members ?? []
  const j = await r.json()
  const list: MemberLite[] = (j.members ?? []).map((m: any) => ({
    user_id: m.user_id,
    email: m.email,
    display_name: m.display_name,
    avatar_url: m.avatar_url,
  }))
  memberCache.set(projectId, { ts: Date.now(), members: list })
  return list
}

export default function AssigneePicker({
  projectId, sceneId, assignedTo, onAssigned, size = 'sm',
}: Props) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<MemberLite[]>([])
  const [pending, setPending] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    void loadMembers(projectId).then(setMembers)
  }, [open, projectId])

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const current = members.find(m => m.user_id === assignedTo)
  const dim = size === 'sm' ? 22 : 28
  const fontSize = size === 'sm' ? 9 : 11

  async function assign(userId: string | null) {
    setPending(true)
    try {
      const r = await fetch('/api/scenes/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId, assignedTo: userId }),
      })
      if (r.ok) onAssigned?.(userId)
    } finally {
      setPending(false)
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
        disabled={pending}
        className="flex items-center gap-1 rounded-full transition-all hover:scale-105"
        style={{
          padding: '2px',
          background: current ? 'transparent' : 'var(--surface-3)',
          border: current ? 'none' : '1px dashed var(--border)',
        }}
        title={current ? `담당: ${current.display_name || current.email}` : '담당자 지정'}
      >
        {current ? (
          <span
            className="rounded-full flex items-center justify-center font-bold text-white"
            style={{
              width: dim, height: dim,
              background: colorFor(current.user_id),
              fontSize,
            }}
          >
            {current.avatar_url
              ? <img src={current.avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
              : initials(current.display_name || current.email)}
          </span>
        ) : (
          <span
            className="rounded-full flex items-center justify-center"
            style={{ width: dim, height: dim, color: 'var(--text-muted)' }}
          >
            <User size={size === 'sm' ? 10 : 13} />
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 z-30 rounded-lg shadow-lg overflow-hidden"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            minWidth: '200px',
          }}
        >
          <div className="px-3 py-2 text-[10px] uppercase tracking-wide"
            style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            담당자 지정
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); assign(null) }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover-surface text-left"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X size={11} />
            <span>담당자 없음</span>
          </button>

          <div className="max-h-56 overflow-y-auto">
            {members.map(m => (
              <button
                key={m.user_id}
                onClick={(e) => { e.stopPropagation(); assign(m.user_id) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover-surface text-left"
              >
                <span
                  className="rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                  style={{ width: 18, height: 18, background: colorFor(m.user_id) }}
                >
                  {m.avatar_url
                    ? <img src={m.avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
                    : initials(m.display_name || m.email)}
                </span>
                <span className="truncate" style={{ color: 'var(--text-primary)' }}>
                  {m.display_name || m.email}
                </span>
              </button>
            ))}
            {members.length === 0 && (
              <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                멤버를 먼저 초대해주세요.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
