'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import {
  Loader2, ChevronRight, ChevronDown, Play, RefreshCw,
  ImageOff, CheckCircle2, XCircle, Film, Sparkles, Square,
} from 'lucide-react'
import type { Scene, Asset, SatisfactionScore } from '@/types'
import Badge from '@/components/ui/Badge'
import SatisfactionRating from '@/components/ui/SatisfactionRating'
import SceneTreeView from '@/components/scene/SceneTreeView'
import CameraReferencePanel, { buildCameraPrompt } from '@/components/ui/CameraReferencePanel'
import SceneReferencePicker, {
  emptyRefSelection, allSelectedUrls, RefSelection,
} from '@/components/ui/SceneReferencePicker'
import { pushToast } from '@/components/ui/GenerationToast'
import { sendGenerationNotification, getNotificationsEnabled, getSlackWebhookUrl } from '@/lib/notifications'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface I2VAttempt {
  id: string
  scene_id: string
  prompt: string
  engine: string
  status: 'pending' | 'generating' | 'done' | 'failed'
  created_at: string
  metadata?: { source_image_url?: string; duration?: number; aspect_ratio?: string; _error?: string }
  outputs: I2VOutput[]
  _optimistic?: boolean   // 로컬에서 즉시 추가한 임시 카드
}

interface I2VOutput {
  id: string
  attempt_id: string
  asset_id: string
  satisfaction_score: SatisfactionScore | null
  archived: boolean
  asset: { url: string; thumbnail_url: string | null }
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function Toast({ message, type }: { message: string; type: 'info' | 'success' | 'error' }) {
  const colors = {
    info:    { bg: 'rgba(99,102,241,0.15)',  border: 'rgba(99,102,241,0.4)',  color: '#a5b4fc' },
    success: { bg: 'rgba(16,185,129,0.15)',  border: 'rgba(16,185,129,0.4)', color: '#6ee7b7' },
    error:   { bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.4)',  color: '#fca5a5' },
  }[type]
  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-medium shadow-xl"
      style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.color, backdropFilter: 'blur(12px)' }}>
      {type === 'info'    && <Loader2 size={14} className="animate-spin" />}
      {type === 'success' && <CheckCircle2 size={14} />}
      {type === 'error'   && <XCircle size={14} />}
      {message}
    </div>
  )
}

// ─── Generating Card (즉시 표시용) ──────────────────────────────────────────

