'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, X, ImageIcon, Film, Loader2 } from 'lucide-react'

export type ToastType = 'info' | 'success' | 'error'
export type GenerationType = 't2i' | 'i2v' | 't2v'

interface ToastItem {
  id: string
  type: ToastType
  genType: GenerationType
  title: string
  message?: string
  duration?: number
}

// ── 글로벌 토스트 큐 (단일 인스턴스 패턴) ─────────────────────────────────
type ToastHandler = (item: Omit<ToastItem, 'id'>) => void
let globalHandler: ToastHandler | null = null

export function pushToast(item: Omit<ToastItem, 'id'>) {
  if (globalHandler) globalHandler(item)
}

// ── 개별 토스트 ─────────────────────────────────────────────────────────────

const GEN_ICON: Record<GenerationType, React.ElementType> = {
  t2i: ImageIcon,
  i2v: Film,
  t2v: Film,
}

const GEN_LABEL: Record<GenerationType, string> = {
  t2i: '이미지 생성',
  i2v: '영상 생성',
  t2v: 'T2V 생성',
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: (id: string) => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    const t = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onClose(item.id), 300)
    }, item.duration ?? 5000)
    return () => clearTimeout(t)
  }, [item.id, item.duration])

  const Icon = GEN_ICON[item.genType]

  const palette = {
    info:    { bg: 'var(--bg-2)', border: 'var(--accent-line)', icon: 'var(--accent)', text: 'var(--ink)', soft: 'var(--accent-soft)' },
    success: { bg: 'var(--bg-2)', border: 'var(--ok)',          icon: 'var(--ok)',     text: 'var(--ink)', soft: 'var(--ok-soft)' },
    error:   { bg: 'var(--bg-2)', border: 'var(--danger)',      icon: 'var(--danger)', text: 'var(--ink)', soft: 'var(--danger-soft)' },
  }[item.type]

  const StatusIcon = item.type === 'info'
    ? Loader2
    : item.type === 'success'
      ? CheckCircle2
      : XCircle

  return (
    <div
      className="relative flex items-start gap-3"
      style={{
        padding: '12px 14px',
        borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-lg)',
        background:   palette.bg,
        border:       `1px solid var(--line)`,
        minWidth:     '280px',
        maxWidth:     '360px',
        opacity:      visible ? 1 : 0,
        transform:    visible ? 'translateY(0)' : 'translateY(12px)',
        transition:   'opacity 0.25s ease, transform 0.25s ease',
      }}
    >
      {/* Left accent bar */}
      <div
        className="absolute"
        style={{
          left: 0, top: 12, bottom: 12,
          width: 3,
          background: palette.border,
          borderRadius: '0 2px 2px 0',
        }}
      />

      {/* Gen type icon */}
      <div
        className="shrink-0 flex items-center justify-center"
        style={{
          width: 30, height: 30,
          borderRadius: 'var(--r-md)',
          background: palette.soft,
        }}
      >
        <Icon size={14} style={{ color: palette.icon }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <StatusIcon
            size={13}
            style={{ color: palette.icon }}
            className={item.type === 'info' ? 'animate-spin' : ''}
          />
          <p className="text-xs font-semibold truncate" style={{ color: palette.text }}>
            {item.title}
          </p>
        </div>
        {item.message && (
          <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            {item.message}
          </p>
        )}
        <p className="text-[10px] mt-1" style={{ color: 'var(--ink-4)' }}>
          {GEN_LABEL[item.genType]}
        </p>
      </div>

      {/* Close */}
      <button
        onClick={() => { setVisible(false); setTimeout(() => onClose(item.id), 300) }}
        className="shrink-0 p-1 rounded-lg transition-all hover-surface"
        style={{ color: 'var(--text-muted)' }}
      >
        <X size={11} />
      </button>
    </div>
  )
}

// ── ToastProvider (app/layout 에 마운트) ────────────────────────────────────

export function GenerationToastProvider() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    globalHandler = (item) => {
      const id = `toast_${Date.now()}_${Math.random()}`
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
      style={{ bottom: '24px', right: '24px' }}
    >
      {toasts.map(t => (
        <ToastCard key={t.id} item={t} onClose={close} />
      ))}
    </div>
  )
}
