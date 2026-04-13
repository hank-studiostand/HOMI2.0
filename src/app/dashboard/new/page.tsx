'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import Link from 'next/link'

export default function NewProjectPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/projects/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? '프로젝트 생성 실패')
      setLoading(false)
      return
    }

    window.location.href = `/project/${data.projectId}/script`
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-md">
        <Link href="/dashboard" className="flex items-center gap-2 text-sm mb-6 hover:text-white transition-colors"
          style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft size={15} /> 대시보드로
        </Link>
        <h1 className="text-xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>새 프로젝트</h1>
        <form onSubmit={handleCreate} className="rounded-2xl p-6 space-y-4"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>프로젝트명</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="예: 브랜드 캠페인 영상 2025"
              className="w-full px-3.5 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>설명 (선택)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder="프로젝트 설명..."
              className="w-full px-3.5 py-2.5 rounded-xl text-sm resize-none"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          </div>
          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>
          )}
          <button type="submit" disabled={loading || !name}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--accent)' }}>
            {loading && <Loader2 size={15} className="animate-spin" />}
            프로젝트 만들기
          </button>
        </form>
      </div>
    </div>
  )
}
