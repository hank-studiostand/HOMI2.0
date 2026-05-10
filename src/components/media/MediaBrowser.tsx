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
import ImageLightbox, { type LightboxItem } from '@/components/ui/ImageLightbox'

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
  source: 'workspace' | 'studio'
}

type SourceFilter = 'all' | 'workspace' | 'studio'
type SortMode    = 'newest' | 'rating' | 'scene'

const STATUS_OPTIONS: { v: FilterStatus; label: string; variant?: PillVariant; icon?: any }[] = [
  { v: 'all',              label: '전체' },
  { v: 'pending',          label: '검토 대기',  variant: 'review',   icon: Eye },
  { v: 'approved',         label: '승인',       variant: 'approved', icon: CheckCircle2 },
  { v: 'revise_requested', label: '수정 요청',  variant: 'revise',   icon: RotateCcw },
  { v: 'removed',          label: '제거',       variant: 'removed',  icon: Trash2 },
]

interface Props {
  type: MediaType
  // 출처 잠금 — 'workspace' 또는 'studio' 으로 고정 시 칩 토글 숨기고 헤더 라벨도 갱신
  lockSource?: 'workspace' | 'studio'
  // 라이브러리 라벨 커스터마이즈 (예: "Studio 이미지 라이브러리")
  titleOverride?: string
  subtitleOverride?: string
}

