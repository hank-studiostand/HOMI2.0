'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import { Scissors, Loader2, ChevronRight, CheckCircle2 } from 'lucide-react'

export default function ScriptPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()
  const [content, setContent] = useState('')
  const [scriptId, setScriptId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const supabase = createClient()

  const savedContentRef = useRef<string>('')
  const isDirty = loaded && content !== savedContentRef.current

  useEffect(() => {
    supabase.from('scripts')
      .select('*').eq('project_id', projectId).single()
      .then(({ data }) => {
        if (data) {
          setContent(data.content ?? '')
          setScriptId(data.id)
          savedContentRef.current = data.content ?? ''
          if (data.updated_at) setLastSavedAt(new Date(data.updated_at))
        }
        setLoaded(true)
      })
  }, [projectId])

  async function save() {
    if (!scriptId) return false
    setSaving(true)
    try {
      const snapshot = content
      const { error: err } = await supabase.from('scripts')
        .update({ content: snapshot, updated_at: new Date().toISOString() })
        .eq('id', scriptId)
      if (err) { setError('저장 실패: ' + err.message); return false }
      savedContentRef.current = snapshot
      setLastSavedAt(new Date())
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
      return true
    } finally {
      setSaving(false)
    }
  }

  // 1분 자동 저장 (변경사항 있을 때만)
  useEffect(() => {
    if (!loaded) return
    const t = setInterval(() => {
      if (isDirty && !saving) void save()
    }, 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, isDirty, saving])

  // 브라우저 닫기/새로고침 가드
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = ''
        return ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  // 동일 페이지 내 클릭 가로채기 — 다른 페이지로 이동 시 confirm
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!isDirty) return
      const target = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!target) return
      const href = target.getAttribute('href')
      if (!href) return
      if (href.startsWith('#')) return
      if (target.target === '_blank') return
      const ok = window.confirm('대본 변경사항이 저장되지 않았어요.\n\n저장하지 않고 다른 탭으로 이동할까요?\n(취소: 머무르기 / 확인: 이동)')
      if (!ok) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
    }
    document.addEventListener('click', onDocClick, true)
    return () => document.removeEventListener('click', onDocClick, true)
  }, [isDirty])

  async function goToSceneEditor() {
    if (!content.trim() || !scriptId) return
    const ok = await save()
    if (ok) router.push(`/project/${projectId}/scene-editor`)
  }

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const lastSavedStr = lastSavedAt
    ? `${lastSavedAt.getMonth() + 1}/${lastSavedAt.getDate()} ${String(lastSavedAt.getHours()).padStart(2, '0')}:${String(lastSavedAt.getMinutes()).padStart(2, '0')}`
    : null

  return (
    <div className="h-full flex flex-col">
      {error && (
        <div
          className="mx-6 mt-4 flex items-center justify-between"
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--r-md)',
            fontSize: 13,
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger-soft)',
            color: 'var(--danger)',
          }}
        >
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}
      <div className="flex items-center justify-between" style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--line)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 3 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>대본</h1>
          <p className="text-[13px] mt-1 flex items-center" style={{ color: 'var(--ink-3)', gap: 8 }}>
            <span>{wordCount.toLocaleString()}자</span>
            {isDirty && (
              <span style={{ color: 'var(--warn)', fontWeight: 600 }}>· 저장되지 않음</span>
            )}
            {!isDirty && lastSavedStr && (
              <span style={{ color: 'var(--ink-4)' }}>· 마지막 저장 {lastSavedStr}</span>
            )}
            {saving && <Loader2 size={11} className="animate-spin" style={{ color: 'var(--accent)' }} />}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !isDirty}
            className="transition-all"
            style={{
              padding: '7px 12px',
              borderRadius: 'var(--r-md)',
              fontSize: 12, fontWeight: 500,
              background: 'transparent',
              color: saved ? 'var(--ok)' : (isDirty ? 'var(--accent)' : 'var(--ink-4)'),
              border: `1px solid ${saved ? 'var(--ok)' : (isDirty ? 'var(--accent-line)' : 'transparent')}`,
              opacity: !isDirty && !saved ? 0.55 : 1,
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}
            title="저장 (Cmd/Ctrl+S). 1분마다 자동 저장."
          >
            {saved ? <CheckCircle2 size={12} /> : null}
            {saving ? '저장중...' : saved ? '저장됨' : (isDirty ? '저장' : '저장됨')}
          </button>
          <button
            onClick={goToSceneEditor}
            disabled={!content.trim()}
            className="flex items-center gap-2 disabled:opacity-50 transition-all"
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--r-md)',
              fontSize: 13, fontWeight: 500,
              background: 'var(--accent)', color: '#fff',
              border: '1px solid var(--accent)',
            }}
            onMouseEnter={e => { if (content.trim()) { (e.currentTarget as HTMLElement).style.background = 'var(--accent-2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-2)' } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
            title="저장 후 씬 경계 편집으로 이동합니다"
          >
            <Scissors size={15} />
            씬 경계 편집
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1" style={{ padding: 28 }}>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={`대본을 여기에 붙여넣으세요.\n\n예시:\n씬 1. 도심 사무실 - 낮\n\n창문 너머 도시의 풍경이 보인다.\n직장인들이 바쁘게 움직인다.\n\n씬 2. 회의실 - 낮\n\n팀원들이 모여 앉아 있다...`}
          className="w-full h-full resize-none outline-none transition-colors"
          style={{
            padding: 24,
            borderRadius: 'var(--r-lg)',
            background: '#ffffff',
            border: '1px solid #d4d4d8',
            color: '#1f2937',
            fontFamily: "'Noto Serif KR', Georgia, serif",
            fontSize: 14, lineHeight: '28px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}
          onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = '#9ca3af'; (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px rgba(156,163,175,0.15)' }}
          onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = '#d4d4d8'; (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)' }}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void save() } }}
        />
      </div>
    </div>
  )
}
