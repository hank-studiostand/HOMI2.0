'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Image as ImageIcon, Film, Filter, Loader2,
  CheckCircle2, RotateCcw, Trash2, Eye, Search, X,
} from 'lucide-react'
import Pill, { type PillVariant } from '@/components/ui/Pill'
import { sortScenesByNumber, compareSceneNumbers } from '@/lib/sceneSort'

// 미디어 브라우저 — 프로젝트 전체에서 생성된 결과물을 시간/씬/상태별로 둘러보기.
// /t2i, /i2v 사이드바 진입점으로, 씬 카드 그리드 (= /scenes)와 차별화된 결과-중심 뷰.

type MediaType = 't2i' | 'i2v'
type DecisionType = 'approved' | 'revise_requested' | 'removed'
type FilterStatus = 'all' | 'pending' | 'approved' | 'revise_requested' | 'removed'

interface MediaItem {
  id: string
  attempt_id: string
  type: MediaType | 'lipsync'
  url: string | null
  engine: string
  created_at: string
  archived: boolean
  satisfaction_score: number | null
  scene_id: string
  scene_number: string
  scene_title: string
  decision: DecisionType | null
}

const STATUS_OPTIONS: { v: FilterStatus; label: string; variant?: PillVariant; icon?: any }[] = [
  { v: 'all',              label: '전체' },
  { v: 'pending',          label: '검토 대기',  variant: 'review',   icon: Eye },
  { v: 'approved',         label: '승인',       variant: 'approved', icon: CheckCircle2 },
  { v: 'revise_requested', label: '수정 요청',  variant: 'revise',   icon: RotateCcw },
  { v: 'removed',          label: '제거',       variant: 'removed',  icon: Trash2 },
]

interface Props {
  type: MediaType
}

