'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import {
  Loader2, Film, ChevronRight, ChevronDown, X, Plus, RotateCcw,
  Tag, Type, Hash, Layers, History, Wand2,
} from 'lucide-react'

// ── 씬 헤더 감지 패턴 ──────────────────────────────────────────
// Detects: #1, #1-1, #1-1-1, 씬1, Scene 1, INT., EXT.
const SCENE_HEADER_RE = /^#\d[\d\-]*|^(?:씬|scene|s)[\s\-.]?\d+|^(?:INT|EXT|내부|외부)[.\s]/i

// 대본이 HTML로 저장된 경우 plain text로 변환 (씬 경계 편집은 plain text 기반)
function htmlToPlain(html: string): string {
  if (!html) return ''
  if (!html.includes('<')) return html  // 이미 plain text면 그대로
  if (typeof document === 'undefined') {
    // SSR 폴백 — 단순 태그 제거
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|h[1-6]|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  ;(['p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'] as const).forEach(tag => {
    Array.from(tmp.getElementsByTagName(tag)).forEach((el: any) => {
      if (tag === 'br') el.replaceWith('\n')
      else el.appendChild(document.createTextNode('\n'))
    })
  })
  return (tmp.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}



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
  { accent: 'var(--pink)',   bg: 'var(--pink-soft)',   border: 'var(--pink-soft)' },
  { accent: 'var(--ok)',     bg: 'var(--ok-soft)',     border: 'var(--ok-soft)' },
  { accent: 'var(--warn)',   bg: 'var(--warn-soft)',   border: 'var(--warn-soft)' },
  { accent: 'var(--info)',   bg: 'var(--info-soft)',   border: 'var(--info-soft)' },
  { accent: 'var(--violet)', bg: 'var(--violet-soft)', border: 'var(--violet-soft)' },
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
  // 비주얼 세팅 — scene_settings 테이블의 angle/lens/lighting/mood 매핑
  visualSetting?: {
    angle?:    string  // eye-level / low-angle / high-angle / birds-eye / dutch-angle / overhead
    lens?:     string  // wide / standard / telephoto / fisheye / macro / anamorphic
    lighting?: string  // natural / golden / blue_hour / studio / dramatic / backlit / neon / candlelight
    mood?:     string  // 자유 텍스트 (e.g. "쓸쓸한", "긴장된")
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
      rootAssetMarks: s.rootAssetMarks,
      visualSetting: s.visualSetting,
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
          className="absolute top-full left-0 mt-1 z-20 overflow-hidden"
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-lg)',
            minWidth: 280,
          }}
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

// ── 비주얼 세팅 드롭다운 (각 씬 아래 inline) ──────────────
// 4요소(인물/공간/오브제/기타) + 카메라(앵글/렌즈/조명) + 무드
const ANGLE_OPTIONS = [
  { v: '', label: '자동' },
  { v: 'eye-level',  label: '아이레벨' },
  { v: 'low-angle',  label: '로우앵글' },
  { v: 'high-angle', label: '하이앵글' },
  { v: 'birds-eye',  label: '버즈아이' },
  { v: 'dutch-angle',label: '더치앵글' },
  { v: 'overhead',   label: '오버헤드' },
]
const LENS_OPTIONS = [
  { v: '', label: '자동' },
  { v: 'wide',       label: '광각 (24mm)' },
  { v: 'standard',   label: '표준 (50mm)' },
  { v: 'telephoto',  label: '망원 (135mm)' },
  { v: 'macro',      label: '마크로' },
  { v: 'fisheye',    label: '어안' },
  { v: 'anamorphic', label: '아나모픽' },
]
const LIGHTING_OPTIONS = [
  { v: '', label: '자동' },
  { v: 'natural',    label: '자연광' },
  { v: 'golden',     label: '골든아워' },
  { v: 'blue_hour',  label: '블루아워' },
  { v: 'studio',     label: '스튜디오' },
  { v: 'dramatic',   label: '드라마틱' },
  { v: 'backlit',    label: '역광' },
  { v: 'neon',       label: '네온' },
  { v: 'candlelight',label: '촛불' },
]