export default function MediaBrowser({ type, lockSource, titleOverride, subtitleOverride }: Props) {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [scenesList, setScenesList] = useState<{ id: string; scene_number: string; title: string }[]>([])

  const [filterScene, setFilterScene] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [filterEngine, setFilterEngine] = useState<string>('all')
  const [filterSource, setFilterSource] = useState<SourceFilter>(lockSource ?? 'all')
  const [sortMode, setSortMode] = useState<SortMode>('scene')
  const [search, setSearch] = useState('')
  const [lbIndex, setLbIndex] = useState<number | null>(null)

  const loadAll = async () => {
      setLoading(true)

      const { data: scenes } = await supabase
        .from('scenes').select('id, scene_number, title').eq('project_id', projectId)
      const list = sortScenesByNumber((scenes ?? []) as any)
      setScenesList(list as any)
      const sceneIds = list.map((s: any) => s.id)
      const sceneById = new Map<string, any>(list.map((s: any) => [s.id, s]))

      if (sceneIds.length === 0) { setItems([]); setLoading(false); return }

      // 1) 우선 metadata 포함해서 시도 — 실패하면 metadata 없이 (마이그레이션 미적용 환경 대응)
      let attemptsRows: any[] | null = null
      const withMeta = await supabase
        .from('prompt_attempts')
        .select('id, scene_id, type, engine, created_at, status, metadata, outputs:attempt_outputs(*, asset:assets(url))')
        .in('scene_id', sceneIds)
        .eq('type', type)
        .order('created_at', { ascending: false })
      if (!withMeta.error) {
        attemptsRows = withMeta.data
      } else {
        // metadata 컬럼이 없는 경우 (마이그레이션 전) — 폴백
        console.warn('[MediaBrowser] metadata select 실패, 폴백:', withMeta.error.message)
        const noMeta = await supabase
          .from('prompt_attempts')
          .select('id, scene_id, type, engine, created_at, status, outputs:attempt_outputs(*, asset:assets(url))')
          .in('scene_id', sceneIds)
          .eq('type', type)
          .order('created_at', { ascending: false })
        attemptsRows = noMeta.data
      }
      const { data: decRows } = await supabase
        .from('shot_decisions')
        .select('output_id, decision_type, created_at')
        .in('scene_id', sceneIds)
        .order('created_at', { ascending: false })
      const attempts = attemptsRows

      const latestByOutput = new Map<string, DecisionType>()
      for (const d of (decRows ?? []) as any[]) {
        if (!latestByOutput.has(d.output_id)) latestByOutput.set(d.output_id, d.decision_type)
      }

      const all: MediaItem[] = []
      for (const a of (attempts ?? []) as any[]) {
        const sc = sceneById.get(a.scene_id)
        if (!sc) continue
        const src: 'workspace' | 'studio' = a.metadata?.source === 'studio' ? 'studio' : 'workspace'
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
            source: src,
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
    const out = items.filter(it => {
      if (filterScene !== 'all' && it.scene_id !== filterScene) return false
      if (filterEngine !== 'all' && it.engine !== filterEngine) return false
      if (filterSource !== 'all' && it.source !== filterSource) return false
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
    // 정렬 — 기본 'scene' (씬순), 'newest' (최신), 'rating' (평점 높은 순)
    if (sortMode === 'newest') {
      out.sort((a, b) => b.created_at.localeCompare(a.created_at))
    } else if (sortMode === 'rating') {
      out.sort((a, b) => {
        const ra = a.satisfaction_score ?? 0
        const rb = b.satisfaction_score ?? 0
        if (rb !== ra) return rb - ra
        return b.created_at.localeCompare(a.created_at)
      })
    }
    // 'scene' 은 loadAll에서 이미 정렬해둠
    return out
  }, [items, filterScene, filterStatus, filterEngine, filterSource, search, sortMode])

  // 소스별 카운트 (워크스페이스 / 스튜디오 분리)
  const sourceCounts = useMemo(() => {
    const c = { all: items.length, workspace: 0, studio: 0 }
    for (const it of items) {
      if (it.source === 'studio') c.studio++
      else c.workspace++
    }
    return c
  }, [items])

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
  const defaultTitle = lockSource === 'studio'
    ? (type === 't2i' ? 'Studio 이미지 라이브러리' : 'Studio 영상 라이브러리')
    : lockSource === 'workspace'
      ? (type === 't2i' ? 'Workspace 이미지 라이브러리' : 'Workspace 영상 라이브러리')
      : (type === 't2i' ? '이미지 라이브러리' : '영상 라이브러리')
  const title = titleOverride ?? defaultTitle
  const defaultSubtitle = lockSource === 'studio'
    ? (type === 't2i' ? 'Image Studio에서 만든 단일 이미지 결과만 모았어요.' : 'Video Studio에서 만든 단일 영상 결과만 모았어요.')
    : lockSource === 'workspace'
      ? (type === 't2i' ? 'Shot Workspace 씬별 이미지 결과를 모았어요.' : 'Shot Workspace 씬별 영상 결과를 모았어요.')
      : (type === 't2i'
        ? '프로젝트에서 생성된 모든 이미지를 씬 순서대로 둘러보세요.'
        : '프로젝트에서 생성된 모든 영상을 씬 순서대로 둘러보세요.')
  const subtitle = subtitleOverride ?? defaultSubtitle

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

          {/* 정렬 */}
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as SortMode)}
            title="정렬 기준"
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--r-md)', fontSize: 11,
              background: 'var(--bg-2)', border: '1px solid var(--line)',
              color: 'var(--ink-2)', outline: 'none',
            }}
          >
            <option value="scene">씬순</option>
            <option value="newest">최신순</option>
            <option value="rating">평점순</option>
          </select>

          {(filterScene !== 'all' || filterStatus !== 'all' || filterEngine !== 'all' || filterSource !== 'all' || search.trim()) && (
            <button
              onClick={() => { setFilterScene('all'); setFilterStatus('all'); setFilterEngine('all'); setFilterSource('all'); setSearch('') }}
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

        {/* 출처 필터 — 워크스페이스 vs 스튜디오 라이브러리 분리 (lockSource 시 숨김) */}
        {!lockSource && <div className="flex items-center" style={{ gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            라이브러리
          </span>
          {([
            { v: 'all',       label: '통합',       hint: '전체' },
            { v: 'workspace', label: 'Workspace',  hint: 'Shot Workspace' },
            { v: 'studio',    label: 'Studio',     hint: type === 't2i' ? '이미지 생성' : '영상 생성' },
          ] as const).map(opt => {
            const active = filterSource === opt.v
            const count  = sourceCounts[opt.v]
            return (
              <button
                key={opt.v}
                onClick={() => setFilterSource(opt.v as SourceFilter)}
                title={opt.hint}
                style={{
                  padding: '5px 12px', gap: 6,
                  borderRadius: 999,
                  fontSize: 11, fontWeight: 600,
                  background: active ? 'var(--ink)' : 'var(--bg)',
                  color:      active ? 'var(--bg)' : 'var(--ink-2)',
                  border: `1px solid ${active ? 'var(--ink)' : 'var(--line)'}`,
                  display: 'inline-flex', alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
                <span style={{
                  fontSize: 10, fontWeight: 500,
                  color: active ? 'var(--bg-2)' : 'var(--ink-4)',
                  fontFamily: 'var(--font-mono)',
                }}>{count}</span>
              </button>
            )
          })}
        </div>}
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
            {filtered.map((it, i) => (
              <MediaCard
                key={it.id}
                item={it}
                onClick={() => setLbIndex(i)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 라이트박스 — 카드 클릭 시 즉시 미리보기 */}
      {lbIndex !== null && filtered[lbIndex] && (
        <ImageLightbox
          items={filtered.map<LightboxItem>(it => ({
            url:     it.url ?? '',
            name:    `${it.scene_number} ${it.scene_title}`.trim(),
            caption: `${it.engine}${it.satisfaction_score ? ` · ★${it.satisfaction_score}` : ''}${it.source === 'studio' ? ' · Studio' : ' · Workspace'}`,
            isVideo: it.type === 'i2v' || it.type === 'lipsync',
          }))}
          initialIndex={lbIndex}
          onClose={() => setLbIndex(null)}
          actions={[
            {
              label: '씬으로 이동',
              onClick: (i) => {
                const it = filtered[i]
                if (!it) return
                if (it.source === 'studio') {
                  const studioPath = type === 't2i' ? 'image-studio' : 'video-studio'
                  router.push(`/project/${projectId}/${studioPath}?scene=${it.scene_id}`)
                } else {
                  router.push(`/project/${projectId}/workspace?scene=${it.scene_id}`)
                }
              },
            },
          ]}
        />
      )}
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
          <span style={{ flex: 1 }} />
          <span
            style={{
              padding: '1px 6px', borderRadius: 999,
              fontSize: 9, fontWeight: 600, letterSpacing: '0.02em',
              background: item.source === 'studio' ? 'var(--accent-soft)' : 'var(--bg-3)',
              color:      item.source === 'studio' ? 'var(--accent)'      : 'var(--ink-3)',
              border: `1px solid ${item.source === 'studio' ? 'var(--accent-line)' : 'var(--line)'}`,
            }}
            title={item.source === 'studio' ? 'Studio에서 생성' : 'Workspace에서 생성'}
          >
            {item.source === 'studio' ? 'Studio' : 'Work'}
          </span>
        </div>
      </div>
    </button>
  )
}