export default function MediaBrowser({ type }: Props) {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [scenesList, setScenesList] = useState<{ id: string; scene_number: string; title: string }[]>([])

  const [filterScene, setFilterScene] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [filterEngine, setFilterEngine] = useState<string>('all')
  const [search, setSearch] = useState('')

  const loadAll = async () => {
      setLoading(true)

      const { data: scenes } = await supabase
        .from('scenes').select('id, scene_number, title').eq('project_id', projectId)
      const list = sortScenesByNumber((scenes ?? []) as any)
      setScenesList(list as any)
      const sceneIds = list.map((s: any) => s.id)
      const sceneById = new Map<string, any>(list.map((s: any) => [s.id, s]))

      if (sceneIds.length === 0) { setItems([]); setLoading(false); return }

      const [{ data: attempts }, { data: decRows }] = await Promise.all([
        supabase
          .from('prompt_attempts')
          .select('id, scene_id, type, engine, created_at, status, outputs:attempt_outputs(*, asset:assets(url))')
          .in('scene_id', sceneIds)
          .eq('type', type)
          .order('created_at', { ascending: false }),
        supabase
          .from('shot_decisions')
          .select('output_id, decision_type, created_at')
          .in('scene_id', sceneIds)
          .order('created_at', { ascending: false }),
      ])

      const latestByOutput = new Map<string, DecisionType>()
      for (const d of (decRows ?? []) as any[]) {
        if (!latestByOutput.has(d.output_id)) latestByOutput.set(d.output_id, d.decision_type)
      }

      const all: MediaItem[] = []
      for (const a of (attempts ?? []) as any[]) {
        const sc = sceneById.get(a.scene_id)
        if (!sc) continue
        for (const o of (a.outputs ?? [])) {
          const url = o.url ?? o.asset?.url ?? null
          if (!url) continue
          all.push({
            id: o.id,
            attempt_id: a.id,
            type: a.type,
            url,
            engine: a.engine,
            created_at: o.created_at ?? a.created_at,
            archived: o.archived ?? false,
            satisfaction_score: o.satisfaction_score,
            scene_id: a.scene_id,
            scene_number: sc.scene_number,
            scene_title: sc.title ?? '',
            decision: latestByOutput.get(o.id) ?? null,
          })
        }
      }
      all.sort((a, b) => {
        const c = compareSceneNumbers(a.scene_number, b.scene_number)
        if (c !== 0) return c
        return b.created_at.localeCompare(a.created_at)
      })
      setItems(all)
      setLoading(false)
  }

  useEffect(() => {
    void loadAll()
    let timer: ReturnType<typeof setTimeout> | null = null
    const debouncedReload = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void loadAll() }, 400)
    }
    const ch = supabase
      .channel(`media-browser-${type}-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prompt_attempts' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attempt_outputs' }, debouncedReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shot_decisions' }, debouncedReload)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, type, supabase])

  // 엔진 옵션 (현재 결과에서 추출)
  const engineOptions = useMemo(() => {
    const set = new Set<string>()
    for (const it of items) set.add(it.engine)
    return ['all', ...Array.from(set).sort()]
  }, [items])

  // 필터 적용
  const filtered = useMemo(() => {
    return items.filter(it => {
      if (filterScene !== 'all' && it.scene_id !== filterScene) return false
      if (filterEngine !== 'all' && it.engine !== filterEngine) return false
      if (filterStatus !== 'all') {
        if (filterStatus === 'pending' && it.decision) return false
        if (filterStatus !== 'pending' && it.decision !== filterStatus) return false
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const hay = `${it.scene_number} ${it.scene_title} ${it.engine}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, filterScene, filterStatus, filterEngine, search])

  const counts = useMemo(() => {
    const c = { all: items.length, pending: 0, approved: 0, revise_requested: 0, removed: 0 }
    for (const it of items) {
      if (!it.decision) c.pending++
      else if (it.decision === 'approved') c.approved++
      else if (it.decision === 'revise_requested') c.revise_requested++
      else if (it.decision === 'removed') c.removed++
    }
    return c
  }, [items])

  const Icon = type === 't2i' ? ImageIcon : Film
  const title = type === 't2i' ? '이미지 라이브러리' : '영상 라이브러리'
  const subtitle = type === 't2i'
    ? '프로젝트에서 생성된 모든 이미지를 씬 순서대로 둘러보세요.'
    : '프로젝트에서 생성된 모든 영상을 씬 순서대로 둘러보세요.'

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div
        style={{
          padding: '20px 28px 14px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--bg)',
          position: 'sticky', top: 0, zIndex: 3,
        }}
      >
        <div className="flex items-end justify-between" style={{ gap: 16 }}>
          <div>
            <div className="flex items-center" style={{ gap: 8 }}>
              <Icon size={20} style={{ color: 'var(--accent)' }} />
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                {title}
              </h1>
            </div>
            <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>
              {subtitle} · 총 {items.length}개
            </p>
          </div>

          {/* 검색 */}
          <div className="relative" style={{ width: 280 }}>
            <Search size={13} className="absolute" style={{ left: 10, top: 9, color: 'var(--ink-4)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="씬 번호 / 제목 / 엔진 검색..."
              style={{
                width: '100%', padding: '6px 10px 6px 30px',
                background: 'var(--bg-2)', border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                color: 'var(--ink)', fontSize: 12,
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* 필터 바 */}
        <div className="flex items-center" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {/* 상태 칩 */}
          {STATUS_OPTIONS.map(opt => {
            const active = filterStatus === opt.v
            const count = counts[opt.v as keyof typeof counts] ?? 0
            return (
              <button
                key={opt.v}
                onClick={() => setFilterStatus(opt.v)}
                className="flex items-center"
                style={{
                  padding: '4px 10px', gap: 5,
                  borderRadius: 'var(--r-md)',
                  fontSize: 11, fontWeight: 500,
                  background: active ? 'var(--accent-soft)' : 'var(--bg-2)',
                  color: active ? 'var(--accent)' : 'var(--ink-3)',
                  border: `1px solid ${active ? 'var(--accent-line)' : 'var(--line)'}`,
                }}
              >
                {opt.icon ? <opt.icon size={11} /> : null}
                {opt.label}
                <span style={{ fontSize: 10, color: active ? 'var(--accent-2)' : 'var(--ink-4)' }}>
                  {count}
                </span>
              </button>
            )
          })}

          <span style={{ flex: 1 }} />

          {/* 씬 선택 */}
          <select
            value={filterScene}
            onChange={e => setFilterScene(e.target.value)}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--r-md)', fontSize: 11,
              background: 'var(--bg-2)', border: '1px solid var(--line)',
              color: 'var(--ink-2)', outline: 'none',
            }}
          >
            <option value="all">전체 씬</option>
            {scenesList.map(s => (
              <option key={s.id} value={s.id}>
                {s.scene_number} {s.title || ''}
              </option>
            ))}
          </select>

          {/* 엔진 */}
          <select
            value={filterEngine}
            onChange={e => setFilterEngine(e.target.value)}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--r-md)', fontSize: 11,
              background: 'var(--bg-2)', border: '1px solid var(--line)',
              color: 'var(--ink-2)', outline: 'none',
            }}
          >
            {engineOptions.map(e => (
              <option key={e} value={e}>
                {e === 'all' ? '전체 엔진' : e}
              </option>
            ))}
          </select>

          {(filterScene !== 'all' || filterStatus !== 'all' || filterEngine !== 'all' || search.trim()) && (
            <button
              onClick={() => { setFilterScene('all'); setFilterStatus('all'); setFilterEngine('all'); setSearch('') }}
              style={{
                padding: '4px 10px', borderRadius: 'var(--r-md)',
                fontSize: 11, color: 'var(--ink-3)',
                background: 'transparent', border: '1px solid var(--line)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              <X size={11} /> 필터 해제
            </button>
          )}
        </div>
      </div>

      {/* 그리드 */}
      <div className="flex-1 overflow-auto" style={{ padding: '16px 28px 28px' }}>
        {loading ? (
          <div className="empty" style={{ padding: 64, textAlign: 'center' }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <p style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-3)' }}>불러오는 중...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty" style={{ padding: 64, textAlign: 'center' }}>
            <Filter size={20} style={{ color: 'var(--ink-4)' }} />
            <p style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-3)' }}>
              {items.length === 0 ? '아직 생성된 결과가 없어요' : '필터에 맞는 결과가 없어요'}
            </p>
            {items.length > 0 && (
              <button
                onClick={() => { setFilterScene('all'); setFilterStatus('all'); setFilterEngine('all'); setSearch('') }}
                style={{
                  marginTop: 10,
                  padding: '5px 12px', borderRadius: 'var(--r-sm)',
                  fontSize: 11, color: 'var(--accent)',
                  background: 'var(--accent-soft)', border: '1px solid var(--accent-line)',
                }}
              >
                필터 해제
              </button>
            )}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 14,
            }}
          >
            {filtered.map(it => (
              <MediaCard
                key={it.id}
                item={it}
                onClick={() => router.push(`/project/${projectId}/workspace?scene=${it.scene_id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MediaCard({ item, onClick }: { item: MediaItem; onClick: () => void }) {
  const decisionMeta: Record<DecisionType, { label: string; variant: PillVariant }> = {
    approved: { label: '승인', variant: 'approved' },
    revise_requested: { label: '수정요청', variant: 'revise' },
    removed: { label: '제거', variant: 'removed' },
  }
  const meta = item.decision ? decisionMeta[item.decision] : null
  return (
    <button
      onClick={onClick}
      title={`${item.scene_number} ${item.scene_title}`}
      style={{
        padding: 0, textAlign: 'left',
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.12s, transform 0.12s',
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = 'var(--accent)'
        el.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = 'var(--line)'
        el.style.transform = 'translateY(0)'
      }}
    >
      <div style={{ aspectRatio: '16/9', background: 'var(--bg-3)', position: 'relative' }}>
        {item.url && (
          item.type === 't2i'
            ? <img src={item.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <video src={item.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {/* 좌상단 — 씬 번호 */}
        <div
          style={{
            position: 'absolute', top: 6, left: 6,
            padding: '2px 7px', borderRadius: 'var(--r-sm)',
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            fontSize: 10, fontWeight: 600,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {item.scene_number}
        </div>
        {/* 우상단 — 결정 배지 */}
        {meta && (
          <div style={{ position: 'absolute', top: 6, right: 6 }}>
            <Pill variant={meta.variant}>{meta.label}</Pill>
          </div>
        )}
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div className="truncate" style={{ fontSize: 12, color: 'var(--ink)', marginBottom: 2 }}>
          {item.scene_title || '(제목 없음)'}
        </div>
        <div className="flex items-center" style={{ gap: 6, fontSize: 10, color: 'var(--ink-4)' }}>
          <span className="mono">{item.engine}</span>
          <span>·</span>
          <span>
            {new Date(item.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>
    </button>
  )
}
