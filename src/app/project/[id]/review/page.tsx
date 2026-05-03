'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Pill, { type PillVariant } from '@/components/ui/Pill'
import { CheckCircle2, RotateCcw, Trash2, Eye, MoreHorizontal, Loader2 } from 'lucide-react'
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

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex items-end justify-between gap-6"
        style={{
          padding: '20px 28px 16px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--bg)',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
            Review &amp; Decision
          </h1>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
            팀이 만든 결과를 검토하고 승인 / 수정 요청 / 제거합니다.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto" style={{ padding: 20 }}>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', minWidth: 1200 }}>
          {COLUMNS.map(col => {
            const Icon = col.icon
            const list = grouped[col.key]
            return (
              <div key={col.key} className="card" style={{ background: 'var(--bg-1)' }}>
                <div
                  className="flex items-center justify-between"
                  style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}
                >
                  <div className="row" style={{ gap: 8 }}>
                    <Icon size={14} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{col.label}</span>
                  </div>
                  <Pill variant={col.variant}>{list.length}</Pill>
                </div>

                <div className="flex flex-col" style={{ padding: 12, gap: 10, maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
                  {loading && <div className="empty">불러오는 중...</div>}
                  {!loading && list.length === 0 && <div className="empty">없음</div>}
                  {list.map(c => (
                    <ReviewCard
                      key={c.id}
                      c={c}
                      busy={busyId === c.id}
                      onOpen={() => router.push(`/project/${projectId}/workspace?scene=${c.scene_id}`)}
                      onDecide={(d) => quickDecide(c, d)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Review 카드 (호버 퀵 결정 + 클릭 시 워크스페이스 진입) ─────
function ReviewCard({
  c, busy, onOpen, onDecide,
}: {
  c: OutputCard
  busy: boolean
  onOpen: () => void
  onDecide: (d: 'approved' | 'revise_requested' | 'removed') => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="card"
      style={{ background: 'var(--bg-2)', position: 'relative', cursor: 'pointer' }}
      onClick={onOpen}
      title="이 씬 워크스페이스 열기"
    >
                      {c.url ? (
                        c.type === 'i2v' || c.type === 'lipsync' ? (
                          <video src={c.url} className="w-full" style={{ aspectRatio: '16/9', objectFit: 'cover' }} muted preload="metadata" />
                        ) : (
                          <img src={c.url} alt="" className="w-full" style={{ aspectRatio: '16/9', objectFit: 'cover' }} />
                        )
                      ) : (
                        <div className="shimmer" style={{ aspectRatio: '16/9' }} />
                      )}
                      <div style={{ padding: 10 }}>
                        <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                          <Pill variant="gen">{c.type.toUpperCase()}</Pill>
                          <span className="mono" style={{ color: 'var(--ink-4)' }}>{c.scene_number}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-2)' }} className="truncate">
                          {c.scene_title}
                        </div>
                        {c.decision?.reason_tags && c.decision.reason_tags.length > 0 && (
                          <div className="flex flex-wrap" style={{ gap: 4, marginTop: 6 }}>
                            {c.decision.reason_tags.map(t => (
                              <span
                                key={t}
                                style={{
                                  padding: '1px 7px', borderRadius: 999,
                                  fontSize: 10,
                                  background: 'var(--accent-soft)', color: 'var(--accent-2)',
                                  border: '1px solid var(--accent-line)',
                                }}
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        {(c.decision?.comment || c.feedback) && (
                          <div
                            style={{
                              marginTop: 6, padding: 6,
                              background: 'var(--bg-3)', borderRadius: 'var(--r-sm)',
                              fontSize: 11, color: 'var(--ink-3)',
                            }}
                          >
                            {c.decision?.comment || c.feedback}
                          </div>
                        )}
                      </div>
                      {/* 호버 시 퀵 결정 액션바 (카드 wrapper 클릭 이벤트는 stopPropagation) */}
                      {hover && !busy && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center"
                          style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            padding: 6, gap: 4,
                            background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.8) 60%)',
                          }}
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); onDecide('approved') }}
                            title="승인"
                            style={{
                              flex: 1, padding: '5px 0',
                              borderRadius: 'var(--r-sm)', fontSize: 11, fontWeight: 600,
                              background: 'var(--ok)', color: '#fff',
                              border: '1px solid var(--ok)',
                            }}
                          >
                            <CheckCircle2 size={11} style={{ display: 'inline', marginRight: 3 }} />
                            승인
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onDecide('revise_requested') }}
                            title="수정 요청"
                            style={{
                              padding: '5px 9px',
                              borderRadius: 'var(--r-sm)', fontSize: 11,
                              background: 'var(--accent)', color: '#fff',
                              border: '1px solid var(--accent)',
                            }}
                          >
                            <RotateCcw size={11} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onDecide('removed') }}
                            title="휴지통으로"
                            style={{
                              padding: '5px 9px',
                              borderRadius: 'var(--r-sm)', fontSize: 11,
                              background: 'var(--danger)', color: '#fff',
                              border: '1px solid var(--danger)',
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
