'use client'

// /project/[id]/video-studio — 영상 생성 전용 풀 페이지 (Higgsfield Seedance 스타일)

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import VideoStudio from '@/components/workspace/VideoStudio'
import { ChevronDown } from 'lucide-react'

interface SceneRow { id: string; scene_number: string; title: string; content?: string }
interface AttemptMeta { id: string; prompt: string; engine: string }
interface OutputRow {
  id: string; attempt_id: string; scene_id: string
  url: string | null; archived: boolean
  type: string; engine: string; created_at: string
}
interface RootAssetLite {
  id: string; name: string; category: string
  reference_image_urls?: string[] | null
}

export default function VideoStudioPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const search = useSearchParams()
  const supabase = createClient()

  const [scenes, setScenes] = useState<SceneRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [outputs, setOutputs] = useState<OutputRow[]>([])
  const [attempts, setAttempts] = useState<AttemptMeta[]>([])
  const [rootAssets, setRootAssets] = useState<RootAssetLite[]>([])
  const [sceneOpen, setSceneOpen] = useState(false)

  const [promptDraft, setPromptDraft] = useState('')
  const [engine, setEngine] = useState('seedance-2')
  const [duration, setDuration] = useState(7)
  const [ratio, setRatio] = useState('16:9')
  const [resolution, setResolution] = useState<'480p' | '720p' | '1080p'>('1080p')
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null)
  const [endFrameUrl, setEndFrameUrl] = useState<string | null>(null)
  const [refs, setRefs] = useState<Array<{
    token: string; rootAssetId: string; name: string; url: string | null; category: string
  }>>([])
  const [audioOn, setAudioOn] = useState(false)
  const [generating, setGenerating] = useState(false)

  // 초기 로드
  useEffect(() => {
    let mounted = true
    void (async () => {
      const { data: sc } = await supabase
        .from('scenes')
        .select('id, scene_number, title, content')
        .eq('project_id', projectId)
        .order('order_index')
      if (!mounted) return
      const list = (sc ?? []) as SceneRow[]
      setScenes(list)
      const sceneParam = search?.get('scene')
      const initial = sceneParam && list.find(s => s.id === sceneParam) ? sceneParam : list[0]?.id ?? null
      setActiveId(initial)

      // 루트 자산
      const { data: ra } = await supabase
        .from('root_asset_seeds')
        .select('id, name, category, reference_image_urls')
        .eq('project_id', projectId)
      if (mounted) setRootAssets((ra ?? []) as RootAssetLite[])

      // sessionStorage prefill (scene-editor → Seedance 프롬프트화 → 여기로 라우팅하면)
      try {
        const raw = window.sessionStorage.getItem('seedance_prefill')
        if (raw) {
          const payload = JSON.parse(raw)
          if (typeof payload?.prompt === 'string' && payload.prompt) setPromptDraft(payload.prompt)
          if (Array.isArray(payload?.refs)) setRefs(payload.refs)
          if (typeof payload?.durationSec === 'number') setDuration(payload.durationSec)
          if (typeof payload?.sceneId === 'string') setActiveId(payload.sceneId)
          window.sessionStorage.removeItem('seedance_prefill')
        }
      } catch {}
    })()
    return () => { mounted = false }
  }, [projectId, search, supabase])

  // 씬별 결과 로드
  useEffect(() => {
    if (!activeId) { setOutputs([]); setAttempts([]); return }
    let mounted = true
    void (async () => {
      const { data: at } = await supabase
        .from('prompt_attempts').select('id, prompt, engine')
        .eq('scene_id', activeId)
      const { data: out } = await supabase
        .from('attempt_outputs')
        .select('id, attempt_id, scene_id, archived, asset:assets(url, type, name), created_at')
        .eq('scene_id', activeId)
        .order('created_at', { ascending: false })
        .limit(60)
      if (!mounted) return
      setAttempts((at ?? []) as AttemptMeta[])
      const flat: OutputRow[] = (out ?? []).map((o: any) => ({
        id: o.id, attempt_id: o.attempt_id, scene_id: o.scene_id,
        url: o.asset?.url ?? null,
        archived: o.archived ?? false,
        type: o.asset?.type ?? 'i2v',
        engine: (at ?? []).find((a: any) => a.id === o.attempt_id)?.engine ?? '',
        created_at: o.created_at,
      }))
      setOutputs(flat)
    })()
    return () => { mounted = false }
  }, [activeId, supabase])

  // Realtime
  useEffect(() => {
    if (!activeId) return
    const ch = supabase
      .channel(`video-studio-${activeId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'attempt_outputs', filter: `scene_id=eq.${activeId}` },
        async () => {
          const { data: out } = await supabase
            .from('attempt_outputs')
            .select('id, attempt_id, scene_id, archived, asset:assets(url, type, name), created_at')
            .eq('scene_id', activeId)
            .order('created_at', { ascending: false })
            .limit(60)
          const flat: OutputRow[] = (out ?? []).map((o: any) => ({
            id: o.id, attempt_id: o.attempt_id, scene_id: o.scene_id,
            url: o.asset?.url ?? null, archived: o.archived ?? false,
            type: o.asset?.type ?? 'i2v', engine: '', created_at: o.created_at,
          }))
          setOutputs(flat)
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [activeId, supabase])

  const activeScene = useMemo(() => scenes.find(s => s.id === activeId) ?? null, [scenes, activeId])

  async function runGenerate() {
    if (!activeId) { alert('먼저 씬을 선택해주세요.'); return }
    const draft = promptDraft.trim()
    if (!draft) { alert('프롬프트를 입력해주세요.'); return }

    const isR2V = engine === 'seedance-2' && refs.length > 0

    setGenerating(true)
    try {
      const dbType = 'i2v'
      const { data: attempt, error } = await supabase
        .from('prompt_attempts')
        .insert({
          scene_id: activeId, type: dbType, engine,
          prompt: draft, status: 'generating', depth: 0,
        })
        .select().single()
      if (error || !attempt) { alert('시도 생성 실패: ' + (error?.message ?? '')); return }

      const useT2V = !sourceImageUrl && refs.length === 0
      const url = useT2V ? '/api/t2v/generate' : '/api/i2v/generate'
      const refUrls = refs.map(r => r.url).filter((u): u is string => !!u)
      const body = useT2V
        ? {
            attemptId: attempt.id, prompt: draft, engine,
            projectId, sceneId: activeId, duration,
            aspectRatio: ratio,
          }
        : isR2V
          ? {
              attemptId: attempt.id, prompt: draft, engine,
              mode: 'r2v', referenceImageUrls: refUrls,
              projectId, sceneId: activeId,
              duration, aspectRatio: ratio, resolution,
            }
          : {
              attemptId: attempt.id, prompt: draft, engine,
              sourceImageUrl,
              endFrameUrl: endFrameUrl ?? undefined,
              projectId, sceneId: activeId,
              duration, aspectRatio: ratio, resolution,
            }

      void (async () => {
        try {
          const r = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!r.ok) {
            const errText = await r.text()
            console.error('[video-studio] 생성 실패', r.status, errText.slice(0, 300))
            alert('영상 생성 실패 (' + r.status + '): ' + errText.slice(0, 200))
            await supabase.from('prompt_attempts').update({ status: 'failed' }).eq('id', attempt.id)
            return
          }
        } catch (e) {
          console.error('[video-studio] 백그라운드 에러', e)
        }
      })()
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '10px 18px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--bg-1)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 500 }}>씬</span>
        <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
          <button onClick={() => setSceneOpen(o => !o)}
            style={{
              padding: '6px 12px', borderRadius: 'var(--r-md)',
              border: '1px solid var(--line)', background: 'var(--bg)',
              color: 'var(--ink)', fontSize: 12, fontWeight: 500,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              cursor: 'pointer',
            }}>
            {activeScene ? (
              <>
                <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>{activeScene.scene_number}</span>
                <span style={{ color: 'var(--ink-2)' }}>{activeScene.title || '제목 없음'}</span>
              </>
            ) : (<span style={{ color: 'var(--ink-4)' }}>씬 선택</span>)}
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
                  씬이 없어요
                </div>
              ) : scenes.map(s => (
                <button key={s.id}
                  onClick={() => { setActiveId(s.id); setSceneOpen(false) }}
                  style={{
                    width: '100%', padding: '6px 10px',
                    background: s.id === activeId ? 'var(--accent-soft)' : 'transparent',
                    color: s.id === activeId ? 'var(--accent)' : 'var(--ink-2)',
                    border: 'none', borderRadius: 'var(--r-sm)',
                    fontSize: 12, fontWeight: 500, textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                  }}>
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
        <span style={{ fontSize: 10, color: 'var(--ink-5)' }}>영상 생성 (I2V / T2V / R2V)</span>
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <VideoStudio
          projectId={projectId}
          sceneId={activeId}
          promptDraft={promptDraft}
          onPromptChange={setPromptDraft}
          engine={engine}
          onEngineChange={setEngine}
          duration={duration}
          onDurationChange={setDuration}
          ratio={ratio}
          onRatioChange={setRatio}
          resolution={resolution}
          onResolutionChange={setResolution}
          generating={generating}
          onGenerate={runGenerate}
          sourceImageUrl={sourceImageUrl}
          onSourceImageChange={setSourceImageUrl}
          endFrameUrl={endFrameUrl}
          onEndFrameChange={setEndFrameUrl}
          refs={refs}
          onRefsChange={setRefs}
          rootAssets={rootAssets}
          recentOutputs={outputs
            .filter(o => o.url && !o.archived && (o.type === 'i2v' || o.type === 't2v' || o.type === 'lipsync'))
            .slice(0, 60)
            .map(o => ({
              id: o.id, url: o.url,
              prompt: attempts.find(a => a.id === o.attempt_id)?.prompt,
              engine: o.engine, created_at: o.created_at, attempt_id: o.attempt_id,
            }))}
          audioOn={audioOn}
          onAudioToggle={setAudioOn}
        />
      </div>
    </div>
  )
}
