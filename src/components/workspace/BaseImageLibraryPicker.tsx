'use client'

// BaseImageLibraryPicker — 프로젝트 전체 베이스 이미지(승인/★5 T2I) 그리드 팝업.
// I2V 소스로 선택 가능.

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { X, Search, Image as ImageIcon, Loader2 } from 'lucide-react'

interface PickerItem {
  id: string                // attempt_outputs.id
  url: string
  scene_id: string
  scene_number: string
  attempt_id: string
  prompt: string
  engine: string
  satisfaction_score: number | null
  decision?: string | null
  created_at: string
  type: 't2i' | 'i2v'       // 이미지 / 영상 구분
}

export default function BaseImageLibraryPicker({
  open,
  projectId,
  onClose,
  onPick,
  assetType = 't2i',     // 'all' = 이미지+영상, 't2i' = 이미지만, 'i2v' = 영상만
}: {
  open: boolean
  projectId: string
  onClose: () => void
  onPick: (outputId: string, output: { url: string; scene_id: string; type: 't2i' | 'i2v' }) => void
  assetType?: 't2i' | 'i2v' | 'all'
}) {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<PickerItem[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'approved' | 'starred'>('all')

  useEffect(() => {
    if (!open) return
    let mounted = true
    setLoading(true)
    void (async () => {
      try {
        // 프로젝트의 모든 씬 조회 → 그 씬 ID들로 attempts + outputs 가져오기
        const { data: scenes } = await supabase
          .from('scenes')
          .select('id, scene_number')
          .eq('project_id', projectId)
        if (!mounted) return
        const sceneIds = (scenes ?? []).map((s: any) => s.id)
        const sceneNumberMap = new Map<string, string>(
          (scenes ?? []).map((s: any) => [s.id, s.scene_number])
        )
        if (sceneIds.length === 0) { setItems([]); return }

        // attempts (assetType에 따라 T2I/I2V/둘 다)
        const typeFilter = assetType === 'all' ? ['t2i', 'i2v'] : [assetType]
        const { data: at } = await supabase
          .from('prompt_attempts')
          .select('id, scene_id, prompt, engine, type')
          .in('scene_id', sceneIds)
          .in('type', typeFilter)

        const attemptMap = new Map<string, any>((at ?? []).map((a: any) => [a.id, a]))
        const attemptIds = (at ?? []).map((a: any) => a.id)
        if (attemptIds.length === 0) { setItems([]); return }

        // attempt_outputs (조인 + asset url)
        const { data: outs } = await supabase
          .from('attempt_outputs')
          .select('id, attempt_id, archived, satisfaction_score, asset:assets(url), created_at')
          .in('attempt_id', attemptIds)
          .order('created_at', { ascending: false })
          .limit(300)

        // 결정 가져오기 (approved 마킹용)
        const outIds = (outs ?? []).map((o: any) => o.id)
        const decMap = new Map<string, string>()
        if (outIds.length > 0) {
          const { data: decs } = await supabase
            .from('shot_decisions')
            .select('output_id, decision_type, created_at')
            .in('output_id', outIds)
            .order('created_at', { ascending: false })
          for (const d of (decs ?? []) as any[]) {
            if (!decMap.has(d.output_id)) decMap.set(d.output_id, d.decision_type)
          }
        }

        const flat: PickerItem[] = []
        for (const o of (outs ?? []) as any[]) {
          const a = attemptMap.get(o.attempt_id)
          if (!a) continue
          const url = o.asset?.url
          if (!url) continue
          const decision = decMap.get(o.id) ?? null
          // 베이스 이미지 = approved 또는 ★5
          const isBase = decision === 'approved' || (o.satisfaction_score ?? 0) >= 5
          if (!isBase) continue
          flat.push({
            id: o.id,
            url,
            scene_id: a.scene_id,
            scene_number: sceneNumberMap.get(a.scene_id) ?? '?',
            attempt_id: o.attempt_id,
            prompt: a.prompt ?? '',
            engine: a.engine ?? '',
            satisfaction_score: o.satisfaction_score,
            decision,
            created_at: o.created_at,
            type: (a.type === 'i2v' ? 'i2v' : 't2i') as 't2i' | 'i2v',
          })
        }
        if (mounted) setItems(flat)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [open, projectId, supabase, assetType])

  const filtered = useMemo(() => {
    let list = items
    if (filter === 'approved') list = list.filter(i => i.decision === 'approved')
    else if (filter === 'starred') list = list.filter(i => (i.satisfaction_score ?? 0) >= 5)
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(i =>
        i.scene_number.includes(q)
        || (i.prompt ?? '').toLowerCase().includes(q)
        || (i.engine ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [items, filter, query])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(1080px, 100%)', maxHeight: '88vh',
          background: 'var(--bg)', border: '1px solid var(--line)',
          borderRadius: 'var(--r-md)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* 헤더 */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <ImageIcon size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
            베이스 이미지 라이브러리
          </span>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            프로젝트 전체 · 승인됨 또는 ★5+ T2I 결과
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} className="btn" style={{ padding: 6 }}>
            <X size={14} />
          </button>
        </div>

        {/* 필터/검색 */}
        <div style={{
          padding: '10px 18px', borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-1)',
        }}>
          {([
            { v: 'all',      label: `전체 (${items.length})` },
            { v: 'approved', label: `승인 (${items.filter(i => i.decision === 'approved').length})` },
            { v: 'starred',  label: `★5+ (${items.filter(i => (i.satisfaction_score ?? 0) >= 5).length})` },
          ] as const).map(opt => (
            <button key={opt.v}
              onClick={() => setFilter(opt.v)}
              style={{
                padding: '5px 12px', borderRadius: 999,
                background: filter === opt.v ? 'var(--accent-soft)' : 'var(--bg-2)',
                color: filter === opt.v ? 'var(--accent)' : 'var(--ink-3)',
                border: `1px solid ${filter === opt.v ? 'var(--accent-line)' : 'var(--line)'}`,
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}>{opt.label}</button>
          ))}
          <span style={{ flex: 1 }} />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', background: 'var(--bg-2)',
            border: '1px solid var(--line)', borderRadius: 999,
          }}>
            <Search size={12} style={{ color: 'var(--ink-4)' }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="씬 번호 / 프롬프트 / 엔진"
              style={{
                background: 'transparent', border: 'none', outline: 'none',
                fontSize: 12, color: 'var(--ink)', width: 220,
              }}
            />
          </div>
        </div>

        {/* 그리드 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--ink-4)' }}>
              <Loader2 size={20} className="animate-spin" style={{ marginBottom: 10 }} />
              <div style={{ fontSize: 12 }}>불러오는 중...</div>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{
              padding: 60, textAlign: 'center', color: 'var(--ink-4)',
              fontSize: 13,
            }}>
              {items.length === 0
                ? '아직 베이스 이미지가 없어요. T2I 결과를 승인 또는 ★5 별점 매겨야 모입니다.'
                : '검색/필터 조건에 맞는 결과가 없어요.'}
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 10,
            }}>
              {filtered.map(it => (
                <button
                  key={it.id}
                  onClick={() => { onPick(it.id, { url: it.url, scene_id: it.scene_id, type: it.type }); onClose() }}
                  style={{
                    padding: 0, border: '1px solid var(--line)',
                    borderRadius: 10, overflow: 'hidden',
                    background: 'var(--bg-2)', cursor: 'pointer',
                    aspectRatio: '1',
                    position: 'relative', display: 'block',
                  }}
                  title={`${it.scene_number} · ${it.engine} · ${(it.prompt ?? '').slice(0, 80)}…`}
                >
                  {it.type === 'i2v'
                    ? <video src={it.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  <div style={{
                    position: 'absolute', top: 4, left: 4,
                    padding: '2px 6px', borderRadius: 4,
                    background: 'rgba(0,0,0,0.65)', color: '#fff',
                    fontSize: 9, fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                  }}>{it.scene_number}</div>
                  {it.decision === 'approved' && (
                    <div style={{
                      position: 'absolute', top: 4, right: 4,
                      padding: '1px 6px', borderRadius: 4,
                      background: 'var(--ok, #22c55e)', color: '#fff',
                      fontSize: 9, fontWeight: 700,
                    }}>OK</div>
                  )}
                  {(it.satisfaction_score ?? 0) >= 5 && (
                    <div style={{
                      position: 'absolute', bottom: 4, right: 4,
                      padding: '1px 6px', borderRadius: 4,
                      background: 'rgba(255,200,0,0.9)', color: '#000',
                      fontSize: 9, fontWeight: 700,
                    }}>★{it.satisfaction_score}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
