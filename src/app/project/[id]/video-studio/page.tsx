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
  const [rootAssets] = useState<RootAssetLite[]>([])  // Studio 는 루트에셋 비독립 — 빈 배열

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

  // 초기 로드 (Studio — 씬 비독립)
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
    })()
    return () => { mounted = false }
  }, [projectId, supabase])

  // Studio 결과 로드 (source='studio', 모든 씬 또는 null)
  useEffect(() => {
    let mounted = true
    void (async () => {
      const tryStudio = await supabase
        .from('prompt_attempts')
        .select('id, prompt, engine, scene_id, project_id, type, metadata, status, created_at, outputs:attempt_outputs(id, archived, asset:assets(url, type, name), created_at)')
        .eq('project_id', projectId)
        .in('type', ['i2v'])
        .eq('metadata->>source', 'studio')
        .order('created_at', { ascending: false })
        .limit(80)
      if (!mounted) return
      let rows: any[] = []
      if (tryStudio.error) {
        // 폴백 — metadata 컬럼 미적용
        const fb = await supabase
          .from('prompt_attempts')
          .select('id, prompt, engine, scene_id, type, status, created_at, outputs:attempt_outputs(id, archived, asset:assets(url, type, name), created_at)')
          .in('type', ['i2v'])
          .order('created_at', { ascending: false })
          .limit(80)
        rows = fb.data ?? []
      } else {
        rows = tryStudio.data ?? []
      }
      const meta: AttemptMeta[] = []
      const flat: OutputRow[] = []
      for (const a of rows) {
        meta.push({ id: a.id, prompt: a.prompt ?? '', engine: a.engine })
        for (const o of (a.outputs ?? [])) {
          flat.push({
            id: o.id, attempt_id: a.id, scene_id: a.scene_id,
            url: o.asset?.url ?? null,
            archived: o.archived ?? false,
            type: o.asset?.type ?? 'i2v',
            engine: a.engine,
            created_at: o.created_at ?? a.created_at,
          })
        }
      }
      setAttempts(meta)
      setOutputs(flat)
    })()
    return () => { mounted = false }
  }, [supabase])

  // Realtime — 전체 prompt_attempts/attempt_outputs 변화 시 reload (Studio 전체)
  useEffect(() => {
    const ch = supabase
      .channel(`video-studio-${projectId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'prompt_attempts' },
        () => { /* 의존성: 위 useEffect가 다음 tick에서 reload — 여기선 nothing */ },
      )
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [projectId, supabase])

  const activeScene = useMemo(() => scenes.find(s => s.id === activeId) ?? null, [scenes, activeId])

  async function runGenerate() {
    const draft = promptDraft.trim()
    if (!draft) { alert('프롬프트를 입력해주세요.'); return }

    const isR2V = engine === 'seedance-2' && refs.length > 0
    const useT2V = !sourceImageUrl && refs.length === 0
    const studioMode: 't2v' | 'r2v' | 'i2v' = useT2V ? 't2v' : isR2V ? 'r2v' : 'i2v'

    setGenerating(true)
    try {
      const dbType = 'i2v'
      const { data: attempt, error } = await supabase
        .from('prompt_attempts')
        .insert({
          project_id: projectId,
          scene_id: null, type: dbType, engine,    // Studio — 씬 비독립
          prompt: draft, status: 'generating', depth: 0,
          metadata: {
            source: 'studio', mode: studioMode,
            duration, ratio, resolution,
            hasStartFrame: !!sourceImageUrl,
            hasEndFrame:   !!endFrameUrl,
            refCount: refs.length,
          },
        })
        .select().single()
      if (error || !attempt) {
        alert('시도 생성 실패: ' + (error?.message ?? '') + '\n\n마이그레이션 미적용 시 prompt_attempts.scene_id NOT NULL 제약으로 실패할 수 있어요.\nSupabase에서 2026-05-10_prompt_attempts_scene_nullable.sql 적용해주세요.')
        return
      }

      const url = useT2V ? '/api/t2v/generate' : '/api/i2v/generate'
      const refUrls = refs.map(r => r.url).filter((u): u is string => !!u)
      const body = useT2V
        ? {
            attemptId: attempt.id, prompt: draft, engine,
            projectId, sceneId: null, duration,
            aspectRatio: ratio,
          }
        : isR2V
          ? {
              attemptId: attempt.id, prompt: draft, engine,
              mode: 'r2v', referenceImageUrls: refUrls,
              projectId, sceneId: null,
              duration, aspectRatio: ratio, resolution,
            }
          : {
              attemptId: attempt.id, prompt: draft, engine,
              sourceImageUrl,
              endFrameUrl: endFrameUrl ?? undefined,
              projectId, sceneId: null,
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
