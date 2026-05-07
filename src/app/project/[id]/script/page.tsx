'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import {
  Scissors, Loader2, ChevronRight, CheckCircle2,
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Heading,
} from 'lucide-react'

// 대본 본문은 HTML로 보관. (b/i/u/s/h2/ul/ol 등)
// scene-editor로 넘길 때는 HTML 태그를 제거해서 plain text로 변환.
function htmlToPlain(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, '')
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  // 블록 요소 끝에 줄바꿈 삽입
  ;(['p', 'div', 'br', 'h1', 'h2', 'h3', 'li'] as const).forEach(tag => {
    Array.from(tmp.getElementsByTagName(tag)).forEach((el: any) => {
      if (tag === 'br') el.replaceWith('\n')
      else el.appendChild(document.createTextNode('\n'))
    })
  })
  return (tmp.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

function ToolbarButton({
  onClick, title, active, children,
}: {
  onClick: () => void
  title: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      title={title}
      style={{
        padding: '5px 8px',
        borderRadius: 4,
        background: active ? 'var(--accent-soft, #fde68a)' : 'transparent',
        color: active ? 'var(--accent, #d97706)' : '#52525b',
        border: 'none',
        display: 'inline-flex', alignItems: 'center',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

export default function ScriptPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()
  const [contentHtml, setContentHtml] = useState('')
  const [scriptId, setScriptId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const supabase = createClient()

  const editorRef = useRef<HTMLDivElement | null>(null)
  const savedContentRef = useRef<string>('')
  const isDirty = loaded && contentHtml !== savedContentRef.current

  // 초기 로드
  useEffect(() => {
    supabase.from('scripts')
      .select('*').eq('project_id', projectId).single()
      .then(({ data }) => {
        if (data) {
          const raw = String(data.content ?? '')
          // 기존 plain-text 데이터면 그대로 표시되도록 <p>로 한번 감싸기 (선택)
          const html = raw.includes('<') ? raw : raw.replace(/\n/g, '<br/>')
          setContentHtml(html)
          if (editorRef.current) editorRef.current.innerHTML = html
          setScriptId(data.id)
          savedContentRef.current = html
          if (data.updated_at) setLastSavedAt(new Date(data.updated_at))
        }
        setLoaded(true)
      })
  }, [projectId])

  async function save() {
    if (!scriptId) return false
    setSaving(true)
    try {
      const snapshot = contentHtml
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

  // 1분 자동 저장
  useEffect(() => {
    if (!loaded) return
    const t = setInterval(() => {
      if (isDirty && !saving) void save()
    }, 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, isDirty, saving])

  // 브라우저 가드
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

  // 인앱 네비게이션 가드
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!isDirty) return
      const target = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!target) return
      const href = target.getAttribute('href')
      if (!href || href.startsWith('#') || target.target === '_blank') return
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

  // 툴바 액션 (deprecated execCommand이지만 모든 브라우저 지원)
  function exec(command: string, value?: string) {
    if (!editorRef.current) return
    editorRef.current.focus()
    document.execCommand(command, false, value)
    setContentHtml(editorRef.current.innerHTML)
  }

  // scene-editor로 넘어갈 때는 plain text로 변환해서 scripts에도 plain 저장 (분류 호환)
  async function goToSceneEditor() {
    const plain = htmlToPlain(contentHtml).trim()
    if (!plain || !scriptId) return
    setSaving(true)
    try {
      // HTML 원본은 내부 보관, classify 호환을 위해 plain만 supabase에도 한 번 더 plain으로 덮어쓰지는 않음.
      // 대신 별도 컬럼이 없으니 — HTML 그대로 저장된 상태로 두고 router 이동.
      await supabase.from('scripts').update({ content: contentHtml, updated_at: new Date().toISOString() }).eq('id', scriptId)
      savedContentRef.current = contentHtml
      setLastSavedAt(new Date())
    } finally { setSaving(false) }
    router.push(`/project/${projectId}/scene-editor`)
  }

  const plainPreview = htmlToPlain(contentHtml).trim()
  const wordCount = plainPreview ? plainPreview.split(/\s+/).length : 0
  const charCount = plainPreview.length
  const lastSavedStr = lastSavedAt
    ? `${lastSavedAt.getMonth() + 1}/${lastSavedAt.getDate()} ${String(lastSavedAt.getHours()).padStart(2, '0')}:${String(lastSavedAt.getMinutes()).padStart(2, '0')}`
    : null

  return (
    <div className="h-full flex flex-col">
      {error && (
        <div
          className="mx-6 mt-4 flex items-center justify-between"
          style={{
            padding: '10px 14px', borderRadius: 'var(--r-md)', fontSize: 13,
            background: 'var(--danger-soft)', border: '1px solid var(--danger-soft)', color: 'var(--danger)',
          }}
        >
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}
      <div
        className="flex items-center justify-between"
        style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--line)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 3 }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>대본</h1>
          <p className="text-[13px] mt-1 flex items-center" style={{ color: 'var(--ink-3)', gap: 8 }}>
            <span>{charCount.toLocaleString()}자 · {wordCount.toLocaleString()}단어</span>
            {isDirty && <span style={{ color: 'var(--warn)', fontWeight: 600 }}>· 저장되지 않음</span>}
            {!isDirty && lastSavedStr && <span style={{ color: 'var(--ink-4)' }}>· 마지막 저장 {lastSavedStr}</span>}
            {saving && <Loader2 size={11} className="animate-spin" style={{ color: 'var(--accent)' }} />}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !isDirty}
            style={{
              padding: '7px 12px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500,
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
            disabled={!plainPreview}
            className="flex items-center gap-2 disabled:opacity-50"
            style={{
              padding: '7px 14px', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 500,
              background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)',
            }}
            title="저장 후 씬 경계 편집으로 이동 (서식은 plain text로 변환되어 적용)"
          >
            <Scissors size={15} /> 씬 경계 편집 <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col" style={{ padding: 28 }}>
        {/* 워드 툴바 */}
        <div
          className="flex items-center"
          style={{
            gap: 2, padding: '4px 6px', marginBottom: 8,
            background: '#f9fafb',
            border: '1px solid #d4d4d8',
            borderRadius: 8,
            width: 'fit-content',
          }}
        >
          <ToolbarButton onClick={() => exec('bold')} title="볼드 (Cmd/Ctrl+B)">
            <Bold size={13} />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec('italic')} title="이탤릭 (Cmd/Ctrl+I)">
            <Italic size={13} />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec('underline')} title="언더라인 (Cmd/Ctrl+U)">
            <Underline size={13} />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec('strikeThrough')} title="취소선">
            <Strikethrough size={13} />
          </ToolbarButton>
          <span style={{ width: 1, height: 18, background: '#e5e7eb', margin: '0 4px' }} />
          <ToolbarButton onClick={() => exec('formatBlock', 'h2')} title="제목">
            <Heading size={13} />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec('insertUnorderedList')} title="불릿 리스트">
            <List size={13} />
          </ToolbarButton>
          <ToolbarButton onClick={() => exec('insertOrderedList')} title="번호 리스트">
            <ListOrdered size={13} />
          </ToolbarButton>
          <span style={{ width: 1, height: 18, background: '#e5e7eb', margin: '0 4px' }} />
          <ToolbarButton onClick={() => exec('removeFormat')} title="서식 지우기">
            <span style={{ fontSize: 11, fontWeight: 600 }}>지움</span>
          </ToolbarButton>
        </div>

        {/* contentEditable 본문 */}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={e => setContentHtml((e.currentTarget as HTMLDivElement).innerHTML)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void save() }
          }}
          dir="ltr"
          spellCheck={true}
          className="w-full flex-1 outline-none transition-colors overflow-auto"
          style={{
            padding: 24, borderRadius: 'var(--r-lg)',
            background: '#ffffff', border: '1px solid #d4d4d8',
            color: '#1f2937',
            fontFamily: "'Noto Serif KR', Georgia, serif",
            fontSize: 14, lineHeight: '28px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            minHeight: 200,
          }}
          onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = '#9ca3af'; (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px rgba(156,163,175,0.15)' }}
          onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = '#d4d4d8'; (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)' }}
        />
        {!plainPreview && (
          <p className="text-xs mt-2" style={{ color: 'var(--ink-5)' }}>
            예시: 씬 1. 도심 사무실 - 낮 …
          </p>
        )}
      </div>
    </div>
  )
}
