'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import {
  Loader2, Film, ChevronRight, ChevronDown, X, Plus, RotateCcw,
  Tag, Type, Hash, Layers,
} from 'lucide-react'

// ── 씬 헤더 감지 패턴 ──────────────────────────────────────────
// Detects: #1, #1-1, #1-1-1, 씬1, Scene 1, INT., EXT.
const SCENE_HEADER_RE = /^#\d[\d\-]*|^(?:씬|scene|s)[\s\-.]?\d+|^(?:INT|EXT|내부|외부)[.\s]/i

// ── 씬 번호 자동 추출 (대본 파싱) ─────────────────────────────
function extractSceneNumber(content: string): string | undefined {
  const firstLine = content.split('\n')[0]?.trim() ?? ''
  const m = firstLine.match(/^#(\d[\d\-]*)/)
  if (m) return m[1]
  const m2 = firstLine.match(/(?:씬|scene|s)[\s\-.]?(\d+(?:-\d+)*)/i)
  if (m2) return m2[1]
  return undefined
}

// ── 씬 라벨 프리셋 ────────────────────────────────────────────
const LABEL_PRESETS = [
  { key: 'opening',    label: '오프닝',   color: 'var(--accent)' },
  { key: 'daily',      label: '일상',     color: 'var(--ok)' },
  { key: 'tension',    label: '긴장',     color: 'var(--warn)' },
  { key: 'conflict',   label: '갈등',     color: '#ef4444' },
  { key: 'turning',    label: '전환',     color: '#8b5cf6' },
  { key: 'climax',     label: '절정',     color: '#ec4899' },
  { key: 'resolution', label: '결말',     color: '#14b8a6' },
  { key: 'epilogue',   label: '에필로그', color: '#64748b' },
]

// ── 씬별 색상 팔레트 ──────────────────────────────────────────
const PALETTE = [
  { accent: 'var(--accent)', bg: 'var(--accent-soft)',  border: 'var(--accent-soft)' },
  { accent: 'var(--pink)', bg: 'rgba(236,72,153,0.06)',  border: 'rgba(236,72,153,0.18)' },
  { accent: 'var(--ok)', bg: 'rgba(52,211,153,0.06)',  border: 'rgba(52,211,153,0.18)' },
  { accent: 'var(--warn)', bg: 'var(--warn-soft)',  border: 'var(--warn-soft)' },
  { accent: '#38bdf8', bg: 'rgba(14,165,233,0.06)',  border: 'rgba(14,165,233,0.18)' },
  { accent: '#c084fc', bg: 'rgba(168,85,247,0.06)',  border: 'rgba(168,85,247,0.18)' },
]

let _uid = 0
const uid = () => `sc_${++_uid}`

interface Scene {
  id: string
  content: string
  sceneNumber?: string   // e.g. "1", "1-2", "1-2-3"
  label?: string         // preset key
  labelMode?: 'toggle' | 'text'
  customLabel?: string
  rootAssetMarks?: {
    character: string
    space: string
    object: string
    misc: string
  }
}

// ── localStorage 헬퍼 ─────────────────────────────────────────
const lsKey         = (id: string) => `scene-editor-${id}`
const lsCollapseKey = (id: string) => `scene-editor-collapse-${id}`

function saveToLocal(projectId: string, scenes: Scene[]) {
  try { localStorage.setItem(lsKey(projectId), JSON.stringify(scenes)) } catch {}
}

function loadFromLocal(projectId: string): Scene[] | null {
  try {
    const raw = localStorage.getItem(lsKey(projectId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return null
    return parsed.map((s: any) => ({
      id: uid(),
      content: String(s.content ?? ''),
      sceneNumber: s.sceneNumber,
      label: s.label,
      labelMode: s.labelMode,
      customLabel: s.customLabel,
    }))
  } catch { return null }
}

function clearLocal(projectId: string) {
  try { localStorage.removeItem(lsKey(projectId)) } catch {}
}

function saveCollapse(projectId: string, seqs: Set<string>, groups: Set<string>) {
  try {
    localStorage.setItem(lsCollapseKey(projectId), JSON.stringify({
      seqs: Array.from(seqs),
      groups: Array.from(groups),
    }))
  } catch {}
}

function loadCollapse(projectId: string): { seqs: Set<string>; groups: Set<string> } {
  try {
    const raw = localStorage.getItem(lsCollapseKey(projectId))
    if (!raw) return { seqs: new Set(), groups: new Set() }
    const { seqs, groups } = JSON.parse(raw)
    return { seqs: new Set(Array.isArray(seqs) ? seqs : []), groups: new Set(Array.isArray(groups) ? groups : []) }
  } catch {
    return { seqs: new Set(), groups: new Set() }
  }
}

// ── auto-resize textarea ──────────────────────────────────────
function fitHeight(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// ── 씬 라벨 표시 텍스트 ──────────────────────────────────────
function getDisplayLabel(scene: Scene): string {
  if (scene.labelMode === 'text' && scene.customLabel) return scene.customLabel
  if (scene.label) {
    const preset = LABEL_PRESETS.find(p => p.key === scene.label)
    if (preset) return preset.label
  }
  return ''
}

// ── 씬 번호 인라인 입력 ──────────────────────────────────────

function SceneNumberInput({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && /^\d+(-\d+)*$/.test(trimmed)) {
      onChange(trimmed)
    } else if (!trimmed) {
      onChange(undefined)
    } else {
      setDraft(value ?? '')
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
        }}
        placeholder="1-2-3"
        className="w-20 px-2 py-1 rounded text-xs outline-none"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--accent)',
          color: 'var(--accent)',
          fontFamily: 'monospace',
        }}
        autoFocus
      />
    )
  }

  return (
    <button
      onClick={() => { setDraft(value ?? ''); setEditing(true) }}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-all hover:opacity-80"
      style={{
        background: value ? 'var(--accent-soft)' : 'var(--surface-2)',
        border: `1px solid ${value ? 'var(--accent-soft)' : 'var(--border)'}`,
        color: value ? 'var(--accent)' : 'var(--text-muted)',
        fontFamily: 'monospace',
      }}
      title="씬 번호 편집 (예: 1-2-3)"
    >
      <Hash size={9} />
      <span>{value ?? '번호'}</span>
    </button>
  )
}

