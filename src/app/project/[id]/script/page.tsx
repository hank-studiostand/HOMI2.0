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
        <div className="mx-6 mt-4 px-4 py-3 rounded-xl text-sm bg-red-500/10 border border-red-500/30 flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} className="/60 hover: ml-4">✕</button>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>대본</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{wordCount.toLocaleString()}자</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving}
            className="px-3 py-2 rounded-lg text-sm transition-all hover-surface"
            style={{ color: saved ? 'var(--ok)' : 'var(--text-secondary)' }}>
            {saving ? '저장중...' : saved ? '✓ 저장됨' : '저장'}
          </button>
          <button onClick={goToSceneEditor} disabled={!content.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-all hover:opacity-90"
            style={{ background: 'var(--accent)' }}>
            <Scissors size={15} />
            씬 경계 편집
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 p-6">
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={`대본을 여기에 붙여넣으세요.\n\n예시:\n씬 1. 도심 사무실 - 낮\n\n창문 너머 도시의 풍경이 보인다.\n직장인들이 바쁘게 움직인다.\n\n씬 2. 회의실 - 낮\n\n팀원들이 모여 앉아 있다...`}
          className="w-full h-full resize-none text-sm leading-7 rounded-2xl p-5 outline-none"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            fontFamily: "'Noto Serif KR', Georgia, serif",
          }}
          onKeyDown={e => { if (e.metaKey && e.key === 's') { e.preventDefault(); save() } }}
        />
      </div>
    </div>
  )
}
