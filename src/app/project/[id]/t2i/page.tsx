'use client'

import { useState, useEffect } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import {
  Loader2, ChevronRight, ChevronDown, Wand2,
  Plus, Edit3, BookImage,
} from 'lucide-react'
import type { Scene, PromptAttempt, SatisfactionScore } from '@/types'
import Link from 'next/link'
import Badge from '@/components/ui/Badge'
import SatisfactionRating from '@/components/ui/SatisfactionRating'
import SceneTreeView from '@/components/scene/SceneTreeView'
import CameraReferencePanel, { buildCameraPrompt } from '@/components/ui/CameraReferencePanel'
import SceneReferencePicker, {
  emptyRefSelection, allSelectedUrls, RefSelection,
} from '@/components/ui/SceneReferencePicker'
import { pushToast } from '@/components/ui/GenerationToast'
import { sendGenerationNotification, getNotificationsEnabled, getSlackWebhookUrl } from '@/lib/notifications'
import { cn } from '@/lib/utils'

// ── AttemptNode (이미지 시도 하나) ────────────────────────────────
interface AttemptNodeProps {
  attempt: PromptAttempt
  onRetry: (parentId: string, prompt: string, refUrls?: string[]) => void
  onScore: (outputId: string, score: SatisfactionScore) => void
  onArchive: (outputId: string) => void
  onSendToReference: (outputId: string) => void
  referenceAssets: RefImage[]
  depth?: number
}

