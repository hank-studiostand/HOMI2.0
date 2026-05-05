'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { sortScenesByNumber } from '@/lib/sceneSort'
import {
  ChevronLeft, Sparkles, Check, RotateCcw, Trash2, X,
  Image as ImageIcon, Film, MessageCircle, Send, Loader2, Plus,
  Edit2, ChevronDown, ChevronRight, Save, FileText,
  Undo2, Redo2, History,
} from 'lucide-react'
import type { Scene, SatisfactionScore, Asset, RootAssetSeed } from '@/types'
import Pill, { type PillVariant } from '@/components/ui/Pill'
import CameraReferencePanel, { buildCameraPrompt } from '@/components/ui/CameraReferencePanel'
import SceneReferencePicker, {
  emptyRefSelection, allSelectedUrls, type RefSelection,
} from '@/components/ui/SceneReferencePicker'
import ImageLightbox, { type LightboxItem } from '@/components/ui/ImageLightbox'

// ─── Prompt history (per-project, per-type, localStorage, max 30) ──
const PROMPT_HISTORY_MAX = 30
const PROMPT_HISTORY_DEBOUNCE_MS = 1500

function promptHistoryKey(projectId: string, type: 't2i' | 'i2v') {
  return `workspace:promptHistory:${projectId}:${type}`
}
function loadPromptHistory(projectId: string, type: 't2i' | 'i2v'): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(promptHistoryKey(projectId, type))
    const arr = raw ? JSON.parse(raw) : []
    if (Array.isArray(arr)) return arr.filter(x => typeof x === 'string').slice(-PROMPT_HISTORY_MAX)
  } catch {}
  return []
}
function savePromptHistory(projectId: string, type: 't2i' | 'i2v', list: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(promptHistoryKey(projectId, type), JSON.stringify(list.slice(-PROMPT_HISTORY_MAX)))
  } catch {}
}

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
  decision: 'approved' | 'revise_requested' | 'removed' | null
}

