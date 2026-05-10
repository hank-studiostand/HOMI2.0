'use client'

// /project/[id]/image-studio
// 이미지 생성 전용 페이지 (Nano Banana Pro 스타일)

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ImageStudio from '@/components/workspace/ImageStudio'
import { ChevronDown } from 'lucide-react'

interface SceneRow { id: string; scene_number: string; title: string; content?: string }
interface AttemptMeta { id: string; type?: string; prompt: string; engine: string; status?: string; created_at?: string }
interface OutputRow {
  id: string; attempt_id: string
  url: string | null; archived: boolean
  type: string; engine: string; created_at: string
  status?: string  // attempt status 반영
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
  const [quality, setQuality] = useState<'1K' | '2K' | '4K'>('1K')
  const [referenceUrls, setReferenceUrls] = useState<string[]>([])  // 업로드된 레퍼런스 URL
  const [generating, setGenerating] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  // ── 데이터 로드 (Studio 전용 — scene 비독립, source='studio' 만) ──
  const reload = useCallback(async () => {
    // 프로젝트 씬 ID 셋 — scene_id null 또는 프로젝트 씬에 속한 attempts 모두 가져오기
    const { data: sc } = await supabase
      .from('scenes').select('id').eq('project_id', projectId)
    const sceneIds = (sc ?? []).map((s: any) => s.id)
    // metadata.source='studio' 필터 — Studio 페이지 전용 라이브러리
    let q = supabase
      .from('prompt_attempts')
      .select('id, type, engine, prompt, status, created_at, scene_id, metadata, outputs:attempt_outputs(id, archived, asset:assets(url, type, name), created_at)')
      .eq('type', 't2i')
      .eq('metadata->>source', 'studio')
      .order('created_at', { ascending: false })
      .limit(60)
    const { data: at, error } = await q
    if (error) {
      // metadata 미적용 환경 — 폴백 (스튜디오는 본 마이그레이션 후에만 정상)
      console.warn('[image-studio] metadata 폴백:', error.message)
      const fallback = await supabase
        .from('prompt_attempts')
        .select('id, type, engine, prompt, status, created_at, scene_id, outputs:attempt_outputs(id, archived, asset:assets(url, type, name), created_at)')
        .eq('type', 't2i')
        .order('created_at', { ascending: false })
        .limit(60)
      processAttempts(fallback.data ?? [])
      return
    }
    processAttempts(at ?? [])
    function processAttempts(rows: any[]) {
      const meta: AttemptMeta[] = []
      const flat: OutputRow[] = []
      for (const a of rows) {
        // 프로젝트 외부 씬은 제외 (scene_id 가 set 인데 우리 프로젝트가 아닌 경우)
        if (a.scene_id && sceneIds.length && !sceneIds.includes(a.scene_id)) continue
        meta.push({ id: a.id, type: a.type, engine: a.engine, prompt: a.prompt ?? '', status: a.status, created_at: a.created_at })
        for (const o of (a.outputs ?? [])) {
          flat.push({
            id: o.id, attempt_id: a.id,
            url: o.asset?.url ?? null,
            archived: o.archived ?? false,
            type: a.type, engine: a.engine,
            created_at: o.created_at ?? a.created_at,
            status: a.status,
          })
        }
      }
      setAttempts(meta)
      setOutputs(flat)
    }
  }, [supabase, projectId])

