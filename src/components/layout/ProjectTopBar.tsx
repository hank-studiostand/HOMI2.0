'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  FileText, Scissors, Layers, Image, Video, Mic,
  RefreshCw, Users,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StageStats {
  label: string
  key: string
  icon: React.ElementType
  done: number
  total: number
  href: string
}

interface PresenceMember {
  userId: string
  name: string
  avatar: string | null
  page: string        // 현재 보고 있는 페이지 경로 slug
  pageLabel: string
  color: string       // 아바타 배경 고유 색상
  joinedAt: string
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

const PAGE_LABELS: Record<string, string> = {
  'totaltree':    '토탈트리',
  'script':       '대본',
  'scene-editor': '씬 경계 편집',
  'scenes':       '씬 분류',
  'assets':       '에셋',
  't2i':          'T2I',
  'i2v':          'I2V',
  'lipsync':      '립싱크',
  'archive':      '아카이브',
  't2v':          'T2V',
  'settings':     '설정',
}

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
]

function getPageSlug(pathname: string): string {
  const parts = pathname.split('/')
  return parts[parts.length - 1] ?? ''
}

function getAvatarColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  if (!name) return '?'
  // 이메일인 경우
  if (name.includes('@')) return name[0].toUpperCase()
  const words = name.trim().split(/\s+/)
  return words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

// ─── Stage Pill ───────────────────────────────────────────────────────────────

function StagePill({
  stage, isActive, onClick,
}: {
  stage: StageStats; isActive: boolean; onClick: () => void
}) {
  const Icon   = stage.icon
  const pct    = stage.total === 0 ? 0 : Math.round((stage.done / stage.total) * 100)
  const isDone = pct === 100

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all shrink-0"
      style={{
        background: isActive
          ? 'var(--accent-subtle)'
          : isDone
            ? 'var(--success-bg)'
            : 'var(--surface-3)',
        border: `1px solid ${isActive ? 'var(--accent)' : isDone ? 'var(--success)' : 'var(--border)'}`,
        color: isActive ? 'var(--accent)' : isDone ? 'var(--success)' : 'var(--text-secondary)',
      }}
    >
      <Icon size={11} />
      <span className="text-[11px] font-medium">{stage.label}</span>
      <span
        className="text-[10px] font-mono tabular-nums"
        style={{
          color: isActive ? 'var(--accent)' : isDone ? 'var(--success)' : 'var(--text-muted)',
        }}
      >
        {stage.done}/{stage.total}
      </span>
    </button>
  )
}

// ─── Member Avatar ────────────────────────────────────────────────────────────

