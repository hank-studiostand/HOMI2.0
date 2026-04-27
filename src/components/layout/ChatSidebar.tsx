'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { MessageSquare, Send, X, ChevronRight, Hash, Loader2 } from 'lucide-react'
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

// "#1-1-1" / "#3" 패턴 → 씬 멘션 링크. 매칭 안 되는 #는 일반 텍스트로.
function renderContent(content: string, sceneMap: Map<string, SceneLite>, projectId: string) {
  // 씬 번호 형식: 1-1-1 / 1-1 / 1 (숫자 + 옵션 - 숫자 - 숫자)
  const re = /#(\d+(?:-\d+){0,2})/g
  const out: Array<{ type: 'text' | 'mention'; value: string; sceneId?: string }> = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: content.slice(last, m.index) })
    const num = m[1]
    const scene = sceneMap.get(num)
    out.push({
      type: scene ? 'mention' : 'text',
      value: m[0],
      sceneId: scene?.id,
    })
    last = m.index + m[0].length
  }
  if (last < content.length) out.push({ type: 'text', value: content.slice(last) })

  return out.map((seg, i) => {
    if (seg.type === 'mention' && seg.sceneId) {
      return (
        <Link
          key={i}
          href={`/project/${projectId}/scenes#${seg.sceneId}`}
          className="inline-flex items-center px-1.5 rounded font-medium"
          style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
        >
          {seg.value}
        </Link>
      )
    }
    return <span key={i}>{seg.value}</span>
  })
}

export default function ChatSidebar({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [scenes, setScenes] = useState<SceneLite[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [meId, setMeId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')

  const listRef = useRef<HTMLDivElement | null>(null)

  // scene_number → SceneLite 맵 (멘션 변환용)
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

  // 처음 열 때 메시지/씬 로드 + Realtime 구독
  useEffect(() => {
    if (!open) return
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setMeId(user?.id ?? null)

      // 씬 목록 (멘션 변환용)
      const { data: sc } = await supabase
        .from('scenes').select('id, scene_number, title').eq('project_id', projectId).order('order_index')
      setScenes(sc ?? [])

      await fetchMessages()
    })()

    // Realtime 구독 — 새 메시지 들어오면 추가
    const ch = supabase
      .channel(`project-chat-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'project_messages', filter: `project_id=eq.${projectId}` },
        () => fetchMessages(),
      )
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [open, projectId, supabase, fetchMessages])

  // 새 메시지 도착 시 스크롤 맨 아래로
  useEffect(() => {
    if (!open || !listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, open])

  // # 입력 추적 → 자동완성
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
    if (!content || sending) return
    setSending(true)

    // 멘션 ID 추출
    const mentions: string[] = []
    const re = /#(\d+(?:-\d+){0,2})/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const sc = sceneMap.get(m[1])
      if (sc) mentions.push(sc.id)
    }

    try {
      const r = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, sceneMentions: mentions }),
      })
      if (r.ok) setDraft('')
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

  return (
    <>
      {/* 토글 버튼 (사이드바 닫혔을 때만 보임) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-3 bottom-4 z-40 flex items-center gap-2 px-3 py-2 rounded-full shadow-lg hover:scale-105 transition-transform"
          style={{ background: 'var(--accent)', color: 'white' }}
          title="팀 채팅"
        >
          <MessageSquare size={14} />
          <span className="text-xs font-semibold">팀 채팅</span>
        </button>
      )}

      {/* 사이드바 */}
      {open && (
        <aside
          className="fixed top-0 right-0 z-40 h-full flex flex-col"
          style={{
            width: 340,
            background: 'var(--surface)',
            borderLeft: '1px solid var(--border)',
            boxShadow: '-4px 0 16px rgba(0,0,0,0.1)',
          }}
        >
          {/* 헤더 */}
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <MessageSquare size={14} style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>팀 채팅</span>
            <button onClick={() => setOpen(false)} className="ml-auto hover-surface p-1 rounded" title="접기">
              <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>

          {/* 메시지 리스트 */}
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
              const isMe = msg.user_id === meId

              return (
                <div key={msg.id} className="flex gap-2">
                  {/* 아바타 */}
                  <div className="w-7 shrink-0">
                    {!sameAuthorAsPrev && (
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                        style={{ background: colorFor(msg.user_id) }}
                      >
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
                          {msg.user_display_name || msg.user_email || (isMe ? '나' : '익명')}
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {formatTime(msg.created_at)}
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

          {/* 입력창 */}
          <div className="border-t relative" style={{ borderColor: 'var(--border)' }}>
            {/* 씬 멘션 자동완성 */}
            {showMentions && mentionMatches.length > 0 && (
              <div
                className="absolute bottom-full left-2 right-2 mb-1 rounded-lg shadow-lg max-h-48 overflow-y-auto"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                {mentionMatches.map(s => (
                  <button
                    key={s.id}
                    onClick={() => applyMention(s)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover-surface"
                  >
                    <Hash size={11} style={{ color: 'var(--accent)' }} />
                    <span className="font-mono font-semibold" style={{ color: 'var(--accent)' }}>
                      {s.scene_number}
                    </span>
                    <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{s.title}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2 p-2">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="메시지... (씬 멘션 #1-1-1)"
                rows={1}
                className="flex-1 px-3 py-2 rounded-lg text-sm resize-none"
                style={{
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  maxHeight: 120,
                }}
              />
              <button
                onClick={() => void send()}
                disabled={!draft.trim() || sending}
                className="p-2 rounded-lg disabled:opacity-40"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                <Send size={13} />
              </button>
            </div>
          </div>
        </aside>
      )}
    </>
  )
}