function VisualSettingsPanel({
  scene, onUpdate,
}: {
  scene: Scene
  onUpdate: (id: string, updates: Partial<Scene>) => void
}) {
  const marks = scene.rootAssetMarks ?? { character: '', space: '', object: '', misc: '' }
  const visual = scene.visualSetting ?? {}
  const marksFilled = (Object.values(marks) as string[]).filter(v => v && v.trim()).length
  const visualFilled = (Object.values(visual) as (string | undefined)[]).filter(v => v && v.trim()).length
  const filled = marksFilled + visualFilled
  const [open, setOpen] = useState(filled > 0)
  const fields = [
    { key: 'character' as const, label: '캐릭터', emoji: '🧑', color: 'var(--accent)' },
    { key: 'space'     as const, label: '공간',   emoji: '🏞', color: 'var(--info)' },
    { key: 'object'    as const, label: '오브제', emoji: '📦', color: 'var(--violet)' },
    { key: 'misc'      as const, label: '기타',   emoji: '✨', color: 'var(--ink-3)' },
  ]
  return (
    <div
      style={{
        marginTop: 6,
        background: 'var(--bg-1)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center text-left"
        style={{
          padding: '8px 12px',
          gap: 8,
          background: open ? 'var(--bg-2)' : 'transparent',
          fontSize: 11, color: 'var(--ink-3)',
          borderBottom: open ? '1px solid var(--line)' : '0',
        }}
      >
        <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          비주얼 세팅
        </span>
        <span style={{ flex: 1 }} />
        {!open && filled > 0 && (
          <span className="flex items-center" style={{ gap: 4 }}>
            {fields.filter(f => marks[f.key]?.trim()).map(f => (
              <span
                key={f.key}
                style={{
                  padding: '1px 7px', borderRadius: 999,
                  fontSize: 10, color: '#fff', background: f.color,
                }}
              >
                {f.label}: {marks[f.key].trim().slice(0, 12)}{marks[f.key].trim().length > 12 ? '…' : ''}
              </span>
            ))}
          </span>
        )}
        {!open && filled === 0 && (
          <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>
            비어있음 — 4요소(자동분석 가능) + 카메라·무드(직접 설정) · 마스터 프롬프트에 자동 반영
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{open ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '10px 12px' }}>
          {/* 1) 4요소 */}
          <div
            style={{
              fontSize: 9, fontWeight: 700, color: 'var(--ink-4)',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            4요소
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
            {fields.map(f => (
              <div key={f.key}>
                <label
                  className="flex items-center"
                  style={{
                    gap: 4, marginBottom: 4,
                    fontSize: 10, fontWeight: 600, color: f.color,
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                  }}
                >
                  <span>{f.emoji}</span> {f.label}
                </label>
                <input
                  type="text"
                  value={marks[f.key]}
                  onChange={e => onUpdate(scene.id, {
                    rootAssetMarks: { ...marks, [f.key]: e.target.value },
                  })}
                  placeholder={`${f.label} (예: ${
                    f.key === 'character' ? '진오, 미정' :
                    f.key === 'space' ? '카페, 거실' :
                    f.key === 'object' ? '책상, 자전거' :
                    '비, 알람시계'
                  })`}
                  style={{
                    width: '100%',
                    padding: '5px 8px',
                    background: 'var(--bg-2)',
                    border: `1px solid ${marks[f.key]?.trim() ? f.color : 'var(--line)'}`,
                    borderRadius: 'var(--r-sm)',
                    fontSize: 12, color: 'var(--ink)',
                    outline: 'none',
                  }}
                />
              </div>
            ))}
          </div>

          {/* 2) 카메라 + 무드 */}
          <div
            style={{
              fontSize: 9, fontWeight: 700, color: 'var(--ink-4)',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            카메라 / 무드
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <div>
              <label className="flex items-center" style={{ gap: 4, marginBottom: 4, fontSize: 10, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase' }}>
                📷 앵글
              </label>
              <select
                value={visual.angle ?? ''}
                onChange={e => onUpdate(scene.id, {
                  visualSetting: { ...visual, angle: e.target.value || undefined },
                })}
                style={{
                  width: '100%', padding: '5px 8px',
                  background: 'var(--bg-2)',
                  border: `1px solid ${visual.angle ? 'var(--accent)' : 'var(--line)'}`,
                  borderRadius: 'var(--r-sm)',
                  fontSize: 12, color: 'var(--ink)', outline: 'none',
                }}
              >
                {ANGLE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center" style={{ gap: 4, marginBottom: 4, fontSize: 10, fontWeight: 600, color: 'var(--info)', textTransform: 'uppercase' }}>
                🔍 렌즈
              </label>
              <select
                value={visual.lens ?? ''}
                onChange={e => onUpdate(scene.id, {
                  visualSetting: { ...visual, lens: e.target.value || undefined },
                })}
                style={{
                  width: '100%', padding: '5px 8px',
                  background: 'var(--bg-2)',
                  border: `1px solid ${visual.lens ? 'var(--info)' : 'var(--line)'}`,
                  borderRadius: 'var(--r-sm)',
                  fontSize: 12, color: 'var(--ink)', outline: 'none',
                }}
              >
                {LENS_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center" style={{ gap: 4, marginBottom: 4, fontSize: 10, fontWeight: 600, color: 'var(--warn)', textTransform: 'uppercase' }}>
                💡 조명
              </label>
              <select
                value={visual.lighting ?? ''}
                onChange={e => onUpdate(scene.id, {
                  visualSetting: { ...visual, lighting: e.target.value || undefined },
                })}
                style={{
                  width: '100%', padding: '5px 8px',
                  background: 'var(--bg-2)',
                  border: `1px solid ${visual.lighting ? 'var(--warn)' : 'var(--line)'}`,
                  borderRadius: 'var(--r-sm)',
                  fontSize: 12, color: 'var(--ink)', outline: 'none',
                }}
              >
                {LIGHTING_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="flex items-center" style={{ gap: 4, marginBottom: 4, fontSize: 10, fontWeight: 600, color: 'var(--violet)', textTransform: 'uppercase' }}>
                🎭 무드
              </label>
              <input
                type="text"
                value={visual.mood ?? ''}
                onChange={e => onUpdate(scene.id, {
                  visualSetting: { ...visual, mood: e.target.value },
                })}
                placeholder="예: 쓸쓸한, 긴장된, 따뜻한"
                style={{
                  width: '100%', padding: '5px 8px',
                  background: 'var(--bg-2)',
                  border: `1px solid ${visual.mood?.trim() ? 'var(--violet)' : 'var(--line)'}`,
                  borderRadius: 'var(--r-sm)',
                  fontSize: 12, color: 'var(--ink)', outline: 'none',
                }}
              />
            </div>
          </div>

          <p style={{ marginTop: 10, fontSize: 10, color: 'var(--ink-4)', lineHeight: 1.5 }}>
            💡 이 비주얼 세팅은 씬 분류에서 마스터 프롬프트 만들 때 자동으로 반영됩니다.
          </p>
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
          className="absolute top-full left-0 mt-1 z-20 overflow-hidden"
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-lg)',
            minWidth: 220,
          }}
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
  const router = useRouter()
  const supabase = createClient()

  const [scenes, setScenes]                 = useState<Scene[]>([])
  const [scriptId, setScriptId]             = useState<string | null>(null)
  const [loading, setLoading]               = useState(true)
  const [classifying, setClassifying]       = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [savedIndicator, setSavedIndicator] = useState(false)
  const [extracting, setExtracting]         = useState(false)
  const [scriptizingSceneId, setScriptizingSceneId] = useState<string | null>(null)
  const [scriptizeError, setScriptizeError] = useState<string | null>(null)

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

  // ── Seedance 프롬프트화 — 선택구간 또는 씬 전체 → 영문 프롬프트 + 자산 매핑 ──
  async function runScriptize(scene: Scene) {
    if (!scene.id || !scene.content?.trim()) {
      setScriptizeError('빈 씬은 변환할 수 없어요.')
      return
    }
    const sceneId = scene.id
    setScriptizingSceneId(sceneId)
    setScriptizeError(null)
    try {
      const ta = refs.current.get(sceneId)
      let scriptText = scene.content
      if (ta && ta.selectionStart !== ta.selectionEnd) {
        const s = ta.selectionStart, e = ta.selectionEnd
        const sel = scene.content.slice(Math.min(s, e), Math.max(s, e)).trim()
        if (sel.length >= 4) scriptText = sel
      }

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sceneId)
      const res = await fetch('/api/seedance/scriptize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          sceneId: isUuid ? sceneId : undefined,
          scriptText,
          durationSec: 15,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `scriptize ${res.status}`)

      try {
        const payload = {
          projectId,
          sceneId: isUuid ? sceneId : null,
          sceneNumber: scene.sceneNumber ?? null,
          prompt: json.prompt,
          refs: json.refs ?? [],
          rawScript: json.rawScript,
          durationSec: json.durationSec ?? 15,
          ts: Date.now(),
        }
        sessionStorage.setItem('seedance_prefill', JSON.stringify(payload))
      } catch (e) {
        console.warn('[scriptize] sessionStorage 저장 실패', e)
      }

      const sceneParam = isUuid ? `&scene=${encodeURIComponent(sceneId)}` : ''
      router.push(`/project/${projectId}/workspace?tab=i2v&engine=seedance-2&prefill=1${sceneParam}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[scriptize] 실패:', msg)
      setScriptizeError(msg)
      setScriptizingSceneId(null)
    }
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
        const plainContent = htmlToPlain(String(data.content ?? ''))
        const lines = plainContent.split('\n')
        const breakAt = [0]
        lines.forEach((line: string, i: number) => {
          if (i > 0 && SCENE_HEADER_RE.test(line.trim())) breakAt.push(i)
        })
        const initial: Scene[] = breakAt.map((start, i) => {
          const content = lines.slice(start, breakAt[i + 1] ?? lines.length).join('\n').trimEnd()
          return { id: uid(), content, sceneNumber: extractSceneNumber(content) }
        })
        const result = initial.length ? initial : [{ id: uid(), content: plainContent }]
        setScenes(result)
        saveToLocal(projectId, result)
        setLoading(false)
      })
  }, [projectId])

  useEffect(() => { refs.current.forEach(fitHeight) }, [scenes])

  // 자동저장 (localStorage)
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

  // ── DB 버전 스냅샷 자동 저장 (60초 간격, 변경 있을 때만) ──
  const lastSnapshotJsonRef = useRef<string>('')
  const [snapshots, setSnapshots] = useState<Array<{ id: string; created_at: string; sceneCount: number; note: string | null }>>([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [savingSnapshot, setSavingSnapshot] = useState(false)

  async function loadSnapshots() {
    setSnapshotsLoading(true)
    try {
      const r = await fetch(`/api/scene-editor/snapshots?projectId=${projectId}&limit=50`)
      const j = await r.json()
      if (r.ok) setSnapshots(j.snapshots ?? [])
    } finally { setSnapshotsLoading(false) }
  }
  useEffect(() => { void loadSnapshots() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId])

  async function persistSnapshot(note?: string): Promise<boolean> {
    if (!scenes.length) return false
    const json = JSON.stringify(scenes)
    if (json === lastSnapshotJsonRef.current) return false
    setSavingSnapshot(true)
    try {
      const r = await fetch('/api/scene-editor/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, scenes, note: note ?? null }),
      })
      const j = await r.json()
      if (!r.ok) { console.warn('[scene-editor] snapshot 실패:', j.error); return false }
      lastSnapshotJsonRef.current = json
      await loadSnapshots()
      return true
    } finally { setSavingSnapshot(false) }
  }

  useEffect(() => {
    if (loading || !scenes.length) return
    const interval = setInterval(() => { void persistSnapshot() }, 60_000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, scenes, projectId])

  async function restoreSnapshot(snapshotId: string) {
    if (!confirm('이 버전으로 되돌릴까요? 현재 변경사항은 새 스냅샷으로 보관됩니다.')) return
    // 먼저 현재 상태를 스냅샷으로 보관 (롤백 전 상태 보존)
    await persistSnapshot('롤백 직전')
    try {
      const r = await fetch(`/api/scene-editor/snapshots/${snapshotId}`)
      const j = await r.json()
      if (!r.ok) { alert('복원 실패: ' + (j.error ?? r.statusText)); return }
      const restored = j.snapshot?.scenes_json
      if (!Array.isArray(restored)) { alert('스냅샷 형식 오류'); return }
      setScenes(restored as any)
      saveToLocal(projectId, restored as any)
      lastSnapshotJsonRef.current = JSON.stringify(restored)
      setSnapshotsOpen(false)
    } catch (e) {
      alert('복원 실패: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  async function deleteSnapshot(snapshotId: string) {
    if (!confirm('이 스냅샷을 삭제할까요?')) return
    try {
      await fetch(`/api/scene-editor/snapshots/${snapshotId}`, { method: 'DELETE' })
      await loadSnapshots()
    } catch {}
  }

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
    const plainContent = htmlToPlain(String(data.content ?? ''))
    const lines = plainContent.split('\n')
    const breakAt = [0]
    lines.forEach((line: string, i: number) => {
      if (i > 0 && SCENE_HEADER_RE.test(line.trim())) breakAt.push(i)
    })
    const initial: Scene[] = breakAt.map((start, i) => {
      const content = lines.slice(start, breakAt[i + 1] ?? lines.length).join('\n').trimEnd()
      return { id: uid(), content, sceneNumber: extractSceneNumber(content) }
    })
    const result = initial.length ? initial : [{ id: uid(), content: plainContent }]
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
      let extractedCount = 0
      if (data.results) {
        setScenes(prev => prev.map(scene => {
          const result = data.results.find((r: any) => r.sceneId === scene.id)
          if (result?.marks) {
            const hasAny = Object.values(result.marks).some(v => v && String(v).trim())
            if (hasAny) extractedCount++
            return { ...scene, rootAssetMarks: result.marks }
          }
          return scene
        }))
      }
      setError(null)
      // 결과 안내 — '에셋 마크' 버튼이 자동으로 채워짐
      if (extractedCount > 0) {
        // 알림용 메시지로 setError를 잠시 활용 (성공 케이스라 toast가 더 적절하지만 호환성 유지)
        console.log(`[extract-marks] ${extractedCount}개 씬에 자동 채움`)
      }
    } catch (e) {
      setError(`에셋 마크 추출 실패: ${String(e)}`)
    } finally {
      setExtracting(false)
    }
  }

  async function confirmAndClassify() {
    if (!scriptId || !scenes.length) return

    // 기존 씬이 있으면 한 번 더 확인
    const { count } = await supabase
      .from('scenes').select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
    if ((count ?? 0) > 0) {
      const ok = confirm(
        `기존 ${count}개의 씬이 모두 삭제되고 새로 생성됩니다.\n` +
        `(루트 에셋 / 자산 라이브러리는 보존됨)\n\n계속할까요?`,
      )
      if (!ok) return
    }

    setClassifying(true)
    setError(null)
    const validScenes = scenes.filter(sc => sc.content.trim())
    const manualScenes = validScenes.map(s => s.content.trim())
    // 사용자가 scene-editor에서 직접 정한 번호/라벨을 그대로 보냄 (Claude 우회)
    // 비어있는 번호는 array index + 1로 자동 채워서 항상 "전체 번호 있음" 분기 타게.
    const manualSceneRows = validScenes.map((sc, i) => ({
      scene_number: (sc.sceneNumber?.trim()) || String(i + 1),
      title: sc.label?.trim() ?? '',
      content: sc.content.trim(),
      label: sc.label?.trim() ?? '',
      visualSetting: sc.visualSetting,  // angle/lens/lighting/mood
    }))
    // 자동 추출된 root_asset_marks를 같이 전송 → classify가 새 씬에 동기화
    const sceneMarks = scenes
      .filter(sc => sc.rootAssetMarks && Object.values(sc.rootAssetMarks).some(v => v && v.trim()))
      .map(sc => ({ content: sc.content.trim(), marks: sc.rootAssetMarks }))
    try {
      const res = await fetch('/api/scenes/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId, projectId, manualScenes, manualSceneRows, sceneMarks }),
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

            {/* Seedance 프롬프트화 */}
            <button
              onClick={() => void runScriptize(scene)}
              disabled={scriptizingSceneId === scene.id}
              className="flex items-center gap-1 px-2.5 h-6 rounded-full text-[10px] font-semibold transition-all hover:opacity-80 disabled:opacity-50"
              style={{
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                border: '1px solid var(--accent-line)',
              }}
              title="이 씬(또는 선택 구간)을 Seedance R2V 프롬프트로 변환하고 워크스페이스 I2V 탭으로 이동"
            >
              {scriptizingSceneId === scene.id
                ? <Loader2 size={10} className="animate-spin" />
                : <Wand2 size={10} />}
              Seedance 프롬프트화
            </button>

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

        {/* 비주얼 세팅 드롭다운 — 씬 아래에 inline */}
        <VisualSettingsPanel scene={scene} onUpdate={updateScene} />
      </div>
    )
  })

  return (
    <div className="h-full flex flex-col">

      {/* 헤더 */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--line)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 3 }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>씬 경계 편집</h1>
          <p className="text-[13px] mt-1 flex items-center gap-2" style={{ color: 'var(--ink-3)' }}>
            {scenes.length}개 씬 &nbsp;·&nbsp;
            <span className="opacity-70">Cmd+Enter 나누기 / Backspace 합치기</span>
            {savedIndicator && <span style={{ color: 'var(--success)' }}>✓ 자동저장</span>}
            {scriptizeError && (
              <span
                style={{ color: 'var(--danger, #c43)', cursor: 'pointer' }}
                onClick={() => setScriptizeError(null)}
                title="클릭하여 닫기"
              >
                Seedance 변환 실패: {scriptizeError.slice(0, 80)}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 버전 (스냅샷 롤백) */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setSnapshotsOpen(o => !o)}
              className="flex items-center gap-2 transition-all"
              style={{
                padding: '7px 12px', borderRadius: 'var(--r-md)',
                fontSize: 12, fontWeight: 500,
                background: snapshotsOpen ? 'var(--bg-3)' : 'transparent',
                color: 'var(--ink-2)',
                border: '1px solid var(--line-strong)',
              }}
              title="버전 히스토리 (60초 자동 스냅샷 + 수동 저장)"
            >
              <History size={13} /> 버전 {snapshots.length > 0 && `(${snapshots.length})`}
              {savingSnapshot && <Loader2 size={11} className="animate-spin" style={{ color: 'var(--accent)' }} />}
            </button>
            {snapshotsOpen && (
              <div
                style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                  width: 320, maxHeight: 420,
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-md)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  overflow: 'hidden',
                  zIndex: 50,
                  display: 'flex', flexDirection: 'column',
                }}
              >
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>버전 히스토리</span>
                  <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>· 60초 자동</span>
                  <span style={{ flex: 1 }} />
                  <button
                    onClick={() => { void persistSnapshot('수동 저장') }}
                    disabled={savingSnapshot}
                    style={{
                      padding: '3px 8px', borderRadius: 4, fontSize: 11,
                      background: 'var(--accent-soft)', color: 'var(--accent)',
                      border: '1px solid var(--accent-line)',
                    }}
                    title="현재 상태를 버전으로 저장"
                  >+ 저장</button>
                </div>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {snapshotsLoading ? (
                    <div style={{ padding: 16, fontSize: 11, color: 'var(--ink-4)', textAlign: 'center' }}>
                      <Loader2 size={12} className="animate-spin inline-block" /> 불러오는 중...
                    </div>
                  ) : snapshots.length === 0 ? (
                    <div style={{ padding: 16, fontSize: 11, color: 'var(--ink-5)', textAlign: 'center', fontStyle: 'italic' }}>
                      아직 저장된 버전이 없어요.
                    </div>
                  ) : (
                    snapshots.map(s => {
                      const t = new Date(s.created_at)
                      const ts = `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
                      return (
                        <div
                          key={s.id}
                          className="flex items-center"
                          style={{
                            padding: '8px 12px', gap: 8,
                            borderBottom: '1px solid var(--line)',
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="mono" style={{ fontSize: 11, color: 'var(--ink)', fontWeight: 600 }}>{ts}</div>
                            <div style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                              {s.sceneCount}개 씬 {s.note ? `· ${s.note}` : ''}
                            </div>
                          </div>
                          <button
                            onClick={() => void restoreSnapshot(s.id)}
                            style={{
                              padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500,
                              background: 'var(--accent-soft)', color: 'var(--accent)',
                              border: '1px solid var(--accent-line)',
                            }}
                            title="이 버전으로 롤백"
                          >복원</button>
                          <button
                            onClick={() => void deleteSnapshot(s.id)}
                            style={{
                              padding: '3px 6px', borderRadius: 4, fontSize: 10,
                              background: 'transparent', color: 'var(--danger)',
                              border: '1px solid transparent',
                            }}
                            title="이 버전 삭제"
                          >✕</button>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={resetFromScript}
            disabled={classifying || loading || extracting}
            className="flex items-center gap-2 transition-all disabled:opacity-40"
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--r-md)',
              fontSize: 13, fontWeight: 500,
              background: 'transparent', color: 'var(--ink-3)',
              border: '1px solid var(--line-strong)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--ink-3)' }}
          >
            <RotateCcw size={13} /> 초기화
          </button>
          <button
            onClick={extractRootAssetMarks}
            disabled={extracting || classifying || !scenes.length}
            className="flex items-center gap-2 transition-all disabled:opacity-40"
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--r-md)',
              fontSize: 13, fontWeight: 500,
              background: 'transparent', color: 'var(--ink-3)',
              border: '1px solid var(--line-strong)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--ink-3)' }}
          >
            {extracting
              ? <><Loader2 size={13} className="animate-spin" /> 분석중...</>
              : <>📝 대본 자동 분석</>
            }
          </button>
          <button
            onClick={confirmAndClassify}
            disabled={classifying || !scenes.length || extracting}
            className="flex items-center gap-2 disabled:opacity-50 transition-all"
            style={{
              padding: '7px 16px',
              borderRadius: 'var(--r-md)',
              fontSize: 13, fontWeight: 500,
              background: 'var(--accent)', color: '#fff',
              border: '1px solid var(--accent)',
            }}
            onMouseEnter={e => { if (!classifying && scenes.length > 0 && !extracting) { (e.currentTarget as HTMLElement).style.background = 'var(--accent-2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-2)' } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
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
          className="flex items-center justify-between flex-shrink-0"
          style={{
            margin: '12px 28px 0',
            padding: '10px 14px',
            borderRadius: 'var(--r-md)',
            fontSize: 12,
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger-soft)',
            color: 'var(--danger)',
          }}
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
            className="mt-4 w-full flex items-center justify-center gap-2 transition-all"
            style={{
              padding: 14,
              borderRadius: 'var(--r-md)',
              border: '1px dashed var(--line-2)',
              fontSize: 13,
              background: 'transparent',
              color: 'var(--ink-4)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-line)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--line-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink-4)' }}
          >
            <Plus size={14} /> 씬 추가
          </button>

        </div>
      </div>
    </div>
  )
}