function MemberAvatar({
  member, showTooltip,
}: {
  member: PresenceMember; showTooltip: boolean
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ring-2 shrink-0"
        style={{
          background: member.color,
          outline: '2px solid var(--background)',
        }}
      >
        {member.avatar
          ? <img src={member.avatar} className="w-full h-full rounded-full object-cover" alt="" />
          : getInitials(member.name)
        }
      </div>

      {/* 온라인 dot */}
      <div
        className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
        style={{ background: 'var(--success)', outline: '2px solid var(--background)' }}
      />

      {/* Tooltip */}
      {(hovered || showTooltip) && (
        <div
          className="absolute top-full right-0 mt-2 z-50 flex flex-col gap-0.5 p-2.5 rounded-xl shadow-xl whitespace-nowrap"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            minWidth: '140px',
          }}
        >
          <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            {member.name}
          </p>
          <div className="flex items-center gap-1 mt-0.5">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--success)' }}
            />
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {member.pageLabel || '작업 중'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main TopBar ──────────────────────────────────────────────────────────────

interface ProjectTopBarProps {
  projectId: string
  projectName: string
}

export default function ProjectTopBar({ projectId, projectName }: ProjectTopBarProps) {
  const pathname = usePathname()
  const supabase = createClient()

  const [stages, setStages]           = useState<StageStats[]>([])
  const [members, setMembers]         = useState<PresenceMember[]>([])
  const [totalPct, setTotalPct]       = useState(0)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [loading, setLoading]         = useState(true)
  const [activeStage, setActiveStage] = useState<string | null>(null)

  const channelRef  = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const userInfoRef = useRef<{ name: string; avatar: string | null } | null>(null)

  const currentSlug = getPageSlug(pathname)

  // ── 씬 완료도 조회 ───────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    // 전체 씬 수
    const { data: scenes } = await supabase
      .from('scenes').select('id').eq('project_id', projectId)
    const total = scenes?.length ?? 0
    const sceneIds = scenes?.map(s => s.id) ?? []

    if (total === 0) {
      setStages(buildStages(0, 0, 0, 0, 0))
      setTotalPct(0)
      setLoading(false)
      return
    }

    // 마스터 프롬프트 있는 씬 (씬분류 완료)
    const { data: mpScenes } = await supabase
      .from('master_prompts').select('scene_id').in('scene_id', sceneIds)
    const mpDone = new Set(mpScenes?.map(r => r.scene_id) ?? []).size

    // T2I 아카이브 완료된 씬
    const { data: t2iAttempts } = await supabase
      .from('prompt_attempts').select('id, scene_id').eq('type', 't2i').in('scene_id', sceneIds)
    const t2iIds = t2iAttempts?.map(a => a.id) ?? []
    let t2iDone = 0
    if (t2iIds.length > 0) {
      const { data: t2iOutputs } = await supabase
        .from('attempt_outputs').select('attempt_id').eq('archived', true).in('attempt_id', t2iIds)
      const t2iDoneScenes = new Set(
        (t2iOutputs ?? []).map(o => t2iAttempts?.find(a => a.id === o.attempt_id)?.scene_id).filter(Boolean)
      )
      t2iDone = t2iDoneScenes.size
    }

    // I2V 완료된 씬
    const { data: i2vAttempts } = await supabase
      .from('prompt_attempts').select('scene_id').eq('type', 'i2v').eq('status', 'done').in('scene_id', sceneIds)
    const i2vDone = new Set(i2vAttempts?.map(a => a.scene_id) ?? []).size

    // 립싱크 완료된 씬
    const { data: lipAttempts } = await supabase
      .from('prompt_attempts').select('scene_id').eq('type', 'lipsync').eq('status', 'done').in('scene_id', sceneIds)
    const lipDone = new Set(lipAttempts?.map(a => a.scene_id) ?? []).size

    const newStages = buildStages(total, mpDone, t2iDone, i2vDone, lipDone)
    setStages(newStages)

    // 전체 진행률 = 각 스테이지 평균
    const staged = newStages.filter(s => s.total > 0)
    const avg = staged.length === 0 ? 0
      : staged.reduce((acc, s) => acc + s.done / s.total, 0) / staged.length * 100
    setTotalPct(Math.round(avg))
    setLoading(false)
  }, [projectId])

  function buildStages(
    total: number, mpDone: number, t2iDone: number, i2vDone: number, lipDone: number,
  ): StageStats[] {
    return [
      { key: 'scenes',       label: '씬 분류', icon: Layers,   done: mpDone,  total, href: 'scenes'  },
      { key: 't2i',          label: 'T2I',    icon: Image,    done: t2iDone, total, href: 't2i'     },
      { key: 'i2v',          label: 'I2V',    icon: Video,    done: i2vDone, total, href: 'i2v'     },
      { key: 'lipsync',      label: '립싱크',  icon: Mic,      done: lipDone, total, href: 'lipsync' },
    ]
  }

  // ── Supabase Realtime Presence ────────────────────────────────────────────
  useEffect(() => {
    let mounted = true

    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !mounted) return
      setCurrentUserId(user.id)

      const channel = supabase.channel(`presence:project:${projectId}`, {
        config: { presence: { key: user.id } },
      })

      channelRef.current = channel

      channel.on('presence', { event: 'sync' }, () => {
        if (!mounted) return
        const state = channel.presenceState<{
          userId: string; name: string; avatar: string | null; page: string
        }>()

        const newMembers: PresenceMember[] = []
        for (const [userId, presences] of Object.entries(state)) {
          if (!presences || presences.length === 0) continue
          const p = presences[0]
          // 본인 제외
          if (userId === user.id) continue
          newMembers.push({
            userId,
            name:      p.name ?? p.userId ?? userId,
            avatar:    p.avatar ?? null,
            page:      p.page ?? '',
            pageLabel: PAGE_LABELS[p.page] ?? p.page ?? '',
            color:     getAvatarColor(userId),
            joinedAt:  new Date().toISOString(),
          })
        }
        setMembers(newMembers)
      })

      const name   = user.user_metadata?.full_name ?? user.email ?? user.id
      const avatar = user.user_metadata?.avatar_url ?? null
      userInfoRef.current = { name, avatar }

      await channel.subscribe(async (status) => {
        if (status !== 'SUBSCRIBED' || !mounted) return
        await channel.track({
          userId: user.id,
          name,
          avatar,
          page: currentSlug,
        })
      })
    }

    init()
    return () => {
      mounted = false
      channelRef.current?.unsubscribe()
    }
  }, [projectId])

  // 페이지 변경 시 presence 업데이트 (currentSlug 변경 감지)
  useEffect(() => {
    if (!channelRef.current || !currentUserId || !userInfoRef.current) return
    channelRef.current.track({
      userId: currentUserId,
      name:   userInfoRef.current.name,
      avatar: userInfoRef.current.avatar,
      page:   currentSlug,
    })
  }, [currentSlug, currentUserId])

  // 통계 주기적 새로고침 (30초)
  useEffect(() => {
    fetchStats()
    const t = setInterval(fetchStats, 30_000)
    return () => clearInterval(t)
  }, [fetchStats])

  // ── 전체 진행 바 퍼센트 색상 ──────────────────────────────────────────────
  const barColor =
    totalPct === 100 ? 'var(--success)' :
    totalPct >= 50   ? 'var(--accent)'  :
    totalPct >= 20   ? 'var(--warning)' :
    'var(--text-muted)'

  return (
    <div
      className="flex items-center gap-3 px-4 border-b shrink-0"
      style={{
        height: '44px',
        background: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
    >
      {/* ── 전체 진행 바 ── */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="relative w-24 h-1.5 rounded-full overflow-hidden"
          style={{ background: 'var(--surface-3)' }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
            style={{ width: `${totalPct}%`, background: barColor }}
          />
        </div>
        <span className="text-[11px] font-mono tabular-nums shrink-0"
          style={{ color: barColor, minWidth: '28px' }}>
          {totalPct}%
        </span>
      </div>

      {/* 구분선 */}
      <div className="w-px h-4 shrink-0" style={{ background: 'var(--border)' }} />

      {/* ── 스테이지 Pills ── */}
      {loading ? (
        <div className="flex gap-1.5">
          {[80, 60, 60, 64].map((w, i) => (
            <div key={i} className="h-6 rounded-lg animate-pulse shrink-0"
              style={{ width: w, background: 'var(--surface-3)' }} />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {stages.map(stage => (
            <StagePill
              key={stage.key}
              stage={stage}
              isActive={currentSlug === stage.href}
              onClick={() => setActiveStage(activeStage === stage.key ? null : stage.key)}
            />
          ))}
        </div>
      )}

      {/* 새로고침 */}
      <button
        onClick={fetchStats}
        className="p-1 rounded-md transition-all hover-surface shrink-0"
        style={{ color: 'var(--text-muted)' }}
        title="통계 새로고침"
      >
        <RefreshCw size={11} />
      </button>

      {/* 스페이서 */}
      <div className="flex-1" />

      {/* ── 팀원 프레전스 ── */}
      <div className="flex items-center gap-2 shrink-0">
        {members.length > 0 && (
          <>
            <div className="flex items-center" style={{ gap: '-4px' }}>
              {/* 겹치는 아바타 스택 */}
              <div className="flex">
                {members.slice(0, 5).map((m, i) => (
                  <div
                    key={m.userId}
                    className="relative"
                    style={{ marginLeft: i > 0 ? '-8px' : 0, zIndex: members.length - i }}
                  >
                    <MemberAvatar member={m} showTooltip={false} />
                  </div>
                ))}
                {members.length > 5 && (
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold -ml-2"
                    style={{
                      background: 'var(--surface-3)',
                      border: '2px solid var(--background)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    +{members.length - 5}
                  </div>
                )}
              </div>
            </div>

            {/* 현재 페이지별 그룹 표시 */}
            <MembersOnPagePill members={members} currentSlug={currentSlug} />
          </>
        )}

        {members.length === 0 && (
          <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
            <Users size={12} />
            <span className="text-[11px]">나만 접속 중</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 같은 페이지에 있는 팀원 pill ─────────────────────────────────────────────
function MembersOnPagePill({
  members, currentSlug,
}: {
  members: PresenceMember[]; currentSlug: string
}) {
  const samePageMembers = members.filter(m => m.page === currentSlug)
  if (samePageMembers.length === 0) return null

  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px]"
      style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}
    >
      <Users size={10} />
      <span>이 페이지에 {samePageMembers.length}명</span>
    </div>
  )
}
