'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Film, Loader2 } from 'lucide-react'

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [infoMsg, setInfoMsg] = useState<string | null>(null)
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
      if (error) {
        const msg = error.message
        // 더 친절한 한글 메시지
        if (/email not confirmed/i.test(msg)) {
          setError('이메일 확인이 완료되지 않았어요. 받은편지함에서 확인 링크를 클릭하거나 아래 \'확인 메일 다시 보내기\'를 눌러주세요.')
        } else if (/invalid.*credentials|invalid login/i.test(msg)) {
          setError('이메일 또는 비밀번호가 일치하지 않아요. 비밀번호를 잊었다면 아래 \'비밀번호 재설정\'을 눌러주세요.')
        } else {
          setError(msg)
        }
        setLoading(false)
        return
      }
      window.location.href = '/dashboard'
    } else if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) { setError(error.message); setLoading(false); return }
      if (data.session) {
        // 자동 로그인됨 (이메일 확인 비활성)
        window.location.href = '/dashboard'
      } else {
        // 메일 확인 필요
        setError(null); setLoading(false)
        setInfoMsg(`${email} 으로 확인 메일을 보냈어요. 메일 안의 링크를 클릭한 뒤 로그인 탭에서 로그인해주세요.`)
        setMode('login')
      }
    } else if (mode === 'reset') {
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/auth?reset=1` : undefined
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      if (error) { setError(error.message); setLoading(false); return }
      setError(null); setLoading(false)
      setInfoMsg(`${email} 으로 비밀번호 재설정 메일을 보냈어요. 메일을 확인해주세요.`)
    }
  }

  async function resendConfirmation() {
    if (!email) { setError('이메일을 입력해주세요'); return }
    setLoading(true); setError(null)
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    setLoading(false)
    if (error) setError(error.message)
    else setInfoMsg(`${email} 으로 확인 메일을 다시 보냈어요.`)
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
            HOMI
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
                <button key={m} type="button" onClick={() => { setMode(m); setError(null); setInfoMsg(null) }}
                  className="flex-1 py-2 rounded-md text-sm font-medium transition-all"
                  style={(mode === m || (m === 'login' && mode === 'reset'))
                    ? { background: 'var(--accent)', color: 'white' }
                    : { color: 'var(--text-secondary)' }}>
                  {m === 'login' ? '로그인' : '회원가입'}
                </button>
              ))}
            </div>
            {mode === 'reset' && (
              <div
                className="flex items-center justify-between"
                style={{ padding: '6px 4px', fontSize: 11, color: 'var(--text-muted)' }}
              >
                <span>비밀번호 재설정</span>
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(null); setInfoMsg(null) }}
                  style={{ color: 'var(--accent)', fontSize: 11 }}
                >
                  ← 로그인으로
                </button>
              </div>
            )}

            <div className="space-y-3">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="이메일" required
                className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              {mode !== 'reset' && (
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="비밀번호" required minLength={6}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm"
                  style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              )}
            </div>

            {error && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ color: 'var(--danger)', background: 'var(--danger-soft)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{error}</p>
            )}
            {infoMsg && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ color: 'var(--ok)', background: 'var(--ok-soft)', lineHeight: 1.5 }}>{infoMsg}</p>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--accent)' }}>
              {loading && <Loader2 size={15} className="animate-spin" />}
              {mode === 'login' ? '로그인' : mode === 'signup' ? '가입하기' : '재설정 메일 보내기'}
            </button>

            {/* 부가 액션 — 비밀번호 재설정 / 확인 메일 재발송 */}
            {mode === 'login' && (
              <div className="flex items-center justify-between" style={{ paddingTop: 4, fontSize: 11 }}>
                <button
                  type="button"
                  onClick={() => { setMode('reset'); setError(null); setInfoMsg(null) }}
                  style={{ color: 'var(--accent)' }}
                >
                  비밀번호 재설정
                </button>
                <button
                  type="button"
                  onClick={resendConfirmation}
                  disabled={loading || !email}
                  style={{ color: 'var(--ink-3)', opacity: !email ? 0.4 : 1 }}
                  title={!email ? '먼저 이메일 입력' : '확인 메일 다시 보내기'}
                >
                  확인 메일 재발송
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
