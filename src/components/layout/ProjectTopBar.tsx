'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  RefreshCw, Users, UserPlus, Bell, Settings, Search, ChevronDown, Folder, Sun, Moon, X, Loader2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import ProjectMembersModal from './ProjectMembersModal'
import { useTheme } from '@/components/theme/ThemeProvider'

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
  scenes: '씬 분류', assets: '에셋', t2i: '이미지 라이브러리', i2v: '영상 라이브러리', trash: '휴지통',
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
  const router = useRouter()
  const supabase = createClient()
  const [members, setMembers] = useState<PresenceMember[]>([])
  const [totalPct, setTotalPct] = useState(0)
  const [counts, setCounts] = useState({ review: 0, revise: 0, generating: 0 })
  const [membersModalOpen, setMembersModalOpen] = useState(false)
  // 다크모드 — 사이드바와 단일 source (ThemeProvider hook)
  const { theme, toggle: toggleTheme } = useTheme()
  // ⌘K
  const [searchOpen, setSearchOpen] = useState(false)
  // 알림
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifs, setNotifs] = useState<{ id: string; title: string; subtitle: string; created_at: string; scene_id: string }[]>([])

  // ⌘K 단축키
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 최근 알림 조회 + Realtime
  useEffect(() => {
    let active = true
    void (async () => {
      const { data: scenes } = await supabase
        .from('scenes').select('id, scene_number, title').eq('project_id', projectId)
      if (!active || !scenes) return
      const sceneById = new Map(scenes.map((s: any) => [s.id, s]))
      const ids = scenes.map((s: any) => s.id)
      if (ids.length === 0) return
      const { data: atts } = await supabase
        .from('prompt_attempts')
        .select('id, scene_id, type, status, created_at')
        .in('scene_id', ids)
        .in('status', ['done', 'completed', 'failed'])
        .order('created_at', { ascending: false })
        .limit(15)
      if (!active) return
      setNotifs((atts ?? []).map((a: any) => {
        const sc = sceneById.get(a.scene_id) as any
        return {
          id: a.id,
          title: a.status === 'failed'
            ? `${a.type === 't2i' ? '이미지' : '영상'} 생성 실패`
            : `${a.type === 't2i' ? '이미지' : '영상'} 생성 완료`,
          subtitle: sc ? `${sc.scene_number} ${sc.title || ''}`.trim() : '',
          created_at: a.created_at,
          scene_id: a.scene_id,
        }
      }))
    })()
    return () => { active = false }
  }, [projectId, supabase])

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
            H
          </div>
          <span
            style={{
              fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 22,
              letterSpacing: '-0.02em', color: 'var(--ink)',
            }}
          >
            HOMI
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
          onClick={() => setSearchOpen(true)}
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

        {/* 다크모드 토글 */}
        <button
          onClick={toggleTheme}
          title={theme === 'light' ? '다크모드로' : '라이트모드로'}
          style={{
            width: 30, height: 30, borderRadius: 'var(--r-md)',
            display: 'grid', placeItems: 'center',
            color: 'var(--ink-3)',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
        </button>

        {/* 알림 종 */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setNotifOpen(v => !v)}
            title="알림"
            style={{
              width: 30, height: 30, borderRadius: 'var(--r-md)',
              display: 'grid', placeItems: 'center',
              color: 'var(--ink-3)',
              position: 'relative',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <Bell size={16} />
            {notifs.length > 0 && (
              <span
                style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--accent)',
                }}
              />
            )}
          </button>
          {notifOpen && (
            <>
              <div onClick={() => setNotifOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div
                style={{
                  position: 'absolute', right: 0, top: 36, zIndex: 41,
                  width: 320, maxHeight: 420, overflowY: 'auto',
                  background: 'var(--bg-2)', border: '1px solid var(--line)',
                  borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-lg)',
                }}
              >
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 600 }}>
                  최근 알림 ({notifs.length})
                </div>
                {notifs.length === 0 ? (
                  <div className="empty" style={{ padding: 16, fontSize: 12 }}>아직 없어요</div>
                ) : notifs.map(n => (
                  <button
                    key={n.id}
                    onClick={() => {
                      setNotifOpen(false)
                      router.push(`/project/${projectId}/workspace?scene=${n.scene_id}`)
                    }}
                    className="flex flex-col"
                    style={{
                      width: '100%', padding: '8px 12px',
                      gap: 2, textAlign: 'left',
                      borderBottom: '1px solid var(--line)',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{n.title}</span>
                    {n.subtitle && (
                      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{n.subtitle}</span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                      {new Date(n.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {searchOpen && (
        <SearchModal projectId={projectId} onClose={() => setSearchOpen(false)} />
      )}

      <ProjectMembersModal
        projectId={projectId}
        open={membersModalOpen}
        onClose={() => setMembersModalOpen(false)}
      />
    </>
  )
}

// ─── ⌘K 검색 모달 ──────────────────────────────────────────
function SearchModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const router = useRouter()
  const supabase = createClient()
  const [q, setQ] = useState('')
  const [scenes, setScenes] = useState<{ id: string; scene_number: string; title: string }[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    void (async () => {
      const { data } = await supabase
        .from('scenes')
        .select('id, scene_number, title')
        .eq('project_id', projectId)
        .order('order_index')
      setScenes(data ?? [])
      setLoading(false)
    })()
  }, [projectId, supabase])

  const filtered = q.trim()
    ? scenes.filter(s =>
        s.scene_number?.includes(q) ||
        (s.title ?? '').toLowerCase().includes(q.toLowerCase()),
      )
    : scenes.slice(0, 20)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4"
      style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg shadow-lg"
        style={{
          background: 'var(--bg-2)', border: '1px solid var(--line)',
          borderRadius: 'var(--r-xl)', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
          <Search size={14} style={{ color: 'var(--ink-3)' }} />
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="씬 번호 또는 제목으로 검색..."
            style={{
              flex: 1, background: 'transparent', border: 'none',
              fontSize: 14, color: 'var(--ink)', outline: 'none',
            }}
          />
          <span className="kbd" style={{ fontSize: 10, padding: '1px 6px', background: 'var(--bg-3)', borderRadius: 4, color: 'var(--ink-4)' }}>ESC</span>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {loading && <div className="empty" style={{ padding: 20, fontSize: 12 }}><Loader2 size={14} className="animate-spin" /></div>}
          {!loading && filtered.length === 0 && <div className="empty" style={{ padding: 20, fontSize: 12 }}>일치하는 씬이 없어요</div>}
          {filtered.map(s => (
            <button
              key={s.id}
              onClick={() => {
                router.push(`/project/${projectId}/workspace?scene=${s.id}`)
                onClose()
              }}
              className="flex items-center gap-3 w-full text-left"
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--line)',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', minWidth: 50 }}>
                {s.scene_number}
              </span>
              <span style={{ fontSize: 13, color: 'var(--ink)', flex: 1 }} className="truncate">
                {s.title || '(제목 없음)'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
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
