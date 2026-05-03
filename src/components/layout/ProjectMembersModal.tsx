'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { X, Search, UserPlus, Trash2, Crown, Loader2, Mail, Send, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface MemberRow {
  id: string
  user_id: string
  role: 'owner' | 'editor' | 'viewer'
  email: string
  display_name: string
  avatar_url: string
}

interface SearchHit {
  id: string
  email: string
  display_name: string
  avatar_url: string
}

interface PendingInvitation {
  id: string
  email: string
  role: string
  created_at: string
}

interface Props {
  projectId: string
  open: boolean
  onClose: () => void
}

export default function ProjectMembersModal({ projectId, open, onClose }: Props) {
  const supabase = createClient()
  const [members, setMembers] = useState<MemberRow[]>([])
  const [meId, setMeId] = useState<string | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteOk, setInviteOk] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingInvitation[]>([])

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/projects/${projectId}/members`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? '멤버 조회 실패')
      setMembers(j.members ?? [])
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const fetchPending = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/invite`)
      const j = await r.json()
      if (r.ok) setPending(j.invitations ?? [])
    } catch {}
  }, [projectId])

  async function inviteByEmail() {
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
      setErr('올바른 이메일을 입력하세요')
      return
    }
    setErr(null); setInviteOk(null); setInviting(true)
    try {
      const r = await fetch(`/api/projects/${projectId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: 'editor' }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? '초대 실패')
      if (j.kind === 'added') {
        setInviteOk(`${inviteEmail} — 가입자라 바로 멤버로 추가했어요`)
        fetchMembers()
      } else {
        setInviteOk(j.emailSent
          ? `${inviteEmail} 으로 초대 메일을 보냈어요`
          : `${inviteEmail} — 초대 등록 (메일 발송은 SMTP 설정 필요)`)
        fetchPending()
      }
      setInviteEmail('')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setInviting(false)
    }
  }

  async function cancelInvitation(id: string) {
    if (!confirm('이 초대를 취소할까요?')) return
    try {
      const r = await fetch(`/api/projects/${projectId}/invite?id=${id}`, { method: 'DELETE' })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error ?? '취소 실패')
      }
      fetchPending()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  // 본인 + owner id 조회
  useEffect(() => {
    if (!open) return
    setErr(null)
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setMeId(user?.id ?? null)
      const { data: p } = await supabase.from('projects').select('owner_id').eq('id', projectId).maybeSingle()
      setOwnerId(p?.owner_id ?? null)
      fetchMembers()
      fetchPending()
    })()
  }, [open, projectId, fetchMembers, fetchPending, supabase])

  // 검색 디바운스
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim() || query.trim().length < 2) {
      setHits([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await fetch(
          `/api/users/search?q=${encodeURIComponent(query.trim())}&projectId=${projectId}`,
        )
        const j = await r.json()
        if (r.ok) setHits(j.users ?? [])
      } finally {
        setSearching(false)
      }
    }, 250)
  }, [query, projectId])

  async function addMember(userId: string, role: 'editor' | 'viewer' = 'editor') {
    setErr(null)
    try {
      const r = await fetch(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? '추가 실패')
      setQuery('')
      setHits([])
      fetchMembers()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  async function removeMember(userId: string) {
    if (!confirm('이 멤버를 프로젝트에서 제거할까요?')) return
    setErr(null)
    try {
      const r = await fetch(`/api/projects/${projectId}/members?userId=${userId}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? '제거 실패')
      fetchMembers()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  if (!open) return null

  const isOwner = meId !== null && meId === ownerId

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 fade-in"
      style={{
        background: 'rgba(0, 0, 0, 0.35)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg shadow-lg"
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-xl)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* 모달 헤더 (.ph 톤) */}
        <div
          className="flex items-center justify-between"
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--line)',
            background: 'var(--bg-1)',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
              팀원 관리
            </h2>
            <p style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-3)' }}>
              가입한 사용자를 검색해 프로젝트에 추가하세요.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded"
            style={{ padding: 6, color: 'var(--ink-4)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* 검색 */}
          {isOwner && (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="이메일 또는 이름으로 가입자 검색..."
                className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
                style={{
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                }}
              />
              {/* 검색 결과 */}
              {(query.trim().length >= 2) && (
                <div
                  className="absolute mt-1 w-full rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  {searching && (
                    <div className="flex items-center gap-2 p-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                      <Loader2 size={12} className="animate-spin" /> 검색 중...
                    </div>
                  )}
                  {!searching && hits.length === 0 && (
                    <div className="p-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                      일치하는 가입자가 없어요.
                    </div>
                  )}
                  {!searching && hits.map(u => (
                    <button
                      key={u.id}
                      onClick={() => addMember(u.id)}
                      className="w-full flex items-center gap-3 p-2.5 text-left hover-surface"
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                        style={{ background: 'var(--accent)' }}
                      >
                        {u.avatar_url
                          ? <img src={u.avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
                          : (u.display_name || u.email)[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {u.display_name || u.email}
                        </p>
                        {u.display_name && (
                          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{u.email}</p>
                        )}
                      </div>
                      <UserPlus size={14} style={{ color: 'var(--accent)' }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 이메일로 초대 (미가입자도 OK) */}
          {isOwner && (
            <div>
              <p className="text-xs uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
                이메일로 초대
              </p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--text-muted)' }} />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void inviteByEmail() }}
                    placeholder="newmember@example.com"
                    disabled={inviting}
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm"
                    style={{
                      background: 'var(--surface-3)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
                <button
                  onClick={() => void inviteByEmail()}
                  disabled={inviting || !inviteEmail.trim()}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  {inviting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  초대
                </button>
              </div>
              {inviteOk && (
                <p className="text-[11px] mt-2" style={{ color: 'var(--ok)' }}>
                  {inviteOk}
                </p>
              )}

              {pending.length > 0 && (
                <div className="mt-3 space-y-1">
                  {pending.map(p => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                      style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
                    >
                      <Clock size={11} style={{ color: 'var(--text-muted)' }} />
                      <span className="text-[12px] flex-1 min-w-0 truncate" style={{ color: 'var(--text-secondary)' }}>
                        {p.email}
                      </span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}
                      >
                        대기중
                      </span>
                      <button
                        onClick={() => void cancelInvitation(p.id)}
                        className="p-1 rounded hover-surface"
                        title="취소"
                      >
                        <X size={11} style={{ color: 'var(--danger)' }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 에러 */}
          {err && (
            <div className="text-xs p-2 rounded" style={{ color: 'var(--danger)', background: 'var(--danger-bg)' }}>
              {err}
            </div>
          )}

          {/* 현재 멤버 */}
          <div>
            <p className="text-xs uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
              현재 멤버 ({members.length})
            </p>
            {loading && <Loader2 size={14} className="animate-spin" />}
            <div className="space-y-1">
              {members.map(m => {
                const isMemberOwner = m.role === 'owner'
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 p-2 rounded-lg"
                    style={{ background: 'var(--surface-2)' }}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{ background: 'var(--accent)' }}
                    >
                      {m.avatar_url
                        ? <img src={m.avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
                        : (m.display_name || m.email)[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {m.display_name || m.email}
                      </p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{m.email}</p>
                    </div>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                      style={{
                        background: isMemberOwner ? 'var(--warning-bg)' : 'var(--surface-3)',
                        color: isMemberOwner ? 'var(--warning)' : 'var(--text-secondary)',
                      }}
                    >
                      {isMemberOwner && <Crown size={10} />}
                      {m.role}
                    </span>
                    {isOwner && !isMemberOwner && (
                      <button
                        onClick={() => removeMember(m.user_id)}
                        className="p-1 rounded hover-surface"
                        title="제거"
                      >
                        <Trash2 size={13} style={{ color: 'var(--danger)' }} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {!isOwner && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              owner만 멤버를 추가하거나 제거할 수 있어요.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
