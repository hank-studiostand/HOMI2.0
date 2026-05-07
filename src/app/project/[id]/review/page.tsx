'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Pill, { type PillVariant } from '@/components/ui/Pill'
import { CheckCircle2, RotateCcw, Trash2, Eye, Loader2, Filter, Image as ImageIcon, Film } from 'lucide-react'
import { toast } from '@/components/ui/Toast'

// Review & Decision — 칸반 4 컬럼 (검토 대기 / 수정 요청 / 승인 / 제거)
// 데이터: shot_decisions 의 decision_type 로 그룹핑.
//   - 결정이 없는 output           → 검토 대기
//   - decision_type='revise_requested' → 수정 요청
//   - decision_type='approved'         → 승인
//   - decision_type='removed'          → 제거
// shot_decisions 테이블이 비어있으면 satisfaction_score 폴백.

interface ShotDecision {
  output_id: string
  decision_type: 'approved' | 'revise_requested' | 'removed'
  reason_tags: string[] | null
  comment: string | null
  created_at: string
}

interface OutputCard {
  id: string
  asset_id: string
  attempt_id: string
  url: string | null
  thumbnail_url: string | null
  satisfaction_score: number | null
  feedback: string
  archived: boolean
  scene_id: string
  scene_number: string
  scene_title: string
  type: 't2i' | 'i2v' | 'lipsync'
  decision: ShotDecision | null
}

const COLUMNS: { key: 'review' | 'revise' | 'approved' | 'removed'; label: string; variant: PillVariant; icon: any }[] = [
  { key: 'review',   label: '검토 대기',  variant: 'review',   icon: Eye },
  { key: 'revise',   label: '수정 요청',  variant: 'revise',   icon: RotateCcw },
  { key: 'approved', label: '승인',       variant: 'approved', icon: CheckCircle2 },
  { key: 'removed',  label: '제거',       variant: 'removed',  icon: Trash2 },
]

