'use client'

import { useState, useRef, useEffect } from 'react'
import { Edit2, Check, X } from 'lucide-react'

// 파일명 인라인 편집 — 확장자는 변경 불가.
// 클릭 → input. Enter/blur로 저장, Escape로 취소.

interface Props {
  value: string                          // 전체 파일명 (확장자 포함)
  onSave: (newName: string) => Promise<void> | void
  className?: string
  // disabled면 단순 텍스트로 렌더
  disabled?: boolean
}

function splitName(full: string): { base: string; ext: string } {
  const i = full.lastIndexOf('.')
  if (i <= 0 || i === full.length - 1) return { base: full, ext: '' }   // 확장자 없음 또는 dotfile
  return { base: full.slice(0, i), ext: full.slice(i) }
}

export default function FileNameEditor({ value, onSave, className, disabled }: Props) {
  const { base, ext } = splitName(value)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(base)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const composing = useRef(false)

  useEffect(() => { setDraft(base) }, [base])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  async function commit() {
    if (composing.current) return
    const next = draft.trim()
    if (!next || next === base) { setEditing(false); setDraft(base); return }
    setSaving(true)
    try {
      await onSave(next + ext)
      setEditing(false)
    } catch (e: any) {
      alert('이름 변경 실패: ' + (e?.message ?? String(e)))
      setDraft(base)
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setEditing(false)
    setDraft(base)
  }

  if (disabled) {
    return <span className={className}>{value}</span>
  }

  if (!editing) {
    return (
      <span
        className={className}
        onClick={(e) => { e.stopPropagation(); setEditing(true) }}
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        title="클릭해서 이름 변경"
      >
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value}
        </span>
        <Edit2 size={10} style={{ opacity: 0.4, flexShrink: 0 }} />
      </span>
    )
  }

  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={(e) => { composing.current = false; setDraft((e.target as HTMLInputElement).value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !composing.current) { e.preventDefault(); void commit() }
          else if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
        onBlur={commit}
        disabled={saving}
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--accent-line)',
          borderRadius: 'var(--r-sm)',
          padding: '2px 6px',
          fontSize: 'inherit',
          color: 'var(--ink)',
          outline: 'none',
          minWidth: 80,
          maxWidth: 240,
        }}
      />
      {/* 확장자 (잠김) */}
      {ext && (
        <span style={{ color: 'var(--ink-4)', fontSize: 'inherit' }}>{ext}</span>
      )}
      <button
        onMouseDown={(e) => { e.preventDefault(); void commit() }}
        disabled={saving}
        style={{ color: 'var(--ok)', padding: 2 }}
        title="저장"
      >
        <Check size={11} />
      </button>
      <button
        onMouseDown={(e) => { e.preventDefault(); cancel() }}
        disabled={saving}
        style={{ color: 'var(--ink-4)', padding: 2 }}
        title="취소"
      >
        <X size={11} />
      </button>
    </span>
  )
}
