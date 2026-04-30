'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import { Scissors, Loader2, ChevronRight } from 'lucide-react'
import Link from 'next/link'

export default function ScriptPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()
  const [content, setContent] = useState('')
  const [scriptId, setScriptId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    supabase.from('scripts')
      .select('*').eq('project_id', projectId).single()
      .then(({ data }) => {
        if (data) { setContent(data.content); setScriptId(data.id) }
      })
  }, [projectId])

  async function save() {
    if (!scriptId) return
    setSaving(true)
    await supabase.from('scripts').update({ content, updated_at: new Date().toISOString() }).eq('id', scriptId)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function goToSceneEditor() {
    if (!content.trim() || !scriptId) return
    await save()
    window.location.href = `/project/${projectId}/scene-editor`
  }

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0

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
      {/* Header */}
      <div className="flex items-center justify-between" style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--line)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 3 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>대본</h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>{wordCount.toLocaleString()}자</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="transition-all"
            style={{
              padding: '7px 12px',
              borderRadius: 'var(--r-md)',
              fontSize: 12, fontWeight: 500,
              background: 'transparent',
              color: saved ? 'var(--ok)' : 'var(--ink-3)',
              border: '1px solid transparent',
            }}
            onMouseEnter={e => { if (!saved) { (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)' } }}
            onMouseLeave={e => { if (!saved) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--ink-3)' } }}
          >
            {saving ? '저장중...' : saved ? '✓ 저장됨' : '저장'}
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
          >
            <Scissors size={15} />
            씬 경계 편집
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1" style={{ padding: 28 }}>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={`대본을 여기에 붙여넣으세요.\n\n예시:\n씬 1. 도심 사무실 - 낮\n\n창문 너머 도시의 풍경이 보인다.\n직장인들이 바쁘게 움직인다.\n\n씬 2. 회의실 - 낮\n\n팀원들이 모여 앉아 있다...`}
          className="w-full h-full resize-none outline-none transition-colors"
          style={{
            padding: 20,
            borderRadius: 'var(--r-lg)',
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            color: 'var(--ink)',
            fontFamily: "'Noto Serif KR', Georgia, serif",
            fontSize: 14, lineHeight: '28px',
          }}
          onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-line)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)' }}
          onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)' }}
          onKeyDown={e => { if (e.metaKey && e.key === 's') { e.preventDefault(); save() } }}
        />
      </div>
    </div>
  )
}