export default function ReviewPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const [outputs, setOutputs] = useState<OutputCard[]>([])
  const [loading, setLoading] = useState(true)
  const [meId, setMeId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null))
  }, [supabase])

  // 호버 퀵 결정 — 카드를 워크스페이스로 이동시키지 않고 컬럼 사이를 한 번 클릭으로
  async function quickDecide(c: OutputCard, decision: 'approved' | 'revise_requested' | 'removed') {
    if (!meId) { toast.error('로그인 필요'); return }
    setBusyId(c.id)
    try {
      const { error } = await supabase.from('shot_decisions').insert({
        output_id: c.id, scene_id: c.scene_id,
        decision_type: decision, reason_tags: [], comment: '',
        decided_by: meId,
      })
      if (error) { toast.error('결정 저장 실패', error.message); return }
      if (decision === 'approved') {
        await supabase.from('attempt_outputs').update({ archived: true, satisfaction_score: 5 }).eq('id', c.id)
      }
      // 로컬 상태 즉시 반영 (refetch보다 빠름)
      setOutputs(prev => prev.map(x => x.id === c.id ? { ...x, decision: { ...(x.decision ?? { reason_tags: null, comment: null, created_at: new Date().toISOString() }), output_id: c.id, decision_type: decision } } : x))
      toast.success(
        decision === 'approved' ? '승인됨'
        : decision === 'revise_requested' ? '수정 요청'
        : '제거 — 휴지통으로'
      )
    } finally { setBusyId(null) }
  }

  useEffect(() => {
    void (async () => {
      const { data: scenes } = await supabase
        .from('scenes').select('id, scene_number, title').eq('project_id', projectId)
      const sceneById = new Map((scenes ?? []).map(s => [s.id, s]))
      const sceneIds  = (scenes ?? []).map(s => s.id)
      if (sceneIds.length === 0) { setOutputs([]); setLoading(false); return }

      const { data: attempts } = await supabase
        .from('prompt_attempts')
        .select('id, scene_id, type, outputs:attempt_outputs(*, asset:assets(url, thumbnail_url))')
        .in('scene_id', sceneIds)

      const { data: decRows } = await supabase
        .from('shot_decisions')
        .select('output_id, decision_type, reason_tags, comment, created_at')
        .in('scene_id', sceneIds)
        .order('created_at', { ascending: false })

      const latestByOutput = new Map<string, ShotDecision>()
      for (const d of (decRows ?? []) as any[]) {
        if (!latestByOutput.has(d.output_id)) {
          latestByOutput.set(d.output_id, d as ShotDecision)
        }
      }

      const cards: OutputCard[] = []
      for (const a of (attempts ?? [])) {
        const scene = sceneById.get((a as any).scene_id)
        if (!scene) continue
        for (const o of ((a as any).outputs ?? [])) {
          cards.push({
            id: o.id,
            asset_id: o.asset_id,
            attempt_id: (a as any).id,
            url: o.url ?? o.asset?.url ?? null,
            thumbnail_url: o.thumbnail_url ?? o.asset?.thumbnail_url ?? null,
            satisfaction_score: o.satisfaction_score,
            feedback: o.feedback ?? '',
            archived: o.archived ?? false,
            scene_id: (a as any).scene_id,
            scene_number: (scene as any).scene_number,
            scene_title: (scene as any).title,
            type: (a as any).type,
            decision: latestByOutput.get(o.id) ?? null,
          })
        }
      }
      setOutputs(cards)
      setLoading(false)
    })()
  }, [projectId, supabase])

  const grouped = useMemo(() => {
    const r: Record<'review' | 'revise' | 'approved' | 'removed', OutputCard[]> =
      { review: [], revise: [], approved: [], removed: [] }
    for (const c of outputs) {
      if (c.decision) {
        if (c.decision.decision_type === 'approved') r.approved.push(c)
        else if (c.decision.decision_type === 'revise_requested') r.revise.push(c)
        else if (c.decision.decision_type === 'removed') r.removed.push(c)
      } else if (c.satisfaction_score === null) {
        r.review.push(c)
      } else if (c.satisfaction_score <= 2) {
        r.revise.push(c)
      } else if (c.satisfaction_score >= 4 && c.archived) {
        r.approved.push(c)
      } else {
        r.review.push(c)
      }
    }
    return r
  }, [outputs])

  // ── 필터 상태 ────────────────────────────────────
  const [typeFilter, setTypeFilter] = useState<'all' | 't2i' | 'i2v'>('all')
  const [sceneFilter, setSceneFilter] = useState<string>('all')

  const sceneOptions = useMemo(() => {
    const seen = new Map<string, { id: string; number: string; title: string }>()
    for (const o of outputs) {
      if (!seen.has(o.scene_id)) seen.set(o.scene_id, { id: o.scene_id, number: o.scene_number, title: o.scene_title })
    }
    return Array.from(seen.values())
  }, [outputs])

  const filteredGrouped = useMemo(() => {
    const result: Record<'review' | 'revise' | 'approved' | 'removed', OutputCard[]> =
      { review: [], revise: [], approved: [], removed: [] }
    for (const k of Object.keys(grouped) as Array<'review' | 'revise' | 'approved' | 'removed'>) {
      result[k] = grouped[k].filter(c => {
        if (typeFilter !== 'all' && c.type !== typeFilter) return false
        if (sceneFilter !== 'all' && c.scene_id !== sceneFilter) return false
        return true
      })
    }
    return result
  }, [grouped, typeFilter, sceneFilter])

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      {/* 헤더 + 필터 */}
      <div
        style={{
          padding: '20px 28px 14px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--bg)',
          position: 'sticky', top: 0, zIndex: 3,
        }}
      >
        <div className="flex items-end justify-between" style={{ gap: 16, marginBottom: 14 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
              Review &amp; Decision
            </h1>
            <p style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
              결과를 한눈에 살펴보고 승인 / 수정 요청 / 제거. 키보드: <kbd>A</kbd> 승인 · <kbd>R</kbd> 수정 · <kbd>X</kbd> 제거
            </p>
          </div>
          <div className="flex items-center" style={{ gap: 16, fontSize: 11, color: 'var(--ink-3)' }}>
            {COLUMNS.map(col => {
              const Icon = col.icon
              return (
                <div key={col.key} className="flex items-center" style={{ gap: 6 }}>
                  <Icon size={12} />
                  <span>{col.label}</span>
                  <Pill variant={col.variant}>{filteredGrouped[col.key].length}</Pill>
                </div>
              )
            })}
          </div>
        </div>
        {/* 필터 행 */}
        <div className="flex items-center" style={{ gap: 10, fontSize: 12 }}>
          <Filter size={13} style={{ color: 'var(--ink-4)' }} />
          {/* 타입 필터 */}
          <div className="flex" style={{ gap: 4 }}>
            {(['all', 't2i', 'i2v'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                style={{
                  padding: '4px 10px', borderRadius: 'var(--r-sm)',
                  fontSize: 11, fontWeight: 500,
                  background: typeFilter === t ? 'var(--accent-soft)' : 'var(--bg-3)',
                  color: typeFilter === t ? 'var(--accent)' : 'var(--ink-3)',
                  border: `1px solid ${typeFilter === t ? 'var(--accent-line)' : 'var(--line)'}`,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                {t === 't2i' && <ImageIcon size={11} />}
                {t === 'i2v' && <Film size={11} />}
                {t === 'all' ? '전체' : t.toUpperCase()}
              </button>
            ))}
          </div>
          {/* 씬 필터 */}
          <select
            value={sceneFilter}
            onChange={e => setSceneFilter(e.target.value)}
            style={{
              padding: '4px 10px', borderRadius: 'var(--r-sm)',
              fontSize: 11, color: 'var(--ink-2)',
              background: 'var(--bg-3)', border: '1px solid var(--line)',
              outline: 'none',
              minWidth: 200,
            }}
          >
            <option value="all">모든 씬</option>
            {sceneOptions.map(s => (
              <option key={s.id} value={s.id}>{s.number} {s.title}</option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
          {(typeFilter !== 'all' || sceneFilter !== 'all') && (
            <button
              onClick={() => { setTypeFilter('all'); setSceneFilter('all') }}
              className="btn"
              style={{ fontSize: 11, padding: '4px 10px' }}
            >
              필터 초기화
            </button>
          )}
        </div>
      </div>

      {/* 본문 — 검토 대기 상단 강조 + 결정된 것 하단 컴팩트 3열 */}
      <div className="flex-1 overflow-auto" style={{ padding: '20px 28px' }}>
        {loading ? (
          <div className="flex items-center justify-center" style={{ padding: 60, color: 'var(--ink-4)' }}>
            <Loader2 size={20} className="animate-spin" /> <span style={{ marginLeft: 8 }}>불러오는 중…</span>
          </div>
        ) : (
          <>
            {/* 검토 대기 — 큰 카드 그리드 (focal point) */}
            <section style={{ marginBottom: 28 }}>
              <div className="flex items-center" style={{ gap: 8, marginBottom: 12 }}>
                <Eye size={16} style={{ color: 'var(--accent)' }} />
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>검토 대기</h2>
                <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{filteredGrouped.review.length}개</span>
              </div>
              {filteredGrouped.review.length === 0 ? (
                <div
                  style={{
                    border: '1px dashed var(--line-strong)',
                    borderRadius: 12, padding: 40,
                    textAlign: 'center', color: 'var(--ink-4)',
                    background: 'var(--bg-2)', fontSize: 13,
                  }}
                >
                  검토 대기 중인 결과가 없어요. 워크스페이스에서 결과를 만들거나 필터를 조정해 보세요.
                </div>
              ) : (
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 14,
                  }}
                >
                  {filteredGrouped.review.map(c => (
                    <ReviewCard
                      key={c.id}
                      c={c}
                      busy={busyId === c.id}
                      compact={false}
                      onOpen={() => router.push(`/project/${projectId}/workspace?scene=${c.scene_id}`)}
                      onDecide={(d) => quickDecide(c, d)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* 결정 기록 — 통합 타임라인 (시인성 개선: 한 줄 카드, 색상 좌측 보더) */}
            <section>
              <div className="flex items-center" style={{ gap: 8, marginBottom: 12 }}>
                <CheckCircle2 size={14} style={{ color: 'var(--ink-3)' }} />
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>결정 기록</h2>
                <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                  · 승인 {filteredGrouped.approved.length} · 수정 {filteredGrouped.revise.length} · 제거 {filteredGrouped.removed.length}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: 'var(--ink-5)' }}>최근순 정렬</span>
              </div>
              {(() => {
                const all = [...filteredGrouped.approved, ...filteredGrouped.revise, ...filteredGrouped.removed]
                  .sort((a, b) => {
                    const ta = a.decision?.created_at ?? ''
                    const tb = b.decision?.created_at ?? ''
                    return tb.localeCompare(ta)
                  })
                if (all.length === 0) {
                  return (
                    <div className="empty" style={{ padding: 32, textAlign: 'center', fontSize: 12, color: 'var(--ink-4)' }}>
                      아직 결정한 항목이 없어요.
                    </div>
                  )
                }
                return (
                  <div
                    style={{
                      maxHeight: 540, overflowY: 'auto',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--bg-2)',
                    }}
                  >
                    {all.map((c, idx) => {
                      const decision = c.decision?.decision_type
                      const accentColor =
                        decision === 'approved' ? 'var(--ok)' :
                        decision === 'revise_requested' ? 'var(--accent)' :
                        decision === 'removed' ? 'var(--danger)' : 'var(--line)'
                      const decLabel =
                        decision === 'approved' ? '승인' :
                        decision === 'revise_requested' ? '수정요청' :
                        decision === 'removed' ? '제거' : '?'
                      const isVideo = c.type === 'i2v' || c.type === 'lipsync'
                      const ts = c.decision?.created_at ?? ''
                      const timeStr = ts
                        ? (() => {
                            const t = new Date(ts)
                            return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
                          })()
                        : ''
                      return (
                        <div
                          key={c.id}
                          onClick={() => router.push(`/project/${projectId}/workspace?scene=${c.scene_id}`)}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '4px 72px 1fr auto',
                            gap: 10,
                            padding: '8px 10px 8px 0',
                            borderBottom: idx < all.length - 1 ? '1px solid var(--line)' : 'none',
                            cursor: 'pointer',
                            background: 'transparent',
                            transition: 'background 0.12s',
                            opacity: decision === 'removed' ? 0.7 : 1,
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                        >
                          {/* 색상 좌측 보더 */}
                          <div style={{ width: 4, background: accentColor }} />
                          {/* 썸네일 */}
                          <div
                            style={{
                              width: 72, aspectRatio: '16/9',
                              borderRadius: 'var(--r-sm)',
                              overflow: 'hidden',
                              background: 'var(--bg-3)',
                              flexShrink: 0,
                            }}
                          >
                            {c.url ? (
                              isVideo
                                ? <video src={c.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <img src={c.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : null}
                          </div>
                          {/* 정보 */}
                          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, justifyContent: 'center' }}>
                            <div className="flex items-center" style={{ gap: 6 }}>
                              <span
                                className="mono"
                                style={{
                                  padding: '1px 6px', borderRadius: 3,
                                  fontSize: 10, fontWeight: 700,
                                  background: 'var(--bg-3)', color: 'var(--accent)',
                                }}
                              >{c.scene_number}</span>
                              <span
                                style={{
                                  fontSize: 10, fontWeight: 600,
                                  color: 'var(--ink-3)',
                                  textTransform: 'uppercase',
                                }}
                              >{c.type}</span>
                              <span style={{ fontSize: 11, color: 'var(--ink-2)', minWidth: 0 }} className="truncate" title={c.scene_title}>
                                {c.scene_title || '(제목 없음)'}
                              </span>
                            </div>
                            {(c.decision?.comment || c.feedback || (c.decision?.reason_tags && c.decision.reason_tags.length > 0)) && (
                              <div className="flex items-center flex-wrap" style={{ gap: 4, fontSize: 10, color: 'var(--ink-4)' }}>
                                {c.decision?.reason_tags?.map(t => (
                                  <span
                                    key={t}
                                    style={{
                                      padding: '0 5px', borderRadius: 3,
                                      background: 'var(--bg-3)', color: 'var(--ink-3)',
                                      fontSize: 9,
                                    }}
                                  >{t}</span>
                                ))}
                                {(c.decision?.comment || c.feedback) && (
                                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {c.decision?.comment || c.feedback}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          {/* 우측: 결정 + 시간 + 액션 */}
                          <div className="flex items-center" style={{ gap: 6, paddingLeft: 6 }}>
                            <span
                              style={{
                                padding: '2px 8px', borderRadius: 999,
                                fontSize: 10, fontWeight: 700,
                                background: accentColor, color: '#fff',
                              }}
                            >{decLabel}</span>
                            <span style={{ fontSize: 10, color: 'var(--ink-5)', minWidth: 56, textAlign: 'right' }} className="mono">{timeStr}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); quickDecide(c, 'approved') }}
                              title="승인으로 변경 (A)"
                              style={{
                                padding: '3px 6px', borderRadius: 3,
                                background: decision === 'approved' ? 'var(--ok)' : 'transparent',
                                color: decision === 'approved' ? '#fff' : 'var(--ok)',
                                border: `1px solid ${decision === 'approved' ? 'var(--ok)' : 'var(--ok-soft)'}`,
                                fontSize: 10,
                              }}
                            ><CheckCircle2 size={10} /></button>
                            <button
                              onClick={(e) => { e.stopPropagation(); quickDecide(c, 'revise_requested') }}
                              title="수정요청으로 변경 (R)"
                              style={{
                                padding: '3px 6px', borderRadius: 3,
                                background: decision === 'revise_requested' ? 'var(--accent)' : 'transparent',
                                color: decision === 'revise_requested' ? '#fff' : 'var(--accent)',
                                border: `1px solid ${decision === 'revise_requested' ? 'var(--accent)' : 'var(--accent-line)'}`,
                                fontSize: 10,
                              }}
                            ><RotateCcw size={10} /></button>
                            <button
                              onClick={(e) => { e.stopPropagation(); quickDecide(c, 'removed') }}
                              title="제거로 변경 (X)"
                              style={{
                                padding: '3px 6px', borderRadius: 3,
                                background: decision === 'removed' ? 'var(--danger)' : 'transparent',
                                color: decision === 'removed' ? '#fff' : 'var(--danger)',
                                border: `1px solid ${decision === 'removed' ? 'var(--danger)' : 'var(--danger-soft)'}`,
                                fontSize: 10,
                              }}
                            ><Trash2 size={10} /></button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Review 카드 (action 버튼 항상 노출, decision 상태별 색상) ─────
function ReviewCard({
  c, busy, compact, onOpen, onDecide,
}: {
  c: OutputCard
  busy: boolean
  compact: boolean
  onOpen: () => void
  onDecide: (d: 'approved' | 'revise_requested' | 'removed') => void
}) {
  const [hover, setHover] = useState(false)
  const isVideo = c.type === 'i2v' || c.type === 'lipsync'
  const decision = c.decision?.decision_type
  const accentColor =
    decision === 'approved' ? 'var(--ok)'
    : decision === 'revise_requested' ? 'var(--accent)'
    : decision === 'removed' ? 'var(--danger)'
    : 'var(--line)'

  // 키보드 단축키 — 호버 중인 카드만 반응
  useEffect(() => {
    if (!hover || busy) return
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const k = e.key.toLowerCase()
      if (k === 'a') { e.preventDefault(); onDecide('approved') }
      else if (k === 'r') { e.preventDefault(); onDecide('revise_requested') }
      else if (k === 'x') { e.preventDefault(); onDecide('removed') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hover, busy, onDecide])

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--bg-2)',
        border: `2px solid ${accentColor}`,
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
        position: 'relative',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hover ? '0 4px 16px rgba(0,0,0,0.10)' : 'none',
        opacity: decision === 'removed' ? 0.65 : 1,
      }}
    >
      {/* 미디어 */}
      <div
        onClick={onOpen}
        style={{
          aspectRatio: '16/9',
          background: 'var(--bg-3)',
          cursor: 'pointer',
          position: 'relative',
        }}
        title="이 씬 워크스페이스 열기"
      >
        {c.url ? (
          isVideo
            ? <video src={c.url} muted preload="metadata"
                onMouseEnter={e => (e.target as HTMLVideoElement).play().catch(()=>{})}
                onMouseLeave={e => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0 }}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <img src={c.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div className="shimmer" style={{ width: '100%', height: '100%' }} />
        )}
        {/* 좌상단: 타입 + 씬번호 배지 */}
        <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 4 }}>
          <span
            style={{
              padding: '2px 7px', borderRadius: 4,
              fontSize: 9, fontWeight: 700,
              background: 'rgba(0,0,0,0.65)', color: '#fff',
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}
          >
            {isVideo ? <Film size={9} /> : <ImageIcon size={9} />}
            {c.type.toUpperCase()}
          </span>
          <span
            className="mono"
            style={{
              padding: '2px 7px', borderRadius: 4,
              fontSize: 9, fontWeight: 600,
              background: 'rgba(0,0,0,0.65)', color: '#fff',
            }}
          >
            {c.scene_number}
          </span>
        </div>
        {/* 우상단: 결정 배지 */}
        {decision && (
          <div style={{ position: 'absolute', top: 6, right: 6 }}>
            {decision === 'approved' && <Pill variant="approved">승인</Pill>}
            {decision === 'revise_requested' && <Pill variant="revise">수정요청</Pill>}
            {decision === 'removed' && <Pill variant="removed">제거</Pill>}
          </div>
        )}
      </div>

      {/* 본문 (compact 모드는 더 작은 padding) */}
      {!compact && (
        <div style={{ padding: '8px 10px' }}>
          <div
            style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 500 }}
            className="truncate"
            title={c.scene_title}
          >
            {c.scene_title || '(제목 없음)'}
          </div>
          {c.decision?.reason_tags && c.decision.reason_tags.length > 0 && (
            <div className="flex flex-wrap" style={{ gap: 3, marginTop: 5 }}>
              {c.decision.reason_tags.map(t => (
                <span
                  key={t}
                  style={{
                    padding: '1px 6px', borderRadius: 999,
                    fontSize: 9,
                    background: 'var(--accent-soft)', color: 'var(--accent-2)',
                    border: '1px solid var(--accent-line)',
                  }}
                >{t}</span>
              ))}
            </div>
          )}
          {(c.decision?.comment || c.feedback) && (
            <div
              style={{
                marginTop: 5, padding: '5px 7px',
                background: 'var(--bg-3)', borderRadius: 'var(--r-sm)',
                fontSize: 11, color: 'var(--ink-3)',
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}
              title={c.decision?.comment || c.feedback}
            >
              {c.decision?.comment || c.feedback}
            </div>
          )}
        </div>
      )}

      {/* compact: 정보 한 줄로 */}
      {compact && (
        <div style={{ padding: '6px 8px', fontSize: 11, color: 'var(--ink-3)' }} className="truncate" title={c.scene_title}>
          {c.scene_title || '(제목 없음)'}
        </div>
      )}

      {/* 결정 액션바 — 항상 노출 (호버 의존 X) */}
      {!busy && (
        <div
          className="flex items-center"
          style={{
            padding: compact ? 5 : 7, gap: 4,
            borderTop: '1px solid var(--line)',
            background: 'var(--bg-1)',
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onDecide('approved') }}
            title="승인 (단축키 A)"
            style={{
              flex: 1, padding: compact ? '4px 0' : '6px 0',
              borderRadius: 'var(--r-sm)', fontSize: 11, fontWeight: 600,
              background: decision === 'approved' ? 'var(--ok)' : 'var(--ok-soft)',
              color: decision === 'approved' ? '#fff' : 'var(--ok)',
              border: `1px solid ${decision === 'approved' ? 'var(--ok)' : 'transparent'}`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            <CheckCircle2 size={11} />
            {!compact && '승인'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDecide('revise_requested') }}
            title="수정 요청 (단축키 R)"
            style={{
              padding: compact ? '4px 8px' : '6px 10px',
              borderRadius: 'var(--r-sm)', fontSize: 11,
              background: decision === 'revise_requested' ? 'var(--accent)' : 'var(--accent-soft)',
              color: decision === 'revise_requested' ? '#fff' : 'var(--accent-2)',
              border: `1px solid ${decision === 'revise_requested' ? 'var(--accent)' : 'transparent'}`,
            }}
          >
            <RotateCcw size={11} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDecide('removed') }}
            title="제거 (단축키 X)"
            style={{
              padding: compact ? '4px 8px' : '6px 10px',
              borderRadius: 'var(--r-sm)', fontSize: 11,
              background: decision === 'removed' ? 'var(--danger)' : 'var(--danger-soft)',
              color: decision === 'removed' ? '#fff' : 'var(--danger)',
              border: `1px solid ${decision === 'removed' ? 'var(--danger)' : 'transparent'}`,
            }}
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
      {busy && (
        <div
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'grid', placeItems: 'center',
          }}
        >
          <Loader2 size={20} className="animate-spin" style={{ color: '#fff' }} />
        </div>
      )}
    </div>
  )
}
