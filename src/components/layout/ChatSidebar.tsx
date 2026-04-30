'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { MessageSquare, Send, ChevronRight, Hash, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

interface MessageRow {
  id: string
  project_id: string
  user_id: string
  content: string
  scene_mentions: string[]
  created_at: string
  user_email?: string
  user_display_name?: string
  user_avatar_url?: string
  pending?: boolean
}

interface SceneLite {
  id: string
  scene_number: string
  title: string
}

const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6']
function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
function initials(s: string) {
  if (!s) return '?'
  if (s.includes('@')) return s[0].toUpperCase()
  const w = s.trim().split(/\s+/)
  return w.length >= 2 ? (w[0][0] + w[1][0]).toUpperCase() : s.slice(0,2).toUpperCase()
}
function formatTime(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  if (sameDay) return `${hh}:${mm}`
  return `${d.getMonth()+1}/${d.getDate()} ${hh}:${mm}`
}

function renderContent(content: string, sceneMap: Map<string, SceneLite>, projectId: string) {
  const re = /#(\d+(?:-\d+){0,2})/g
  const out: Array<{ type: 'text' | 'mention'; value: string; sceneId?: string }> = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: content.slice(last, m.index) })
    const num = m[1]
    const scene = sceneMap.get(num)
    out.push({ type: scene ? 'mention' : 'text', value: m[0], sceneId: scene?.id })
    last = m.index + m[0].length
  }
  if (last < content.length) out.push({ type: 'text', value: content.slice(last) })
  return out.map((seg, i) => {
    if (seg.type === 'mention' && seg.sceneId) {
      return (
        <Link key={i} href={`/project/${projectId}/scenes#${seg.sceneId}`}
          className="inline-flex items-center px-1.5 rounded font-medium"
          style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
          {seg.value}
        </Link>
      )
    }
    return <span key={i}>{seg.value}</span>
  })
}

interface MeInfo { id: string; email: string; name: string; avatar: string }

