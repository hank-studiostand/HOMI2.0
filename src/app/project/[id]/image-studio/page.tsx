'use client'

// /project/[id]/image-studio
// 이미지 생성 전용 페이지 (Nano Banana Pro 스타일)
// — 씬 선택기 + ImageStudio 컴포넌트 + 자체 생성 핸들러

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ImageStudio from '@/components/workspace/ImageStudio'
import { ChevronDown } from 'lucide-react'

interface SceneRow {
  id: string
  scene_number: string
  title: string
  content?: string
}
interface AttemptMeta { id: string; prompt: string; engine: string }
interface OutputRow {
  id: string
  attempt_id: string
  scene_id: string
  url: string | null
  archived: boolean
  type: string
  engine: string
  created_at: string
}

export default function ImageStudioPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const search = useSearchParams()
  const supabase = createClient()

  const [scenes, setScenes] = useState<SceneRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [outputs, setOutputs] = useState<OutputRow[]>([])
  const [attempts, setAttempts] = useState<AttemptMeta[]>([])
  const [meId, setMeId] = useState<string | null>(null)
  const [sceneOpen, setSceneOpen] = useState(false)

  const [promptDraft, setPromptDraft] = useState('')
  const [engine, setEngine] = useState('nanobanana')
  const [ratio, setRatio] = useState('3:4')
  const [count, setCount] = useState(4)
  const [generating, setGenerating] = useState(false)

  // ── 초기 로드 ──
  useEffect(() => {
    let mounted = true
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (mounted) setMeId(user?.id ?? null)

      const { data: sc } = await supabase
        .from('scenes')
        .select('id, scene_number, title, content')
        .eq('project_id', projectId)
        .order('order_index')
      if (!mounted) return
      const list = (sc ?? []) as SceneRow[]
      setScenes(list)

      // URL ?scene=... 우선, 없으면 첫 번째 씬
      const sceneParam = search?.get('scene')
      const initial = sceneParam && list.find(s => s.id === sceneParam)
        ? sceneParam
        : list[0]?.id ?? null
      setActiveId(initial)
    })()
    return () => { mounted = false }
  }, [projectId, search, supabase])

  // 씬별 outputs/attempts 로드
  useEffect(() => {
    if (!activeId) { setOutputs([]); setAttempts([]); return }
    let mounted = true
    void (async () => {
      const { data: at } = await supabase
        .from('prompt_attempts')
        .select('id, prompt, engine')
        .eq('scene_id', activeId)
      const { data: out } = await supabase
        .from('attempt_outputs')
        .select('id, attempt_id, scene_id, archived, satisfaction_score, asset:assets(url, type, name), created_at')
        .eq('scene_id', activeId)
        .order('created_at', { ascending: false })
        .limit(60)
      if (!mounted) return
      setAttempts((at ?? []) as AttemptMeta[])
      const flat: OutputRow[] = (out ?? []).map((o: any) => ({
        id: o.id,
        attempt_id: o.attempt_id,
        scene_id: o.scene_id,
        url: o.asset?.url ?? null,
        archived: o.archived ?? false,
        type: o.asset?.type ?? 't2i',
        engine: (at ?? []).find((a: any) => a.id === o.attempt_id)?.engine ?? '',
        created_at: o.created_at,
      }))
      setOutputs(flat)
    })()
    return () => { mounted = false }
  }, [activeId, supabase])

  const activeScene = useMemo(() => scenes.find(s => s.id === activeId) ?? null, [scenes, activeId])

  // Realtime — 새 attempt_output 도착 시 reload
  useEffect(() => {
    if (!activeId) return
    const ch = supabase
      .channel(`image-studio-${activeId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'attempt_outputs', filter: `scene_id=eq.${activeId}` },
        async () => {
          const { data: out } = await supabase
            .from('attempt_outputs')
            .select('id, attempt_id, scene_id, archived, satisfaction_score, asset:assets(url, type, name), created_at')
            .eq('scene_id', activeId)
            .order('created_at', { ascending: false })
            .limit(60)
          const flat: OutputRow[] = (out ?? []).map((o: any) => ({
            id: o.id,
            attempt_id: o.attempt_id,
            scene_id: o.scene_id,
            url: o.asset?.url ?? null,
            archived: o.archived ?? false,
            type: o.asset?.type ?? 't2i',
            engine: '',
            created_at: o.created_at,
          }))
          setOutputs(flat)
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [activeId, supabase])

  async function runGenerate() {
    if (!activeId) { alert('먼저 씬을 선택해주세요.'); return }
    const draft = promptDraft.trim()
    if (!draft) { alert('프롬프트를 입력해주세요.'); return }

    setGenerating(true)
    try {
      // prompt_attempts insert
      const { data: attempt, error } = await supabase
        .from('prompt_attempts')
        .insert({
          scene_id: activeId, type: 't2i', engine,
          prompt: draft, status: 'generating', depth: 0,
        })
        .select().single()
      if (error || !attempt) { alert('시도 생성 실패: ' + (error?.message ?? '')); return }

      const placeholderCount = Math.max(1, Math.min(8, count))
      // /api/t2i/generate 호출 (백그라운드)
      void (async () => {
        try {
          const r = await fetch('/api/t2i/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              attemptId: attempt.id, prompt: draft, engine,
              projectId, sceneId: activeId, aspectRatio: ratio,
              count: placeholderCount,
            }),
          })
          if (!r.ok) {
            const errText = await r.text()
            console.error('[image-studio] generate 실패', r.status, errText.slice(0, 300))
            alert(`이미지 생성 실패 (${r.status}): ${errText.slice(0, 200)}`)
            await supabase.from('prompt_attempts').update({ status: 'failed' }).eq('id', attempt.id)
            return
          }
          // Realtime이 자동 reload
        } catch (e) {
          console.error('[image-studio] generate 백그라운드 에러', e)
        }
      })()
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 씬 선택기 (상단) */}
      <div style={{
        padding: '10px 18px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--bg-1)',
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 500 }}>씬</span>
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setSceneOpen(o => !o)}
            style={{
              padding: '6px 12px', borderRadius: 'var(--r-md)',
              border: '1px solid var(--line)', background: 'var(--bg)',
              color: 'var(--ink)', fontSize: 12, fontWeight: 500,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              cursor: 'pointer',
            }}
          >
            {activeScene ? (
              <>
                <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>{activeScene.scene_number}</span>
                <span style={{ color: 'var(--ink-2)' }}>{activeScene.title || '제목 없음'}</span>
              </>
            ) : (
              <span style={{ color: 'var(--ink-4)' }}>씬 선택</span>
            )}
            <ChevronDown size={12} />
          </button>
          {sceneOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0,
              zIndex: 50, minWidth: 280, maxHeight: 380, overflowY: 'auto',
              background: 'var(--bg)', border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              padding: 4,
            }}>
              {scenes.length === 0 ? (
                <div style={{ padding: 16, fontSize: 11, color: 'var(--ink-4)', textAlign: 'center' }}>
                  씬이 없어요. 씬 분류부터 만들어주세요.
                </div>
              ) : scenes.map(s => (
                <button key={s.id}
                  onClick={() => { setActiveId(s.id); setSceneOpen(false) }}
                  style={{
                    width: '100%', padding: '6px 10px',
                    background: s.id === activeId ? 'var(--accent-soft)' : 'transparent',
                    color: s.id === activeId ? 'var(--accent)' : 'var(--ink-2)',
                    border: 'none', borderRadius: 'var(--r-sm)',
                    fontSize: 12, fontWeight: 500,
                    textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 8,
                    cursor: 'pointer',
                  }}
                >
                  <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700, minWidth: 40 }}>{s.scene_number}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title || '제목 없음'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--ink-5)' }}>이미지 생성 (T2I)</span>
      </div>

      {/* ImageStudio 본문 */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <ImageStudio
          projectId={projectId}
          sceneId={activeId}
          promptDraft={promptDraft}
          onPromptChange={setPromptDraft}
          engine={engine}
          onEngineChange={setEngine}
          ratio={ratio}
          onRatioChange={setRatio}
          generating={generating}
          onGenerate={runGenerate}
          count={count}
          onCountChange={setCount}
          recentOutputs={outputs
            .filter(o => o.url && !o.archived)
            .slice(0, 30)
            .map(o => ({
              id: o.id, url: o.url, prompt: attempts.find(a => a.id === o.attempt_id)?.prompt,
              engine: o.engine, created_at: o.created_at, attempt_id: o.attempt_id,
            }))}
        />
      </div>
    </div>
  )
}