function AttemptNode({
  attempt, onRetry, onScore, onArchive, onSendToReference, referenceAssets, depth = 0,
}: AttemptNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const [showRetry, setShowRetry] = useState(false)
  const [retryPrompt, setRetryPrompt] = useState(attempt.prompt)
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set())

  function toggleRef(id: string) {
    setSelectedRefs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleRetry() {
    const refUrls = referenceAssets.filter(r => selectedRefs.has(r.id)).map(r => r.url)
    onRetry(attempt.id, retryPrompt, refUrls.length > 0 ? refUrls : undefined)
    setShowRetry(false); setSelectedRefs(new Set()); setExpanded(false)
  }

  const statusBadge = {
    pending:    <Badge variant="muted">대기</Badge>,
    generating: <Badge variant="warning">생성중</Badge>,
    done:       <Badge variant="success">완료</Badge>,
    failed:     <Badge variant="danger">실패</Badge>,
  }[attempt.status]

  return (
    <div className={depth > 0 ? 'attempt-tree-line' : ''}>
      <div className="rounded-xl border mb-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-3 p-3">
          <button onClick={() => setExpanded(!expanded)} className="text-zinc-500">
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {depth > 0 ? `↳ 재시도 #${depth}` : '루트 시도'}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{attempt.engine}</span>
          {statusBadge}
          <div className="flex-1" />
          <button
            onClick={() => { setRetryPrompt(attempt.prompt); setShowRetry(!showRetry) }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] transition-all hover:bg-white/10"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            <Plus size={11} /> 재시도
          </button>
        </div>

        {expanded && (
          <div className="px-3 pb-3 space-y-3">
            <p className="text-[11px] leading-relaxed p-2.5 rounded-lg"
              style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>
              {attempt.prompt}
            </p>

            {attempt.outputs && attempt.outputs.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {attempt.outputs.map(output => (
                  <div key={output.id} className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                    <div className="aspect-video bg-zinc-900 relative">
                      {output.url
                        ? <img src={output.url} alt="" className="w-full h-full object-cover" />
                        : <div className="flex items-center justify-center h-full">
                            <Loader2 size={18} className="text-zinc-600 animate-spin" />
                          </div>
                      }
                      {output.archived && <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400" />}
                    </div>
                    <div className="p-2 space-y-1.5">
                      <SatisfactionRating value={output.satisfaction_score}
                        onChange={score => onScore(output.id, score)} size="sm" />
                      <button onClick={() => onArchive(output.id)}
                        className={cn('w-full text-[11px] py-0.5 rounded transition-all',
                          output.archived ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600')}>
                        {output.archived ? '✓ 아카이브됨' : '아카이브'}
                      </button>
                      {output.url && (
                        <button onClick={() => onSendToReference(output.id)}
                          className="w-full flex items-center justify-center gap-1 text-[11px] py-0.5 rounded transition-all bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25">
                          <BookImage size={10} /> 레퍼런스로
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {attempt.status === 'generating' && (
              <div className="grid grid-cols-2 gap-2">
                {[1, 2, 3].map(n => <div key={n} className="aspect-video rounded-lg bg-zinc-800 animate-pulse" />)}
              </div>
            )}

            {showRetry && (
              <div className="space-y-2 p-3 rounded-lg" style={{ background: 'var(--surface-3)' }}>
                <textarea value={retryPrompt} onChange={e => setRetryPrompt(e.target.value)} rows={3}
                  className="w-full px-2.5 py-2 rounded-lg text-xs resize-none"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                <ReferenceImagePicker available={referenceAssets} selected={selectedRefs} onToggle={toggleRef} />
                <div className="flex gap-2">
                  <button onClick={handleRetry} className="px-4 py-2 rounded-lg text-xs font-medium text-white"
                    style={{ background: 'var(--accent)' }}>재시도 실행</button>
                  <button onClick={() => setShowRetry(false)} className="px-4 py-2 rounded-lg text-xs"
                    style={{ color: 'var(--text-secondary)' }}>취소</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {attempt.children?.map(child => (
        <AttemptNode key={child.id} attempt={child} onRetry={onRetry} onScore={onScore}
          onArchive={onArchive} onSendToReference={onSendToReference}
          referenceAssets={referenceAssets} depth={depth + 1} />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────

export default function T2IPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [scenes, setScenes]               = useState<Scene[]>([])
  const [attempts, setAttempts]           = useState<Record<string, PromptAttempt[]>>({})
  const [referenceAssets, setReferenceAssets] = useState<import('@/types').Asset[]>([])
  const [loading, setLoading]             = useState(true)
  const [expandedScene, setExpandedScene] = useLocalState<string | null>(`expanded-t2i-${projectId}`, null)
  const [genError, setGenError]           = useState<string | null>(null)
  const [completedScenes, setCompletedScenes] = useState<Set<string>>(new Set())

  // 씬별 프롬프트 편집 상태 (마스터 프롬프트 초기값 → 사용자 편집 가능)
  const [editingPrompt, setEditingPrompt] = useState<Record<string, string>>({})
  // 씬별 "새 시도" 폼 표시 여부
  const [showNewForm, setShowNewForm]     = useState<Record<string, boolean>>({})
  // 씬별 선택된 레퍼런스 이미지 (카테고리별 RefSelection)
  const [sceneRefs, setSceneRefs]         = useState<Record<string, RefSelection>>({})
  // 씬별 카메라 레퍼런스 선택
  const [sceneCamera, setSceneCamera]     = useState<Record<string, {
    angle?: string; shotSize?: string; lens?: string; lighting?: string
  }>>({})

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

  const supabase = createClient()

  useEffect(() => { fetchData() }, [projectId])

  async function fetchData() {
    const { data: scenesData } = await supabase
      .from('scenes')
      .select('*, master_prompt:master_prompts(content, negative_prompt, version), settings:scene_settings(engine, aspect_ratio)')
      .eq('project_id', projectId)
      .order('order_index')
    setScenes(scenesData ?? [])

    // 편집 기본값 세팅 (이미 사용자가 편집 중이면 유지)
    setEditingPrompt(prev => {
      const next = { ...prev }
      for (const scene of (scenesData ?? [])) {
        if (next[scene.id] !== undefined) continue   // 이미 편집 중 → 유지
        const mp    = (scene as any).master_prompt
        const mpObj = Array.isArray(mp) ? mp.sort((a: any, b: any) => b.version - a.version)[0] : mp
        next[scene.id] = mpObj?.content ?? ''
      }
      return next
    })

    // 레퍼런스 (전체 필드 — 카테고리 tags 포함)
    const { data: refData } = await supabase
      .from('assets').select('*')
      .eq('project_id', projectId).eq('type', 'reference')
      .order('created_at', { ascending: false })
    setReferenceAssets(refData ?? [])

    // 시도 트리
    const sceneIds = (scenesData ?? []).map((s: any) => s.id)
    if (sceneIds.length > 0) {
      const { data: attemptsData } = await supabase
        .from('prompt_attempts')
        .select('*, outputs:attempt_outputs(*, asset:assets(url, thumbnail_url, satisfaction_score, archived))')
        .in('scene_id', sceneIds).eq('type', 't2i').order('created_at')

      const grouped: Record<string, PromptAttempt[]> = {}
      for (const scene of (scenesData ?? [])) grouped[scene.id] = []
      for (const attempt of (attemptsData ?? [])) {
        if (!grouped[attempt.scene_id]) grouped[attempt.scene_id] = []
        grouped[attempt.scene_id].push({
          ...attempt,
          outputs: (attempt.outputs ?? []).map((o: any) => ({
            ...o,
            url:                o.url ?? o.asset?.url ?? null,
            thumbnail_url:      o.thumbnail_url ?? o.asset?.thumbnail_url ?? null,
            satisfaction_score: o.satisfaction_score ?? o.asset?.satisfaction_score ?? null,
            archived:           o.archived ?? o.asset?.archived ?? false,
          })),
        })
      }
      setAttempts(grouped)
    }
    setLoading(false)
  }

  async function generate(sceneId: string, prompt: string, parentId?: string, referenceImageUrls?: string[]) {
    const scene       = scenes.find(s => s.id === sceneId)
    const settings    = (scene as any)?.settings
    const engine      = settings?.engine ?? 'nanobanana'
    const aspectRatio = settings?.aspect_ratio ?? '16:9'
    const mp          = (scene as any)?.master_prompt
    const mpObj       = Array.isArray(mp) ? mp.sort((a: any, b: any) => b.version - a.version)[0] : mp
    const negativePrompt = mpObj?.negative_prompt ?? ''
    const depth = parentId
      ? ((attempts[sceneId] ?? []).find(a => a.id === parentId)?.depth ?? 0) + 1 : 0

    const { data: attempt } = await supabase.from('prompt_attempts').insert({
      scene_id: sceneId, parent_id: parentId ?? null,
      type: 't2i', prompt, negative_prompt: negativePrompt,
      engine, status: 'generating', depth,
    }).select().single()

    if (attempt) {
      fetchData()
      fetch('/api/t2i/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId: attempt.id, prompt, negativePrompt, engine,
          projectId, sceneId, aspectRatio,
          referenceImageUrls: referenceImageUrls ?? [],
        }),
      }).then(async res => {
        const sceneName = scenes.find(s => s.id === sceneId)?.title
        const notifEnabled = getNotificationsEnabled(projectId)
        const slackUrl = getSlackWebhookUrl(projectId)
        if (!res.ok) {
          const d = await res.json()
          setGenError(d.error ?? '알 수 없는 오류')
          pushToast({ type: 'error', genType: 't2i', title: `이미지 생성 실패${sceneName ? ` — ${sceneName}` : ''}`, message: d.error })
          if (notifEnabled || slackUrl) {
            sendGenerationNotification({ type: 't2i', sceneName, status: 'failed', message: d.error, slackWebhookUrl: slackUrl || undefined })
          }
        } else {
          pushToast({ type: 'success', genType: 't2i', title: `이미지 생성 완료${sceneName ? ` — ${sceneName}` : ''}`, message: '결과를 확인해보세요.' })
          if (notifEnabled || slackUrl) {
            sendGenerationNotification({ type: 't2i', sceneName, status: 'done', slackWebhookUrl: slackUrl || undefined })
          }
        }
        fetchData()
      })
    }
  }

  async function scoreOutput(outputId: string, score: SatisfactionScore) {
    await supabase.from('attempt_outputs').update({ satisfaction_score: score }).eq('id', outputId)
    if (score >= 4) {
      await supabase.from('attempt_outputs').update({ archived: true }).eq('id', outputId)
      const { data: out } = await supabase.from('attempt_outputs').select('asset_id').eq('id', outputId).single()
      if (out?.asset_id) {
        await supabase.from('assets').update({ satisfaction_score: score, archived: true }).eq('id', out.asset_id)
      }
    }
    fetchData()
  }

  async function archiveOutput(outputId: string) {
    const { data } = await supabase.from('attempt_outputs').select('archived, asset_id').eq('id', outputId).single()
    if (!data) return
    await supabase.from('attempt_outputs').update({ archived: !data.archived }).eq('id', outputId)
    await supabase.from('assets').update({ archived: !data.archived }).eq('id', data.asset_id)
    fetchData()
  }

  async function sendToReference(outputId: string) {
    const { data: output } = await supabase.from('attempt_outputs').select('asset_id').eq('id', outputId).single()
    if (!output) return
    const { data: asset } = await supabase.from('assets').select('url, name, scene_id').eq('id', output.asset_id).single()
    if (!asset) return
    await supabase.from('assets').insert({
      project_id: projectId, scene_id: asset.scene_id ?? null,
      type: 'reference', name: `ref_${asset.name}`, url: asset.url,
      tags: ['t2i-reference'], metadata: { source: 't2i', original_asset_id: output.asset_id },
    })
    const { data: refData } = await supabase.from('assets').select('*')
      .eq('project_id', projectId).eq('type', 'reference').order('created_at', { ascending: false })
    setReferenceAssets(refData ?? [])
  }

  function updateSceneRefs(sceneId: string, next: RefSelection) {
    setSceneRefs(prev => ({ ...prev, [sceneId]: next }))
  }

  function getMasterPromptContent(scene: Scene): string {
    const mp    = (scene as any).master_prompt
    const mpObj = Array.isArray(mp) ? mp.sort((a: any, b: any) => b.version - a.version)[0] : mp
    return mpObj?.content ?? ''
  }

  function handleToggleComplete(sceneId: string) {
    setCompletedScenes(prev => {
      const next = new Set(prev)
      if (next.has(sceneId)) {
        next.delete(sceneId)
      } else {
        next.add(sceneId)
        // 완료 시 자동 접기
        if (expandedScene === sceneId) setExpandedScene(null)
      }
      return next
    })
  }

  // SceneTreeView의 renderScene: 씬 펼쳤을 때 보여줄 콘텐츠
  function renderSceneContent(scene: Scene) {
    const sceneAttempts = attempts[scene.id] ?? []
    const mpContent     = getMasterPromptContent(scene)
    const editPrompt    = editingPrompt[scene.id] ?? mpContent
    const isShowingNew  = !!(showNewForm[scene.id])
    const refSel        = sceneRefs[scene.id] ?? emptyRefSelection()

    return (
      <div className="border-t" style={{ borderColor: 'var(--border)', background: 'var(--background)' }}>
        {/* ── 마스터 프롬프트 패널 ── */}
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Wand2 size={12} style={{ color: '#818cf8' }} />
            <span className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}>마스터 프롬프트</span>
            {mpContent && editPrompt !== mpContent && (
              <button
                onClick={() => setEditingPrompt(prev => ({ ...prev, [scene.id]: mpContent }))}
                className="text-[10px] px-2 py-0.5 rounded ml-auto hover:bg-white/5"
                style={{ color: '#818cf8' }}>
                원본으로 초기화
              </button>
            )}
          </div>

          {mpContent ? (
            <textarea
              value={editPrompt}
              onChange={e => setEditingPrompt(prev => ({ ...prev, [scene.id]: e.target.value }))}
              rows={3}
              placeholder="마스터 프롬프트를 수정하거나 그대로 사용하세요..."
              className="w-full px-3 py-2 rounded-lg text-xs resize-none"
              style={{
                background: 'var(--surface-3)',
                border:     `1px solid ${editPrompt !== mpContent ? 'rgba(99,102,241,0.5)' : 'var(--border)'}`,
                color:      'var(--text-primary)',
              }}
            />
          ) : (
            <div className="p-3 rounded-lg text-xs"
              style={{ background: 'var(--surface-3)', border: '1px dashed var(--border)', color: 'var(--text-muted)' }}>
              씬 분류 페이지에서 마스터 프롬프트를 먼저 생성하세요
            </div>
          )}

          {/* 카메라 레퍼런스 */}
          <div className="mt-3">
            <CameraReferencePanel
              selectedAngle={sceneCamera[scene.id]?.angle}
              selectedShotSize={sceneCamera[scene.id]?.shotSize}
              selectedLens={sceneCamera[scene.id]?.lens}
              selectedLighting={sceneCamera[scene.id]?.lighting}
              onSelect={(type, key) => updateCamera(scene.id, type, key)}
              onDeselect={(type) => clearCamera(scene.id, type)}
            />
          </div>

          {/* 씬 레퍼런스 + 생성 버튼 */}
          <div className="flex items-center gap-3 mt-3">
            <SceneReferencePicker
              referenceAssets={referenceAssets}
              selection={refSel}
              onChange={next => updateSceneRefs(scene.id, next)}
            />
            <div className="flex-1" />
            <button
              onClick={() => {
                const refUrls = allSelectedUrls(refSel, referenceAssets)
                const cameraPrompt = buildCameraPrompt(sceneCamera[scene.id] ?? {})
                const finalPrompt = [editPrompt, cameraPrompt].filter(Boolean).join(', ')
                generate(scene.id, finalPrompt, undefined, refUrls.length > 0 ? refUrls : undefined)
                updateSceneRefs(scene.id, emptyRefSelection())
              }}
              disabled={!editPrompt.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-40 transition-all hover:opacity-90"
              style={{ background: 'var(--accent)' }}>
              <Plus size={14} /> 이미지 생성
            </button>
          </div>
        </div>

        {/* ── 생성 이력 ── */}
        <div className="p-4">
          {sceneAttempts.length === 0 ? (
            <p className="text-center text-xs py-8" style={{ color: 'var(--text-muted)' }}>
              아직 생성 이력이 없습니다. 위에서 첫 번째 이미지를 생성해보세요.
            </p>
          ) : (
            <>
              {sceneAttempts.filter(a => !a.parent_id).map(attempt => (
                <AttemptNode key={attempt.id} attempt={attempt}
                  onRetry={(parentId, p, refUrls) => generate(scene.id, p, parentId, refUrls)}
                  onScore={scoreOutput} onArchive={archiveOutput}
                  onSendToReference={sendToReference}
                  referenceAssets={referenceAssets} />
              ))}

              {/* 다른 프롬프트로 새 시도 */}
              {!isShowingNew ? (
                <button
                  onClick={() => setShowNewForm(prev => ({ ...prev, [scene.id]: true }))}
                  className="w-full flex items-center justify-center gap-2 py-2.5 mt-2 rounded-xl border-2 border-dashed text-xs transition-all hover:border-indigo-500/50 hover:text-indigo-400"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                  <Edit3 size={12} /> 다른 프롬프트로 새 시도
                </button>
              ) : (
                <div className="mt-2 p-3 rounded-xl border space-y-2.5"
                  style={{ background: 'var(--surface)', borderColor: 'rgba(99,102,241,0.4)' }}>
                  <label className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                    새 시도 — 프롬프트 수정
                  </label>
                  <textarea
                    value={editPrompt}
                    onChange={e => setEditingPrompt(prev => ({ ...prev, [scene.id]: e.target.value }))}
                    rows={3} className="w-full px-2.5 py-2 rounded-lg text-xs resize-none"
                    style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                  <SceneReferencePicker
                    referenceAssets={referenceAssets}
                    selection={refSel}
                    onChange={next => updateSceneRefs(scene.id, next)}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const refUrls = allSelectedUrls(refSel, referenceAssets)
                        const cameraPrompt = buildCameraPrompt(sceneCamera[scene.id] ?? {})
                        const finalPrompt = [editPrompt, cameraPrompt].filter(Boolean).join(', ')
                        generate(scene.id, finalPrompt, undefined, refUrls.length > 0 ? refUrls : undefined)
                        setShowNewForm(prev => ({ ...prev, [scene.id]: false }))
                        updateSceneRefs(scene.id, emptyRefSelection())
                      }}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                      style={{ background: 'var(--accent)' }}>
                      <Plus size={14} /> 생성 시작
                    </button>
                    <button
                      onClick={() => setShowNewForm(prev => ({ ...prev, [scene.id]: false }))}
                      className="px-3 py-1.5 rounded-lg text-xs"
                      style={{ color: 'var(--text-secondary)' }}>
                      취소
                    </button>
                  </div>
                </div>
              )}
            </>
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
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>T2I — 이미지 생성</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            씬별 이미지를 생성하고 만족도를 평가하세요
            {referenceAssets.length > 0 && (
              <span className="ml-2 text-indigo-400">· 레퍼런스 {referenceAssets.length}장 사용 가능</span>
            )}
          </p>
        </div>
        <Link href={`/project/${projectId}/t2v`}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white"
          style={{ background: 'var(--accent)' }}>
          T2V로 이동 <ChevronRight size={15} />
        </Link>
      </div>

      {/* 에러 */}
      {genError && (
        <div className="mx-6 mt-3 px-4 py-3 rounded-xl text-xs flex items-start gap-2 flex-shrink-0"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
          <span className="flex-1 font-mono break-all">{genError}</span>
          <button onClick={() => setGenError(null)} className="opacity-60 hover:opacity-100 shrink-0">✕</button>
        </div>
      )}

      {/* 씬 트리 */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <SceneTreeView
            scenes={scenes}
            completedScenes={completedScenes}
            onToggleComplete={handleToggleComplete}
            renderScene={renderSceneContent}
            expandedSceneId={expandedScene}
            onExpandScene={setExpandedScene}
          />
        </div>
      </div>
    </div>
  )
}