  useEffect(() => {
    let mounted = true
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (mounted) setMeId(user?.id ?? null)

      // 씬 목록은 그대로 로드 (옵션으로 연결 가능 — UI에서 노출은 안 함)
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

  useEffect(() => {
    void reload()
  }, [reload])

  // Realtime — prompt_attempts 변화 시 reload (Studio 전체)
  useEffect(() => {
    const ch = supabase
      .channel(`image-studio-${projectId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'prompt_attempts' },
        () => { void reload() },
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'attempt_outputs' },
        () => { void reload() },
      )
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [projectId, supabase, reload])

  const activeScene = useMemo(() => scenes.find(s => s.id === activeId) ?? null, [scenes, activeId])

  // ── 레퍼런스 업로드 ──
  async function uploadReference(file: File): Promise<string | null> {
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드 가능해요')
      return null
    }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const path = `references/${projectId}/${Date.now()}_${Math.random().toString(36).slice(2,7)}.${ext}`
    const { data, error } = await supabase.storage.from('assets').upload(path, file, {
      contentType: file.type, upsert: false,
    })
    if (error) { alert('업로드 실패: ' + error.message); return null }
    const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(data.path)
    return publicUrl
  }

  async function runGenerate() {
    const draft = promptDraft.trim()
    if (!draft) { alert('프롬프트를 입력해주세요.'); return }

    setGenerating(true)
    setLastError(null)
    try {
      const placeholderCount = Math.max(1, Math.min(4, count))
      const { data: attempt, error } = await supabase
        .from('prompt_attempts')
        .insert({
          scene_id: null, type: 't2i', engine,    // Studio 는 씬 비독립 (마이그레이션 적용 필요)
          prompt: draft, status: 'generating', depth: 0,
          metadata: { source: 'studio', mode: 'single', count: placeholderCount, quality, ratio },
        })
        .select().single()
      if (error || !attempt) {
        // scene_id NOT NULL 제약 등 — 안내
        alert('시도 생성 실패: ' + (error?.message ?? '') + '\n\n마이그레이션 미적용 시 prompt_attempts.scene_id 가 NOT NULL이라 실패할 수 있어요.\nSupabase에서 2026-05-10_prompt_attempts_scene_nullable.sql 적용해주세요.')
        return
      }

      void reload()  // attempt 즉시 반영

      void (async () => {
        try {
          const r = await fetch('/api/t2i/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              attemptId: attempt.id, prompt: draft, engine,
              projectId, sceneId: null, aspectRatio: ratio,
              referenceImageUrls: referenceUrls.length > 0 ? referenceUrls : undefined,
              count: placeholderCount,
              quality,
            }),
          })
          if (!r.ok) {
            const errText = await r.text()
            let parsed: any = {}
            try { parsed = JSON.parse(errText) } catch {}
            const msg = parsed?.error ?? errText.slice(0, 400) ?? r.statusText
            console.error('[image-studio] 생성 실패', r.status, msg)
            setLastError(`(${r.status}) ${msg}`)
            await supabase.from('prompt_attempts').update({ status: 'failed' }).eq('id', attempt.id)
            void reload()
            return
          }
          void reload()
        } catch (e: any) {
          console.error('[image-studio] 백그라운드 에러', e)
          setLastError(e?.message ?? String(e))
        }
      })()
    } finally {
      setGenerating(false)
    }
  }

  // 가장 최근 attempt + 그 outputs (결과 노출용)
  const latestAttempt = attempts[0]
  const latestOutputs = useMemo(() =>
    latestAttempt ? outputs.filter(o => o.attempt_id === latestAttempt.id) : []
  , [latestAttempt, outputs])

  async function deleteAttempt(attemptId: string) {
    if (!confirm('이 결과를 삭제할까요?')) return
    await supabase.from('prompt_attempts').update({ status: 'failed' }).eq('id', attemptId)
    await supabase.from('attempt_outputs').update({ archived: true }).eq('attempt_id', attemptId)
    void reload()
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
          quality={quality}
          onQualityChange={setQuality}
          referenceUrls={referenceUrls}
          onReferenceAdd={async (file: File) => {
            const url = await uploadReference(file)
            if (url) setReferenceUrls(prev => [...prev, url])
          }}
          onReferenceRemove={(url: string) => setReferenceUrls(prev => prev.filter(u => u !== url))}
          recentOutputs={outputs
            .filter(o => o.url && !o.archived)
            .slice(0, 30)
            .map(o => ({
              id: o.id, url: o.url, prompt: attempts.find(a => a.id === o.attempt_id)?.prompt,
              engine: o.engine, created_at: o.created_at, attempt_id: o.attempt_id,
            }))}
          latestAttempt={latestAttempt
            ? {
                id: latestAttempt.id,
                status: latestAttempt.status ?? 'unknown',
                prompt: latestAttempt.prompt,
                outputs: latestOutputs.map(o => ({ id: o.id, url: o.url, archived: o.archived })),
              }
            : null}
          onRetry={() => void runGenerate()}
          onDeleteLatest={() => latestAttempt && deleteAttempt(latestAttempt.id)}
          lastError={lastError}
        />
      </div>
    </div>
  )
}
