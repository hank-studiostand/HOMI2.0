'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// 페이지 전체에 깔리는 라이브 커서 오버레이.
// — Supabase Realtime broadcast 채널로 30fps throttled mousemove 이벤트 송수신.
// — 본인 커서는 그리지 않음(기본 OS 커서로 충분)
// — 좌표는 viewport (clientX/Y) 기준이지만, 페이지 스크롤 위치 차이 보정 위해
//   페이지 절대좌표(window.scrollX/Y 더한 값)로 송신하고, 수신측은 자기 스크롤을
//   빼서 화면에 그린다.

interface RemoteCursor {
  id: string
  x: number               // 페이지 절대 좌표
  y: number
  name: string
  color: string
  lastSeen: number
}

const AVATAR_COLORS = ['#f97316','#0284c7','#7c3aed','#22c55e','#ec4899','#eab308','#dc2626','#14b8a6']
function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

const SEND_INTERVAL_MS = 33   // ~30fps
const STALE_MS         = 5_000  // 5초 무소식이면 사라짐

export default function LiveCursors({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({})
  const [scroll, setScroll] = useState({ x: 0, y: 0 })
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const meIdRef = useRef<string | null>(null)
  const lastSentRef = useRef(0)
  const pendingRef = useRef<{ x: number; y: number } | null>(null)

  // 채널 set up
  useEffect(() => {
    let mounted = true
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !mounted) return
      meIdRef.current = user.id

      const meta = (user.user_metadata ?? {}) as Record<string, any>
      const myName = String(meta.display_name ?? meta.full_name ?? user.email ?? 'me')

      const channel = supabase.channel(`cursors:${projectId}`, {
        config: { broadcast: { self: false } },
      })

      channel.on('broadcast', { event: 'cursor' }, ({ payload }) => {
        if (!mounted) return
        const p = payload as { id: string; x: number; y: number; name: string; color: string }
        if (p.id === meIdRef.current) return
        setCursors(prev => ({
          ...prev,
          [p.id]: { ...p, lastSeen: Date.now() },
        }))
      })

      channel.on('broadcast', { event: 'leave' }, ({ payload }) => {
        if (!mounted) return
        setCursors(prev => {
          const next = { ...prev }
          delete next[(payload as any).id]
          return next
        })
      })

      await channel.subscribe()
      channelRef.current = channel

      // mousemove → throttle → broadcast
      function onMove(e: MouseEvent) {
        pendingRef.current = {
          x: e.clientX + window.scrollX,
          y: e.clientY + window.scrollY,
        }
        const now = Date.now()
        if (now - lastSentRef.current < SEND_INTERVAL_MS) return
        lastSentRef.current = now
        const p = pendingRef.current
        if (!p || !channelRef.current) return
        void channelRef.current.send({
          type: 'broadcast',
          event: 'cursor',
          payload: {
            id: meIdRef.current,
            name: myName,
            color: colorFor(meIdRef.current!),
            x: p.x,
            y: p.y,
          },
        })
      }

      function onLeave() {
        if (!channelRef.current || !meIdRef.current) return
        void channelRef.current.send({
          type: 'broadcast',
          event: 'leave',
          payload: { id: meIdRef.current },
        })
      }

      function onScroll() {
        setScroll({ x: window.scrollX, y: window.scrollY })
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('beforeunload', onLeave)

      // stale cursor cleanup
      const cleanupTimer = setInterval(() => {
        if (!mounted) return
        setCursors(prev => {
          const cutoff = Date.now() - STALE_MS
          const next: Record<string, RemoteCursor> = {}
          for (const [id, c] of Object.entries(prev)) {
            if (c.lastSeen >= cutoff) next[id] = c
          }
          return next
        })
      }, 1_000)

      // cleanup
      return () => {
        clearInterval(cleanupTimer)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('scroll', onScroll)
        window.removeEventListener('beforeunload', onLeave)
      }
    })()

    return () => {
      mounted = false
      if (channelRef.current && meIdRef.current) {
        void channelRef.current.send({
          type: 'broadcast',
          event: 'leave',
          payload: { id: meIdRef.current },
        })
      }
      channelRef.current?.unsubscribe()
    }
  }, [projectId, supabase])

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[60]"
      aria-hidden
      style={{ overflow: 'hidden' }}
    >
      {Object.values(cursors).map(c => {
        const screenX = c.x - scroll.x
        const screenY = c.y - scroll.y
        // viewport 밖이면 안 그림
        if (screenX < -50 || screenY < -50 || screenX > window.innerWidth + 50 || screenY > window.innerHeight + 50) {
          return null
        }
        return (
          <div
            key={c.id}
            style={{
              position: 'absolute',
              transform: `translate(${screenX}px, ${screenY}px)`,
              transition: 'transform 80ms linear',
              willChange: 'transform',
            }}
          >
            {/* 화살표 */}
            <svg width="20" height="22" viewBox="0 0 20 22" style={{ display: 'block' }}>
              <path
                d="M3 2 L3 18 L7 14 L10 20 L13 19 L10 13 L17 13 Z"
                fill={c.color}
                stroke="white"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            {/* 이름 라벨 */}
            <div
              style={{
                marginTop: 2,
                marginLeft: 12,
                padding: '2px 8px',
                borderRadius: 6,
                background: c.color,
                color: 'white',
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              }}
            >
              {c.name}
            </div>
          </div>
        )
      })}
    </div>
  )
}