// ── 루트 에셋 마크 에디터 ────────────────────────────────────

function RootAssetMarksEditor({
  scene,
  onUpdate,
}: {
  scene: Scene
  onUpdate: (id: string, updates: Partial<Scene>) => void
}) {
  const [open, setOpen] = useState(false)
  const marks = scene.rootAssetMarks ?? { character: '', space: '', object: '', misc: '' }
  const categories = [
    { key: 'character' as const, label: '인물' },
    { key: 'space' as const, label: '공간' },
    { key: 'object' as const, label: '오브제' },
    { key: 'misc' as const, label: '기타' },
  ]

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-all hover:opacity-80"
        style={{
          background: Object.values(marks).some(v => v.trim()) ? 'var(--ok-soft)' : 'var(--surface-2)',
          border: `1px solid ${Object.values(marks).some(v => v.trim()) ? 'var(--ok-soft)' : 'var(--border)'}`,
          color: Object.values(marks).some(v => v.trim()) ? 'var(--ok)' : 'var(--text-muted)',
        }}
        title="루트 에셋 마크 편집"
      >
        <Type size={9} />
        <span>에셋 마크</span>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-20 rounded-lg shadow-xl min-w-[280px] overflow-hidden"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="p-3 space-y-2">
            {categories.map(cat => (
              <div key={cat.key}>
                <label className="text-[10px] font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>
                  {cat.label}
                </label>
                <input
                  type="text"
                  value={marks[cat.key]}
                  onChange={e => onUpdate(scene.id, {
                    rootAssetMarks: { ...marks, [cat.key]: e.target.value }
                  })}
                  placeholder={`${cat.label} 입력...`}
                  className="w-full px-2 py-1 rounded text-xs outline-none"
                  style={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 씬 라벨 에디터 ───────────────────────────────────────────

function LabelEditor({
  scene,
  onUpdate,
}: {
  scene: Scene
  onUpdate: (id: string, updates: Partial<Scene>) => void
}) {
  const [mode, setMode] = useState<'toggle' | 'text'>(scene.labelMode ?? 'toggle')
  const [open, setOpen] = useState(false)
  const displayLabel = getDisplayLabel(scene)
  const selectedPreset = LABEL_PRESETS.find(p => p.key === scene.label)
  const labelColor = selectedPreset ? selectedPreset.color : 'var(--text-muted)'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-all hover:opacity-80"
        style={{
          background: displayLabel ? `${labelColor}15` : 'var(--surface-2)',
          border: `1px solid ${displayLabel ? `${labelColor}40` : 'var(--border)'}`,
          color: displayLabel ? labelColor : 'var(--text-muted)',
        }}
        title="씬 라벨 편집"
      >
        <Tag size={9} />
        <span>{displayLabel || '라벨'}</span>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-20 rounded-lg shadow-xl min-w-[220px] overflow-hidden"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          {/* 모드 탭 */}
          <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
            {(['toggle', 'text'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); onUpdate(scene.id, { labelMode: m }) }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] transition-all"
                style={{
                  color: mode === m ? 'var(--accent)' : 'var(--text-muted)',
                  background: mode === m ? 'var(--accent-subtle)' : 'transparent',
                  borderBottom: mode === m ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                {m === 'toggle' ? <><Tag size={10} /> 프리셋</> : <><Type size={10} /> 직접입력</>}
              </button>
            ))}
          </div>

          {/* 프리셋 그리드 */}
          {mode === 'toggle' && (
            <div className="p-2 grid grid-cols-4 gap-1">
              {LABEL_PRESETS.map(preset => {
                const isSelected = scene.label === preset.key
                return (
                  <button
                    key={preset.key}
                    onClick={() => { onUpdate(scene.id, { label: preset.key, labelMode: 'toggle' }); setOpen(false) }}
                    className="px-1.5 py-1.5 rounded text-[10px] font-medium text-center transition-all"
                    style={{
                      background: isSelected ? `${preset.color}20` : 'var(--surface-2)',
                      color: isSelected ? preset.color : 'var(--text-secondary)',
                      border: `1px solid ${isSelected ? `${preset.color}50` : 'var(--border)'}`,
                    }}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
          )}

          {/* 직접 입력 */}
          {mode === 'text' && (
            <div className="p-2">
              <input
                type="text"
                value={scene.customLabel ?? ''}
                onChange={e => onUpdate(scene.id, { customLabel: e.target.value, labelMode: 'text' })}
                onKeyDown={e => { if (e.key === 'Enter') setOpen(false) }}
                placeholder="라벨 직접 입력..."
                className="w-full px-3 py-2 rounded text-xs outline-none"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                }}
                autoFocus
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export default function SceneEditorPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const supabase = createClient()

  const [scenes, setScenes]                 = useState<Scene[]>([])
  const [scriptId, setScriptId]             = useState<string | null>(null)
  const [loading, setLoading]               = useState(true)
  const [classifying, setClassifying]       = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [savedIndicator, setSavedIndicator] = useState(false)
  const [extracting, setExtracting]         = useState(false)

  // Tree collapse state (persisted to localStorage)
  const [collapsedSeqs, setCollapsedSeqs]     = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const refs          = useRef<Map<string, HTMLTextAreaElement>>(new Map())
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load collapse state on mount
  useEffect(() => {
    const { seqs, groups } = loadCollapse(projectId)
    setCollapsedSeqs(seqs)
    setCollapsedGroups(groups)
  }, [projectId])

  // Persist collapse state on change
  useEffect(() => {
    if (!loading) saveCollapse(projectId, collapsedSeqs, collapsedGroups)
  }, [collapsedSeqs, collapsedGroups, loading, projectId])

  function toggleSeq(key: string) {
    setCollapsedSeqs(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ── 초기 로드 ──────────────────────────────────────────────
  useEffect(() => {
    const cached = loadFromLocal(projectId)
    if (cached) {
      setScenes(cached)
      setLoading(false)
      supabase.from('scripts').select('id').eq('project_id', projectId).single()
        .then(({ data }) => { if (data) setScriptId(data.id) })
      return
    }

    supabase.from('scripts').select('id, content').eq('project_id', projectId).single()
      .then(({ data }) => {
        if (!data?.content) {
          setError('저장된 대본이 없습니다. 대본 페이지에서 먼저 저장해주세요.')
          setLoading(false)
          return
        }
        setScriptId(data.id)
        const lines = data.content.split('\n')
        const breakAt = [0]
        lines.forEach((line: string, i: number) => {
          if (i > 0 && SCENE_HEADER_RE.test(line.trim())) breakAt.push(i)
        })
        const initial: Scene[] = breakAt.map((start, i) => {
          const content = lines.slice(start, breakAt[i + 1] ?? lines.length).join('\n').trimEnd()
          return { id: uid(), content, sceneNumber: extractSceneNumber(content) }
        })
        const result = initial.length ? initial : [{ id: uid(), content: data.content }]
        setScenes(result)
        saveToLocal(projectId, result)
        setLoading(false)
      })
  }, [projectId])

  useEffect(() => { refs.current.forEach(fitHeight) }, [scenes])

  // 자동저장
  useEffect(() => {
    if (loading || !scenes.length) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      saveToLocal(projectId, scenes)
      setSavedIndicator(true)
      setTimeout(() => setSavedIndicator(false), 1200)
    }, 300)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [scenes, loading, projectId])

  const updateContent = useCallback((id: string, val: string) => {
    setScenes(prev => prev.map(s => s.id === id ? { ...s, content: val } : s))
  }, [])

  const updateScene = useCallback((id: string, updates: Partial<Scene>) => {
    setScenes(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
  }, [])

  const splitAt = useCallback((id: string) => {
    const el = refs.current.get(id)
    if (!el) return
    const pos = el.selectionStart
    setScenes(prev => {
      const idx = prev.findIndex(s => s.id === id)
      if (idx < 0) return prev
      const before = prev[idx].content.slice(0, pos).trimEnd()
      const after  = prev[idx].content.slice(pos).replace(/^\n+/, '')
      const newId  = uid()
      const next   = [...prev]
      next.splice(idx, 1,
        { ...prev[idx], content: before },
        { id: newId, content: after, sceneNumber: extractSceneNumber(after) },
      )
      setTimeout(() => {
        const target = refs.current.get(newId)
        if (target) { target.focus(); target.setSelectionRange(0, 0) }
      }, 30)
      return next
    })
  }, [])

  const mergeUp = useCallback((idx: number) => {
    if (idx === 0) return
    setScenes(prev => {
      const next = [...prev]
      const a = next[idx - 1]
      const b = next[idx]
      const combined = a.content + (a.content.endsWith('\n') ? '' : '\n') + b.content
      next.splice(idx - 1, 2, {
        id: a.id, content: combined,
        sceneNumber: a.sceneNumber, label: a.label,
        labelMode: a.labelMode, customLabel: a.customLabel,
      })
      setTimeout(() => {
        const el = refs.current.get(a.id)
        if (el) { el.focus(); const p = a.content.length + 1; el.setSelectionRange(p, p); fitHeight(el) }
      }, 30)
      return next
    })
  }, [])

  const addScene = useCallback(() => {
    const newId = uid()
    setScenes(prev => [...prev, { id: newId, content: '' }])
    setTimeout(() => refs.current.get(newId)?.focus(), 30)
  }, [])

  async function resetFromScript() {
    clearLocal(projectId)
    setLoading(true)
    const { data } = await supabase.from('scripts').select('id, content').eq('project_id', projectId).single()
    if (!data?.content) { setLoading(false); return }
    setScriptId(data.id)
    const lines = data.content.split('\n')
    const breakAt = [0]
    lines.forEach((line: string, i: number) => {
      if (i > 0 && SCENE_HEADER_RE.test(line.trim())) breakAt.push(i)
    })
    const initial: Scene[] = breakAt.map((start, i) => {
      const content = lines.slice(start, breakAt[i + 1] ?? lines.length).join('\n').trimEnd()
      return { id: uid(), content, sceneNumber: extractSceneNumber(content) }
    })
    const result = initial.length ? initial : [{ id: uid(), content: data.content }]
    setScenes(result)
    saveToLocal(projectId, result)
    setLoading(false)
  }

  async function extractRootAssetMarks() {
    if (!scenes.length) return
    setExtracting(true)
    setError(null)
    try {
      const res = await fetch('/api/scene-editor/extract-marks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenes: scenes.map(s => ({ id: s.id, content: s.content })), projectId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      // Update local scenes with extracted marks
      if (data.results) {
        setScenes(prev => prev.map(scene => {
          const result = data.results.find((r: any) => r.sceneId === scene.id)
          if (result?.marks) {
            return { ...scene, rootAssetMarks: result.marks }
          }
          return scene
        }))
      }
    } catch (e) {
      setError(`에셋 마크 추출 실패: ${String(e)}`)
    } finally {
      setExtracting(false)
    }
  }

  async function confirmAndClassify() {
    if (!scriptId || !scenes.length) return
    setClassifying(true)
    setError(null)
    const manualScenes = scenes.map(s => s.content.trim()).filter(Boolean)
    try {
      const res = await fetch('/api/scenes/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId, projectId, manualScenes }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      window.location.href = `/project/${projectId}/scenes`
    } catch (e) {
      setError(`씬 생성 실패: ${String(e)}`)
      setClassifying(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="animate-spin" size={22} style={{ color: 'var(--text-muted)' }} />
    </div>
  )

  // ── 트리 렌더링 ─────────────────────────────────────────────
  const elements: React.ReactNode[] = []
  let lastSeqKey   = ''
  let lastGroupKey = ''
  let seqColorIdx  = -1
  const seqColorMap = new Map<string, number>()

  scenes.forEach((scene, idx) => {
    const num    = scene.sceneNumber
    const parts  = num ? num.split('-') : []
    const seqKey = parts[0] ?? ''
    // groupKey only exists when there are 3 levels (e.g., "1-2" for scene "1-2-3")
    const groupKey = parts.length >= 3 ? `${parts[0]}-${parts[1]}` : ''

    // Assign a stable color per sequence
    if (seqKey && !seqColorMap.has(seqKey)) {
      seqColorIdx = (seqColorIdx + 1) % PALETTE.length
      seqColorMap.set(seqKey, seqColorIdx)
    }
    const colorIdx = seqKey ? (seqColorMap.get(seqKey) ?? 0) : idx % PALETTE.length
    const c = PALETTE[colorIdx]

    // ── 시퀀스 헤더 (새 시퀀스 진입 시) ──────────────────────
    if (seqKey && seqKey !== lastSeqKey) {
      const isCollapsed = collapsedSeqs.has(seqKey)
      const seqCount = scenes.filter(s => (s.sceneNumber?.split('-')[0] ?? '') === seqKey).length

      elements.push(
        <div key={`seq-${seqKey}`} className="mt-6 mb-2">
          <button
            onClick={() => toggleSeq(seqKey)}
            className="flex items-center gap-2 w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-80"
            style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.accent }}
          >
            {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            <Layers size={14} />
            <span>시퀀스 {seqKey}</span>
            <span className="ml-auto text-[11px] opacity-60 font-normal">
              {seqCount}컷{isCollapsed ? ' · 접힘' : ''}
            </span>
          </button>
        </div>
      )
      lastSeqKey = seqKey
      lastGroupKey = ''
    }

    // 시퀀스 접힌 경우 하위 모두 숨김
    if (seqKey && collapsedSeqs.has(seqKey)) return

    // ── 씬 그룹 헤더 (3단계일 때, 새 그룹 진입 시) ───────────
    if (groupKey && groupKey !== lastGroupKey) {
      const isCollapsed = collapsedGroups.has(groupKey)
      const groupCuts = scenes.filter(s => {
        const p = s.sceneNumber?.split('-') ?? []
        return p.length >= 3 && `${p[0]}-${p[1]}` === groupKey
      }).length

      elements.push(
        <div key={`grp-${groupKey}`} className="ml-5 mt-3 mb-1">
          <button
            onClick={() => toggleGroup(groupKey)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
            style={{
              background: `${c.accent}10`,
              border: `1px solid ${c.accent}30`,
              color: c.accent,
            }}
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <span>씬 {groupKey}</span>
            <span className="opacity-60 ml-1">{groupCuts}컷</span>
          </button>
        </div>
      )
      lastGroupKey = groupKey
    }

    // 씬 그룹 접힌 경우 하위 숨김
    if (groupKey && collapsedGroups.has(groupKey)) return

    // ── 씬 블록 (컷) ────────────────────────────────────────
    const indent = seqKey ? (groupKey ? 'ml-10' : 'ml-5') : ''

    elements.push(
      <div key={scene.id} className={indent}>
        {/* 구분선 + 컨트롤 헤더 */}
        <div className="flex items-center gap-2 py-2.5">
          <div className="flex-1 border-t" style={{ borderColor: c.border }} />

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* 씬 번호 */}
            <SceneNumberInput
              value={scene.sceneNumber}
              onChange={v => updateScene(scene.id, { sceneNumber: v })}
            />

            {/* 라벨 (씬 번호와 별개) */}
            <LabelEditor scene={scene} onUpdate={updateScene} />

            {/* 루트 에셋 마크 */}
            <RootAssetMarksEditor scene={scene} onUpdate={updateScene} />

            {/* 합치기 */}
            {idx > 0 && (
              <button
                onClick={() => mergeUp(idx)}
                className="w-6 h-6 flex items-center justify-center rounded-full transition-all hover:opacity-60"
                style={{ background: c.bg, color: c.accent, border: `1px solid ${c.border}` }}
                title="위 씬과 합치기"
              >
                <X size={10} />
              </button>
            )}
          </div>

          <div className="flex-1 border-t" style={{ borderColor: c.border }} />
        </div>

        {/* 씬 텍스트 에디터 */}
        <textarea
          ref={el => {
            if (el) { refs.current.set(scene.id, el); fitHeight(el) }
            else refs.current.delete(scene.id)
          }}
          value={scene.content}
          onChange={e => { updateContent(scene.id, e.target.value); fitHeight(e.target) }}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault(); splitAt(scene.id); return
            }
            if (e.key === 'Backspace' && idx > 0) {
              const el = e.currentTarget
              if (el.selectionStart === 0 && el.selectionEnd === 0) {
                e.preventDefault(); mergeUp(idx)
              }
            }
          }}
          placeholder={scene.sceneNumber
            ? `씬 ${scene.sceneNumber} 내용...`
            : `씬 ${idx + 1} 내용을 입력하세요...`}
          className="w-full resize-none outline-none rounded-lg px-4 py-3.5 text-sm leading-7"
          style={{
            background: c.bg,
            border: `1px solid ${c.border}`,
            color: 'var(--text-primary)',
            fontFamily: "'Noto Serif KR', Georgia, serif",
            minHeight: '80px',
            overflow: 'hidden',
          }}
        />
      </div>
    )
  })

  return (
    <div className="h-full flex flex-col">

      {/* 헤더 */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>씬 경계 편집</h1>
          <p className="text-[13px] mt-1 flex items-center gap-2" style={{ color: 'var(--ink-3)' }}>
            {scenes.length}개 씬 &nbsp;·&nbsp;
            <span className="opacity-70">Cmd+Enter 나누기 / Backspace 합치기</span>
            {savedIndicator && <span style={{ color: 'var(--success)' }}>✓ 자동저장</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetFromScript}
            disabled={classifying || loading || extracting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm hover-surface transition-all disabled:opacity-40"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
          >
            <RotateCcw size={13} /> 초기화
          </button>
          <button
            onClick={extractRootAssetMarks}
            disabled={extracting || classifying || !scenes.length}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm hover-surface transition-all disabled:opacity-40"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            {extracting
              ? <><Loader2 size={13} className="animate-spin" /> 분석중...</>
              : <>📝 대본 자동 분석</>
            }
          </button>
          <button
            onClick={confirmAndClassify}
            disabled={classifying || !scenes.length || extracting}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-all hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            {classifying
              ? <><Loader2 size={14} className="animate-spin" /> 생성중...</>
              : <><Film size={14} /> 씬 {scenes.length}개 생성 <ChevronRight size={14} /></>
            }
          </button>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div
          className="mx-6 mt-3 px-4 py-3 rounded-lg text-xs flex items-center justify-between flex-shrink-0"
          style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
        >
          {error}
          <button onClick={() => setError(null)} className="ml-3 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* 편집 영역 */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 pb-20">

          {elements}

          {/* 씬 추가 버튼 */}
          <button
            onClick={addScene}
            className="mt-4 w-full py-3.5 rounded-lg text-sm flex items-center justify-center gap-2 transition-all hover-surface"
            style={{ border: '1px dashed var(--border)', color: 'var(--text-muted)' }}
          >
            <Plus size={14} /> 씬 추가
          </button>

        </div>
      </div>
    </div>
  )
}
