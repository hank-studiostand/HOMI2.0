'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Trash2, RotateCcw, Loader2, AlertTriangle } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { sortScenesByNumber, compareSceneNumbers } from '@/lib/sceneSort'
import Pill from '@/components/ui/Pill'

// 휴지통 — shot_decisions에 'removed' 결정이 가장 최근인 결과 모음
// 복구: 가장 최근 결정을 무효화 (새 결정 'approved' 또는 단순히 새 row insert 없이 — soft 처리)
//   → 단순히 'revise_requested' 같은 새 결정 또는 latest를 다른 type으로 바꾸기
//   → 가장 깔끔한 방법: 'removed' 결정 row를 삭제 (그러면 그 다음 최근 결정이 latest가 됨, 없으면 검토대기로 돌아감)
// 영구삭제: shot_decisions, attempt_outputs (그리고 asset?) 모두 삭제

interface TrashItem {
  output_id: string
  decision_id: string
  decision_at: string
  url: string | null
  type: 't2i' | 'i2v' | 'lipsync'
  engine: string
  scene_id: string
  scene_number: string
  scene_title: string
}

export default function TrashPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  async function load() {
    setLoading(true)
    const { data: scenes } = await supabase
      .from('scenes').select('id, scene_number, title').eq('project_id', projectId)
    const sceneIds = (scenes ?? []).map((s: any) => s.id)
    const sceneById = new Map<string, any>((scenes ?? []).map((s: any) => [s.id, s]))
    if (sceneIds.length === 0) { setItems([]); setLoading(false); return }

    // 모든 결정 가져와서 output별로 latest만 봄
    const { data: decRows } = await supabase
      .from('shot_decisions')
      .select('id, output_id, scene_id, decision_type, created_at')
      .in('scene_id', sceneIds)
      .order('created_at', { ascending: false })

    type LatestDec = { id: string; decision_type: string; created_at: string; scene_id: string }
    const latest = new Map<string, LatestDec>()
    for (const d of (decRows ?? []) as any[]) {
      if (!latest.has(d.output_id)) latest.set(d.output_id, d)
    }

    const removedOutputIds = Array.from(latest.entries())
      .filter(([_, d]) => d.decision_type === 'removed')
      .map(([id, _]) => id)
    if (removedOutputIds.length === 0) { setItems([]); setLoading(false); return }

    // 그 outputs + attempt 정보
    const { data: outs } = await supabase
      .from('attempt_outputs')
      .select('id, attempt:prompt_attempts(id, scene_id, type, engine), asset:assets(url), url')
      .in('id', removedOutputIds)

    const arr: TrashItem[] = []
    for (const o of (outs ?? []) as any[]) {
      const att = Array.isArray(o.attempt) ? o.attempt[0] : o.attempt
      if (!att) continue
      const sc = sceneById.get(att.scene_id)
      if (!sc) continue
      const dec = latest.get(o.id)
      if (!dec) continue
      arr.push({
        output_id: o.id,
        decision_id: dec.id,
        decision_at: dec.created_at,
        url: o.url ?? o.asset?.url ?? null,
        type: att.type,
        engine: att.engine,
        scene_id: att.scene_id,
        scene_number: sc.scene_number,
        scene_title: sc.title ?? '',
      })
    }

    // 씬 desc, 같은 씬 내 결정 시간 desc
    arr.sort((a, b) => {
      const c = compareSceneNumbers(b.scene_number, a.scene_number)
      if (c !== 0) return c
      return b.decision_at.localeCompare(a.decision_at)
    })
    setItems(arr)
    setLoading(false)
  }

  useEffect(() => { void load() }, [projectId])

  // 복구: 가장 최근 'removed' 결정 row 삭제 → 다음 결정이 latest가 됨 (또는 검토대기)
  async function restore(it: TrashItem) {
    setBusy(it.output_id)
    try {
      const { error } = await supabase.from('shot_decisions').delete().eq('id', it.decision_id)
      if (error) {
        toast.error('복구 실패', error.message)
        return
      }
      await supabase.from('attempt_outputs').update({ archived: false }).eq('id', it.output_id)
      await load()
      toast.success('복구 완료')
    } finally { setBusy(null) }
  }

  // 영구삭제: attempt_outputs 삭제 (cascade로 shot_decisions도 같이 삭제됨)
  async function permanentDelete(it: TrashItem) {
    if (!confirm('이 결과를 영구 삭제할까요?\n(되돌릴 수 없습니다)')) return
    setBusy(it.output_id)
    try {
      const { error } = await supabase.from('attempt_outputs').delete().eq('id', it.output_id)
      if (error) {
        toast.error('삭제 실패', error.message)
        return
      }
      await load()
      toast.success('영구 삭제됨')
    } finally { setBusy(null) }
  }

  async function emptyTrash() {
    if (items.length === 0) return
    if (!confirm(`휴지통의 ${items.length}개 항목을 모두 영구 삭제할까요?\n(되돌릴 수 없습니다)`)) return
    setBusy('all')
    try {
      const ids = items.map(i => i.output_id)
      const { error } = await supabase.from('attempt_outputs').delete().in('id', ids)
      if (error) {
        toast.error('일괄 삭제 실패', error.message)
        return
      }
      await load()
      setConfirmEmpty(false)
    } finally { setBusy(null) }
  }

  // 씬별 그룹핑
  const groups = useMemo(() => {
    const m = new Map<string, { sceneId: string; sceneNumber: string; sceneTitle: string; items: TrashItem[] }>()
    for (const it of items) {
      const k = it.scene_id
      if (!m.has(k)) m.set(k, { sceneId: it.scene_id, sceneNumber: it.scene_number, sceneTitle: it.scene_title, items: [] })
      m.get(k)!.items.push(it)
    }
    return Array.from(m.values())
  }, [items])

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
          <div className="flex items-center" style={{ gap: 8 }}>
            <Trash2 size={20} style={{ color: 'var(--ink-3)' }} />
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>휴지통</h1>
          </div>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
            제거된 결과 {items.length}개 — 복구하거나 영구 삭제할 수 있어요.
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={emptyTrash}
            disabled={busy === 'all'}
            className="flex items-center gap-2"
            style={{
              padding: '7px 14px', borderRadius: 'var(--r-md)',
              fontSize: 13, fontWeight: 500,
              background: 'var(--danger-soft)', color: 'var(--danger)',
              border: '1px solid var(--danger)',
              opacity: busy === 'all' ? 0.5 : 1,
            }}
          >
            {busy === 'all' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            휴지통 비우기
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto" style={{ padding: '16px 28px 28px' }}>
        {loading ? (
          <div className="empty" style={{ padding: 64, textAlign: 'center' }}>
            <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        ) : items.length === 0 ? (
          <div className="empty" style={{ padding: 64, textAlign: 'center' }}>
            <Trash2 size={28} style={{ color: 'var(--ink-4)' }} />
            <p style={{ marginTop: 10, fontSize: 14, color: 'var(--ink-3)' }}>휴지통이 비어있어요</p>
            <p style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-4)' }}>
              결과를 제거하면 여기로 모여요. 복구도 가능합니다.
            </p>
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: 18 }}>
            {groups.map(g => (
              <div key={g.sceneId}>
                <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                    {g.sceneNumber}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{g.sceneTitle || '(제목 없음)'}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>· {g.items.length}개</span>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 14,
                  }}
                >
                  {g.items.map(it => (
                    <div
                      key={it.output_id}
                      style={{
                        background: 'var(--bg-2)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-md)',
                        overflow: 'hidden',
                      }}
                    >
                      <div style={{ aspectRatio: '16/9', background: 'var(--bg-3)', position: 'relative' }}>
                        {it.url && (
                          it.type === 't2i'
                            ? <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(0.4)', opacity: 0.85 }} />
                            : <video src={it.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'grayscale(0.4)', opacity: 0.85 }} />
                        )}
                        <div style={{ position: 'absolute', top: 6, right: 6 }}>
                          <Pill variant="removed">제거됨</Pill>
                        </div>
                      </div>
                      <div style={{ padding: '8px 10px' }}>
                        <div className="flex items-center" style={{ gap: 6, fontSize: 10, color: 'var(--ink-4)', marginBottom: 6 }}>
                          <span className="mono">{it.engine}</span>
                          <span>·</span>
                          <span>
                            {new Date(it.decision_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        <div className="flex items-center" style={{ gap: 6 }}>
                          <button
                            onClick={() => void restore(it)}
                            disabled={busy === it.output_id}
                            className="flex items-center justify-center gap-1"
                            style={{
                              flex: 1, padding: '5px 8px',
                              borderRadius: 'var(--r-sm)',
                              fontSize: 11, fontWeight: 500,
                              background: 'var(--ok-soft)', color: 'var(--ok)',
                              border: '1px solid var(--ok-soft)',
                              opacity: busy === it.output_id ? 0.5 : 1,
                            }}
                          >
                            {busy === it.output_id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                            복구
                          </button>
                          <button
                            onClick={() => void permanentDelete(it)}
                            disabled={busy === it.output_id}
                            className="flex items-center justify-center gap-1"
                            style={{
                              flex: 1, padding: '5px 8px',
                              borderRadius: 'var(--r-sm)',
                              fontSize: 11, fontWeight: 500,
                              background: 'var(--danger-soft)', color: 'var(--danger)',
                              border: '1px solid var(--danger-soft)',
                              opacity: busy === it.output_id ? 0.5 : 1,
                            }}
                          >
                            <Trash2 size={11} />
                            영구삭제
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
