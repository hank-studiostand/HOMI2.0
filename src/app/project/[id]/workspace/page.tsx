'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { sortScenesByNumber } from '@/lib/sceneSort'
import {
  ChevronLeft, Sparkles, Check, RotateCcw, Trash2, X,
  Image as ImageIcon, Film, MessageCircle, Send, Loader2, Plus,
} from 'lucide-react'
import type { Scene, SatisfactionScore, Asset } from '@/types'
import Pill, { type PillVariant } from '@/components/ui/Pill'
import CameraReferencePanel, { buildCameraPrompt } from '@/components/ui/CameraReferencePanel'
import SceneReferencePicker, {
  emptyRefSelection, allSelectedUrls, type RefSelection,
} from '@/components/ui/SceneReferencePicker'

interface PromptVersion {
  id: string
  version_label: string
  content: string
  is_current: boolean
  created_at: string
}

interface MasterPrompt {
  id: string
  content: string
  version: number
  created_at: string
}

interface OutputItem {
  id: string
  attempt_id: string
  url: string | null
  archived: boolean
  satisfaction_score: SatisfactionScore | null
  feedback: string
  type: 't2i' | 'i2v' | 'lipsync'
  engine: string
  created_at: string
}

interface CommentRow {
  id: string
  user_id: string
  content: string
  created_at: string
  output_id: string | null
}

const REASON_TAGS = [
  '색감', '카메라 각도', '구도', '분위기', '표정', '움직임', '공간감', '레퍼런스 불일치',
]

