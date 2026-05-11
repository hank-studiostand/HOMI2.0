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
  const [lightboxOutputId, setLightboxOutputId] = useState<string | null>(null)

  // 큐 진행 = state 또는 DB attempt 중 generating 상태 — Realtime 으로 자동 갱신
  const liveGenerating = useMemo(() => {
    if (generating) return true
    return attempts.some(a => a.status === 'generating')
  }, [generating, attempts])

  // 실패한 attempt 재시도
  async function runRetry(attemptId: string) {
    const a = attempts.find(x => x.id === attemptId)
    if (!a) { alert('재시도할 attempt 을 찾을 수 없어요.'); return }
    if (a.prompt) setPromptDraft(a.prompt)
    // 메타데이터 복원 — duration/ratio/resolution
    const m = a.metadata ?? {}
    if (typeof m.duration === 'number') setDuration(m.duration)
    if (typeof m.ratio === 'string') setRatio(m.ratio)
    if (m.resolution === '480p' || m.resolution === '720p' || m.resolution === '1080p') setResolution(m.resolution)
    // 곧바로 generate 트리거 (sessionStorage 반영 후 다음 tick)
    await new Promise(r => setTimeout(r, 100))
    void runGenerate()
  }

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

    // 업로드된 이미지 element 도 reference 로 함께 보냄
    const uploadedImgPreview = uploadedAssets.filter(a => a.kind === 'image' && a.url).length
    const hasAnyImgRef = refs.length > 0 || uploadedImgPreview > 0
    // R2V 가능 조건: Seedance + (rootAsset refs 또는 업로드 이미지 elements) 가 1+
    const isR2V = engine === 'seedance-2' && hasAnyImgRef && !sourceImageUrl
    // T2V — startFrame 없고 어떤 reference 도 없을 때만
    const useT2V = !sourceImageUrl && !hasAnyImgRef
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
            // 결과 라이트박스에서 어떤 elements 가 쓰였는지 표시하기 위해 저장
            elements: uploadedAssets.map(a => ({
              id: a.id, url: a.url, name: a.name, kind: a.kind, token: a.token,
            })),
            refs: refs.map(r => ({
              token: r.token, name: r.name, url: r.url, category: r.category,
            })),
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

  // Lightbox 데이터 — 클릭한 output 의 attempt 정보
  const lightboxData = useMemo(() => {
    if (!lightboxOutputId) return null
    const o = outputs.find(x => x.id === lightboxOutputId)
    if (!o) return null
    const a = attempts.find(x => x.id === o.attempt_id)
    return { output: o, attempt: a ?? null }
  }, [lightboxOutputId, outputs, attempts])

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
          generating={liveGenerating}
          onGenerate={runGenerate}
          onZoomOutput={(id) => setLightboxOutputId(id)}
          onRetryAttempt={runRetry}
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

      {/* Lightbox — 결과 클릭 시 영상 + 프롬프트 + Elements 표시 */}
      {lightboxData?.output?.url && (
        <div onClick={() => setLightboxOutputId(null)} style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 'clamp(16px, 4vw, 48px)',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)',
            gap: 16, width: '100%', maxWidth: 1400, maxHeight: 'calc(100vh - 80px)',
          }}>
            {/* 영상 */}
            <div style={{
              background: '#000', borderRadius: 12, overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              minHeight: 300,
            }}>
              <video src={lightboxData.output.url} controls autoPlay loop
                style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 120px)', width: 'auto', height: 'auto' }} />
            </div>
            {/* 프롬프트 + Elements */}
            <div style={{
              background: 'var(--bg)', borderRadius: 12,
              border: '1px solid var(--line)',
              padding: 18, overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 16,
              maxHeight: 'calc(100vh - 80px)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.05em' }}>
                  {(lightboxData.attempt?.engine ?? 'video').toUpperCase()}
                </span>
                <span style={{ flex: 1 }} />
                <button onClick={() => setLightboxOutputId(null)} style={{
                  padding: 6, background: 'var(--bg-2)', border: '1px solid var(--line)',
                  borderRadius: 999, color: 'var(--ink-3)', cursor: 'pointer', fontSize: 11,
                }}>닫기 ×</button>
              </div>

              {/* 프롬프트 */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.05em', marginBottom: 6 }}>
                  PROMPT
                </div>
                <div style={{
                  fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.6,
                  background: 'var(--bg-2)', border: '1px solid var(--line)',
                  borderRadius: 8, padding: 10, whiteSpace: 'pre-wrap',
                  maxHeight: 240, overflowY: 'auto',
                }}>
                  {lightboxData.attempt?.prompt || '(프롬프트 정보 없음)'}
                </div>
              </div>

              {/* Elements */}
              {((lightboxData.attempt?.metadata as any)?.elements?.length > 0 || (lightboxData.attempt?.metadata as any)?.refs?.length > 0) && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.05em', marginBottom: 6 }}>
                    ELEMENTS · REFS
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 6 }}>
                    {((lightboxData.attempt?.metadata as any)?.elements ?? []).map((el: any) => (
                      <div key={'el-' + el.id} title={`${el.token} · ${el.name}`} style={{
                        aspectRatio: '1', borderRadius: 8,
                        background: 'var(--bg-2)', border: '1px solid var(--line)',
                        overflow: 'hidden', position: 'relative',
                      }}>
                        {el.kind === 'image' && el.url && <img src={el.url} alt='' style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        {el.kind === 'video' && el.url && <video src={el.url} muted preload='metadata' style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        <span style={{
                          position: 'absolute', bottom: 2, left: 2, right: 2,
                          fontSize: 9, color: '#fff',
                          background: 'rgba(0,0,0,0.7)', padding: '1px 4px',
                          borderRadius: 4, textAlign: 'center',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{el.token}</span>
                      </div>
                    ))}
                    {((lightboxData.attempt?.metadata as any)?.refs ?? []).map((rf: any, i: number) => (
                      <div key={'rf-' + i} title={`${rf.token} · ${rf.name}`} style={{
                        aspectRatio: '1', borderRadius: 8,
                        background: 'var(--bg-2)', border: '1px dashed var(--accent-line)',
                        overflow: 'hidden', position: 'relative',
                      }}>
                        {rf.url && <img src={rf.url} alt='' style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        <span style={{
                          position: 'absolute', bottom: 2, left: 2, right: 2,
                          fontSize: 9, color: '#fff',
                          background: 'rgba(0,0,0,0.7)', padding: '1px 4px',
                          borderRadius: 4, textAlign: 'center',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{rf.token}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 메타 */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.05em', marginBottom: 6 }}>
                  META
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.7 }}>
                  {(lightboxData.attempt?.metadata as any)?.mode && <div>mode: <b>{(lightboxData.attempt?.metadata as any).mode}</b></div>}
                  {(lightboxData.attempt?.metadata as any)?.duration && <div>duration: <b>{(lightboxData.attempt?.metadata as any).duration}s</b></div>}
                  {(lightboxData.attempt?.metadata as any)?.ratio && <div>ratio: <b>{(lightboxData.attempt?.metadata as any).ratio}</b></div>}
                  {(lightboxData.attempt?.metadata as any)?.resolution && <div>resolution: <b>{(lightboxData.attempt?.metadata as any).resolution}</b></div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