export default function ChatSidebar({
  projectId, open, onClose,
}: {
  projectId: string
  open: boolean
  onClose: () => void
}) {
  const supabase = createClient()
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [scenes, setScenes] = useState<SceneLite[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [me, setMe] = useState<MeInfo | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')

  const listRef = useRef<HTMLDivElement | null>(null)
  const meRef = useRef<MeInfo | null>(null)
  useEffect(() => { meRef.current = me }, [me])

  const sceneMap = useMemo(() => {
    const m = new Map<string, SceneLite>()
    for (const s of scenes) m.set(s.scene_number, s)
    return m
  }, [scenes])

  const fetchMessages = useCallback(async () => {
    const r = await fetch(`/api/projects/${projectId}/chat`)
    if (!r.ok) return
    const j = await r.json()
    setMessages(j.messages ?? [])
    setLoaded(true)
  }, [projectId])

  useEffect(() => {
    if (!open) return
    let mounted = true
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!mounted || !user) return
      const meta = (user.user_metadata ?? {}) as Record<string, any>
      setMe({
        id: user.id,
        email: user.email ?? '',
        name: String(meta.display_name ?? meta.full_name ?? meta.name ?? ''),
        avatar: String(meta.avatar_url ?? ''),
      })
      const { data: sc } = await supabase
        .from('scenes').select('id, scene_number, title').eq('project_id', projectId).order('order_index')
      if (!mounted) return
      setScenes(sc ?? [])
      await fetchMessages()
    })()

    const ch = supabase
      .channel(`project-chat-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'project_messages', filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as any
          setMessages(prev => {
            if (prev.some(m => m.id === row.id)) return prev
            const meSnap = meRef.current
            if (meSnap && row.user_id === meSnap.id) {
              const idx = prev.findIndex(m => m.pending && m.user_id === row.user_id && m.content === row.content)
              if (idx >= 0) {
                const next = [...prev]
                next[idx] = { ...row, user_email: meSnap.email, user_display_name: meSnap.name, user_avatar_url: meSnap.avatar }
                return next
              }
            }
            return [...prev, { ...row, user_email: '', user_display_name: '', user_avatar_url: '' }]
          })
        },
      )
      .subscribe()

    return () => {
      mounted = false
      supabase.removeChannel(ch)
    }
  }, [open, projectId, supabase, fetchMessages])

  useEffect(() => {
    if (!open || !listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, open])

  useEffect(() => {
    const m = /#(\d*-?\d*-?\d*)$/.exec(draft)
    if (m && draft.length > 0) {
      setShowMentions(true)
      setMentionQuery(m[1])
    } else {
      setShowMentions(false)
    }
  }, [draft])

  const mentionMatches = useMemo(() => {
    if (!showMentions) return []
    return scenes
      .filter(s => s.scene_number.startsWith(mentionQuery) || s.title.toLowerCase().includes(mentionQuery.toLowerCase()))
      .slice(0, 6)
  }, [scenes, mentionQuery, showMentions])

  function applyMention(s: SceneLite) {
    const re = /#(\d*-?\d*-?\d*)$/
    setDraft(prev => prev.replace(re, `#${s.scene_number} `))
    setShowMentions(false)
  }

  async function send() {
    const content = draft.trim()
    if (!content || sending || !me) return

    const mentions: string[] = []
    const re = /#(\d+(?:-\d+){0,2})/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const sc = sceneMap.get(m[1])
      if (sc) mentions.push(sc.id)
    }

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2,7)}`
    const optimistic: MessageRow = {
      id: tempId,
      project_id: projectId,
      user_id: me.id,
      content,
      scene_mentions: mentions,
      created_at: new Date().toISOString(),
      user_email: me.email,
      user_display_name: me.name,
      user_avatar_url: me.avatar,
      pending: true,
    }

    setMessages(prev => [...prev, optimistic])
    setDraft('')
    setSending(true)

    try {
      const r = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, sceneMentions: mentions }),
      })
      const j = await r.json()
      if (!r.ok) {
        setMessages(prev => prev.filter(x => x.id !== tempId))
        setDraft(content)
        return
      }
      const real = j.message
      if (real) {
        setMessages(prev => prev.map(x => x.id === tempId
          ? { ...real, user_email: me.email, user_display_name: me.name, user_avatar_url: me.avatar }
          : x))
      }
    } catch {
      setMessages(prev => prev.filter(x => x.id !== tempId))
      setDraft(content)
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !showMentions) {
      e.preventDefault()
      void send()
    }
  }

  if (!open) return null

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg)' }}>
      <div
        className="flex items-center gap-2"
        style={{
          padding: '12px 16px',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <MessageSquare size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>팀 채팅</span>
        <button
          onClick={onClose}
          className="ml-auto rounded"
          style={{ padding: 4, color: 'var(--ink-4)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          title="접기"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {!loaded && (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={14} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        )}
        {loaded && messages.length === 0 && (
          <div className="text-center py-10 text-xs" style={{ color: 'var(--text-muted)' }}>
            첫 메시지를 남겨보세요. 씬 멘션은 <code className="text-[10px]">#1-1-1</code> 처럼.
          </div>
        )}
        {messages.map((msg, idx) => {
          const prev = messages[idx - 1]
          const sameAuthorAsPrev = prev && prev.user_id === msg.user_id
            && (new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime()) < 5 * 60_000
          const isMe = me?.id === msg.user_id

          return (
            <div key={msg.id} className="flex gap-2" style={{ opacity: msg.pending ? 0.55 : 1 }}>
              <div className="w-7 shrink-0">
                {!sameAuthorAsPrev && (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ background: colorFor(msg.user_id) }}>
                    {msg.user_avatar_url
                      ? <img src={msg.user_avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
                      : initials(msg.user_display_name || msg.user_email || msg.user_id)}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                {!sameAuthorAsPrev && (
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {msg.user_display_name || msg.user_email || (isMe ? '나' : '멤버')}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {formatTime(msg.created_at)}{msg.pending && ' · 전송 중...'}
                    </span>
                  </div>
                )}
                <div className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)' }}>
                  {renderContent(msg.content, sceneMap, projectId)}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t relative" style={{ borderColor: 'var(--border)' }}>
        {showMentions && mentionMatches.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 mb-1 rounded-lg shadow-lg max-h-48 overflow-y-auto"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            {mentionMatches.map(s => (
              <button key={s.id} onClick={() => applyMention(s)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover-surface">
                <Hash size={11} style={{ color: 'var(--accent)' }} />
                <span className="font-mono font-semibold" style={{ color: 'var(--accent)' }}>
                  {s.scene_number}
                </span>
                <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{s.title}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2" style={{ padding: 10 }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="메시지... (씬 멘션 #1-1-1)"
            rows={1}
            className="flex-1 resize-none"
            style={{
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              padding: '8px 12px',
              color: 'var(--ink)',
              fontSize: 13,
              outline: 'none',
              maxHeight: 120,
            }}
          />
          <button
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            className="disabled:opacity-40"
            style={{
              background: 'var(--accent)', color: '#fff',
              padding: 8, borderRadius: 'var(--r-md)',
              border: '1px solid var(--accent)',
            }}
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