export default function WorkspacePage() {
  const { id: projectId } = useParams<{ id: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const supabase = createClient()

  const [scenes, setScenes] = useState<Scene[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [masterPrompts, setMasterPrompts] = useState<MasterPrompt[]>([])
  const [outputs, setOutputs] = useState<OutputItem[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [compareMode, setCompareMode] = useState(false)
  const [comments, setComments] = useState<CommentRow[]>([])
  const [draft, setDraft] = useState('')
  const [meId, setMeId] = useState<string | null>(null)
  const [decisionFor, setDecisionFor] = useState<string | null>(null)
  const [decisionReasons, setDecisionReasons] = useState<string[]>([])
  const [decisionNote, setDecisionNote] = useState('')

  // ── Generate 탭 상태 ──────────────────────────────
  const [centerTab, setCenterTab] = useState<'results' | 'generate'>('results')
  const [genPromptDraft, setGenPromptDraft] = useState('')
  const [genType, setGenType] = useState<'t2i' | 'i2v'>('t2i')
  const [genEngine, setGenEngine] = useState<string>('nanobanana')
  const [genRatio, setGenRatio] = useState<string>('16:9')
  const [generating, setGenerating] = useState(false)
  const [referenceAssets, setReferenceAssets] = useState<Asset[]>([])
  const [genCamera, setGenCamera] = useState<{ angle?: string; shotSize?: string; lens?: string; lighting?: string }>({})
  const [genRefSel, setGenRefSel] = useState<RefSelection>(emptyRefSelection())
  const [genUseRootAssets, setGenUseRootAssets] = useState(true)

  // 레퍼런스 자산 (오브제/캐릭터/공간 선택용)
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('assets').select('*')
        .eq('project_id', projectId).eq('type', 'reference')
        .order('created_at', { ascending: false })
      setReferenceAssets((data ?? []) as Asset[])
    })()
  }, [projectId, supabase])

  // 씬 목록 + 활성 씬 결정
  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setMeId(user?.id ?? null)

      const { data } = await supabase
        .from('scenes')
        .select('*')
        .eq('project_id', projectId)
        .order('order_index')
      const list = sortScenesByNumber((data ?? []) as Scene[])
      setScenes(list)
      const want = search.get('scene')
      if (want && list.find(s => s.id === want)) setActiveId(want)
      else if (list.length > 0) setActiveId(list[0].id)
    })()
  }, [projectId, supabase, search])

  // 씬 변경 시 데이터 로드
  const loadSceneData = useCallback(async (sceneId: string) => {
    // master prompts (fallback when prompt_versions empty)
    const { data: mp } = await supabase
      .from('master_prompts')
      .select('id, content, version, created_at')
      .eq('scene_id', sceneId)
      .order('version', { ascending: false })
    setMasterPrompts((mp ?? []) as MasterPrompt[])

    // prompt_versions (새 스키마, 있으면 우선)
    const { data: pv } = await supabase
      .from('prompt_versions')
      .select('id, version_label, content, is_current, created_at')
      .eq('scene_id', sceneId)
      .order('created_at', { ascending: false })
    setVersions((pv ?? []) as PromptVersion[])

    // attempts + outputs
    const { data: attempts } = await supabase
      .from('prompt_attempts')
      .select('id, type, engine, status, created_at, outputs:attempt_outputs(*, asset:assets(url))')
      .eq('scene_id', sceneId)
      .order('created_at', { ascending: false })

    const flat: OutputItem[] = []
    for (const a of (attempts ?? []) as any[]) {
      for (const o of (a.outputs ?? [])) {
        flat.push({
          id: o.id,
          attempt_id: a.id,
          url: o.url ?? o.asset?.url ?? null,
          archived: o.archived ?? false,
          satisfaction_score: o.satisfaction_score,
          feedback: o.feedback ?? '',
          type: a.type,
          engine: a.engine,
          created_at: o.created_at ?? a.created_at,
        })
      }
    }
    setOutputs(flat)
    setSelectedIds(flat.length > 0 ? [flat[0].id] : [])

    // shot_comments (새 스키마)
    const { data: cm } = await supabase
      .from('shot_comments')
      .select('id, user_id, content, created_at, output_id')
      .eq('scene_id', sceneId)
      .order('created_at', { ascending: true })
    setComments((cm ?? []) as CommentRow[])
  }, [supabase])

  useEffect(() => {
    if (!activeId) return
    void loadSceneData(activeId)
  }, [activeId, loadSceneData])

  // Realtime 코멘트
  useEffect(() => {
    if (!activeId) return
    const ch = supabase
      .channel(`shot-comments-${activeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'shot_comments', filter: `scene_id=eq.${activeId}` },
        (payload) => {
          const row = payload.new as any
          setComments(prev => prev.some(c => c.id === row.id) ? prev : [...prev, row])
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [activeId, supabase])

  const active = scenes.find(s => s.id === activeId) || null
  const candidates = outputs
  const focused = outputs.find(o => o.id === selectedIds[0]) || candidates[0] || null
  const currentPrompt = versions.find(v => v.is_current) ?? versions[0] ?? null
  const currentMP = masterPrompts[0] ?? null

  function toggleSelect(id: string) {
    if (compareMode) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= 4 ? prev : [...prev, id])
    } else {
      setSelectedIds([id])
    }
  }

  async function postComment() {
    if (!draft.trim() || !meId || !activeId) return
    const content = draft.trim()
    setDraft('')
    const { data, error } = await supabase
      .from('shot_comments')
      .insert({
        scene_id: activeId, user_id: meId, content,
        output_id: selectedIds[0] ?? null,
      })
      .select()
      .single()
    if (error) { alert('코멘트 저장 실패: ' + error.message); setDraft(content); return }
    if (data) setComments(prev => [...prev, data as any])
  }

  async function submitDecision(decision: 'approved' | 'revise_requested' | 'removed') {
    if (!decisionFor || !meId || !activeId) return
    const { error } = await supabase
      .from('shot_decisions')
      .insert({
        output_id: decisionFor,
        scene_id: activeId,
        decision_type: decision,
        reason_tags: decisionReasons,
        comment: decisionNote,
        decided_by: meId,
      })
    if (error) { alert('결정 저장 실패: ' + error.message); return }
    // archived 필드도 같이 갱신
    if (decision === 'approved') {
      await supabase.from('attempt_outputs').update({ archived: true, satisfaction_score: 5 }).eq('id', decisionFor)
    } else if (decision === 'removed') {
      await supabase.from('attempt_outputs').update({ archived: false, satisfaction_score: 1 }).eq('id', decisionFor)
    }
    setDecisionFor(null); setDecisionReasons([]); setDecisionNote('')
    void loadSceneData(activeId)
  }

  if (!active) {
    return (
      <div className="h-full flex items-center justify-center" style={{ color: 'var(--ink-4)' }}>
        씬이 없습니다. 씬 분류에서 씬을 만든 뒤 다시 들어와주세요.
      </div>
    )
  }

  return (
    <div className="h-full grid overflow-hidden" style={{ gridTemplateColumns: '320px 1fr 340px' }}>
      {/* LEFT — Shot Brief */}
      <aside style={{ borderRight: '1px solid var(--line)', overflow: 'auto', background: 'var(--bg-1)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <button
              onClick={() => router.push(`/project/${projectId}/scenes`)}
              style={{ padding: '2px 6px', color: 'var(--ink-3)' }}
              title="씬 분류로"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="mono" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{active.scene_number}</span>
            <Pill variant="review" showDot>검토 필요</Pill>
          </div>
          <h2 style={{ margin: '4px 0', fontSize: 16, fontWeight: 600, lineHeight: 1.3, color: 'var(--ink)' }}>
            {active.title || '제목 없음'}
          </h2>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {active.content || '내용 없음'}
          </div>
        </div>

        {/* Scene navigator */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div className="field-label">씬 이동</div>
          <div className="flex flex-col" style={{ gap: 4 }}>
            {scenes.map(s => (
              <button
                key={s.id}
                onClick={() => { setActiveId(s.id); router.replace(`/project/${projectId}/workspace?scene=${s.id}`) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', borderRadius: 'var(--r-sm)',
                  background: activeId === s.id ? 'var(--bg-3)' : 'transparent',
                  color: activeId === s.id ? 'var(--ink)' : 'var(--ink-3)',
                  fontSize: 12, textAlign: 'left',
                }}
              >
                <span className="mono" style={{ minWidth: 36, color: 'var(--accent)' }}>{s.scene_number}</span>
                <span className="truncate flex-1">{s.title || '(제목 없음)'}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Prompt versions */}
        <div style={{ padding: '14px 16px' }}>
          <div className="flex items-center" style={{ marginBottom: 8 }}>
            <span className="field-label" style={{ margin: 0 }}>PROMPT</span>
            <span style={{ flex: 1 }} />
            <Link
              href={`/project/${projectId}/scenes`}
              style={{
                padding: '4px 8px',
                fontSize: 11,
                color: 'var(--ink-3)',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--line)',
              }}
            >
              <Sparkles size={11} style={{ display: 'inline', marginRight: 4 }} />
              씬 분류로
            </Link>
          </div>
          <div className="flex flex-col" style={{ gap: 6, marginBottom: 12 }}>
            {versions.length > 0 ? versions.map(pv => (
              <div
                key={pv.id}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 'var(--r-sm)',
                  border: `1px solid ${pv.is_current ? 'var(--accent-line)' : 'var(--line)'}`,
                  background: pv.is_current ? 'var(--accent-soft)' : 'var(--bg-2)',
                }}
              >
                <div className="flex items-center" style={{ marginBottom: 3, gap: 6 }}>
                  <span className="mono" style={{ fontSize: 11, color: pv.is_current ? 'var(--accent-2)' : 'var(--ink-3)', fontWeight: 600 }}>
                    {pv.version_label}
                  </span>
                  {pv.is_current && <Pill variant="ready">current</Pill>}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                    {new Date(pv.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {pv.content}
                </div>
              </div>
            )) : currentMP ? (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--accent-line)',
                  background: 'var(--accent-soft)',
                }}
              >
                <div className="flex items-center" style={{ marginBottom: 3, gap: 6 }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--accent-2)', fontWeight: 600 }}>
                    v{currentMP.version}
                  </span>
                  <Pill variant="ready">current</Pill>
                </div>
                <div
                  style={{
                    fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {currentMP.content}
                </div>
              </div>
            ) : (
              <div className="empty" style={{ padding: '16px 12px' }}>아직 프롬프트가 없어요</div>
            )}
          </div>

          <Link
            href={`/project/${projectId}/t2i?scene=${active.id}`}
            className="flex items-center justify-center gap-2"
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--r-md)',
              fontSize: 12, fontWeight: 500,
              background: 'transparent',
              border: '1px solid var(--line-strong)',
              color: 'var(--ink-2)',
            }}
          >
            <Sparkles size={13} /> 새 시도 — Generation
          </Link>
        </div>
      </aside>

      {/* CENTER — Results */}
      <main style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Toolbar */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--line)',
            position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg)',
          }}
        >
          <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
            {/* Tab 토글 */}
            <div className="flex items-center" style={{ gap: 4 }}>
              <button
                onClick={() => setCenterTab('results')}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--r-md)',
                  fontSize: 12, fontWeight: 600,
                  background: centerTab === 'results' ? 'var(--bg-3)' : 'transparent',
                  color: centerTab === 'results' ? 'var(--ink)' : 'var(--ink-3)',
                }}
              >
                결과
              </button>
              <button
                onClick={() => setCenterTab('generate')}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--r-md)',
                  fontSize: 12, fontWeight: 600,
                  background: centerTab === 'generate' ? 'var(--bg-3)' : 'transparent',
                  color: centerTab === 'generate' ? 'var(--ink)' : 'var(--ink-3)',
                }}
              >
                <Sparkles size={11} style={{ display: 'inline', marginRight: 4 }} />
                생성
              </button>
            </div>
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              · {candidates.length} candidates
            </span>
            <span style={{ flex: 1 }} />
            {centerTab === 'results' && (
              <button
                onClick={() => setCompareMode(v => !v)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--r-md)',
                  fontSize: 11, fontWeight: 500,
                  background: compareMode ? 'var(--accent)' : 'transparent',
                  color: compareMode ? '#fff' : 'var(--ink-2)',
                  border: '1px solid var(--line-strong)',
                }}
              >
                Compare {compareMode && `(${selectedIds.length})`}
              </button>
            )}
          </div>
        </div>

        {/* 본문 */}
        {centerTab === 'generate' ? (
          <GeneratePanel
            sceneId={active.id}
            projectId={projectId}
            currentPrompt={(currentPrompt?.content ?? currentMP?.content ?? '')}
            promptDraft={genPromptDraft}
            onPromptChange={setGenPromptDraft}
            type={genType}
            onTypeChange={setGenType}
            engine={genEngine}
            onEngineChange={setGenEngine}
            ratio={genRatio}
            onRatioChange={setGenRatio}
            generating={generating}
            referenceAssets={referenceAssets}
            camera={genCamera}
            onCameraSelect={(t, key, p) => setGenCamera(prev => ({ ...prev, [t]: key }))}
            onCameraDeselect={(t) => setGenCamera(prev => { const n = { ...prev }; delete n[t]; return n })}
            refSel={genRefSel}
            onRefSelChange={setGenRefSel}
            scene={active}
            useRootAssets={genUseRootAssets}
            onUseRootAssetsChange={setGenUseRootAssets}
            onGenerate={async () => {
              const basePrompt = (genPromptDraft || currentPrompt?.content || currentMP?.content || '').trim()
              if (!basePrompt) { alert('프롬프트를 입력하거나 마스터 프롬프트를 먼저 만들어주세요.'); return }

              // 카메라 suffix 추가
              const cameraStr = buildCameraPrompt(genCamera)
              const fullPrompt = cameraStr ? `${basePrompt}\n\n${cameraStr}` : basePrompt

              // 레퍼런스 URL 모음 (오브제 + 루트에셋)
              const refUrls: string[] = allSelectedUrls(genRefSel, referenceAssets)
              if (genUseRootAssets) {
                const rootImgs = (active as any).selected_root_asset_image_ids ?? {}
                for (const cat of ['character', 'space', 'object', 'misc']) {
                  const ids: string[] = rootImgs[cat] ?? []
                  for (const id of ids) {
                    if (!refUrls.includes(id) && id.startsWith('http')) refUrls.push(id)
                  }
                }
              }

              setGenerating(true)
              setCenterTab('results')

              // 옵티미스틱 placeholder
              const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,7)}`
              const tempAttempt = `temp_a_${Date.now()}`
              const placeholder: OutputItem = {
                id: tempId, attempt_id: tempAttempt, url: null, archived: false,
                satisfaction_score: null, feedback: '',
                type: genType, engine: genEngine,
                created_at: new Date().toISOString(),
              }
              setOutputs(prev => [...prev, placeholder])

              try {
                const { data: attempt, error } = await supabase
                  .from('prompt_attempts')
                  .insert({
                    scene_id: active.id, type: genType, engine: genEngine,
                    prompt: fullPrompt, status: 'generating', depth: 0,
                  })
                  .select().single()
                if (error || !attempt) {
                  alert('시도 생성 실패: ' + (error?.message ?? ''))
                  setOutputs(prev => prev.filter(o => o.id !== tempId))
                  return
                }
                const url = genType === 't2i' ? '/api/t2i/generate' : '/api/i2v/generate'
                const body = genType === 't2i'
                  ? { attemptId: attempt.id, prompt: fullPrompt, engine: genEngine, projectId, sceneId: active.id, aspectRatio: genRatio, referenceImageUrls: refUrls.length > 0 ? refUrls : undefined }
                  : { attemptId: attempt.id, prompt: fullPrompt, sourceImageUrl: focused?.url, projectId, sceneId: active.id, duration: 5, aspectRatio: genRatio }
                const r = await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                })
                if (!r.ok) {
                  const j = await r.json().catch(() => ({}))
                  alert('생성 실패: ' + (j.error ?? r.statusText))
                  await supabase.from('prompt_attempts').update({ status: 'failed' }).eq('id', attempt.id)
                  setOutputs(prev => prev.filter(o => o.id !== tempId))
                  return
                }
                await loadSceneData(active.id)
              } finally {
                setGenerating(false)
              }
            }}
          />
        ) : compareMode ? (
          <div style={{ padding: '18px 20px' }}>
            <div
              style={{
                padding: '10px 12px', background: 'var(--accent-soft)',
                border: '1px solid var(--accent-line)',
                borderRadius: 'var(--r-md)', marginBottom: 14, fontSize: 12, color: 'var(--ink-2)',
              }}
            >
              <strong>비교 모드</strong> — 결과를 클릭해 최대 4개까지 선택. Shot Intent 기준으로 평가하세요.
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(2, selectedIds.length)}, 1fr)`,
                gap: 12,
              }}
            >
              {selectedIds.map(rid => {
                const r = candidates.find(x => x.id === rid)
                if (!r) return null
                return <CompareCell key={rid} item={r} onRemove={() => toggleSelect(rid)} onDecide={(d) => setDecisionFor(rid)} />
              })}
              {selectedIds.length < 4 && (
                <div
                  style={{
                    aspectRatio: '1', border: '1px dashed var(--line-strong)',
                    borderRadius: 'var(--r-md)',
                    display: 'grid', placeItems: 'center',
                    color: 'var(--ink-4)', fontSize: 11,
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <Plus size={18} />
                    <div style={{ marginTop: 6 }}>아래에서 선택</div>
                  </div>
                </div>
              )}
            </div>

            <div className="divider" />
            <div className="field-label">선택 가능한 후보</div>
            <CandidateStrip items={candidates} selected={selectedIds} onToggle={toggleSelect} />
          </div>
        ) : (
          /* Single hero + strip */
          <div style={{ padding: '18px 20px' }}>
            {focused ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18, marginBottom: 24 }}>
                <div className="card overflow-hidden" style={{ padding: 0 }}>
                  <div style={{ aspectRatio: '16/9', background: 'var(--bg-3)', position: 'relative' }}>
                    {focused.url
                      ? (focused.type === 't2i'
                        ? <img src={focused.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <video src={focused.url} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
                      : <div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin" /></div>}
                  </div>
                </div>
                <div className="card-pad" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)' }}>
                  <div className="flex items-center" style={{ gap: 8, marginBottom: 12 }}>
                    <Pill variant="gen">{focused.type.toUpperCase()}</Pill>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{focused.engine}</span>
                  </div>
                  <div className="field-label">결정</div>
                  <div className="flex flex-col" style={{ gap: 6, marginBottom: 12 }}>
                    <DecisionButton
                      type="approved" label="승인 — Approved"
                      onClick={() => setDecisionFor(focused.id)}
                    />
                    <DecisionButton
                      type="revise_requested" label="수정 요청 — Revise"
                      onClick={() => setDecisionFor(focused.id)}
                    />
                    <DecisionButton
                      type="removed" label="제거 — Remove"
                      onClick={() => setDecisionFor(focused.id)}
                    />
                  </div>
                  {focused.feedback && (
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', padding: 8, background: 'var(--bg-1)', borderRadius: 'var(--r-sm)' }}>
                      <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>피드백</div>
                      {focused.feedback}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="empty" style={{ marginBottom: 18 }}>
                생성된 결과가 없어요. T2I 페이지에서 시도를 만들어주세요.
              </div>
            )}

            <div className="field-label">후보 ({candidates.length})</div>
            <CandidateStrip items={candidates} selected={selectedIds} onToggle={toggleSelect} />
          </div>
        )}
      </main>

      {/* RIGHT — Comments */}
      <aside style={{ borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--bg-1)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }} className="flex items-center gap-2">
          <MessageCircle size={13} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>코멘트</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{comments.length}</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {comments.length === 0 ? (
            <div className="empty" style={{ padding: 16, fontSize: 12 }}>아직 코멘트가 없어요</div>
          ) : (
            <div className="flex flex-col" style={{ gap: 10 }}>
              {comments.map(c => (
                <div key={c.id} style={{ background: 'var(--bg-2)', padding: 10, borderRadius: 'var(--r-md)', border: '1px solid var(--line)' }}>
                  <div className="flex items-center" style={{ gap: 6, marginBottom: 4, fontSize: 10, color: 'var(--ink-4)' }}>
                    <span>{c.user_id === meId ? '나' : '멤버'}</span>
                    <span>·</span>
                    <span>{new Date(c.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {c.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: 10 }} className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void postComment() } }}
            rows={2}
            placeholder="이 결과에 코멘트... (Enter로 전송)"
            style={{
              flex: 1,
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              padding: '6px 10px',
              color: 'var(--ink)',
              fontSize: 12,
              outline: 'none',
              resize: 'none',
            }}
          />
          <button
            onClick={() => void postComment()}
            disabled={!draft.trim()}
            style={{
              padding: 8,
              borderRadius: 'var(--r-md)',
              background: 'var(--accent)',
              color: '#fff',
              border: '1px solid var(--accent)',
              opacity: draft.trim() ? 1 : 0.4,
            }}
          >
            <Send size={13} />
          </button>
        </div>
      </aside>

      {/* Decision modal */}
      {decisionFor && (
        <DecisionModal
          onClose={() => { setDecisionFor(null); setDecisionReasons([]); setDecisionNote('') }}
          reasons={decisionReasons}
          note={decisionNote}
          onReasonsChange={setDecisionReasons}
          onNoteChange={setDecisionNote}
          onSubmit={submitDecision}
        />
      )}
    </div>
  )
}

// ─── 후보 strip ─────────────────────────────────────────────────
function CandidateStrip({
  items, selected, onToggle,
}: { items: OutputItem[]; selected: string[]; onToggle: (id: string) => void }) {
  if (items.length === 0) return <div className="empty" style={{ padding: 16, fontSize: 12 }}>후보 없음</div>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
      {items.map(r => {
        const sel = selected.includes(r.id)
        return (
          <button
            key={r.id}
            onClick={() => onToggle(r.id)}
            style={{
              aspectRatio: '16/9', borderRadius: 'var(--r-sm)', overflow: 'hidden',
              border: `2px solid ${sel ? 'var(--accent)' : 'var(--line)'}`,
              background: 'var(--bg-3)', cursor: 'pointer', position: 'relative', padding: 0,
            }}
          >
            {r.url
              ? (r.type === 't2i'
                ? <img src={r.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <video src={r.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
              : (
                <div
                  style={{
                    width: '100%', height: '100%',
                    background: 'var(--bg-3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column', gap: 4,
                    animation: 'pulse-soft 1.6s ease-in-out infinite',
                  }}
                >
                  <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: 9, color: 'var(--ink-4)' }}>큐 대기 중</span>
                </div>
              )}
            <div style={{ position: 'absolute', inset: 0, background: sel ? 'rgba(249,115,22,0.15)' : 'transparent' }} />
            {r.archived && (
              <div style={{ position: 'absolute', top: 4, right: 4 }}>
                <Pill variant="approved">승인</Pill>
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── 비교 모드 셀 ───────────────────────────────────────────────
function CompareCell({
  item, onRemove, onDecide,
}: { item: OutputItem; onRemove: () => void; onDecide: (d: 'approved' | 'revise_requested') => void }) {
  return (
    <div className="card" style={{ padding: 0, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
      <div style={{ aspectRatio: '16/9', background: 'var(--bg-3)', position: 'relative' }}>
        {item.url
          ? (item.type === 't2i'
            ? <img src={item.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <video src={item.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
          : <div style={{ width: '100%', height: '100%' }} />}
        <div style={{ position: 'absolute', top: 6, left: 6 }}>
          <Pill variant="gen">{item.type.toUpperCase()}</Pill>
        </div>
      </div>
      <div style={{ padding: 10, fontSize: 11 }}>
        <div className="flex items-center" style={{ marginBottom: 8 }}>
          <span className="mono" style={{ color: 'var(--ink-3)' }}>{item.engine}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onRemove} style={{ padding: 4, color: 'var(--ink-4)' }}><X size={11} /></button>
        </div>
        <div className="flex flex-col" style={{ gap: 6 }}>
          <button
            onClick={() => onDecide('approved')}
            style={{
              padding: '5px 10px', borderRadius: 'var(--r-sm)', fontSize: 11,
              background: 'var(--ok-soft)', color: 'var(--ok)', border: '1px solid var(--ok-soft)',
            }}
          >Approve</button>
          <button
            onClick={() => onDecide('revise_requested')}
            style={{
              padding: '5px 10px', borderRadius: 'var(--r-sm)', fontSize: 11,
              background: 'var(--accent-soft)', color: 'var(--accent-2)', border: '1px solid var(--accent-line)',
            }}
          >Revise</button>
        </div>
      </div>
    </div>
  )
}

// ─── 결정 버튼 ──────────────────────────────────────────────────
function DecisionButton({
  type, label, onClick,
}: { type: 'approved' | 'revise_requested' | 'removed'; label: string; onClick: () => void }) {
  const palette = {
    approved: { bg: 'var(--ok-soft)', color: 'var(--ok)', icon: <Check size={13} /> },
    revise_requested: { bg: 'var(--accent-soft)', color: 'var(--accent-2)', icon: <RotateCcw size={13} /> },
    removed: { bg: 'var(--danger-soft)', color: 'var(--danger)', icon: <Trash2 size={13} /> },
  }[type]
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-2"
      style={{
        padding: '8px 12px',
        borderRadius: 'var(--r-md)',
        fontSize: 12, fontWeight: 500,
        background: palette.bg, color: palette.color,
        border: `1px solid ${palette.bg}`,
      }}
    >
      {palette.icon} {label}
    </button>
  )
}

// ─── 결정 모달 ──────────────────────────────────────────────────
function DecisionModal({
  onClose, reasons, note, onReasonsChange, onNoteChange, onSubmit,
}: {
  onClose: () => void
  reasons: string[]
  note: string
  onReasonsChange: (next: string[]) => void
  onNoteChange: (next: string) => void
  onSubmit: (d: 'approved' | 'revise_requested' | 'removed') => void
}) {
  function toggle(tag: string) {
    onReasonsChange(reasons.includes(tag) ? reasons.filter(r => r !== tag) : [...reasons, tag])
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 fade-in"
      style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md shadow-lg"
        style={{
          background: 'var(--bg-2)', border: '1px solid var(--line)',
          borderRadius: 'var(--r-xl)', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', background: 'var(--bg-1)' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>이 결과 결정</h2>
          <p style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-3)' }}>이유 태그와 짧은 코멘트를 남겨주세요.</p>
        </div>
        <div style={{ padding: 16 }}>
          <div className="field-label">이유 태그 (선택)</div>
          <div className="flex flex-wrap" style={{ gap: 6, marginBottom: 14 }}>
            {REASON_TAGS.map(tag => {
              const sel = reasons.includes(tag)
              return (
                <button
                  key={tag}
                  onClick={() => toggle(tag)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontSize: 11,
                    background: sel ? 'var(--accent-soft)' : 'var(--bg-3)',
                    color: sel ? 'var(--accent)' : 'var(--ink-3)',
                    border: `1px solid ${sel ? 'var(--accent-line)' : 'var(--line)'}`,
                  }}
                >
                  {tag}
                </button>
              )
            })}
          </div>

          <div className="field-label">코멘트 (선택)</div>
          <textarea
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            rows={3}
            placeholder="추가 메모..."
            style={{
              width: '100%',
              background: 'var(--bg-1)', border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)', padding: 10, fontSize: 12,
              color: 'var(--ink)', outline: 'none', resize: 'none',
              marginBottom: 14,
            }}
          />

          <div className="flex flex-col" style={{ gap: 6 }}>
            <DecisionButton type="approved" label="승인 — Approved" onClick={() => onSubmit('approved')} />
            <DecisionButton type="revise_requested" label="수정 요청 — Revise" onClick={() => onSubmit('revise_requested')} />
            <DecisionButton type="removed" label="제거 — Remove" onClick={() => onSubmit('removed')} />
            <button
              onClick={onClose}
              style={{
                marginTop: 4, padding: '8px 12px', borderRadius: 'var(--r-md)',
                fontSize: 12, color: 'var(--ink-4)', background: 'transparent',
                border: '1px solid transparent',
              }}
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Generate 패널 — 프롬프트 + 엔진 + 화면비 + 생성 ─────────
const T2I_ENGINES = [
  { value: 'nanobanana',       label: '나노바나나' },
  { value: 'gpt-image',        label: 'GPT Image' },
  { value: 'midjourney',       label: 'Midjourney' },
  { value: 'stable-diffusion', label: 'Stable Diffusion' },
  { value: 'dalle',            label: 'DALL-E 3' },
]
const I2V_ENGINES = [
  { value: 'kling',     label: 'Kling I2V' },
  { value: 'kling3',    label: 'Kling 3.0' },
  { value: 'seedance-2',label: 'Seedance 2.0 (스켈레톤)' },
]
const RATIOS = ['16:9', '9:16', '1:1', '4:3', '21:9']

function GeneratePanel({
  sceneId, projectId,
  currentPrompt, promptDraft, onPromptChange,
  type, onTypeChange,
  engine, onEngineChange,
  ratio, onRatioChange,
  generating, onGenerate,
  referenceAssets, camera, onCameraSelect, onCameraDeselect,
  refSel, onRefSelChange, scene, useRootAssets, onUseRootAssetsChange,
}: {
  sceneId: string
  projectId: string
  currentPrompt: string
  promptDraft: string
  onPromptChange: (v: string) => void
  type: 't2i' | 'i2v'
  onTypeChange: (v: 't2i' | 'i2v') => void
  engine: string
  onEngineChange: (v: string) => void
  ratio: string
  onRatioChange: (v: string) => void
  generating: boolean
  onGenerate: () => Promise<void> | void
  referenceAssets: Asset[]
  camera: { angle?: string; shotSize?: string; lens?: string; lighting?: string }
  onCameraSelect: (type: 'angle' | 'shotSize' | 'lens' | 'lighting', key: string, prompt: string) => void
  onCameraDeselect: (type: 'angle' | 'shotSize' | 'lens' | 'lighting') => void
  refSel: RefSelection
  onRefSelChange: (next: RefSelection) => void
  scene: Scene
  useRootAssets: boolean
  onUseRootAssetsChange: (v: boolean) => void
}) {
  const engineOptions = type === 't2i' ? T2I_ENGINES : I2V_ENGINES

  return (
    <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
      {/* 좌측 — 프롬프트 */}
      <div>
        <div className="field-label">프롬프트</div>
        <textarea
          value={promptDraft || currentPrompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="이미지/영상 생성에 쓸 프롬프트... (현재 마스터 프롬프트가 자동 로드됨)"
          rows={10}
          style={{
            width: '100%',
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            padding: 12,
            fontSize: 13,
            color: 'var(--ink)',
            outline: 'none',
            resize: 'vertical',
            lineHeight: 1.6,
          }}
        />
        <p style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)' }}>
          공란일 경우 현재 마스터 프롬프트가 자동 사용됩니다.
        </p>
      </div>

      {/* 우측 — 옵션 + 생성 */}
      <div>
        <div className="field-label">유형</div>
        <div className="flex" style={{ gap: 6, marginBottom: 14 }}>
          {(['t2i', 'i2v'] as const).map(t => (
            <button
              key={t}
              onClick={() => onTypeChange(t)}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 'var(--r-md)',
                fontSize: 12, fontWeight: 500,
                background: type === t ? 'var(--accent-soft)' : 'var(--bg-2)',
                color: type === t ? 'var(--accent)' : 'var(--ink-3)',
                border: `1px solid ${type === t ? 'var(--accent-line)' : 'var(--line)'}`,
              }}
            >
              {t === 't2i' ? 'T2I — 이미지' : 'I2V — 영상'}
            </button>
          ))}
        </div>

        <div className="field-label">엔진</div>
        <div className="flex flex-wrap" style={{ gap: 6, marginBottom: 14 }}>
          {engineOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => onEngineChange(opt.value)}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--r-md)',
                fontSize: 11, fontWeight: 500,
                background: engine === opt.value ? 'var(--accent-soft)' : 'var(--bg-3)',
                color: engine === opt.value ? 'var(--accent)' : 'var(--ink-2)',
                border: `1px solid ${engine === opt.value ? 'var(--accent-line)' : 'var(--line)'}`,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="field-label">화면비</div>
        <div className="flex" style={{ gap: 6, marginBottom: 18 }}>
          {RATIOS.map(r => (
            <button
              key={r}
              onClick={() => onRatioChange(r)}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--r-md)',
                fontSize: 11, fontWeight: 500,
                background: ratio === r ? 'var(--accent-soft)' : 'var(--bg-3)',
                color: ratio === r ? 'var(--accent)' : 'var(--ink-2)',
                border: `1px solid ${ratio === r ? 'var(--accent-line)' : 'var(--line)'}`,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {r}
            </button>
          ))}
        </div>

        {/* 샷 구도 */}
        <div className="field-label">샷 구도 (앵글 / 샷사이즈 / 렌즈)</div>
        <div style={{ marginBottom: 14 }}>
          <CameraReferencePanel
            selectedAngle={camera.angle}
            selectedShotSize={camera.shotSize}
            selectedLens={camera.lens}
            selectedLighting={camera.lighting}
            onSelect={onCameraSelect}
            onDeselect={onCameraDeselect}
          />
        </div>

        {/* 오브제 / 레퍼런스 자산 */}
        <div className="field-label">레퍼런스 자산 (오브제 / 캐릭터 / 공간)</div>
        <div style={{ marginBottom: 14 }}>
          <SceneReferencePicker
            referenceAssets={referenceAssets}
            selection={refSel}
            onChange={onRefSelChange}
          />
        </div>

        {/* 루트 에셋 박스 */}
        <div className="field-label">루트 에셋</div>
        <RootAssetBox
          scene={scene}
          enabled={useRootAssets}
          onToggle={onUseRootAssetsChange}
        />

        <button
          onClick={() => onGenerate()}
          disabled={generating}
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 'var(--r-md)',
            fontSize: 13, fontWeight: 600,
            background: 'var(--accent)', color: '#fff',
            border: '1px solid var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: generating ? 0.6 : 1,
            marginTop: 18,
          }}
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {generating ? '생성 중...' : `${type === 't2i' ? '이미지' : '영상'} 생성 — Que`}
        </button>

        <p style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5 }}>
          생성 시작 후 결과 탭에서 진행 상태와 후보를 확인할 수 있어요.
          엔진/화면비 설정은 씬 설정에 저장되지 않고 이 시도에만 적용됩니다.
        </p>
      </div>
    </div>
  )
}

// ─── 루트 에셋 박스 (씬에 마킹된 인물/공간/오브제/기타 토글로 사용) ───
function RootAssetBox({
  scene, enabled, onToggle,
}: { scene: Scene; enabled: boolean; onToggle: (v: boolean) => void }) {
  const marks = (scene as any).root_asset_marks ?? {}
  const images = (scene as any).selected_root_asset_image_ids ?? {}
  const cats: { key: 'character' | 'space' | 'object' | 'misc'; label: string }[] = [
    { key: 'character', label: '인물' },
    { key: 'space',     label: '공간' },
    { key: 'object',    label: '오브제' },
    { key: 'misc',      label: '기타' },
  ]
  const hasContent = cats.some(c => (marks[c.key] && marks[c.key].trim()) || ((images[c.key] ?? []).length > 0))

  return (
    <div
      style={{
        marginBottom: 14,
        padding: 12,
        background: 'var(--bg-2)',
        border: `1px solid ${enabled ? 'var(--accent-line)' : 'var(--line)'}`,
        borderRadius: 'var(--r-md)',
      }}
    >
      <label className="flex items-center gap-2" style={{ cursor: 'pointer', marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ accentColor: 'var(--accent)' }}
        />
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
          이 씬의 루트 에셋 마킹을 생성에 적용
        </span>
      </label>

      {hasContent ? (
        <div className="flex flex-col" style={{ gap: 8 }}>
          {cats.map(c => {
            const text = marks[c.key]
            const imgs: string[] = images[c.key] ?? []
            if (!(text && text.trim()) && imgs.length === 0) return null
            return (
              <div key={c.key}>
                <div className="flex items-center" style={{ gap: 6, marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 10, fontWeight: 600, padding: '1px 6px',
                      borderRadius: 'var(--r-sm)',
                      background: 'var(--bg-3)', color: 'var(--ink-3)',
                    }}
                  >
                    {c.label}
                  </span>
                  {text && text.trim() && (
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      {text}
                    </span>
                  )}
                </div>
                {imgs.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 4 }}>
                    {imgs.slice(0, 8).map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt=""
                        style={{
                          width: '100%', aspectRatio: '1', objectFit: 'cover',
                          borderRadius: 'var(--r-sm)',
                          opacity: enabled ? 1 : 0.4,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p style={{ fontSize: 11, color: 'var(--ink-4)' }}>
          씬 경계 편집에서 인물/공간/오브제/기타를 마킹하면 여기에 표시되고 생성에 자동 첨부됩니다.
        </p>
      )}
    </div>
  )
}
