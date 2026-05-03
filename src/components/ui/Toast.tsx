'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'

// 일반 알림용 토스트 — alert() 대체
// (생성 결과 토스트는 GenerationToast.tsx 에 별도)

export type ToastKind = 'info' | 'success' | 'error' | 'warning'

interface ToastItem {
  id: string
  kind: ToastKind
  title: string
  message?: string
  duration?: number
}

type ToastHandler = (item: Omit<ToastItem, 'id'>) => void
let globalHandler: ToastHandler | null = null

export function toast(item: Omit<ToastItem, 'id'>) {
  if (globalHandler) globalHandler(item)
  else {
    // SSR/초기 마운트 전 안전 폴백
    if (item.kind === 'error') console.error(item.title, item.message ?? '')
    else console.log(item.title, item.message ?? '')
  }
}

// 편의 메서드들
toast.success = (title: string, message?: string) => toast({ kind: 'success', title, message })
toast.error   = (title: string, message?: string) => toast({ kind: 'error',   title, message })
toast.warning = (title: string, message?: string) => toast({ kind: 'warning', title, message })
toast.info    = (title: string, message?: string) => toast({ kind: 'info',    title, message })

const KIND_META: Record<ToastKind, { icon: React.ElementType; color: string; soft: string }> = {
  info:    { icon: Info,           color: 'var(--info)',   soft: 'var(--info-soft)' },
  success: { icon: CheckCircle2,   color: 'var(--ok)',     soft: 'var(--ok-soft)' },
  error:   { icon: XCircle,        color: 'var(--danger)', soft: 'var(--danger-soft)' },
  warning: { icon: AlertTriangle,  color: 'var(--warn)',   soft: 'var(--warn-soft)' },
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: (id: string) => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    const t = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onClose(item.id), 300)
    }, item.duration ?? (item.kind === 'error' ? 6500 : 4500))
    return () => clearTimeout(t)
  }, [item.id, item.duration, item.kind])

  const meta = KIND_META[item.kind]
  const Icon = meta.icon

  return (
    <div
      className="relative flex items-start gap-3"
      style={{
        padding: '12px 14px',
        borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-lg)',
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        minWidth: '280px',
        maxWidth: '380px',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
      }}
    >
      <div
        className="absolute"
        style={{
          left: 0, top: 12, bottom: 12,
          width: 3,
          background: meta.color,
          borderRadius: '0 2px 2px 0',
        }}
      />
      <div
        className="shrink-0 flex items-center justify-center"
        style={{
          width: 30, height: 30,
          borderRadius: 'var(--r-md)',
          background: meta.soft,
        }}
      >
        <Icon size={14} style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
          {item.title}
        </p>
        {item.message && (
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--ink-3)', whiteSpace: 'pre-wrap' }}>
            {item.message}
          </p>
        )}
      </div>
      <button
        onClick={() => { setVisible(false); setTimeout(() => onClose(item.id), 300) }}
        className="shrink-0 p-1 rounded-lg"
        style={{ color: 'var(--ink-4)' }}
      >
        <X size={11} />
      </button>
    </div>
  )
}

export function ToastProvider() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    globalHandler = (item) => {
      const id = `gtoast_${Date.now()}_${Math.random()}`
      setToasts(prev => [...prev, { ...item, id }])
    }
    return () => { globalHandler = null }
  }, [])

  function close(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed z-[9999] flex flex-col gap-2"
      style={{ bottom: '24px', left: '24px' }}
    >
      {toasts.map(t => (
        <ToastCard key={t.id} item={t} onClose={close} />
      ))}
    </div>
  )
}
