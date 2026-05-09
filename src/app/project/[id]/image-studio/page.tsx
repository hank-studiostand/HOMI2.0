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

  // ── 데이터 로드 (prompt_attempts join 패턴 — 워크스페이스와 동일) ──
  const reload = useCallback(async (sceneId: string) => {
    const { data: at } = await supabase
      .from('prompt_attempts')
      .select('id, type, engine, prompt, status, created_at, outputs:attempt_outputs(id, archived, asset:assets(url, type, name), created_at)')
      .eq('scene_id', sceneId)
      .eq('type', 't2i')
      .order('created_at', { ascending: false })
      .limit(40)

    const meta: AttemptMeta[] = []
    const flat: OutputRow[] = []
    for (const a of (at ?? []) as any[]) {
      meta.push({ id: a.id, type: a.type, engine: a.engine, prompt: a.prompt ?? '', status: a.status, created_at: a.created_at })
      for (const o of (a.outputs ?? [])) {
        flat.push({
          id: o.id,
          attempt_id: a.id,
          url: o.asset?.url ?? null,
          archived: o.archived ?? false,
          type: a.type,
          engine: a.engine,
          created_at: o.created_at ?? a.created_at,
          status: a.status,
        })
      }
    }
    setAttempts(meta)
    setOutputs(flat)
  }, [supabase])

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

      const sceneParam = search?.get('scene')
      const initial = sceneParam && list.find(s => s.id === sceneParam)
        ? sceneParam : list[0]?.id ?? null
      setActiveId(initial)
    })()
    return () => { mounted = false }
  }, [projectId, search, supabase])

  useEffect(() => {
    if (!activeId) { setOutputs([]); setAttempts([]); return }
    void reload(activeId)
  }, [activeId, reload])

  // Realtime — prompt_attempts 변화 시 reload (scene_id 필터 작동)
  useEffect(() => {
    if (!activeId) return
    const ch = supabase
      .channel(`image-studio-${activeId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'prompt_attempts', filter: `scene_id=eq.${activeId}` },
        () => { void reload(activeId) },
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'attempt_outputs' },
        // attempt_outputs는 scene_id 컬럼이 없으니 필터 없이 — 받으면 reload (소량이라 OK)
        () => { void reload(activeId) },
      )
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [activeId, supabase, reload])

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
    if (!activeId) { alert('먼저 씬을 선택해주세요.'); return }
    const draft = promptDraft.trim()
    if (!draft) { alert('프롬프트를 입력해주세요.'); return }

    setGenerating(true)
    setLastError(null)
    try {
      const placeholderCount = Math.max(1, Math.min(4, count))
      const { data: attempt, error } = await supabase
        .from('prompt_attempts')
        .insert({
          scene_id: activeId, type: 't2i', engine,
          prompt: draft, status: 'generating', depth: 0,
        })
        .select().single()
      if (error || !attempt) { alert('시도 생성 실패: ' + (error?.message ?? '')); return }

      void reload(activeId)  // attempt 즉시 반영

      void (async () => {
        try {
          const r = await fetch('/api/t2i/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              attemptId: attempt.id, prompt: draft, engine,
              projectId, sceneId: activeId, aspectRatio: ratio,
              referenceImageUrls: referenceUrls.length > 0 ? referenceUrls : undefined,
              count: placeholderCount,
              quality,  // API 측에서 지원 시 적용
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
            void reload(activeId)
            return
          }
          // 성공 — Realtime으로 자동 reload되지만 안전하게 한 번 더
          void reload(activeId)
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
    if (activeId) void reload(activeId)
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
        <span style={{ fontSize: 10, color: 'var(--ink-5)' }}>이미지 생성 (T2I)</span>
      </div>

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
