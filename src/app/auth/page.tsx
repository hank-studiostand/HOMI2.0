'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Film, Loader2 } from 'lucide-react'

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); setLoading(false); return }
      window.location.href = '/dashboard'
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) { setError(error.message); setLoading(false); return }
      if (data.session) {
        window.location.href = '/dashboard'
      } else {
        setError(null)
        setLoading(false)
        alert('가입 완료! 이메일 인증 없이 바로 로그인 탭에서 로그인하세요.')
        setMode('login')
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: 'var(--accent)' }}>
            <Film size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            AI 영상 협업툴
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            팀과 함께 AI 영상을 제작하세요
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-2xl p-6 space-y-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>

            {/* Tab */}
            <div className="flex rounded-lg p-0.5" style={{ background: 'var(--surface-3)' }}>
              {(['login', 'signup'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className="flex-1 py-2 rounded-md text-sm font-medium transition-all"
                  style={mode === m
                    ? { background: 'var(--accent)', color: 'white' }
                    : { color: 'var(--text-secondary)' }}>
                  {m === 'login' ? '로그인' : '회원가입'}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="이메일" required
                className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="비밀번호" required minLength={6}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--accent)' }}>
              {loading && <Loader2 size={15} className="animate-spin" />}
              {mode === 'login' ? '로그인' : '가입하기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
