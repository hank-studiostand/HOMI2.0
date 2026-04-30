'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Pill from '@/components/ui/Pill'
import { GitBranch, Image as ImageIcon, Video, Mic, Wand2 } from 'lucide-react'

// Version & Provenance — 프로젝트 내 모든 attempt를 시간순으로 보여주는 타임라인 스텁.
// 각 이벤트: 씬 + 타입 + 엔진 + 상태 + 생성 시각.

interface TimelineEvent {
  id: string
  scene_id: string
  scene_number: string
  scene_title: string
  type: 't2i' | 'i2v' | 'lipsync'
  engine: string
  status: string
  created_at: string
}

const TYPE_META: Record<string, { icon: any; color: string; label: string }> = {
  t2i:     { icon: ImageIcon, color: 'var(--accent)', label: 'T2I' },
  i2v:     { icon: Video,     color: 'var(--violet)', label: 'I2V' },
  lipsync: { icon: Mic,       color: 'var(--pink)',   label: 'Lipsync' },
}

function statusVariant(status: string) {
  if (status === 'done') return 'approved' as const
  if (status === 'generating') return 'gen' as const
  if (status === 'failed') return 'danger' as const
  return 'draft' as const
}

function formatRel(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diff = (now - d.getTime()) / 1000
  if (diff < 60) return `방금 전`
  if (diff < 3600) return `${Math.floor(diff/60)}분 전`
  if (diff < 86400) return `${Math.floor(diff/3600)}시간 전`
  if (diff < 86400 * 7) return `${Math.floor(diff/86400)}일 전`
  return `${d.getMonth()+1}/${d.getDate()}`
}

export default function VersionPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const supabase = createClient()
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const { data: scenes } = await supabase
        .from('scenes').select('id, scene_number, title').eq('project_id', projectId)
      const sceneById = new Map((scenes ?? []).map(s => [s.id, s]))
      const sceneIds = (scenes ?? []).map(s => s.id)
      if (sceneIds.length === 0) { setEvents([]); setLoading(false); return }

      const { data: attempts } = await supabase
        .from('prompt_attempts')
        .select('id, scene_id, type, engine, status, created_at')
        .in('scene_id', sceneIds)
        .order('created_at', { ascending: false })

      const out: TimelineEvent[] = []
      for (const a of (attempts ?? [])) {
        const sc = sceneById.get((a as any).scene_id)
        if (!sc) continue
        out.push({
          id: (a as any).id,
          scene_id: (a as any).scene_id,
          scene_number: (sc as any).scene_number,
          scene_title: (sc as any).title,
          type: (a as any).type,
          engine: (a as any).engine,
          status: (a as any).status,
          created_at: (a as any).created_at,
        })
      }
      setEvents(out)
      setLoading(false)
    })()
  }, [projectId, supabase])

  // 씬별로 그룹핑
  const bySceneId = events.reduce<Record<string, TimelineEvent[]>>((acc, e) => {
    if (!acc[e.scene_id]) acc[e.scene_id] = []
    acc[e.scene_id].push(e)
    return acc
  }, {})

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
            Version &amp; Provenance
          </h1>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
            모든 생성 시도의 타임라인. 어떤 프롬프트로 어떤 엔진을 썼는지 추적합니다.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto" style={{ padding: '20px 28px' }}>
        {loading && <div className="empty">불러오는 중...</div>}
        {!loading && events.length === 0 && <div className="empty">아직 생성 이력이 없어요.</div>}

        <div className="flex flex-col" style={{ gap: 16 }}>
          {Object.entries(bySceneId).map(([sceneId, list]) => {
            const head = list[0]
            return (
              <div key={sceneId} className="card">
                <div
                  className="flex items-center gap-2"
                  style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', background: 'var(--bg-1)' }}
                >
                  <GitBranch size={14} style={{ color: 'var(--accent)' }} />
                  <span className="mono" style={{ color: 'var(--accent)' }}>{head.scene_number}</span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{head.scene_title}</span>
                  <span className="ml-auto muted" style={{ fontSize: 11 }}>{list.length}건</span>
                </div>
                <div style={{ padding: '8px 14px' }}>
                  {list.map(e => {
                    const meta = TYPE_META[e.type]
                    const Icon = meta?.icon ?? Wand2
                    return (
                      <div
                        key={e.id}
                        className="flex items-center gap-3"
                        style={{
                          padding: '8px 0',
                          borderBottom: '1px dashed var(--line)',
                          fontSize: 13,
                        }}
                      >
                        <div
                          style={{
                            width: 26, height: 26, borderRadius: '50%',
                            display: 'grid', placeItems: 'center',
                            background: 'var(--bg-3)',
                            color: meta?.color ?? 'var(--ink-3)',
                            flexShrink: 0,
                          }}
                        >
                          <Icon size={13} />
                        </div>
                        <span style={{ fontWeight: 500 }}>{meta?.label ?? e.type}</span>
                        <span className="muted">·</span>
                        <span className="mono" style={{ color: 'var(--ink-3)' }}>{e.engine}</span>
                        <Pill variant={statusVariant(e.status)} showDot>
                          {e.status}
                        </Pill>
                        <div className="flex-1" />
                        <span className="muted" style={{ fontSize: 12 }}>{formatRel(e.created_at)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