interface AttemptMeta {
  id: string
  type: 't2i' | 'i2v' | 'lipsync'
  engine: string
  prompt: string
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
  const [attempts, setAttempts] = useState<AttemptMeta[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [compareMode, setCompareMode] = useState(false)
  const [comments, setComments] = useState<CommentRow[]>([])
  const [draft, setDraft] = useState('')
  const [meId, setMeId] = useState<string | null>(null)
  const [decisionFor, setDecisionFor] = useState<string | null>(null)
  const [decisionIntent, setDecisionIntent] = useState<'approved' | 'revise_requested' | 'removed' | null>(null)
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

  // 라이트박스 (결과 클릭 시 팝업)
  const [lightboxState, setLightboxState] = useState<{ items: LightboxItem[]; idx: number } | null>(null)
  const openLightbox = useCallback((items: LightboxItem[], idx: number) => {
    if (!items || items.length === 0) return
    setLightboxState({ items, idx: Math.max(0, Math.min(idx, items.length - 1)) })
  }, [])
  const [genCamera, setGenCamera] = useState<{ angle?: string; shotSize?: string; lens?: string; lighting?: string }>({})
  const [genRefSel, setGenRefSel] = useState<RefSelection>(emptyRefSelection())
  // 루트 에셋 — 프로젝트 전체 seeds + 이번 attempt에 선택된 이미지 URL set per-카테고리
  const [rootAssets, setRootAssets] = useState<RootAssetSeed[]>([])
  const [genRootSel, setGenRootSel] = useState<Record<'character' | 'space' | 'object' | 'misc', Set<string>>>({
    character: new Set(), space: new Set(), object: new Set(), misc: new Set(),
  })

  // 프롬프트 편집 상태 — 씬 진입 시 마스터 prefill, 사용자 편집 후엔 그대로 유지
  const [promptUserEdited, setPromptUserEdited] = useState(false)
  const [optimizing, setOptimizing] = useState(false)

  // ── 마스터 프롬프트 인라인 편집/생성 ─────────────────
  const [mpEditing, setMpEditing] = useState(false)
  const [mpDraft, setMpDraft] = useState('')
  const [mpSaving, setMpSaving] = useState(false)
  const [mpAiBusy, setMpAiBusy] = useState(false)

  // ── Provenance / rollback ────────────────────────────
  const [filterVersionId, setFilterVersionId] = useState<string | null>(null)
  async function rollbackToVersion(pvId: string) {
    if (!activeId) return
    try {
      await supabase.from('prompt_versions').update({ is_current: false }).eq('scene_id', activeId).eq('is_current', true)
      await supabase.from('prompt_versions').update({ is_current: true }).eq('id', pvId)
      await loadSceneData(activeId)
    } catch (e: any) {
      alert('롤백 실패: ' + (e?.message ?? String(e)))
    }
  }
  async function forkVersion(pv: PromptVersion) {
    setMpDraft(pv.content)
    setMpEditing(true)
  }

  // 레퍼런스 자산 (업로드 + 생성된 T2I) — 시간순(최신 우선) + Realtime
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function loadRefs() {
      const { data } = await supabase
        .from('assets').select('*')
        .eq('project_id', projectId)
        .in('type', ['reference', 't2i'])
        .eq('archived', false)
        .order('created_at', { ascending: false })  // 시간순 (최신 우선)
        .limit(300)
      if (!cancelled) setReferenceAssets((data ?? []) as Asset[])
    }
    void loadRefs()

    const debouncedReload = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void loadRefs() }, 250)
    }

    // Realtime — assets 테이블 변경 즉시 반영 (생성/삭제/archived 토글)
    const ch = supabase
      .channel(`workspace-refs-${projectId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'assets', filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as any
          if (!row) return
          const t = row.type
          if (t === 'reference' || t === 't2i') debouncedReload()
        })
      .subscribe()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      supabase.removeChannel(ch)
    }
  }, [projectId, supabase])

  // 프로젝트 전체 루트 에셋 시드 (Generate 탭 RootAssetBox용)
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('root_asset_seeds').select('*')
        .eq('project_id', projectId)
      setRootAssets((data ?? []) as RootAssetSeed[])
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
    const { data: attemptsData } = await supabase
      .from('prompt_attempts')
      .select('id, type, engine, prompt, status, created_at, outputs:attempt_outputs(*, asset:assets(url))')
      .eq('scene_id', sceneId)
      .order('created_at', { ascending: false })

    // shot_decisions — output별 최신 결정
    const { data: decRows } = await supabase
      .from('shot_decisions')
      .select('output_id, decision_type, created_at')
      .eq('scene_id', sceneId)
      .order('created_at', { ascending: false })
    const latestDecision = new Map<string, 'approved' | 'revise_requested' | 'removed'>()
    for (const d of (decRows ?? []) as any[]) {
      if (!latestDecision.has(d.output_id)) latestDecision.set(d.output_id, d.decision_type)
    }

    const flat: OutputItem[] = []
    const meta: AttemptMeta[] = []
    for (const a of (attemptsData ?? []) as any[]) {
      meta.push({
        id: a.id, type: a.type, engine: a.engine,
        prompt: a.prompt ?? '', created_at: a.created_at,
      })
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
          decision: latestDecision.get(o.id) ?? null,
        })
      }
    }
    // in-flight placeholder 보존 — DB에 아직 outputs가 안 박힌 큐는 화면에 유지.
    // placeholder는 id가 'temp_'로 시작하고 url=null. attempt_id는 임시(temp_a_) 또는
    // attempt insert 직후 realAttemptId로 교체된 상태일 수 있음.
    // 해당 attempt에 outputs가 들어왔으면 placeholder 제거 (자연 swap).
    setOutputs(prev => {
      const tempPlaceholders = prev.filter(o =>
        typeof o.id === 'string' && o.id.startsWith('temp_') && !o.url &&
        !flat.some(f => f.attempt_id === o.attempt_id)
      )
      return [...flat, ...tempPlaceholders]
    })
    setAttempts(meta)
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

  // 씬 변경 시 — 그 씬의 default 루트 이미지 선택을 prefill (per-attempt 편집 가능)
  useEffect(() => {
    const sc = scenes.find(s => s.id === activeId)
    if (!sc) return
    const def = (sc as any).selected_root_asset_image_ids ?? {}
    setGenRootSel({
      character: new Set<string>(def.character ?? []),
      space:     new Set<string>(def.space ?? []),
      object:    new Set<string>(def.object ?? []),
      misc:      new Set<string>(def.misc ?? []),
    })
  }, [activeId, scenes])

  // 씬 변경 → 프롬프트 편집 플래그 리셋
  useEffect(() => {
    setPromptUserEdited(false)
  }, [activeId])

  // 마스터 프롬프트 / 버전 prefill (사용자가 아직 편집 안한 경우만)
  useEffect(() => {
    if (promptUserEdited) return
    const fallback = (versions.find(v => v.is_current)?.content ?? versions[0]?.content ?? masterPrompts[0]?.content ?? '')
    setGenPromptDraft(fallback)
  }, [activeId, versions, masterPrompts, promptUserEdited])

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

  // Realtime — prompt_attempts / attempt_outputs / shot_decisions
  // 다른 사용자가 같은 씬에서 생성 / 결정하면 즉시 동기화 (debounced reload)
  useEffect(() => {
    if (!activeId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const debouncedReload = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void loadSceneData(activeId) }, 350)
    }
    const ch = supabase
      .channel(`workspace-live-${activeId}`)
      // 이 씬의 attempt 변경 (생성/완료/실패)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prompt_attempts', filter: `scene_id=eq.${activeId}` },
        debouncedReload,
      )
      // attempt_outputs는 scene_id 컬럼이 없어 attempt를 통해서만 — 일단 scene 단위 reload
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attempt_outputs' },
        (payload) => {
          // attempt_id 매칭으로 빠른 필터 (모든 outputs 변경에 reload 안 하도록)
          const row = (payload.new ?? payload.old) as any
          if (!row?.attempt_id) return
          // 이 씬에 속한 attempt인지는 attempts 배열에서 검사
          const isOurs = attempts.some(a => a.id === row.attempt_id)
          if (isOurs) debouncedReload()
        },
      )
      // shot_decisions 변경 (다른 사람이 결정 누름)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shot_decisions', filter: `scene_id=eq.${activeId}` },
        debouncedReload,
      )
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(ch)
    }
  }, [activeId, supabase, loadSceneData, attempts])

  const active = scenes.find(s => s.id === activeId) || null
  // 버전별 attempts 매칭 (attempt.prompt가 version.content로 시작하면 그 버전의 시도)
  const attemptsByVersion = new Map<string, AttemptMeta[]>()
  for (const v of versions) {
    attemptsByVersion.set(v.id, attempts.filter(a => a.prompt.startsWith(v.content)))
  }

  // 후보 필터 — removed는 휴지통으로, 버전 필터는 그 위에
  const visibleOutputs = outputs.filter(o => o.decision !== 'removed')
  const filteredCandidates = filterVersionId
    ? visibleOutputs.filter(o => (attemptsByVersion.get(filterVersionId) ?? []).some(a => a.id === o.attempt_id))
    : visibleOutputs

  const candidates = filteredCandidates
  const focused = filteredCandidates.find(o => o.id === selectedIds[0]) || filteredCandidates[0] || null
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

    // 큐 placeholder는 결정 불가 (실제 output 저장된 뒤 다시 시도)
    if (decisionFor.startsWith('temp_')) {
      alert('아직 생성 중인 결과예요. 완성된 후 다시 시도해주세요.')
      setDecisionFor(null); setDecisionIntent(null); setDecisionReasons([]); setDecisionNote('')
      return
    }

    // 1) shot_decisions insert
    const { error: decErr } = await supabase
      .from('shot_decisions')
      .insert({
        output_id: decisionFor,
        scene_id: activeId,
        decision_type: decision,
        reason_tags: decisionReasons,
        comment: decisionNote,
        decided_by: meId,
      })
    if (decErr) {
      console.error('[submitDecision] shot_decisions insert error:', decErr)
      alert(
        '결정 저장 실패\n\n' +
        '코드: ' + (decErr.code ?? '?') + '\n' +
        '메시지: ' + (decErr.message ?? '?') + '\n' +
        (decErr.hint ? '힌트: ' + decErr.hint + '\n' : '') +
        (decErr.details ? '상세: ' + decErr.details : ''),
      )
      return
    }

    // 2) attempt_outputs 동기화 (실패해도 결정 자체는 저장됨 — 경고만)
    try {
      if (decision === 'approved') {
        const { error: upErr } = await supabase.from('attempt_outputs')
          .update({ archived: true, satisfaction_score: 5 })
          .eq('id', decisionFor)
        if (upErr) console.warn('[submitDecision] attempt_outputs update warn:', upErr)
      } else if (decision === 'removed') {
        const { error: upErr } = await supabase.from('attempt_outputs')
          .update({ archived: false, satisfaction_score: 1 })
          .eq('id', decisionFor)
        if (upErr) console.warn('[submitDecision] attempt_outputs update warn:', upErr)
      }
    } catch (e) {
      console.warn('[submitDecision] attempt_outputs sync skipped:', e)
    }

    setDecisionFor(null); setDecisionIntent(null); setDecisionReasons([]); setDecisionNote('')
    void loadSceneData(activeId)
  }

  // ── 마스터 프롬프트 액션 ────────────────────────────
  async function saveMasterPromptManual() {
    if (!activeId || !mpDraft.trim()) return
    setMpSaving(true)
    try {
      const r = await fetch('/api/prompts/master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: activeId, content: mpDraft.trim() }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        alert('저장 실패: ' + (j.error ?? r.statusText))
        return
      }
      setMpEditing(false)
      setMpDraft('')
      await loadSceneData(activeId)
    } finally {
      setMpSaving(false)
    }
  }

  async function generateMasterPromptAI() {
    if (!activeId) return
    setMpAiBusy(true)
    try {
      const r = await fetch('/api/prompts/master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: activeId }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        alert('AI 생성 실패: ' + (j.error ?? r.statusText))
        return
      }
      await loadSceneData(activeId)
    } finally {
      setMpAiBusy(false)
    }
  }

  function startEditMaster() {
    setMpDraft(currentPrompt?.content ?? currentMP?.content ?? '')
    setMpEditing(true)
  }

  if (!active) {
    return (
      <div className="h-full flex items-center justify-center" style={{ color: 'var(--ink-4)' }}>
        씬이 없습니다. 씬 분류에서 씬을 만든 뒤 다시 들어와주세요.
      </div>
    )
  }

  return (
    <div className="workspace-grid h-full grid overflow-hidden">
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
          <div className="flex items-center" style={{ marginBottom: 8, gap: 6 }}>
            <span className="field-label" style={{ margin: 0 }}>PROMPT</span>
            <span style={{ flex: 1 }} />
            {!mpEditing && (
              <>
                <button
                  onClick={generateMasterPromptAI}
                  disabled={mpAiBusy}
                  title="씬 정보로 AI가 마스터 프롬프트 자동 생성"
                  style={{
                    padding: '4px 8px',
                    fontSize: 11,
                    color: mpAiBusy ? 'var(--ink-4)' : 'var(--accent)',
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--accent-line)',
                    background: 'var(--accent-soft)',
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                  }}
                >
                  {mpAiBusy
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Sparkles size={11} />}
                  AI
                </button>
                <button
                  onClick={startEditMaster}
                  title={(currentPrompt || currentMP) ? '직접 수정 (새 버전 저장)' : '직접 작성'}
                  style={{
                    padding: '4px 8px',
                    fontSize: 11,
                    color: 'var(--ink-2)',
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--line)',
                    background: 'transparent',
                  }}
                >
                  {(currentPrompt || currentMP) ? '수정' : '직접 작성'}
                </button>
              </>
            )}
          </div>

          {/* 인라인 에디터 */}
          {mpEditing && (
            <div style={{ marginBottom: 12 }}>
              <textarea
                value={mpDraft}
                onChange={(e) => setMpDraft(e.target.value)}
                rows={6}
                placeholder="이 씬의 마스터 프롬프트... (영문 권장, 카메라/구도/분위기 포함)"
                autoFocus
                style={{
                  width: '100%',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--accent-line)',
                  borderRadius: 'var(--r-md)',
                  padding: 10,
                  fontSize: 12,
                  color: 'var(--ink)',
                  outline: 'none',
                  resize: 'vertical',
                  lineHeight: 1.5,
                  marginBottom: 6,
                }}
              />
              <div className="flex items-center" style={{ gap: 6 }}>
                <button
                  onClick={() => void saveMasterPromptManual()}
                  disabled={mpSaving || !mpDraft.trim()}
                  style={{
                    padding: '5px 10px',
                    fontSize: 11, fontWeight: 500,
                    background: 'var(--accent)', color: '#fff',
                    border: '1px solid var(--accent)',
                    borderRadius: 'var(--r-sm)',
                    opacity: (mpSaving || !mpDraft.trim()) ? 0.5 : 1,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  {mpSaving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                  저장 (새 버전)
                </button>
                <button
                  onClick={() => { setMpEditing(false); setMpDraft('') }}
                  disabled={mpSaving}
                  style={{
                    padding: '5px 10px',
                    fontSize: 11,
                    color: 'var(--ink-3)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-sm)',
                    background: 'transparent',
                  }}
                >
                  <X size={11} style={{ display: 'inline', marginRight: 3 }} />
                  취소
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col" style={{ gap: 6, marginBottom: 12 }}>
            {versions.length > 0 ? versions.map(pv => {
              const versionAttempts = attemptsByVersion.get(pv.id) ?? []
              const isFiltered = filterVersionId === pv.id
              return (
              <div
                key={pv.id}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 'var(--r-sm)',
                  border: `1px solid ${pv.is_current ? 'var(--accent-line)' : isFiltered ? 'var(--accent)' : 'var(--line)'}`,
                  background: pv.is_current ? 'var(--accent-soft)' : 'var(--bg-2)',
                  cursor: 'pointer',
                }}
                onClick={() => setFilterVersionId(isFiltered ? null : pv.id)}
                title={isFiltered ? '필터 해제' : '이 버전의 결과만 보기'}
              >
                <div className="flex items-center" style={{ marginBottom: 3, gap: 6 }}>
                  <span className="mono" style={{ fontSize: 11, color: pv.is_current ? 'var(--accent-2)' : 'var(--ink-3)', fontWeight: 600 }}>
                    {pv.version_label}
                  </span>
                  {pv.is_current && <Pill variant="ready">current</Pill>}
                  {isFiltered && !pv.is_current && <Pill variant="gen">filter</Pill>}
                  <span style={{ flex: 1 }} />
                  {versionAttempts.length > 0 && (
                    <span
                      className="mono"
                      style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 'var(--r-sm)',
                        background: 'var(--bg-3)', color: 'var(--ink-3)',
                      }}
                      title={`${versionAttempts.length}개 시도`}
                    >
                      {versionAttempts.length} att
                    </span>
                  )}
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
                    marginBottom: 4,
                  }}
                >
                  {pv.content}
                </div>
                {/* Branch / Rollback */}
                <div className="flex items-center" style={{ gap: 4 }}>
                  {!pv.is_current && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void rollbackToVersion(pv.id) }}
                      style={{
                        padding: '2px 7px', fontSize: 10,
                        background: 'var(--bg-3)', color: 'var(--ink-2)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-sm)',
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}
                      title="이 버전을 current로 (rollback)"
                    >
                      <RotateCcw size={9} /> 현재로
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); forkVersion(pv) }}
                    style={{
                      padding: '2px 7px', fontSize: 10,
                      background: 'var(--bg-3)', color: 'var(--ink-2)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-sm)',
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                    }}
                    title="이 버전을 기반으로 분기"
                  >
                    <Plus size={9} /> 분기
                  </button>
                </div>
              </div>
              )
            }) : currentMP ? (
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
            onPromptChange={(v) => { setGenPromptDraft(v); setPromptUserEdited(true) }}
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
            rootAssets={rootAssets}
            rootSel={genRootSel}
            onRootSelChange={setGenRootSel}
            sceneDefaultRootIds={(active as any).selected_root_asset_image_ids ?? {}}
            recentOutputs={candidates}
            recentAttempts={attempts}
            selectedOutputId={selectedIds[0] ?? null}
            onJumpToResults={() => setCenterTab('results')}
            onSelectOutput={(id) => setSelectedIds(prev => prev[0] === id ? [] : [id])}
            onZoomOutput={(id) => {
              const list = candidates.filter(o => o.url) as Array<{ id: string; url: string; engine?: string; type?: string; prompt?: string }>
              const items: LightboxItem[] = list.map(o => ({
                url: o.url!,
                name: (o as any).engine ?? '',
                caption: (o as any).prompt ?? '',
                isVideo: (o as any).type === 'i2v' || (o as any).type === 'lipsync',
              }))
              const idx = list.findIndex(o => o.id === id)
              openLightbox(items, idx >= 0 ? idx : 0)
            }}
            onQuickDecide={async (id, dec) => {
              if (!meId || !activeId) return
              if (id.startsWith('temp_')) return
              const { error } = await supabase.from('shot_decisions').insert({
                output_id: id, scene_id: activeId, decision_type: dec,
                reason_tags: [], comment: '',
                decided_by: meId,
              })
              if (error) { alert('저장 실패: ' + error.message); return }
              if (dec === 'approved') {
                await supabase.from('attempt_outputs').update({ archived: true, satisfaction_score: 5 }).eq('id', id)
              }
              await loadSceneData(activeId)
            }}
            onQuickRate={async (id, score) => {
              if (id.startsWith('temp_')) return
              const { error } = await supabase.from('attempt_outputs')
                .update({ satisfaction_score: score })
                .eq('id', id)
              if (error) { alert('별점 저장 실패: ' + error.message); return }
              if (activeId) await loadSceneData(activeId)
            }}
            optimizing={optimizing}
            onOptimize={async () => {
              if (!active) return
              const draft = genPromptDraft.trim()
              if (!draft) { alert('먼저 프롬프트를 입력하거나 마스터를 prefill 받아주세요.'); return }
              setOptimizing(true)
              try {
                // 카메라 토큰
                const camTokens: string[] = []
                if (genCamera.angle)    camTokens.push(`angle:${genCamera.angle}`)
                if (genCamera.shotSize) camTokens.push(`shot:${genCamera.shotSize}`)
                if (genCamera.lens)     camTokens.push(`lens:${genCamera.lens}`)
                if (genCamera.lighting) camTokens.push(`lighting:${genCamera.lighting}`)
                // 레퍼런스 라벨 (카테고리만 — URL 노출은 LLM에 불필요)
                const refLabels: string[] = []
                for (const [k, v] of Object.entries(genRefSel)) {
                  if ((v as Set<string>).size > 0) refLabels.push(`${k}: ${(v as Set<string>).size}장`)
                }
                for (const [k, v] of Object.entries(genRootSel)) {
                  if ((v as Set<string>).size > 0) refLabels.push(`root-${k}: ${(v as Set<string>).size}장`)
                }
                const r = await fetch('/api/prompts/optimize', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sceneId: active.id,
                    draft,
                    aspectRatio: genRatio,
                    cameraTokens: camTokens,
                    referenceLabels: refLabels,
                    type: genType,
                  }),
                })
                const j = await r.json()
                if (!r.ok) { alert('최적화 실패: ' + (j.error ?? r.statusText)); return }
                if (j.optimized) {
                  setGenPromptDraft(j.optimized)
                  setPromptUserEdited(true)
                }
              } finally {
                setOptimizing(false)
              }
            }}
            onGenerate={async () => {
              const basePrompt = (genPromptDraft || currentPrompt?.content || currentMP?.content || '').trim()
              if (!basePrompt) { alert('프롬프트를 입력하거나 마스터 프롬프트를 먼저 만들어주세요.'); return }

              // 카메라 suffix 추가
              const cameraStr = buildCameraPrompt(genCamera)
              const fullPrompt = cameraStr ? `${basePrompt}\n\n${cameraStr}` : basePrompt

              // ── prompt_versions 자동 저장 ──────────────────
              const draftTrim = genPromptDraft.trim()
              const currentContentForCompare = (currentPrompt?.content ?? currentMP?.content ?? '').trim()
              if (draftTrim && draftTrim !== currentContentForCompare) {
                try {
                  const nextLabel = `V${versions.length + 1}`
                  if (versions.some(v => v.is_current)) {
                    await supabase.from('prompt_versions')
                      .update({ is_current: false })
                      .eq('scene_id', active.id)
                      .eq('is_current', true)
                  }
                  await supabase.from('prompt_versions').insert({
                    scene_id: active.id,
                    version_label: nextLabel,
                    content: draftTrim,
                    is_current: true,
                    created_by: meId,
                  })
                } catch (e) {
                  console.warn('[prompt_versions auto-save]', e)
                }
              }

              // 레퍼런스 URL 모음 (레퍼런스 라이브러리 + 루트 에셋 인라인 선택)
              const refUrls: string[] = allSelectedUrls(genRefSel, referenceAssets)
              for (const cat of ['character', 'space', 'object', 'misc'] as const) {
                for (const url of Array.from(genRootSel[cat])) {
                  if (!refUrls.includes(url) && url.startsWith('http')) refUrls.push(url)
                }
              }

              // I2V는 source image 필수 — 없으면 막기
              if (genType === 'i2v' && !focused?.url) {
                alert('I2V 영상 생성에는 소스 이미지가 필요해요.\n좌측 "최근 결과"에서 이미지를 클릭해 소스로 선택하세요.')
                return
              }

              setGenerating(true)

              // 옵티미스틱 placeholder — T2I는 4장, I2V는 1장이 일반적
              const placeholderCount = genType === 't2i' ? 4 : 1
              const tempAttempt = `temp_a_${Date.now()}`
              const sourceUrlForI2V = focused?.url ?? null
              const placeholders: OutputItem[] = Array.from({ length: placeholderCount }, (_, i) => ({
                id: `temp_${Date.now()}_${i}_${Math.random().toString(36).slice(2,7)}`,
                attempt_id: tempAttempt, url: null, archived: false,
                satisfaction_score: null, feedback: '',
                type: genType, engine: genEngine,
                created_at: new Date().toISOString(),
                decision: null,
              }))
              setOutputs(prev => [...prev, ...placeholders])

              // 1단계 — attempt insert (짧음, 락 유지)
              const { data: attempt, error } = await supabase
                .from('prompt_attempts')
                .insert({
                  scene_id: active.id, type: genType, engine: genEngine,
                  prompt: fullPrompt, status: 'generating', depth: 0,
                })
                .select().single()
              if (error || !attempt) {
                alert('시도 생성 실패: ' + (error?.message ?? ''))
                setOutputs(prev => prev.filter(o => o.attempt_id !== tempAttempt))
                setGenerating(false)
                return
              }
              // attempt 생성 성공 — placeholder의 attempt_id를 실제 UUID로 교체.
              // 이렇게 하면 API 완료 후 loadSceneData에서 outputs가 들어왔을 때
              // 병합 로직(flat.some(f => f.attempt_id === o.attempt_id))이 일치되어
              // placeholder가 자연 제거됨 (잔존 방지).
              const realAttemptId = attempt.id as string
              setOutputs(prev => prev.map(o =>
                o.attempt_id === tempAttempt ? { ...o, attempt_id: realAttemptId } : o
              ))

              // 2단계 — API 호출 (긴 작업 — fire-and-forget으로 백그라운드)
              // 락은 즉시 해제해서 사용자가 다른 큐를 동시에 돌릴 수 있게.
              setGenerating(false)

              void (async () => {
                try {
                  const url = genType === 't2i' ? '/api/t2i/generate' : '/api/i2v/generate'
                  const body = genType === 't2i'
                    ? { attemptId: attempt.id, prompt: fullPrompt, engine: genEngine, projectId, sceneId: active.id, aspectRatio: genRatio, referenceImageUrls: refUrls.length > 0 ? refUrls : undefined }
                    : { attemptId: attempt.id, prompt: fullPrompt, sourceImageUrl: sourceUrlForI2V, projectId, sceneId: active.id, duration: 5, aspectRatio: genRatio }
                  const r = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                  })
                  if (!r.ok) {
                    const j = await r.json().catch(() => ({}))
                    alert('생성 실패: ' + (j.error ?? r.statusText))
                    await supabase.from('prompt_attempts').update({ status: 'failed' }).eq('id', attempt.id)
                    // placeholder는 realAttemptId로 박혀있음 — 즉시 제거
                    setOutputs(prev => prev.filter(o => o.attempt_id !== realAttemptId))
                    return
                  }
                  if (active && active.id) await loadSceneData(active.id)
                } catch (e: any) {
                  console.error('[onGenerate background]', e)
                }
              })()
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
                return <CompareCell key={rid} item={r} onRemove={() => toggleSelect(rid)} onDecide={(d) => { setDecisionFor(rid); setDecisionIntent(d) }} />
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
            <CandidateStrip items={candidates} attempts={attempts} selected={selectedIds} onToggle={toggleSelect} />
          </div>
        ) : (
          /* Single hero + strip */
          <div style={{ padding: '18px 20px' }}>
            {focused ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18, marginBottom: 24 }}>
                <div className="card overflow-hidden" style={{ padding: 0 }}>
                  <div
                    onClick={() => {
                      if (!focused?.url) return
                      const list = candidates.filter(o => o.url) as Array<{ id: string; url: string; engine?: string; type?: string; prompt?: string }>
                      const items: LightboxItem[] = list.map(o => ({
                        url: o.url!,
                        name: (o as any).engine ?? '',
                        caption: (o as any).prompt ?? '',
                        isVideo: (o as any).type === 'i2v' || (o as any).type === 'lipsync',
                      }))
                      const idx = list.findIndex(o => o.id === focused.id)
                      openLightbox(items, idx >= 0 ? idx : 0)
                    }}
                    title="클릭해서 크게 보기"
                    style={{ aspectRatio: '16/9', background: 'var(--bg-3)', position: 'relative', cursor: focused.url ? 'zoom-in' : 'default' }}
                  >
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
                    <span style={{ flex: 1 }} />
                    {focused.decision === 'approved' && <Pill variant="approved">승인됨</Pill>}
                    {focused.decision === 'revise_requested' && <Pill variant="revise">수정요청</Pill>}
                    {focused.decision === 'removed' && <Pill variant="removed">제거됨</Pill>}
                  </div>
                  <div className="field-label">결정</div>
                  <div className="flex flex-col" style={{ gap: 6, marginBottom: 12 }}>
                    <DecisionButton
                      type="approved" label="승인 — Approved"
                      onClick={() => { setDecisionFor(focused.id); setDecisionIntent('approved') }}
                    />
                    <DecisionButton
                      type="revise_requested" label="수정 요청 — Revise"
                      onClick={() => { setDecisionFor(focused.id); setDecisionIntent('revise_requested') }}
                    />
                    <DecisionButton
                      type="removed" label="제거 — Remove"
                      onClick={() => { setDecisionFor(focused.id); setDecisionIntent('removed') }}
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
              <div
                style={{
                  marginBottom: 18,
                  padding: '28px 24px',
                  borderRadius: 'var(--r-lg)',
                  background: 'var(--bg-2)',
                  border: '1px dashed var(--line-strong)',
                }}
              >
                <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
                  <Sparkles size={16} style={{ color: 'var(--accent)' }} />
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                    이 씬에서 시작하기
                  </h3>
                </div>
                <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, marginBottom: 14 }}>
                  아직 생성된 결과가 없어요. 아래 순서대로 진행해보세요.
                </p>
                <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <li className="flex items-start" style={{ gap: 10 }}>
                    <span
                      style={{
                        width: 22, height: 22, borderRadius: '50%',
                        background: (currentPrompt || currentMP) ? 'var(--ok)' : 'var(--accent)',
                        color: '#fff', fontSize: 11, fontWeight: 700,
                        display: 'grid', placeItems: 'center', flexShrink: 0,
                      }}
                    >
                      {(currentPrompt || currentMP) ? <Check size={11} /> : '1'}
                    </span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>
                        좌측 PROMPT에서 마스터 프롬프트 만들기
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        AI 자동 생성 또는 직접 작성 가능
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start" style={{ gap: 10 }}>
                    <span
                      style={{
                        width: 22, height: 22, borderRadius: '50%',
                        background: 'var(--accent)',
                        color: '#fff', fontSize: 11, fontWeight: 700,
                        display: 'grid', placeItems: 'center', flexShrink: 0,
                      }}
                    >
                      2
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>
                        상단 <strong>생성</strong> 탭에서 샷 구도 / 레퍼런스 선택
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        시네마틱 콤보 프리셋 + 루트 에셋 인라인 피커
                      </div>
                    </div>
                  </li>
                  <li className="flex items-start" style={{ gap: 10 }}>
                    <span
                      style={{
                        width: 22, height: 22, borderRadius: '50%',
                        background: 'var(--accent)',
                        color: '#fff', fontSize: 11, fontWeight: 700,
                        display: 'grid', placeItems: 'center', flexShrink: 0,
                      }}
                    >
                      3
                    </span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>
                        Que 누르고 결과 도착 후 OK / 수정요청 / 휴지통
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        T2I 4장이 동시 큐 → 호버 퀵 액션 (별점 / 결정)
                      </div>
                    </div>
                  </li>
                </ol>
                <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => setCenterTab('generate')}
                    className="flex items-center gap-1"
                    style={{
                      padding: '7px 14px', borderRadius: 'var(--r-md)',
                      fontSize: 12, fontWeight: 500,
                      background: 'var(--accent)', color: '#fff',
                      border: '1px solid var(--accent)',
                    }}
                  >
                    <Sparkles size={12} /> 생성 탭으로 이동
                  </button>
                  {!(currentPrompt || currentMP) && (
                    <button
                      onClick={() => generateMasterPromptAI()}
                      disabled={mpAiBusy}
                      className="flex items-center gap-1"
                      style={{
                        padding: '7px 14px', borderRadius: 'var(--r-md)',
                        fontSize: 12, fontWeight: 500,
                        background: 'var(--accent-soft)', color: 'var(--accent)',
                        border: '1px solid var(--accent-line)',
                        opacity: mpAiBusy ? 0.5 : 1,
                      }}
                    >
                      {mpAiBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      AI 마스터 프롬프트 생성
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="field-label">후보 ({candidates.length})</div>
            <CandidateStrip items={candidates} attempts={attempts} selected={selectedIds} onToggle={toggleSelect} />
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
          intent={decisionIntent}
          onClose={() => { setDecisionFor(null); setDecisionIntent(null); setDecisionReasons([]); setDecisionNote('') }}
          reasons={decisionReasons}
          note={decisionNote}
          onReasonsChange={setDecisionReasons}
          onNoteChange={setDecisionNote}
          onSubmit={submitDecision}
        />
      )}
      {/* 라이트박스 — 결과 클릭 시 팝업 */}
      {lightboxState && (
        <ImageLightbox
          items={lightboxState.items}
          initialIndex={lightboxState.idx}
          onClose={() => setLightboxState(null)}
        />
      )}

    </div>
  )
}

// ─── 후보 strip ─────────────────────────────────────────────────
function CandidateStrip({
  items, attempts, selected, onToggle,
}: {
  items: OutputItem[]
  attempts: AttemptMeta[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  if (items.length === 0) return <div className="empty" style={{ padding: 16, fontSize: 12 }}>후보 없음</div>

  // attempt_id 별 그룹핑 — items는 이미 attempt 시간 desc 순서로 들어옴
  const groups: { attemptId: string; items: OutputItem[] }[] = []
  for (const it of items) {
    const last = groups[groups.length - 1]
    if (last && last.attemptId === it.attempt_id) {
      last.items.push(it)
    } else {
      groups.push({ attemptId: it.attempt_id, items: [it] })
    }
  }

  // attempt 인덱스 (오래된 게 #1, 최신이 #N)
  const attemptOrder = new Map<string, number>()
  const totalAttempts = attempts.length
  attempts.forEach((a, i) => {
    attemptOrder.set(a.id, totalAttempts - i)
  })

  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      {groups.map(g => {
        const meta = attempts.find(a => a.id === g.attemptId)
        const idx = attemptOrder.get(g.attemptId) ?? null
        const isTemp = g.attemptId.startsWith('temp_')
        const dateStr = meta
          ? new Date(meta.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : isTemp ? '방금' : ''
        return (
          <div key={g.attemptId}>
            <div className="flex items-center" style={{ gap: 6, marginBottom: 6, fontSize: 11, color: 'var(--ink-3)' }}>
              <span
                className="mono"
                style={{
                  padding: '1px 7px', borderRadius: 'var(--r-sm)',
                  background: isTemp ? 'var(--bg-3)' : 'var(--accent-soft)',
                  color: isTemp ? 'var(--ink-4)' : 'var(--accent-2)',
                  fontWeight: 600,
                }}
              >
                {isTemp ? '큐' : (idx ? `#${idx}` : '시도')}
              </span>
              {meta && (
                <span className="mono" style={{ color: 'var(--ink-4)' }}>
                  {meta.engine}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                {g.items.length}장 · {dateStr}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
              {g.items.map(r => {
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
                    {(r.decision || r.archived) && (
                      <div style={{ position: 'absolute', top: 4, right: 4 }}>
                        {r.decision === 'approved' && <Pill variant="approved">승인</Pill>}
                        {r.decision === 'revise_requested' && <Pill variant="revise">수정요청</Pill>}
                        {!r.decision && r.archived && <Pill variant="approved">승인</Pill>}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
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
        {item.decision === 'removed' && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'grid', placeItems: 'center' }}>
            <Trash2 size={22} style={{ color: '#fff' }} />
          </div>
        )}
        <div style={{ position: 'absolute', top: 6, left: 6 }}>
          <Pill variant="gen">{item.type.toUpperCase()}</Pill>
        </div>
        {item.decision && (
          <div style={{ position: 'absolute', top: 6, right: 6 }}>
            {item.decision === 'approved' && <Pill variant="approved">승인</Pill>}
            {item.decision === 'revise_requested' && <Pill variant="revise">수정요청</Pill>}
            {item.decision === 'removed' && <Pill variant="removed">제거</Pill>}
          </div>
        )}
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
  intent, onClose, reasons, note, onReasonsChange, onNoteChange, onSubmit,
}: {
  intent: 'approved' | 'revise_requested' | 'removed' | null
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
  const intentMeta: Record<'approved' | 'revise_requested' | 'removed', { label: string; bg: string; color: string }> = {
    approved:         { label: '승인 — Approved',     bg: 'var(--ok-soft)',     color: 'var(--ok)' },
    revise_requested: { label: '수정 요청 — Revise',   bg: 'var(--accent-soft)', color: 'var(--accent-2)' },
    removed:          { label: '제거 — Remove',        bg: 'var(--danger-soft)', color: 'var(--danger)' },
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
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
            이 결과 결정 {intent && (
              <span
                style={{
                  marginLeft: 8, padding: '2px 8px', borderRadius: 999,
                  fontSize: 11, fontWeight: 500,
                  background: intentMeta[intent].bg, color: intentMeta[intent].color,
                }}
              >
                {intentMeta[intent].label.replace(/.* — /, '')}
              </span>
            )}
          </h2>
          <p style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-3)' }}>
            {intent ? '이유 태그와 짧은 코멘트를 남기고 확인을 누르세요.' : '이유 태그와 짧은 코멘트를 남겨주세요.'}
          </p>
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

          {intent ? (
            <div className="flex flex-col" style={{ gap: 6 }}>
              <button
                onClick={() => onSubmit(intent)}
                className="flex items-center justify-center gap-2"
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--r-md)',
                  fontSize: 13, fontWeight: 600,
                  background: intentMeta[intent].color, color: '#fff',
                  border: `1px solid ${intentMeta[intent].color}`,
                }}
              >
                <Check size={13} /> {intentMeta[intent].label} 확정
              </button>
              <div className="flex" style={{ gap: 6 }}>
                {(['approved', 'revise_requested', 'removed'] as const)
                  .filter(t => t !== intent)
                  .map(t => (
                    <button
                      key={t}
                      onClick={() => onSubmit(t)}
                      style={{
                        flex: 1, padding: '6px 10px', borderRadius: 'var(--r-sm)',
                        fontSize: 11,
                        background: intentMeta[t].bg, color: intentMeta[t].color,
                        border: `1px solid ${intentMeta[t].bg}`,
                      }}
                    >
                      {intentMeta[t].label.replace(/.* — /, '')}로 변경
                    </button>
                  ))}
              </div>
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
          ) : (
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
          )}
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
  refSel, onRefSelChange, scene,
  rootAssets, rootSel, onRootSelChange, sceneDefaultRootIds,
  recentOutputs, recentAttempts, selectedOutputId, onJumpToResults,
  onSelectOutput, onZoomOutput, onQuickDecide, onQuickRate,
  optimizing, onOptimize,
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
  rootAssets: RootAssetSeed[]
  rootSel: Record<'character' | 'space' | 'object' | 'misc', Set<string>>
  onRootSelChange: React.Dispatch<React.SetStateAction<Record<'character' | 'space' | 'object' | 'misc', Set<string>>>>
  sceneDefaultRootIds: Record<string, string[]>
  recentOutputs: OutputItem[]
  recentAttempts: AttemptMeta[]
  selectedOutputId: string | null
  onJumpToResults: () => void
  onSelectOutput: (id: string) => void
  onZoomOutput?: (id: string) => void
  onQuickDecide: (id: string, decision: 'approved' | 'revise_requested' | 'removed') => Promise<void> | void
  onQuickRate: (id: string, score: number) => Promise<void> | void
  optimizing: boolean
  onOptimize: () => Promise<void> | void
}) {
  const engineOptions = type === 't2i' ? T2I_ENGINES : I2V_ENGINES

  // ─── Prompt history (T2I/I2V 분리, 최대 30개, localStorage 영속) ───
  const [history, setHistory] = useState<string[]>([])
  const [cursor, setCursor]   = useState<number>(-1)   // -1 = 라이브 (히스토리 진입 안 함)
  const navigatingRef         = useRef(false)           // 네비게이션으로 인한 setDraft인지 표시

  // 프로젝트/타입 전환 시 히스토리 재로드
  useEffect(() => {
    const list = loadPromptHistory(projectId, type)
    setHistory(list)
    setCursor(-1)
  }, [projectId, type])

  // 디바운스 자동 저장 (1.5초 멈추면 저장) — 단, 네비게이션 직후엔 skip
  useEffect(() => {
    if (navigatingRef.current) {
      navigatingRef.current = false
      return
    }
    const draft = promptDraft.trim()
    if (!draft) return
    const t = setTimeout(() => {
      setHistory(prev => {
        const last = prev[prev.length - 1]
        if (draft === last) return prev
        const next = [...prev, draft].slice(-PROMPT_HISTORY_MAX)
        savePromptHistory(projectId, type, next)
        return next
      })
      setCursor(-1)
    }, PROMPT_HISTORY_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [promptDraft, projectId, type])

  function pushHistoryNow() {
    const draft = promptDraft.trim()
    if (!draft) return
    setHistory(prev => {
      const last = prev[prev.length - 1]
      if (draft === last) return prev
      const next = [...prev, draft].slice(-PROMPT_HISTORY_MAX)
      savePromptHistory(projectId, type, next)
      return next
    })
    setCursor(-1)
  }

  function navHistory(dir: -1 | 1) {
    if (history.length === 0) return
    // cursor === -1 → live → 첫 back은 마지막 항목
    let nextCursor: number
    if (cursor === -1) {
      if (dir === 1) return                 // 라이브 상태에서 forward는 의미없음
      // 라이브 → 마지막 저장 항목으로. 단, 라이브가 마지막 저장과 다르면 먼저 저장
      const live = promptDraft.trim()
      if (live && live !== history[history.length - 1]) {
        const merged = [...history, live].slice(-PROMPT_HISTORY_MAX)
        setHistory(merged)
        savePromptHistory(projectId, type, merged)
        nextCursor = merged.length - 2     // 새로 추가된 라이브 바로 직전 항목
        navigatingRef.current = true
        onPromptChange(merged[nextCursor])
        setCursor(nextCursor)
        return
      }
      nextCursor = history.length - 1
      // 마지막 항목이 이미 표시되고 있다면 한 칸 더 뒤로
      if (history[nextCursor] === live && nextCursor > 0) nextCursor -= 1
    } else {
      nextCursor = cursor + dir
    }
    if (nextCursor < 0 || nextCursor >= history.length) return
    navigatingRef.current = true
    onPromptChange(history[nextCursor])
    setCursor(nextCursor)
  }

  const canBack    = history.length > 0 && (cursor === -1 || cursor > 0)
  const canForward = cursor !== -1 && cursor < history.length - 1
  const displayPos = cursor === -1 ? history.length : cursor + 1   // 1-indexed

  return (
    <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
      {/* 좌측 — 씬 컨텍스트 + 프롬프트 */}
      <div>
        {/* 씬 컨텍스트 (씬 경계 편집 텍스트 + 4요소 마크) */}
        <SceneContextPanel scene={scene} />

        <div className="flex items-center" style={{ marginBottom: 6, gap: 6 }}>
          <span className="field-label" style={{ margin: 0 }}>프롬프트</span>
          <span style={{ flex: 1 }} />
          {/* 프롬프트 히스토리 툴바 */}
          <div
            className="flex items-center"
            style={{
              gap: 2, padding: '2px 4px',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
              background: 'var(--bg-2)',
            }}
          >
            <History size={11} style={{ color: 'var(--ink-4)', marginLeft: 2, marginRight: 2 }} />
            <span
              className="mono"
              style={{
                fontSize: 10, color: 'var(--ink-3)',
                padding: '0 6px',
                fontVariantNumeric: 'tabular-nums',
                minWidth: 38, textAlign: 'center',
              }}
              title={`${type.toUpperCase()} 프롬프트 히스토리 — 최대 ${PROMPT_HISTORY_MAX}개 저장`}
            >
              {history.length === 0 ? '0/0' : `${displayPos}/${history.length}`}
            </span>
            <button
              onClick={() => navHistory(-1)}
              disabled={!canBack}
              title="이전 (뒤로)"
              style={{
                padding: '3px 5px', borderRadius: 'var(--r-sm)',
                color: canBack ? 'var(--ink-2)' : 'var(--ink-5)',
                opacity: canBack ? 1 : 0.4,
                background: 'transparent',
              }}
            >
              <Undo2 size={12} />
            </button>
            <button
              onClick={() => navHistory(1)}
              disabled={!canForward}
              title="다음 (앞으로)"
              style={{
                padding: '3px 5px', borderRadius: 'var(--r-sm)',
                color: canForward ? 'var(--ink-2)' : 'var(--ink-5)',
                opacity: canForward ? 1 : 0.4,
                background: 'transparent',
              }}
            >
              <Redo2 size={12} />
            </button>
            <button
              onClick={pushHistoryNow}
              title="현재 프롬프트 즉시 저장"
              style={{
                padding: '3px 6px', borderRadius: 'var(--r-sm)',
                color: 'var(--accent)',
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent-line)',
                marginLeft: 2,
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 10, fontWeight: 600,
              }}
            >
              <Save size={11} /> 저장
            </button>
          </div>
        </div>
        <textarea
          value={promptDraft}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="이미지/영상 생성에 쓸 프롬프트... (씬 진입 시 마스터가 자동 로드, 비우면 빈 상태 유지)"
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
          씬에 진입할 때 마스터 프롬프트가 자동 로드돼요. 비우면 비운 채로 유지됩니다.
        </p>

        {/* ── 인라인 결과 strip (Generate 탭에서도 결과 즉시 확인) ── */}
        <div style={{ marginTop: 18 }}>
          <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
            <span className="field-label" style={{ margin: 0 }}>최근 결과</span>
            <span style={{ flex: 1 }} />
            {recentOutputs.length > 0 && (
              <button
                onClick={onJumpToResults}
                style={{
                  fontSize: 10, color: 'var(--accent)',
                  padding: '3px 8px', borderRadius: 'var(--r-sm)',
                  background: 'var(--accent-soft)', border: '1px solid var(--accent-line)',
                }}
              >
                결과 탭에서 더 보기 →
              </button>
            )}
          </div>
          {recentOutputs.length === 0 ? (
            <div className="empty" style={{ padding: 16, fontSize: 11 }}>
              아직 결과가 없어요. 위에서 프롬프트를 다듬고 Que를 눌러보세요.
            </div>
          ) : (
            <InlineResultStrip
              outputs={recentOutputs.slice(0, 8)}
              attempts={recentAttempts}
              selectedOutputId={selectedOutputId}
              isI2VMode={type === 'i2v'}
              onSelect={onSelectOutput}
              onZoom={onZoomOutput}
              onQuickDecide={onQuickDecide}
              onQuickRate={onQuickRate}
            />
          )}
        </div>
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
          {referenceAssets.length === 0 ? (
            <div
              style={{
                padding: 14,
                background: 'var(--bg-2)',
                border: '1px dashed var(--line-strong)',
                borderRadius: 'var(--r-md)',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>
                아직 레퍼런스 자산이 없어요
              </p>
              <Link
                href={`/project/${projectId}/assets`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '5px 12px', borderRadius: 'var(--r-sm)',
                  fontSize: 11, fontWeight: 500,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  border: '1px solid var(--accent-line)',
                }}
              >
                <Plus size={11} />
                레퍼런스 라이브러리에서 추가
              </Link>
            </div>
          ) : (
            <SceneReferencePicker
              referenceAssets={referenceAssets}
              selection={refSel}
              onChange={onRefSelChange}
            />
          )}
        </div>

        {/* 루트 에셋 인라인 피커 */}
        <div className="field-label">루트 에셋 (이번 생성에 사용)</div>
        <RootAssetBox
          rootAssets={rootAssets}
          selection={rootSel}
          onChange={onRootSelChange}
          sceneDefaultRootIds={sceneDefaultRootIds}
          projectId={projectId}
        />

        {/* I2V 소스 표시 (i2v 모드일 때만) */}
        {type === 'i2v' && (
          <div
            style={{
              marginTop: 10, padding: 10,
              borderRadius: 'var(--r-md)',
              background: selectedOutputId
                ? (recentOutputs.find(o => o.id === selectedOutputId)?.url ? 'var(--accent-soft)' : 'var(--bg-2)')
                : 'var(--warn-soft)',
              border: `1px solid ${selectedOutputId && recentOutputs.find(o => o.id === selectedOutputId)?.url ? 'var(--accent-line)' : 'var(--warn)'}`,
            }}
          >
            <div className="field-label" style={{ marginBottom: 6 }}>영상 변환 소스 (I2V)</div>
            {(() => {
              const sel = recentOutputs.find(o => o.id === selectedOutputId)
              const valid = sel && sel.url && sel.type === 't2i'
              if (valid) {
                return (
                  <div className="flex items-center" style={{ gap: 10 }}>
                    <img
                      src={sel.url ?? ''}
                      alt=""
                      style={{
                        width: 80, height: 45, objectFit: 'cover',
                        borderRadius: 'var(--r-sm)',
                        border: '2px solid var(--accent)',
                      }}
                    />
                    <div style={{ flex: 1, fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                      이 이미지를 영상으로 변환합니다.<br/>
                      <span style={{ color: 'var(--ink-4)' }}>아래 결과에서 다른 컷을 클릭하면 변경돼요.</span>
                    </div>
                  </div>
                )
              }
              return (
                <div style={{ fontSize: 11, color: 'var(--warn)', lineHeight: 1.5 }}>
                  ⚠️ 아직 소스 이미지를 선택하지 않았어요.<br/>
                  <span style={{ color: 'var(--ink-3)' }}>아래 "최근 결과"에서 변환할 이미지를 클릭해주세요.</span>
                </div>
              )
            })()}
          </div>
        )}

        {/* 액션 묶음 — 최적화 + 생성 */}
        <div className="flex flex-col" style={{ gap: 8, marginTop: 18 }}>
          <button
            onClick={() => onOptimize()}
            disabled={optimizing || !promptDraft.trim()}
            className="flex items-center justify-center gap-2"
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 'var(--r-md)',
              fontSize: 12, fontWeight: 500,
              background: 'var(--accent-soft)', color: 'var(--accent)',
              border: '1px solid var(--accent-line)',
              opacity: (optimizing || !promptDraft.trim()) ? 0.5 : 1,
            }}
            title="현재 프롬프트 + 화면비 + 구도 + 레퍼런스를 합쳐 AI가 다듬어줍니다"
          >
            {optimizing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {optimizing ? '최적화 중...' : '프롬프트 최적화 (옵션 통합)'}
          </button>
          <button
            onClick={() => onGenerate()}
            disabled={generating}
            className="flex items-center justify-center gap-2"
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 'var(--r-md)',
              fontSize: 13, fontWeight: 600,
              background: 'var(--accent)', color: '#fff',
              border: '1px solid var(--accent)',
              opacity: generating ? 0.6 : 1,
            }}
          >
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {generating ? '큐 등록 중...' : `${type === 't2i' ? '이미지' : '영상'} 생성 — Que (동시 가능)`}
          </button>
        </div>

        <p style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5 }}>
          생성 시작 후 결과 탭에서 진행 상태와 후보를 확인할 수 있어요.
          엔진/화면비 설정은 씬 설정에 저장되지 않고 이 시도에만 적용됩니다.
        </p>
      </div>
    </div>
  )
}

