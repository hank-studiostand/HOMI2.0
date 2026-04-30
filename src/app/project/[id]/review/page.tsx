'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Pill, { type PillVariant } from '@/components/ui/Pill'
import { CheckCircle2, RotateCcw, Trash2, Eye } from 'lucide-react'

// Review & Decision — 칸반 4 컬럼 (검토 대기 / 수정 요청 / 승인 / 제거)
// 데이터: attempt_outputs 의 satisfaction_score + archived 로 임시 매핑
//   - score === null            → 검토 대기
//   - score 1~2                 → 수정 요청
//   - score >= 4 + archived     → 승인
//   - archived === false + score 3 → 제거 후보
// 정식 워크플로 (approve/revise/remove + reason tag)는 후속 단계.

interface OutputCard {
  id: string
  asset_id: string
  attempt_id: string
  url: string | null
  thumbnail_url: string | null
  satisfaction_score: number | null
  feedback: string
  archived: boolean
  scene_number: string
  scene_title: string
  type: 't2i' | 'i2v' | 'lipsync'
}

const COLUMNS: { key: 'review' | 'revise' | 'approved' | 'removed'; label: string; variant: PillVariant; icon: any }[] = [
  { key: 'review',   label: '검토 대기',  variant: 'review',   icon: Eye },
  { key: 'revise',   label: '수정 요청',  variant: 'revise',   icon: RotateCcw },
  { key: 'approved', label: '승인',       variant: 'approved', icon: CheckCircle2 },
  { key: 'removed',  label: '제거',       variant: 'removed',  icon: Trash2 },
]

export default function ReviewPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const supabase = createClient()
  const [outputs, setOutputs] = useState<OutputCard[]>([])
  const [loading, setLoading] = useState(true)

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
            scene_number: (scene as any).scene_number,
            scene_title: (scene as any).title,
            type: (a as any).type,
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
      if (c.satisfaction_score === null) r.review.push(c)
      else if (c.satisfaction_score <= 2) r.revise.push(c)
      else if (c.satisfaction_score >= 4 && c.archived) r.approved.push(c)
      else r.removed.push(c)
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
                    <div key={c.id} className="card" style={{ background: 'var(--bg-2)' }}>
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
                        {c.feedback && (
                          <div
                            style={{
                              marginTop: 6, padding: 6,
                              background: 'var(--bg-3)', borderRadius: 'var(--r-sm)',
                              fontSize: 11, color: 'var(--ink-3)',
                            }}
                          >
                            {c.feedback}
                          </div>
                        )}
                      </div>
                    </div>
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
