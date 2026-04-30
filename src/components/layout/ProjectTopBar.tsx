'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  RefreshCw, Users, UserPlus, Bell, Settings, Search, ChevronDown, Folder,
} from 'lucide-react'
import ProjectMembersModal from './ProjectMembersModal'

interface PresenceMember {
  userId: string
  name: string
  avatar: string | null
  page: string
  pageLabel: string
  color: string
}

const PAGE_LABELS: Record<string, string> = {
  totaltree: '대시보드', script: '대본', 'scene-editor': '씬 경계',
  scenes: '씬 분류', assets: '에셋', t2i: 'T2I', i2v: 'I2V',
  lipsync: '립싱크', archive: '아카이브', t2v: 'T2V', settings: '설정',
  workspace: 'Workspace', review: 'Review', version: 'Version',
}

const AVATAR_COLORS = ['#f97316','#0284c7','#7c3aed','#22c55e','#ec4899','#eab308','#dc2626','#14b8a6']

function getPageSlug(pathname: string): string {
  return pathname.split('/').pop() ?? ''
}
function getAvatarColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = userId.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
function getInitials(name: string): string {
  if (!name) return '?'
  if (name.includes('@')) return name[0].toUpperCase()
  const w = name.trim().split(/\s+/)
  return w.length >= 2 ? (w[0][0] + w[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}

interface ProjectTopBarProps {
  projectId: string
  projectName: string
}

export default function ProjectTopBar({ projectId, projectName }: ProjectTopBarProps) {
  const pathname = usePathname()
  const supabase = createClient()
  const [members, setMembers] = useState<PresenceMember[]>([])
  const [totalPct, setTotalPct] = useState(0)
  const [counts, setCounts] = useState({ review: 0, revise: 0, generating: 0 })
  const [membersModalOpen, setMembersModalOpen] = useState(false)

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const userInfoRef = useRef<{ name: string; avatar: string | null } | null>(null)
  const currentSlug = getPageSlug(pathname)

  // ── 진행률 + 카운트 조회 ────────────────────────────────────
  const fetchStats = useCallback(async () => {
    const { data: scenes } = await supabase
      .from('scenes').select('id').eq('project_id', projectId)
    const total = scenes?.length ?? 0
    const sceneIds = scenes?.map(s => s.id) ?? []

    if (total === 0) {
      setTotalPct(0); setCounts({ review: 0, revise: 0, generating: 0 })
      return
    }

    const [{ data: mp }, { data: t2iA }, { data: i2vA }] = await Promise.all([
      supabase.from('master_prompts').select('scene_id').in('scene_id', sceneIds),
      supabase.from('prompt_attempts').select('scene_id, status').eq('type', 't2i').in('scene_id', sceneIds),
      supabase.from('prompt_attempts').select('scene_id, status').eq('type', 'i2v').in('scene_id', sceneIds),
    ])

    const mpDone = new Set((mp ?? []).map(r => r.scene_id)).size
    const t2iDone = new Set((t2iA ?? []).filter(a => a.status === 'done').map(a => a.scene_id)).size
    const i2vDone = new Set((i2vA ?? []).filter(a => a.status === 'done').map(a => a.scene_id)).size
    const generating =
      ((t2iA ?? []).filter(a => a.status === 'generating').length) +
      ((i2vA ?? []).filter(a => a.status === 'generating').length)

    const stages = [
      { done: mpDone, total }, { done: t2iDone, total }, { done: i2vDone, total },
    ].filter(s => s.total > 0)
    const avg = stages.length === 0 ? 0
      : Math.round(stages.reduce((acc, s) => acc + s.done / s.total, 0) / stages.length * 100)
    setTotalPct(avg)
    setCounts({
      review: Math.max(0, t2iDone - i2vDone),  // 검토 대기: T2I done이지만 I2V 미시작
      revise: 0,                                // (피드백 시스템 연결 시 채움)
      generating,
    })
  }, [projectId, supabase])

  useEffect(() => {
    fetchStats()
    const t = setInterval(fetchStats, 30_000)
    return () => clearInterval(t)
  }, [fetchStats])

  // ── Presence ────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !mounted) return
      const channel = supabase.channel(`presence:project:${projectId}`, {
        config: { presence: { key: user.id } },
      })
      channelRef.current = channel
      const meta = (user.user_metadata ?? {}) as Record<string, any>
      const name = String(meta.display_name ?? meta.full_name ?? user.email ?? user.id)
      const avatar = meta.avatar_url ?? null
      userInfoRef.current = { name, avatar }

      channel.on('presence', { event: 'sync' }, () => {
        if (!mounted) return
        const state = channel.presenceState<{ userId: string; name: string; avatar: string | null; page: string }>()
        const next: PresenceMember[] = []
        for (const [uid, presences] of Object.entries(state)) {
          if (!presences || presences.length === 0) continue
          if (uid === user.id) continue
          const p = presences[0]
          next.push({
            userId: uid,
            name: p.name ?? uid,
            avatar: p.avatar ?? null,
            page: p.page ?? '',
            pageLabel: PAGE_LABELS[p.page] ?? p.page ?? '',
            color: getAvatarColor(uid),
          })
        }
        setMembers(next)
      })

      await channel.subscribe(async (status) => {
        if (status !== 'SUBSCRIBED' || !mounted) return
        await channel.track({ userId: user.id, name, avatar, page: currentSlug })
      })
    })()
    return () => { mounted = false; channelRef.current?.unsubscribe() }
  }, [projectId, supabase])

  useEffect(() => {
    if (!channelRef.current || !userInfoRef.current) return
    void channelRef.current.track({
      userId: '', name: userInfoRef.current.name, avatar: userInfoRef.current.avatar, page: currentSlug,
    })
  }, [currentSlug])

  return (
    <>
      <div
        className="flex items-center gap-4 px-4 shrink-0"
        style={{
          height: 48, background: 'var(--bg-1)', borderBottom: '1px solid var(--line)',
        }}
      >
        {/* 브랜드 */}
        <Link href="/dashboard" className="flex items-center gap-2 shrink-0" style={{ width: 200 }}>
          <div
            className="av-1"
            style={{
              width: 24, height: 24, borderRadius: 6,
              display: 'grid', placeItems: 'center',
              fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 13,
            }}
          >
            R
          </div>
          <span
            style={{
              fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 20,
              letterSpacing: '-0.02em', color: 'var(--ink)',
            }}
          >
            Reel
          </span>
        </Link>

        <div style={{ width: 1, height: 18, background: 'var(--line)' }} />

        {/* 프로젝트 셀렉터 */}
        <button
          className="flex items-center gap-2"
          style={{
            padding: '4px 10px', borderRadius: 'var(--r-md)',
            fontWeight: 500, fontSize: 13, color: 'var(--ink)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <Folder size={14} />
          <span className="truncate" style={{ maxWidth: 200 }}>{projectName}</span>
          <ChevronDown size={14} style={{ opacity: 0.5 }} />
        </button>

        {/* 진행률 */}
        <div
          className="flex items-center gap-2.5 shrink-0"
          style={{
            padding: '4px 10px', background: 'var(--bg-2)',
            borderRadius: 'var(--r-md)', border: '1px solid var(--line)',
            fontSize: 12,
          }}
        >
          <span style={{ color: 'var(--ink-3)' }}>전체</span>
          <div
            style={{
              width: 80, height: 4, background: 'var(--bg-4)',
              borderRadius: 999, overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${totalPct}%`,
                background: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
                borderRadius: 999, transition: 'width 0.5s',
              }}
            />
          </div>
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{totalPct}%</span>
        </div>

        {/* 카운트 칩 */}
        <div className="flex gap-1.5 shrink-0">
          <StatChip dot="var(--warn)"   label="검토"   value={counts.review} />
          <StatChip dot="var(--accent)" label="수정"   value={counts.revise} />
          <StatChip dot="var(--violet)" label="생성중" value={counts.generating} pulse />
        </div>

        <div className="flex-1" />

        {/* 검색 (placeholder UI) */}
        <button
          className="flex items-center gap-2"
          style={{
            width: 280, padding: '6px 10px',
            background: 'var(--bg-2)', border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            color: 'var(--ink-3)', fontSize: 12,
          }}
          onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--line-strong)')}
          onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--line)')}
        >
          <Search size={13} />
          <span>Scene · Shot · Prompt 검색</span>
          <span
            className="kbd"
            style={{ marginLeft: 'auto' }}
          >⌘K</span>
        </button>

        {/* 프레젠스 아바타 스택 */}
        <div className="flex items-center shrink-0">
          {members.slice(0, 4).map((m, i) => (
            <div
              key={m.userId}
              title={`${m.name} · ${m.pageLabel || '작업 중'}`}
              style={{
                width: 24, height: 24, borderRadius: '50%',
                background: m.color, color: '#fff',
                display: 'grid', placeItems: 'center',
                fontSize: 10, fontWeight: 600,
                marginLeft: i > 0 ? -6 : 0,
                border: '2px solid var(--bg-1)',
                zIndex: 10 - i,
              }}
            >
              {getInitials(m.name)}
            </div>
          ))}
          {members.length > 4 && (
            <div
              style={{
                width: 24, height: 24, borderRadius: '50%',
                background: 'var(--bg-3)', border: '2px solid var(--bg-1)',
                display: 'grid', placeItems: 'center',
                fontSize: 10, color: 'var(--ink-3)',
                marginLeft: -6,
              }}
            >+{members.length - 4}</div>
          )}
        </div>

        {/* 팀원 관리 버튼 */}
        <button
          onClick={() => setMembersModalOpen(true)}
          title="팀원 관리"
          style={{
            width: 30, height: 30, borderRadius: 'var(--r-md)',
            display: 'grid', placeItems: 'center',
            color: 'var(--ink-3)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <UserPlus size={16} />
        </button>

        <button
          title="알림 (준비 중)"
          style={{
            width: 30, height: 30, borderRadius: 'var(--r-md)',
            display: 'grid', placeItems: 'center',
            color: 'var(--ink-3)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <Bell size={16} />
        </button>
      </div>

      <ProjectMembersModal
        projectId={projectId}
        open={membersModalOpen}
        onClose={() => setMembersModalOpen(false)}
      />
    </>
  )
}

function StatChip({
  dot, label, value, pulse,
}: { dot: string; label: string; value: number; pulse?: boolean }) {
  return (
    <button
      className="flex items-center gap-1.5"
      style={{
        padding: '4px 10px', borderRadius: 'var(--r-md)',
        background: 'var(--bg-2)', border: '1px solid var(--line)',
        color: 'var(--ink-3)', fontSize: 12,
      }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--line-strong)')}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--line)')}
    >
      <span
        className={pulse ? 'pulse' : ''}
        style={{ width: 6, height: 6, borderRadius: '50%', background: dot }}
      />
      <span>{label}</span>
      <span style={{ color: 'var(--ink)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </button>
  )
}