// ─── Generate 탭 인라인 결과 strip — 반응형 + 호버 퀵액션 ──────
function InlineResultStrip({
  outputs, attempts, selectedOutputId, isI2VMode,
  onSelect, onZoom, onQuickDecide, onQuickRate,
}: {
  outputs: OutputItem[]
  attempts: AttemptMeta[]
  selectedOutputId: string | null
  isI2VMode: boolean
  onSelect: (id: string) => void
  onZoom?: (id: string) => void
  onQuickDecide: (id: string, d: 'approved' | 'revise_requested' | 'removed') => Promise<void> | void
  onQuickRate: (id: string, score: number) => Promise<void> | void
}) {
  // attempt별 그룹핑
  const groups: { attemptId: string; items: OutputItem[] }[] = []
  for (const it of outputs) {
    const last = groups[groups.length - 1]
    if (last && last.attemptId === it.attempt_id) last.items.push(it)
    else groups.push({ attemptId: it.attempt_id, items: [it] })
  }
  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      {groups.map(g => {
        const meta = attempts.find(a => a.id === g.attemptId)
        const isTemp = g.attemptId.startsWith('temp_')
        return (
          <div key={g.attemptId}>
            <div className="flex items-center" style={{ gap: 6, marginBottom: 6, fontSize: 11, color: 'var(--ink-3)' }}>
              <span
                style={{
                  padding: '2px 8px', borderRadius: 'var(--r-sm)',
                  background: isTemp ? 'var(--bg-3)' : 'var(--accent-soft)',
                  color: isTemp ? 'var(--ink-3)' : 'var(--accent-2)',
                  fontWeight: 600,
                  fontSize: 10,
                }}
              >
                {isTemp ? '생성 중' : (meta?.engine ?? '시도')}
              </span>
              <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{g.items.length}장</span>
              {isTemp && <Loader2 size={11} className="animate-spin" style={{ color: 'var(--accent)' }} />}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
              {g.items.map(r => (
                <InlineResultCard
                  key={r.id}
                  item={r}
                  isI2VSource={isI2VMode && selectedOutputId === r.id}
                  selectableAsSource={isI2VMode && r.type === 't2i' && !!r.url}
                  onSelect={() => onSelect(r.id)}
                  onZoom={onZoom ? () => onZoom(r.id) : undefined}
                  onQuickDecide={(d) => onQuickDecide(r.id, d)}
                  onQuickRate={(score) => onQuickRate(r.id, score)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function InlineResultCard({
  item, isI2VSource, selectableAsSource,
  onSelect, onZoom, onQuickDecide, onQuickRate,
}: {
  item: OutputItem
  isI2VSource: boolean
  selectableAsSource: boolean
  onSelect: () => void
  onZoom?: () => void
  onQuickDecide: (d: 'approved' | 'revise_requested' | 'removed') => Promise<void> | void
  onQuickRate: (score: number) => Promise<void> | void
}) {
  const [hover, setHover] = useState(false)
  const isPlaceholder = !item.url
  // 우선순위: I2V 소스 > 결정 색
  const borderColor = isI2VSource
    ? 'var(--accent)'
    : item.decision === 'approved' ? 'var(--ok)'
    : item.decision === 'revise_requested' ? 'var(--accent)'
    : 'var(--line)'
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={selectableAsSource ? (isI2VSource ? '✓ 영상 변환 소스로 선택됨 — 클릭으로 해제 / 다른 컷 선택' : '클릭해서 영상 변환 소스로 선택') : undefined}
      style={{
        position: 'relative',
        aspectRatio: '16/9',
        borderRadius: 'var(--r-md)', overflow: 'hidden',
        background: 'var(--bg-3)',
        border: `${isI2VSource ? '3px' : '2px'} solid ${borderColor}`,
        boxShadow: isI2VSource ? '0 0 0 3px var(--accent-soft)' : 'none',
        cursor: isPlaceholder ? 'default' : 'pointer',
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}
      onClick={() => { if (!isPlaceholder) onSelect() }}
    >
      {item.url ? (
        item.type === 't2i'
          ? <img src={item.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <video src={item.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div
          style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 6,
            animation: 'pulse-soft 1.6s ease-in-out infinite',
          }}
        >
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>큐 대기 중</span>
        </div>
      )}

      {/* I2V 소스 배지 */}
      {isI2VSource && (
        <div style={{ position: 'absolute', top: 6, left: 6 }}>
          <span
            className="flex items-center"
            style={{
              padding: '2px 7px', borderRadius: 'var(--r-sm)',
              fontSize: 10, fontWeight: 600, gap: 3,
              background: 'var(--accent)', color: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
            }}
          >
            <Film size={9} />
            I2V 소스
          </span>
        </div>
      )}
      {/* 결정 pill */}
      {item.decision && (
        <div style={{ position: 'absolute', top: 6, right: 6 }}>
          {item.decision === 'approved' && <Pill variant="approved">승인</Pill>}
          {item.decision === 'revise_requested' && <Pill variant="revise">수정요청</Pill>}
        </div>
      )}

      {/* 별점 (이미 매겨진 경우) */}
      {!isPlaceholder && item.satisfaction_score && !hover && (
        <div
          style={{
            position: 'absolute', bottom: 6, left: 6,
            padding: '2px 7px', borderRadius: 999,
            background: 'rgba(0,0,0,0.55)', color: '#fff',
            fontSize: 10, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}
        >
          ★ {item.satisfaction_score}
        </div>
      )}

      {/* 호버 시 퀵 액션 오버레이 */}
      {!isPlaceholder && hover && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 30%, rgba(0,0,0,0.65) 100%)',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            padding: 8, gap: 6,
          }}
        >
          {/* 확대 버튼 (우상단) */}
          {onZoom && (
            <div className="flex justify-end">
              <button
                onClick={(e) => { e.stopPropagation(); onZoom() }}
                title="크게 보기"
                style={{
                  padding: '4px 8px', borderRadius: 'var(--r-sm)', fontSize: 10, fontWeight: 600,
                  background: 'rgba(0,0,0,0.55)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.2)',
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                }}
              >
                <ImageIcon size={11} /> 확대
              </button>
            </div>
          )}
          {/* 별점 + OK/Revise/Remove (그룹) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* 별점 */}
          <div className="flex items-center justify-center" style={{ gap: 2 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={(e) => { e.stopPropagation(); void onQuickRate(n) }}
                title={`별점 ${n}`}
                style={{
                  padding: 2, fontSize: 14,
                  color: (item.satisfaction_score ?? 0) >= n ? 'var(--accent)' : 'rgba(255,255,255,0.6)',
                  background: 'transparent', border: 'none',
                  cursor: 'pointer',
                }}
              >
                ★
              </button>
            ))}
          </div>
          {/* OK / Revise / Remove */}
          <div className="flex items-center" style={{ gap: 4 }}>
            <button
              onClick={(e) => { e.stopPropagation(); void onQuickDecide('approved') }}
              title="OK 컷 — 승인"
              style={{
                flex: 1, padding: '5px 0',
                borderRadius: 'var(--r-sm)', fontSize: 11, fontWeight: 600,
                background: 'var(--ok)', color: '#fff',
                border: '1px solid var(--ok)',
              }}
            >
              OK
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); void onQuickDecide('revise_requested') }}
              title="수정 요청"
              style={{
                padding: '5px 8px',
                borderRadius: 'var(--r-sm)', fontSize: 11,
                background: 'var(--accent-soft)', color: 'var(--accent-2)',
                border: '1px solid var(--accent-line)',
              }}
            >
              <RotateCcw size={11} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); void onQuickDecide('removed') }}
              title="휴지통으로"
              style={{
                padding: '5px 8px',
                borderRadius: 'var(--r-sm)', fontSize: 11,
                background: 'var(--danger-soft)', color: 'var(--danger)',
                border: '1px solid var(--danger-soft)',
              }}
            >
              <Trash2 size={11} />
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 루트 에셋 인라인 피커 ─────────────────────────────────────
// 프로젝트 전체 루트 에셋 시드를 카테고리별로 그리드 노출.
// 씬에 마킹된 default 이미지는 prefilled (badge 표시).
// 사용자는 이번 attempt에서 자유롭게 추가 선택/해제 가능.
function RootAssetBox({
  rootAssets, selection, onChange, sceneDefaultRootIds, projectId,
}: {
  rootAssets: RootAssetSeed[]
  selection: Record<'character' | 'space' | 'object' | 'misc', Set<string>>
  onChange: React.Dispatch<React.SetStateAction<Record<'character' | 'space' | 'object' | 'misc', Set<string>>>>
  sceneDefaultRootIds: Record<string, string[]>
  projectId: string
}) {
  const cats: { key: 'character' | 'space' | 'object' | 'misc'; label: string; color: string }[] = [
    { key: 'character', label: '인물',   color: 'var(--accent)' },
    { key: 'space',     label: '공간',   color: 'var(--info)' },
    { key: 'object',    label: '오브제', color: 'var(--violet)' },
    { key: 'misc',      label: '기타',   color: 'var(--ink-3)' },
  ]

  const totalSelected =
    selection.character.size + selection.space.size + selection.object.size + selection.misc.size

  const byCat = new Map<string, RootAssetSeed[]>()
  for (const c of cats) byCat.set(c.key, [])
  for (const a of rootAssets) {
    const arr = byCat.get(a.category)
    if (arr) arr.push(a)
  }

  function toggle(cat: 'character' | 'space' | 'object' | 'misc', url: string) {
    onChange(prev => {
      const next = { ...prev, [cat]: new Set(prev[cat]) }
      if (next[cat].has(url)) next[cat].delete(url)
      else next[cat].add(url)
      return next
    })
  }

  function selectAllScene() {
    onChange(prev => {
      const next = { ...prev }
      for (const c of cats) {
        next[c.key] = new Set<string>([...Array.from(prev[c.key]), ...((sceneDefaultRootIds[c.key] ?? []) as string[])])
      }
      return next
    })
  }

  function clearAll() {
    onChange({ character: new Set(), space: new Set(), object: new Set(), misc: new Set() })
  }

  if (rootAssets.length === 0) {
    return (
      <div
        style={{
          marginBottom: 14, padding: 14,
          background: 'var(--bg-2)',
          border: '1px dashed var(--line-strong)',
          borderRadius: 'var(--r-md)',
          textAlign: 'center',
        }}
      >
        <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>
          아직 등록된 루트 에셋이 없어요
        </p>
        <Link
          href={`/project/${projectId}/root-assets`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '5px 12px', borderRadius: 'var(--r-sm)',
            fontSize: 11, fontWeight: 500,
            background: 'var(--accent-soft)', color: 'var(--accent)',
            border: '1px solid var(--accent-line)',
          }}
        >
          <Plus size={11} />
          루트 에셋 등록
        </Link>
      </div>
    )
  }

  return (
    <div
      style={{
        marginBottom: 14, padding: 12,
        background: 'var(--bg-2)',
        border: `1px solid ${totalSelected > 0 ? 'var(--accent-line)' : 'var(--line)'}`,
        borderRadius: 'var(--r-md)',
      }}
    >
      {/* 헤더 — 선택 개수 + 일괄 액션 */}
      <div className="flex items-center" style={{ marginBottom: 10, gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
          {totalSelected > 0 ? `${totalSelected}개 선택됨` : '카테고리별로 선택하세요'}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={selectAllScene}
          title="이 씬에 마킹된 default 일괄 적용"
          style={{
            padding: '3px 8px',
            fontSize: 10,
            color: 'var(--accent-2)',
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent-line)',
            borderRadius: 'var(--r-sm)',
          }}
        >
          씬 default
        </button>
        <button
          onClick={clearAll}
          disabled={totalSelected === 0}
          style={{
            padding: '3px 8px',
            fontSize: 10,
            color: 'var(--ink-3)',
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
            opacity: totalSelected === 0 ? 0.4 : 1,
          }}
        >
          전체 해제
        </button>
      </div>

      <div className="flex flex-col" style={{ gap: 12 }}>
        {cats.map(c => {
          const seeds = byCat.get(c.key) ?? []
          if (seeds.length === 0) return null
          const sceneDefaults = new Set<string>(sceneDefaultRootIds[c.key] ?? [])
          const sel = selection[c.key]
          return (
            <div key={c.key}>
              <div className="flex items-center" style={{ gap: 6, marginBottom: 6 }}>
                <span
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 7px',
                    borderRadius: 'var(--r-sm)',
                    background: c.color, color: '#fff',
                  }}
                >
                  {c.label}
                </span>
                <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                  {sel.size > 0 ? `${sel.size}/${seeds.reduce((n, s) => n + (s.reference_image_urls?.length ?? 0), 0)}` : `${seeds.reduce((n, s) => n + (s.reference_image_urls?.length ?? 0), 0)}장`}
                </span>
              </div>
              <div className="flex flex-col" style={{ gap: 8 }}>
                {seeds.map(seed => (
                  <div key={seed.id}>
                    <div style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 3 }}>
                      {seed.name}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))', gap: 4 }}>
                      {(seed.reference_image_urls ?? []).map((url, i) => {
                        const picked = sel.has(url)
                        const isDefault = sceneDefaults.has(url)
                        return (
                          <button
                            key={i}
                            onClick={() => toggle(c.key, url)}
                            title={isDefault ? '씬 default · 클릭으로 토글' : '클릭으로 선택'}
                            style={{
                              position: 'relative',
                              width: '100%', aspectRatio: '1',
                              padding: 0, overflow: 'hidden',
                              borderRadius: 'var(--r-sm)',
                              border: `2px solid ${picked ? 'var(--accent)' : isDefault ? 'var(--accent-line)' : 'var(--line)'}`,
                              cursor: 'pointer',
                              background: 'var(--bg-3)',
                            }}
                          >
                            <img
                              src={url}
                              alt=""
                              style={{
                                width: '100%', height: '100%', objectFit: 'cover',
                                opacity: picked ? 1 : 0.65,
                                transition: 'opacity 0.12s',
                              }}
                            />
                            {picked && (
                              <div
                                style={{
                                  position: 'absolute', top: 2, right: 2,
                                  width: 14, height: 14, borderRadius: '50%',
                                  background: 'var(--accent)',
                                  display: 'grid', placeItems: 'center',
                                }}
                              >
                                <Check size={9} style={{ color: '#fff' }} />
                              </div>
                            )}
                            {isDefault && !picked && (
                              <div
                                style={{
                                  position: 'absolute', bottom: 2, left: 2,
                                  fontSize: 8, fontWeight: 600,
                                  padding: '0 4px', borderRadius: 2,
                                  background: 'rgba(255,255,255,0.85)',
                                  color: 'var(--accent-2)',
                                }}
                              >
                                default
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


// ─── 씬 컨텍스트 패널 (씬 경계 편집 텍스트 + 4요소 마크 인라인 편집) ───
function SceneContextPanel({ scene }: { scene: Scene }) {
  const supabase = createClient()
  const [textOpen, setTextOpen] = useState(true)
  const initialMarks = (scene as any).root_asset_marks ?? {}
  const [marks, setMarks] = useState<{ character?: string; space?: string; object?: string; misc?: string }>({
    character: initialMarks.character ?? '',
    space:     initialMarks.space     ?? '',
    object:    initialMarks.object    ?? '',
    misc:      initialMarks.misc      ?? '',
  })
  const [editingKey, setEditingKey] = useState<null | 'character' | 'space' | 'object' | 'misc'>(null)
  const [draftValue, setDraftValue] = useState('')
  const [saving, setSaving] = useState(false)

  // 씬이 바뀌면 marks 초기화
  useEffect(() => {
    const m = (scene as any).root_asset_marks ?? {}
    setMarks({
      character: m.character ?? '',
      space:     m.space     ?? '',
      object:    m.object    ?? '',
      misc:      m.misc      ?? '',
    })
    setEditingKey(null)
  }, [scene.id])

  async function persistMarks(next: typeof marks) {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('scenes')
        .update({ root_asset_marks: next })
        .eq('id', scene.id)
      if (error) throw error
    } catch (e) {
      console.error('[scene-context] root_asset_marks 저장 실패:', e)
    } finally {
      setSaving(false)
    }
  }

  function startEdit(key: 'character' | 'space' | 'object' | 'misc') {
    setEditingKey(key)
    setDraftValue(marks[key] ?? '')
  }

  async function commitEdit() {
    if (!editingKey) return
    const next = { ...marks, [editingKey]: draftValue.trim() }
    setMarks(next)
    setEditingKey(null)
    await persistMarks(next)
  }

  async function clearMark(key: 'character' | 'space' | 'object' | 'misc') {
    const next = { ...marks, [key]: '' }
    setMarks(next)
    await persistMarks(next)
  }

  const ROWS: { key: 'character' | 'space' | 'object' | 'misc'; label: string; color: string; placeholder: string }[] = [
    { key: 'character', label: '인물',   color: 'var(--accent)', placeholder: '예: 진오, 수연' },
    { key: 'space',     label: '공간',   color: 'var(--info)',   placeholder: '예: 안방, 식탁 앞' },
    { key: 'object',    label: '오브제', color: 'var(--violet)', placeholder: '예: 알람 시계, 이불' },
    { key: 'misc',      label: '기타',   color: 'var(--ink-3)',  placeholder: '예: 새벽 분위기' },
  ]

  return (
    <div
      style={{
        marginBottom: 14,
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
      }}
    >
      {/* 씬 경계 편집 텍스트 (collapsible) */}
      <button
        onClick={() => setTextOpen(o => !o)}
        className="w-full flex items-center"
        style={{
          padding: '8px 12px', gap: 6,
          fontSize: 11, fontWeight: 600,
          color: 'var(--ink-2)',
          background: 'var(--bg-3)',
          borderBottom: textOpen ? '1px solid var(--line)' : 'none',
          textAlign: 'left',
        }}
      >
        {textOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <FileText size={12} style={{ color: 'var(--ink-3)' }} />
        <span>씬 #{scene.scene_number} {scene.title ? `· ${scene.title}` : ''}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 400 }}>씬 경계 편집 원문</span>
      </button>
      {textOpen && (
        <div
          style={{
            padding: '10px 12px',
            fontSize: 12, lineHeight: 1.65,
            color: 'var(--ink-2)',
            whiteSpace: 'pre-wrap',
            maxHeight: 180,
            overflowY: 'auto',
            borderBottom: '1px solid var(--line)',
          }}
        >
          {scene.content?.trim() ? scene.content : (
            <span style={{ color: 'var(--ink-5)', fontStyle: 'italic' }}>
              (씬 본문이 비어 있어요. 씬 경계 편집에서 채워주세요)
            </span>
          )}
        </div>
      )}

      {/* 4요소 마크 — 인라인 편집/삭제 */}
      <div style={{ padding: '8px 10px' }}>
        <div className="flex items-center" style={{ gap: 6, marginBottom: 6 }}>
          <Sparkles size={11} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)' }}>4요소 마크</span>
          {saving && <Loader2 size={10} className="animate-spin" style={{ color: 'var(--ink-4)' }} />}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--ink-5)' }}>씬 경계 편집과 동기화</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {ROWS.map(row => {
            const value = marks[row.key] ?? ''
            const isEditing = editingKey === row.key
            return (
              <div
                key={row.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 8px',
                  background: 'var(--bg)',
                  border: `1px solid ${isEditing ? row.color : 'var(--line)'}`,
                  borderRadius: 'var(--r-sm)',
                  minHeight: 30,
                }}
              >
                <span
                  style={{
                    fontSize: 10, fontWeight: 700,
                    color: row.color,
                    minWidth: 36, flexShrink: 0,
                  }}
                >
                  {row.label}
                </span>
                {isEditing ? (
                  <>
                    <input
                      autoFocus
                      value={draftValue}
                      onChange={e => setDraftValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); void commitEdit() }
                        if (e.key === 'Escape') { e.preventDefault(); setEditingKey(null) }
                      }}
                      placeholder={row.placeholder}
                      style={{
                        flex: 1, minWidth: 0,
                        background: 'transparent', border: 'none', outline: 'none',
                        fontSize: 12, color: 'var(--ink)',
                      }}
                    />
                    <button
                      onClick={() => void commitEdit()}
                      title="저장 (Enter)"
                      style={{ padding: 2, color: row.color, flexShrink: 0 }}
                    >
                      <Save size={11} />
                    </button>
                    <button
                      onClick={() => setEditingKey(null)}
                      title="취소 (Esc)"
                      style={{ padding: 2, color: 'var(--ink-4)', flexShrink: 0 }}
                    >
                      <X size={11} />
                    </button>
                  </>
                ) : (
                  <>
                    <span
                      style={{
                        flex: 1, minWidth: 0,
                        fontSize: 12, color: value ? 'var(--ink)' : 'var(--ink-5)',
                        fontStyle: value ? 'normal' : 'italic',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                      title={value || '(비어 있음)'}
                    >
                      {value || '(비어 있음)'}
                    </span>
                    <button
                      onClick={() => startEdit(row.key)}
                      title="편집"
                      style={{ padding: 2, color: 'var(--ink-4)', flexShrink: 0 }}
                    >
                      <Edit2 size={10} />
                    </button>
                    {value && (
                      <button
                        onClick={() => void clearMark(row.key)}
                        title="삭제"
                        style={{ padding: 2, color: 'var(--danger)', flexShrink: 0 }}
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