function GeneratingCard({ attempt, onCancel }: { attempt: I2VAttempt; onCancel?: (id: string) => void }) {
  const [cancelling, setCancelling] = useState(false)
  const sourceImg = attempt.metadata?.source_image_url
  const duration  = attempt.metadata?.duration ?? 5

  async function handleCancel() {
    if (attempt._optimistic || cancelling) return
    setCancelling(true)
    try {
      await fetch('/api/i2v/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: attempt.id }),
      })
      onCancel?.(attempt.id)
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
      {/* Header — T2I와 동일한 톤 */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <Loader2 size={14} className="animate-spin shrink-0" style={{ color: 'var(--warning)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>영상 생성 중</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{duration}초 · Kling</span>
        <div className="flex-1" />
        {!attempt._optimistic && onCancel && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
            style={{
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
            }}
          >
            {cancelling
              ? <Loader2 size={11} className="animate-spin" />
              : <Square size={11} />
            }
            {cancelling ? '취소 중...' : '중지'}
          </button>
        )}
        <Badge variant="warning">생성중</Badge>
      </div>

      {/* Body — T2I 패턴: 비디오 비율 스켈레톤 1개 + 프롬프트 라인 */}
      <div className="p-4 space-y-3">
        <div
          className="aspect-video rounded-lg animate-pulse relative overflow-hidden"
          style={{ background: 'var(--surface-3)' }}
        >
          {sourceImg && (
            <img
              src={sourceImg}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-30"
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={28} className="animate-spin" style={{ color: 'var(--warning)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>완성까지 1~3분 소요</span>
            </div>
          </div>
        </div>
        {attempt.prompt && (
          <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
            {attempt.prompt}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Video Card ───────────────────────────────────────────────────────────────

function VideoCard({ output, onScore, onFeedback, onArchive }: {
  output: I2VOutput
  onScore: (id: string, score: SatisfactionScore) => void
  onFeedback: (id: string, feedback: string) => void
  onArchive: (id: string) => void
}) {
  const videoUrl = output.asset?.url
  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
      <div className="aspect-video bg-zinc-900 relative">
        {videoUrl ? (
          <video src={videoUrl} controls className="w-full h-full object-contain" preload="metadata" />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={24} className="animate-spin text-zinc-600" />
          </div>
        )}
        {output.archived && (
          <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ background: 'rgba(16,185,129,0.2)', color: '#34d399' }}>
            <CheckCircle2 size={11} /> 아카이브
          </div>
        )}
      </div>
      <div className="p-3 space-y-2" style={{ background: 'var(--surface)' }}>
        <SatisfactionRating
          value={output.satisfaction_score}
          onChange={(score) => onScore(output.id, score)}
          feedback={(output as any).feedback ?? ''}
          onFeedbackCommit={(fb) => onFeedback(output.id, fb)}
          size="sm"
        />
        <button onClick={() => onArchive(output.id)}
          className="w-full py-2 rounded-lg text-sm font-medium transition-all"
          style={{
            background: output.archived ? 'rgba(16,185,129,0.15)' : 'var(--surface-3)',
            color: output.archived ? '#34d399' : 'var(--text-secondary)',
            border: `1px solid ${output.archived ? 'rgba(16,185,129,0.4)' : 'var(--border)'}`,
          }}>
          {output.archived ? '✓ 아카이브됨' : '아카이브'}
        </button>
      </div>
    </div>
  )
}

// ─── Attempt Row (완료/실패) ───────────────────────────────────────────────────

function AttemptRow({ attempt, onRetry, onScore, onFeedback, onArchive }: {
  attempt: I2VAttempt
  onRetry: (sceneId: string, prompt: string, sourceImageUrl: string) => void
  onScore: (id: string, score: SatisfactionScore) => void
  onFeedback: (id: string, feedback: string) => void
  onArchive: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const sourceImg = attempt.metadata?.source_image_url

  const statusEl = {
    pending:    <Badge variant="muted">대기</Badge>,
    generating: <Badge variant="warning">생성중</Badge>,
    done:       <Badge variant="success">완료</Badge>,
    failed:     <Badge variant="danger">실패</Badge>,
  }[attempt.status]

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
      <button onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 p-3 text-left transition-colors hover:bg-white/5"
        style={{ background: 'var(--surface)' }}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {sourceImg ? (
          <img src={sourceImg} className="w-8 h-8 rounded object-cover shrink-0"
            style={{ border: '1px solid var(--border)' }} alt="src" />
        ) : (
          <div className="w-8 h-8 rounded flex items-center justify-center shrink-0"
            style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}>
            <ImageOff size={12} style={{ color: 'var(--text-muted)' }} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{attempt.prompt}</p>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {attempt.engine} · {attempt.metadata?.duration ?? 5}s · {attempt.metadata?.aspect_ratio ?? '16:9'}
          </p>
        </div>
        {statusEl}
      </button>

      {expanded && (
        <div className="p-4 border-t space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--background)' }}>
          {attempt.status === 'failed' && (
            <div className="space-y-1.5 p-3 rounded-xl"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div className="flex items-center gap-2">
                <XCircle size={14} className="text-red-400 shrink-0" />
                <p className="text-xs font-medium text-red-400">생성 실패</p>
              </div>
              {attempt.metadata?._error && (
                <p className="text-[11px] leading-relaxed pl-5 break-all"
                  style={{ color: 'rgba(252,165,165,0.8)', fontFamily: 'monospace' }}>
                  {attempt.metadata._error}
                </p>
              )}
            </div>
          )}
          {attempt.outputs.map(out => (
            <VideoCard key={out.id} output={out} onScore={onScore} onFeedback={onFeedback} onArchive={onArchive} />
          ))}
          {(attempt.status === 'done' || attempt.status === 'failed') && sourceImg && (
            <button onClick={() => onRetry(attempt.scene_id, attempt.prompt, sourceImg)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all hover:bg-white/10"
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <RefreshCw size={12} /> 재시도
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function I2VPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [scenes, setScenes]                   = useState<Scene[]>([])
  const [attempts, setAttempts]               = useState<Record<string, I2VAttempt[]>>({})
  const [archivedImages, setArchivedImages]   = useState<Record<string, Asset[]>>({})
  const [selectedSource, setSelectedSource]   = useState<Record<string, string>>({})
  const [prompts, setPrompts]                 = useState<Record<string, string>>({})
  const [durations, setDurations]             = useState<Record<string, number>>({})
  const [aspectRatios, setAspectRatios]       = useState<Record<string, string>>({})
  const [expandedScene, setExpandedScene]     = useLocalState<string | null>(`expanded-i2v-${projectId}`, null)
  const [completedScenes, setCompletedScenes] = useState<Set<string>>(new Set())
  const [sceneCamera, setSceneCamera]         = useState<Record<string, {
    angle?: string; shotSize?: string; lens?: string; lighting?: string
  }>>({})
  const [referenceAssets, setReferenceAssets] = useState<Asset[]>([])
  const [sceneRefs, setSceneRefs]             = useState<Record<string, RefSelection>>({})

  function updateCamera(sceneId: string, type: 'angle' | 'shotSize' | 'lens' | 'lighting', key: string) {
    setSceneCamera(prev => ({ ...prev, [sceneId]: { ...prev[sceneId], [type]: key } }))
  }
  function clearCamera(sceneId: string, type: 'angle' | 'shotSize' | 'lens' | 'lighting') {
    setSceneCamera(prev => {
      const c = { ...prev[sceneId] }
      delete c[type]
      return { ...prev, [sceneId]: c }
    })
  }
  function updateSceneRefs(sceneId: string, next: RefSelection) {
    setSceneRefs(prev => ({ ...prev, [sceneId]: next }))
  }
  const [loading, setLoading]                 = useState(true)
  const [toast, setToast]                     = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null)
  const pollRef   = useRef<NodeJS.Timeout | null>(null)
  const toastRef  = useRef<NodeJS.Timeout | null>(null)
  const listRefs  = useRef<Record<string, HTMLDivElement | null>>({})
  const supabase  = createClient()

  const showToast = (message: string, type: 'info' | 'success' | 'error') => {
    if (toastRef.current) clearTimeout(toastRef.current)
    setToast({ message, type })
    toastRef.current = setTimeout(() => setToast(null), 3500)
  }

  const fetchData = useCallback(async () => {
    const { data: scenesData } = await supabase
      .from('scenes').select('*').eq('project_id', projectId).order('order_index')
    setScenes(scenesData ?? [])

    const sceneIds = (scenesData ?? []).map((s: any) => s.id)
    if (sceneIds.length === 0) { setLoading(false); return }

    const { data: attemptsData } = await supabase
      .from('prompt_attempts')
      .select(`
        id, scene_id, prompt, engine, status, created_at,
        outputs:attempt_outputs(
          id, attempt_id, asset_id, satisfaction_score, archived,
          asset:assets(url, thumbnail_url)
        )
      `)
      .in('scene_id', sceneIds)
      .eq('type', 'i2v')
      .order('created_at')

    const { data: t2iAssets } = await supabase
      .from('assets').select('*').eq('project_id', projectId).eq('type', 't2i').eq('archived', true)

    // 레퍼런스 assets (캐릭터/공간/오브제 포함)
    const { data: refAssets } = await supabase
      .from('assets').select('*').eq('project_id', projectId).eq('type', 'reference')
      .order('created_at', { ascending: false })
    setReferenceAssets(refAssets ?? [])

    const grouped: Record<string, I2VAttempt[]>  = {}
    const imgGrouped: Record<string, Asset[]>    = {}
    for (const scene of (scenesData ?? [])) { grouped[scene.id] = []; imgGrouped[scene.id] = [] }
    for (const a of (attemptsData ?? [])) {
      if (!grouped[a.scene_id]) grouped[a.scene_id] = []
      grouped[a.scene_id].push(a as unknown as I2VAttempt)
    }
    for (const asset of (t2iAssets ?? [])) {
      if (asset.scene_id && imgGrouped[asset.scene_id]) imgGrouped[asset.scene_id].push(asset)
    }

    // 옵티미스틱 카드 제거 (실제 DB 데이터로 교체)
    setAttempts(prev => {
      const merged: Record<string, I2VAttempt[]> = {}
      for (const sid of Object.keys(grouped)) {
        const realOnes = grouped[sid]
        const optimistic = (prev[sid] ?? []).filter(a => a._optimistic && !realOnes.find(r => r.id === a.id))
        merged[sid] = [...optimistic, ...realOnes]
      }
      return merged
    })
    setArchivedImages(imgGrouped)
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    fetchData()
    const attemptChannel = supabase
      .channel(`i2v-attempts-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prompt_attempts' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attempt_outputs' }, () => fetchData())
      .subscribe()
    const assetChannel = supabase
      .channel(`i2v-assets-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets', filter: `project_id=eq.${projectId}` }, () => fetchData())
      .subscribe()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      supabase.removeChannel(attemptChannel)
      supabase.removeChannel(assetChannel)
    }
  }, [projectId])

  // 생성 중인 attempt가 있으면 5초마다 자동 새로고침
  useEffect(() => {
    const hasGenerating = Object.values(attempts).flat().some(a => a.status === 'generating')
    if (hasGenerating) {
      if (!pollRef.current) pollRef.current = setInterval(fetchData, 5000)
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [attempts])

  async function handleGenerate(sceneId: string) {
    const sourceImageUrl = selectedSource[sceneId]
    const basePrompt     = prompts[sceneId]?.trim() ?? ''
    const cameraPrompt   = buildCameraPrompt(sceneCamera[sceneId] ?? {})
    const prompt         = [basePrompt, cameraPrompt].filter(Boolean).join(', ')
    const duration       = durations[sceneId] ?? 5
    const aspectRatio    = aspectRatios[sceneId] ?? '16:9'

    if (!sourceImageUrl) { showToast('소스 이미지를 먼저 선택해주세요', 'error'); return }
    if (!basePrompt)     { showToast('프롬프트를 입력해주세요', 'error'); return }

    // ① 옵티미스틱 카드 즉시 삽입 → 사용자가 바로 피드백 확인
    const optimisticId = `opt_${Date.now()}`
    const optimisticAttempt: I2VAttempt = {
      id:           optimisticId,
      scene_id:     sceneId,
      prompt,
      engine:       'kling',
      status:       'generating',
      created_at:   new Date().toISOString(),
      metadata:     { source_image_url: sourceImageUrl, duration, aspect_ratio: aspectRatio },
      outputs:      [],
      _optimistic:  true,
    }
    setAttempts(prev => ({
      ...prev,
      [sceneId]: [...(prev[sceneId] ?? []), optimisticAttempt],
    }))

    // 씬 펼치기 + 결과 영역으로 스크롤
    setExpandedScene(sceneId)
    showToast('영상 생성 요청됨 · 1~3분 소요', 'info')
    setTimeout(() => {
      listRefs.current[sceneId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 150)

    // ② DB에 실제 시도 등록 (metadata 컬럼 없음 → 제외)
    const { data: attempt, error } = await supabase.from('prompt_attempts').insert({
      scene_id:        sceneId,
      parent_id:       null,
      type:            'i2v',
      prompt,
      negative_prompt: '',
      engine:          'kling',
      status:          'generating',
      depth:           0,
    }).select().single()

    if (error || !attempt) {
      // _optimistic: true 유지 → fetchData 병합에서 사라지지 않음
      const errMsg = (error as any)?.message ?? 'DB 등록 실패'
      setAttempts(prev => ({
        ...prev,
        [sceneId]: (prev[sceneId] ?? []).map(a =>
          a.id === optimisticId
            ? { ...a, status: 'failed' as const, _optimistic: true, metadata: { ...a.metadata, _error: errMsg } }
            : a
        ),
      }))
      return
    }

    // 옵티미스틱 카드를 실제 ID로 교체
    const realAttemptId = attempt.id
    setAttempts(prev => ({
      ...prev,
      [sceneId]: (prev[sceneId] ?? []).map(a =>
        a.id === optimisticId ? { ...(attempt as unknown as I2VAttempt), outputs: [], _optimistic: false } : a
      ),
    }))

    // ③ API 호출 (fire-and-forget)
    fetch('/api/i2v/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ attemptId: realAttemptId, prompt, sourceImageUrl, projectId, sceneId, duration, aspectRatio }),
    }).then(async res => {
      const data = await res.json()
      const sceneName = scenes.find(s => s.id === sceneId)?.title
      const notifEnabled = getNotificationsEnabled(projectId)
      const slackUrl = getSlackWebhookUrl(projectId)
      if (data.success) {
        showToast('영상 생성 완료!', 'success')
        pushToast({ type: 'success', genType: 'i2v', title: `영상 생성 완료${sceneName ? ` — ${sceneName}` : ''}`, message: '결과를 확인해보세요.' })
        if (notifEnabled || slackUrl) {
          sendGenerationNotification({ type: 'i2v', sceneName, status: 'done', slackWebhookUrl: slackUrl || undefined })
        }
        fetchData()
      } else {
        // 카드를 즉시 실패 상태로 전환 + 에러 메시지 표시
        const errMsg = data.error ?? '알 수 없는 오류'
        pushToast({ type: 'error', genType: 'i2v', title: `영상 생성 실패${sceneName ? ` — ${sceneName}` : ''}`, message: errMsg })
        if (notifEnabled || slackUrl) {
          sendGenerationNotification({ type: 'i2v', sceneName, status: 'failed', message: errMsg, slackWebhookUrl: slackUrl || undefined })
        }
        setAttempts(prev => ({
          ...prev,
          [sceneId]: (prev[sceneId] ?? []).map(a =>
            a.id === realAttemptId
              ? { ...a, status: 'failed' as const, metadata: { ...a.metadata, _error: errMsg } }
              : a
          ),
        }))
      }
    }).catch(err => {
      const errMsg = String(err)
      setAttempts(prev => ({
        ...prev,
        [sceneId]: (prev[sceneId] ?? []).map(a =>
          a.id === realAttemptId
            ? { ...a, status: 'failed' as const, metadata: { ...a.metadata, _error: `네트워크 오류: ${errMsg}` } }
            : a
        ),
      }))
    })
  }

  async function handleRetry(sceneId: string, prompt: string, sourceImageUrl: string) {
    const duration    = durations[sceneId]    ?? 5
    const aspectRatio = aspectRatios[sceneId] ?? '16:9'

    const optimisticId = `opt_${Date.now()}`
    setAttempts(prev => ({
      ...prev,
      [sceneId]: [...(prev[sceneId] ?? []), {
        id: optimisticId, scene_id: sceneId, prompt, engine: 'kling',
        status: 'generating', created_at: new Date().toISOString(),
        metadata: { source_image_url: sourceImageUrl, duration, aspect_ratio: aspectRatio },
        outputs: [], _optimistic: true,
      }],
    }))
    showToast('재시도 요청됨', 'info')

    const { data: attempt } = await supabase.from('prompt_attempts').insert({
      scene_id: sceneId, parent_id: null, type: 'i2v', prompt,
      negative_prompt: '', engine: 'kling', status: 'generating', depth: 0,
    }).select().single()

    if (!attempt) return
    const retryAttemptId = attempt.id
    setAttempts(prev => ({
      ...prev,
      [sceneId]: (prev[sceneId] ?? []).map(a =>
        a.id === optimisticId ? { ...(attempt as unknown as I2VAttempt), outputs: [], _optimistic: false } : a
      ),
    }))

    fetch('/api/i2v/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attemptId: retryAttemptId, prompt, sourceImageUrl, projectId, sceneId, duration, aspectRatio }),
    }).then(async res => {
      const data = await res.json()
      if (data.success) {
        showToast('영상 생성 완료!', 'success')
        fetchData()
      } else {
        const errMsg = data.error ?? '알 수 없는 오류'
        setAttempts(prev => ({
          ...prev,
          [sceneId]: (prev[sceneId] ?? []).map(a =>
            a.id === retryAttemptId
              ? { ...a, status: 'failed' as const, metadata: { ...a.metadata, _error: errMsg } }
              : a
          ),
        }))
      }
    }).catch(err => {
      setAttempts(prev => ({
        ...prev,
        [sceneId]: (prev[sceneId] ?? []).map(a =>
          a.id === retryAttemptId
            ? { ...a, status: 'failed' as const, metadata: { ...a.metadata, _error: String(err) } }
            : a
        ),
      }))
    })
  }

  async function handleScore(outputId: string, score: SatisfactionScore) {
    await supabase.from('attempt_outputs').update({ satisfaction_score: score }).eq('id', outputId)
    if (score >= 4) await supabase.from('attempt_outputs').update({ archived: true }).eq('id', outputId)
    fetchData()
  }

  async function handleFeedback(outputId: string, feedback: string) {
    await supabase.from('attempt_outputs').update({ feedback }).eq('id', outputId)
    setAttempts(prev => {
      const next: Record<string, I2VAttempt[]> = {}
      for (const [sceneId, list] of Object.entries(prev)) {
        next[sceneId] = list.map(a => ({
          ...a,
          outputs: (a.outputs ?? []).map(o => o.id === outputId ? { ...o, feedback } : o),
        }))
      }
      return next
    })
  }

  async function handleArchive(outputId: string) {
    const { data } = await supabase.from('attempt_outputs').select('archived').eq('id', outputId).single()
    if (!data) return
    await supabase.from('attempt_outputs').update({ archived: !data.archived }).eq('id', outputId)
    fetchData()
  }

  function handleToggleComplete(sceneId: string) {
    setCompletedScenes(prev => {
      const next = new Set(prev)
      if (next.has(sceneId)) {
        next.delete(sceneId)
      } else {
        next.add(sceneId)
        if (expandedScene === sceneId) setExpandedScene(null)
      }
      return next
    })
  }

  // SceneTreeView의 renderScene
  function renderSceneContent(scene: Scene) {
    const sceneAttempts = attempts[scene.id] ?? []
    const sourceImages  = archivedImages[scene.id] ?? []

    return (
      <div className="border-t" style={{ borderColor: 'var(--border)', background: 'var(--background)' }}>
        {/* ── 생성 기록 (상단 배치) ── */}
        {sceneAttempts.length > 0 && (
          <div className="p-4 space-y-3 border-b" style={{ borderColor: 'var(--border)' }}
            ref={el => { listRefs.current[scene.id] = el }}>
            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              생성 기록 <span style={{ color: 'var(--text-muted)' }}>({sceneAttempts.length}건)</span>
            </p>
            {[...sceneAttempts].reverse().map(attempt =>
              attempt.status === 'generating'
                ? <GeneratingCard
                    key={attempt.id}
                    attempt={attempt}
                    onCancel={(id) => {
                      setAttempts(prev => ({
                        ...prev,
                        [scene.id]: (prev[scene.id] ?? []).map(a =>
                          a.id === id
                            ? { ...a, status: 'failed' as const, metadata: { ...a.metadata, _error: '사용자가 취소했습니다' } }
                            : a
                        ),
                      }))
                      showToast('영상 생성이 취소되었습니다', 'info')
                    }}
                  />
                : <AttemptRow key={attempt.id} attempt={attempt}
                    onRetry={handleRetry} onScore={handleScore} onFeedback={handleFeedback} onArchive={handleArchive} />
            )}
          </div>
        )}

        {/* ── 새 생성 폼 ── */}
        <div className="p-4 space-y-4">
          {/* 소스 이미지 선택 */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              1. 소스 이미지 선택 <span style={{ color: 'var(--text-muted)' }}>(T2I 아카이브 또는 레퍼런스 라이브러리)</span>
            </p>
            {(sourceImages.length > 0 || referenceAssets.length > 0) ? (
              <div className="space-y-3">
                {sourceImages.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>T2I 아카이브</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {sourceImages.map(img => (
                        <button key={img.id}
                          onClick={() => setSelectedSource(prev => ({ ...prev, [scene.id]: img.url }))}
                          className="shrink-0 relative w-20 h-20 rounded-xl overflow-hidden transition-all"
                          style={{
                            border: `2px solid ${selectedSource[scene.id] === img.url ? '#818cf8' : 'transparent'}`,
                            boxShadow: selectedSource[scene.id] === img.url ? '0 0 0 3px rgba(99,102,241,0.25)' : 'none',
                          }}>
                          <img src={img.thumbnail_url ?? img.url} className="w-full h-full object-cover" alt="" />
                          {selectedSource[scene.id] === img.url && (
                            <div className="absolute inset-0 flex items-center justify-center"
                              style={{ background: 'rgba(99,102,241,0.3)' }}>
                              <CheckCircle2 size={18} className="text-white" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {referenceAssets.length > 0 && (() => {
                  const groups: { key: string; label: string; color: string; items: Asset[] }[] = [
                    { key: 'character', label: '캐릭터', color: '#818cf8', items: referenceAssets.filter(a => a.tags?.includes('character')) },
                    { key: 'space',     label: '공간',   color: '#34d399', items: referenceAssets.filter(a => a.tags?.includes('space')) },
                    { key: 'object',    label: '오브제', color: '#fb923c', items: referenceAssets.filter(a => a.tags?.includes('object')) },
                    { key: 'misc',      label: '기타',   color: '#a78bfa', items: referenceAssets.filter(a => a.tags?.includes('misc') || (!a.tags?.includes('character') && !a.tags?.includes('space') && !a.tags?.includes('object'))) },
                  ].filter(g => g.items.length > 0)
                  return (
                    <div className="space-y-2">
                      {groups.map(g => (
                        <div key={g.key}>
                          <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: g.color }}>레퍼런스 · {g.label}</p>
                          <div className="flex gap-2 overflow-x-auto pb-1">
                            {g.items.map(img => (
                              <button key={img.id}
                                onClick={() => setSelectedSource(prev => ({ ...prev, [scene.id]: img.url }))}
                                className="shrink-0 relative w-20 h-20 rounded-xl overflow-hidden transition-all"
                                style={{
                                  border: `2px solid ${selectedSource[scene.id] === img.url ? g.color : 'transparent'}`,
                                  boxShadow: selectedSource[scene.id] === img.url ? `0 0 0 3px ${g.color}40` : 'none',
                                }}>
                                <img src={img.thumbnail_url ?? img.url} className="w-full h-full object-cover" alt="" />
                                {selectedSource[scene.id] === img.url && (
                                  <div className="absolute inset-0 flex items-center justify-center"
                                    style={{ background: `${g.color}4D` }}>
                                    <CheckCircle2 size={18} className="text-white" />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-lg"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}>
                <Film size={14} style={{ color: 'var(--text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  T2I 아카이브 이미지나 에셋 라이브러리의 레퍼런스를 사용할 수 있습니다
                </p>
              </div>
            )}
          </div>

          {/* 프롬프트 */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>2. 프롬프트</p>
            <textarea
              value={prompts[scene.id] ?? ''}
              onChange={e => setPrompts(prev => ({ ...prev, [scene.id]: e.target.value }))}
              rows={3}
              placeholder="카메라 움직임, 동작 묘사 등을 입력하세요 (영문 권장)..."
              className="w-full px-3 py-2.5 rounded-lg text-sm resize-none"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          {/* 카메라 레퍼런스 */}
          <CameraReferencePanel
            selectedAngle={sceneCamera[scene.id]?.angle}
            selectedShotSize={sceneCamera[scene.id]?.shotSize}
            selectedLens={sceneCamera[scene.id]?.lens}
            selectedLighting={sceneCamera[scene.id]?.lighting}
            onSelect={(type, key) => updateCamera(scene.id, type, key)}
            onDeselect={(type) => clearCamera(scene.id, type)}
          />

          {/* 옵션 + 버튼 */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>길이</span>
              {[5, 10].map(d => (
                <button key={d}
                  onClick={() => setDurations(prev => ({ ...prev, [scene.id]: d }))}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: (durations[scene.id] ?? 5) === d ? 'var(--accent)' : 'var(--surface-3)',
                    color: (durations[scene.id] ?? 5) === d ? 'white' : 'var(--text-secondary)',
                    border: `1px solid ${(durations[scene.id] ?? 5) === d ? 'transparent' : 'var(--border)'}`,
                  }}>
                  {d}s
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>비율</span>
              {['16:9', '9:16', '1:1'].map(r => (
                <button key={r}
                  onClick={() => setAspectRatios(prev => ({ ...prev, [scene.id]: r }))}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: (aspectRatios[scene.id] ?? '16:9') === r ? 'rgba(99,102,241,0.2)' : 'var(--surface-3)',
                    color: (aspectRatios[scene.id] ?? '16:9') === r ? '#818cf8' : 'var(--text-secondary)',
                    border: `1px solid ${(aspectRatios[scene.id] ?? '16:9') === r ? 'rgba(99,102,241,0.5)' : 'var(--border)'}`,
                  }}>
                  {r}
                </button>
              ))}
            </div>

            <div className="flex-1" />

            <button
              onClick={() => handleGenerate(scene.id)}
              disabled={!selectedSource[scene.id] || !(prompts[scene.id]?.trim())}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Sparkles size={14} />
              영상 생성
            </button>
          </div>

          {!selectedSource[scene.id] && sourceImages.length > 0 && (
            <p className="text-xs" style={{ color: '#f59e0b' }}>↑ 소스 이미지를 먼저 선택해주세요</p>
          )}
        </div>
      </div>
    )
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 size={24} className="animate-spin text-zinc-600" />
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>I2V — 영상 생성</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>아카이빙된 이미지를 Kling으로 영상 변환</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchData} className="p-2 rounded-lg transition-colors hover:bg-white/10" style={{ color: 'var(--text-muted)' }}>
            <RefreshCw size={15} />
          </button>
          <Link href={`/project/${projectId}/lipsync`}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>
            립싱크 <ChevronRight size={15} />
          </Link>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <SceneTreeView
            scenes={scenes}
            completedScenes={completedScenes}
            onToggleComplete={handleToggleComplete}
            renderScene={renderSceneContent}
            expandedSceneId={expandedScene}
            onExpandScene={setExpandedScene}
            storageKey={`i2v:${projectId}`}
          />
        </div>
      </div>
    </div>
  )
}
