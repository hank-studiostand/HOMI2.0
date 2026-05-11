'use client'

// /project/[id]/video-studio — 영상 생성 전용 풀 페이지 (Higgsfield Seedance 스타일)

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import VideoStudio from '@/components/workspace/VideoStudio'
import { ChevronDown } from 'lucide-react'

interface SceneRow { id: string; scene_number: string; title: string; content?: string }
interface AttemptMeta {
  id: string; prompt: string; engine: string
  status?: string                           // generating / done / failed
  metadata?: Record<string, any> | null     // mode, duration, ratio, failureReason 등
}
interface OutputRow {
  id: string; attempt_id: string; scene_id: string
  url: string | null; archived: boolean
  type: string; engine: string; created_at: string
  status?: string                           // attempt.status 미러
  failureReason?: string | null             // metadata.failureReason 노출
  metadata?: Record<string, any> | null     // attempt.metadata 그대로
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

  // sessionStorage 초기값 헬퍼 — 페이지 이동/리마운트해도 입력값 유지
  const STORE_KEY = `video-studio:${projectId}`
  function readStore<T>(k: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback
    try {
      const raw = window.sessionStorage.getItem(STORE_KEY)
      if (!raw) return fallback
      const o = JSON.parse(raw)
      return (k in o) ? (o[k] as T) : fallback
    } catch { return fallback }
  }
  function persist(patch: Record<string, any>) {
    if (typeof window === 'undefined') return
    try {
      const raw = window.sessionStorage.getItem(STORE_KEY)
      const o = raw ? JSON.parse(raw) : {}
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...o, ...patch }))
    } catch {}
  }

  const [promptDraft, _setPromptDraft] = useState(() => readStore('promptDraft', ''))
  const setPromptDraft = (v: string) => { _setPromptDraft(v); persist({ promptDraft: v }) }
  const [engine, _setEngine] = useState(() => readStore('engine', 'seedance-2'))
  const setEngine = (v: string) => { _setEngine(v); persist({ engine: v }) }
  const [duration, _setDuration] = useState(() => readStore('duration', 7))
  const setDuration = (v: number) => { _setDuration(v); persist({ duration: v }) }
  const [ratio, _setRatio] = useState(() => readStore('ratio', '16:9'))
  const setRatio = (v: string) => { _setRatio(v); persist({ ratio: v }) }
  const [resolution, _setResolution] = useState<'480p' | '720p' | '1080p'>(() => readStore('resolution', '1080p'))
  const setResolution = (v: '480p' | '720p' | '1080p') => { _setResolution(v); persist({ resolution: v }) }
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null)  // base64 라 sessionStorage 부담 — 휘발성 유지
  const [endFrameUrl, setEndFrameUrl] = useState<string | null>(null)
  const [refs, setRefs] = useState<Array<{
    token: string; rootAssetId: string; name: string; url: string | null; category: string
  }>>([])
  // uploadedAssets — 페이지에 lift up + sessionStorage 영속 (URL/메타만, 작음)
  const [uploadedAssets, _setUploadedAssets] = useState<Array<{
    id: string; url: string; name: string; kind: 'image' | 'video' | 'audio'; token: string
  }>>(() => readStore('uploadedAssets', []))
  const setUploadedAssets: typeof _setUploadedAssets = (u) => {
    _setUploadedAssets(prev => {
      const next = typeof u === 'function' ? (u as any)(prev) : u
      persist({ uploadedAssets: next })
      return next
    })
  }
  const [audioOn, _setAudioOn] = useState(() => readStore('audioOn', true))  // 기본값 ON
  const setAudioOn = (v: boolean) => { _setAudioOn(v); persist({ audioOn: v }) }
  const [generating, setGenerating] = useState(false)
  const [optimizing, setOptimizing] = useState(false)

  async function runOptimize() {
    const draft = promptDraft.trim()
    if (!draft) { alert('먼저 프롬프트를 입력해주세요.'); return }
    setOptimizing(true)
    try {
      const r = await fetch('/api/prompts/optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft, type: 'i2v', engine,
          aspectRatio: ratio,
        }),
      })
      const data = await r.json()
      if (!r.ok || !data?.optimized) {
        alert('최적화 실패: ' + (data?.error ?? r.statusText))
        return
      }
      setPromptDraft(String(data.optimized))
    } catch (err) {
      alert('최적화 오류: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setOptimizing(false)
    }
  }

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
        // 폴백 — metadata/project_id 컬럼 미적용 환경 (마이그레이션 미적용)
        const fb = await supabase
          .from('prompt_attempts')
          .select('id, prompt, engine, scene_id, type, status, created_at, outputs:attempt_outputs(id, archived, asset:assets(url, type, name), created_at)')
          .in('type', ['i2v'])
          .order('created_at', { ascending: false })
          .limit(80)
        rows = (fb.data ?? []).map((r: any) => ({ ...r, metadata: null, project_id: null }))
      } else {
        rows = tryStudio.data ?? []
      }
      const meta: AttemptMeta[] = []
      const flat: OutputRow[] = []
      for (const a of rows) {
        const aMetadata = (a.metadata && typeof a.metadata === 'object') ? a.metadata as Record<string, any> : null
        const aFailReason: string | null = aMetadata?.failureReason ?? null
        meta.push({
          id: a.id, prompt: a.prompt ?? '', engine: a.engine,
          status: a.status, metadata: aMetadata,
        })
        const outputs = a.outputs ?? []
        if (outputs.length === 0) {
          // 출력이 없으면 attempt 자체를 row 로 emit (실패/generating 카드용)
          if (a.status === 'failed' || a.status === 'generating') {
            flat.push({
              id: `attempt:${a.id}`, attempt_id: a.id, scene_id: a.scene_id,
              url: null, archived: false,
              type: 'i2v', engine: a.engine,
              created_at: a.created_at,
              status: a.status,
              failureReason: aFailReason,
              metadata: aMetadata,
            })
          }
        } else {
          for (const o of outputs) {
            flat.push({
              id: o.id, attempt_id: a.id, scene_id: a.scene_id,
              url: o.asset?.url ?? null,
              archived: o.archived ?? false,
              type: o.asset?.type ?? 'i2v',
              engine: a.engine,
              created_at: o.created_at ?? a.created_at,
              status: a.status,
              failureReason: aFailReason,
              metadata: aMetadata,
            })
          }
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
      // 업로드한 이미지 에셋도 reference 로 전달 (image kind 만 — video/audio 는 다른 채널)
      const uploadedImgUrls = uploadedAssets.filter(a => a.kind === 'image' && a.url).map(a => a.url)
      const allRefImgs = [...refUrls, ...uploadedImgUrls].slice(0, 4)
      const body = useT2V
        ? {
            attemptId: attempt.id, prompt: draft, engine,
            projectId, sceneId: null, duration,
            aspectRatio: ratio, generateAudio: audioOn,
            referenceImageUrls: allRefImgs.length > 0 ? allRefImgs : undefined,
          }
        : isR2V
          ? {
              attemptId: attempt.id, prompt: draft, engine,
              mode: 'r2v', referenceImageUrls: allRefImgs,
              projectId, sceneId: null,
              duration, aspectRatio: ratio, resolution, generateAudio: audioOn,
            }
          : {
              attemptId: attempt.id, prompt: draft, engine,
              sourceImageUrl,
              endFrameUrl: endFrameUrl ?? undefined,
              projectId, sceneId: null,
              duration, aspectRatio: ratio, resolution, generateAudio: audioOn,
            }

      void (async () => {
        async function clientMarkFailed(reason: string) {
          try {
            const { data: cur } = await supabase
              .from('prompt_attempts').select('metadata').eq('id', attempt.id).single()
            const prev = (cur?.metadata && typeof cur.metadata === 'object') ? cur.metadata : {}
            await supabase.from('prompt_attempts')
              .update({ status: 'failed', metadata: { ...prev, failureReason: String(reason).slice(0, 500) } })
              .eq('id', attempt.id)
          } catch {
            await supabase.from('prompt_attempts').update({ status: 'failed' }).eq('id', attempt.id)
          }
        }
        try {
          const r = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!r.ok) {
            const errText = await r.text()
            console.error('[video-studio] 생성 실패', r.status, errText.slice(0, 300))
            // 서버 측에서 이미 markAttemptFailed 로 metadata 머지함 — 클라는 fallback 만
            await clientMarkFailed(`HTTP ${r.status}: ${errText.slice(0, 300)}`)
          }
        } catch (e) {
          console.error('[video-studio] 백그라운드 에러', e)
          await clientMarkFailed(e instanceof Error ? e.message : String(e))
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
          optimizing={optimizing}
          onOptimize={runOptimize}
          sourceImageUrl={sourceImageUrl}
          onSourceImageChange={setSourceImageUrl}
          endFrameUrl={endFrameUrl}
          onEndFrameChange={setEndFrameUrl}
          refs={refs}
          onRefsChange={setRefs}
          rootAssets={rootAssets}
          recentOutputs={outputs
            .filter(o => {
              // 성공 — url 있고 archived 아님 + 영상 타입
              if (o.url && !o.archived && (o.type === 'i2v' || o.type === 't2v' || o.type === 'lipsync')) return true
              // 실패/진행중 — url 없어도 카드 노출
              if (o.status === 'failed' || o.status === 'generating') return true
              return false
            })
            .slice(0, 60)
            .map(o => ({
              id: o.id, url: o.url,
              prompt: attempts.find(a => a.id === o.attempt_id)?.prompt,
              engine: o.engine, created_at: o.created_at, attempt_id: o.attempt_id,
              status: o.status,
              failureReason: o.failureReason ?? null,
              metadata: o.metadata ?? null,
            }))}
          audioOn={audioOn}
          onAudioToggle={setAudioOn}
          uploadedAssets={uploadedAssets}
          onUploadedAssetsChange={setUploadedAssets}
        />
      </div>
    </div>
  )
}
