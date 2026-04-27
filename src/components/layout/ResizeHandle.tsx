'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  // 'right' = 컨테이너의 오른쪽에 붙어 → 우측으로 드래그하면 컨테이너가 넓어짐 (왼쪽 사이드바 패턴)
  // 'left'  = 컨테이너의 왼쪽에 붙어 → 좌측으로 드래그하면 컨테이너가 넓어짐 (오른쪽 사이드바 패턴)
  side: 'right' | 'left'
  width: number
  onChange: (next: number) => void
  min?: number
  max?: number
}

export default function ResizeHandle({ side, width, onChange, min = 180, max = 600 }: Props) {
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  useEffect(() => {
    if (!dragging) return

    function onMove(e: MouseEvent) {
      const dx = e.clientX - startXRef.current
      const next = side === 'right'
        ? startWidthRef.current + dx
        : startWidthRef.current - dx
      const clamped = Math.max(min, Math.min(max, next))
      onChange(clamped)
    }
    function onUp() { setDragging(false) }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, onChange, side, min, max])

  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault()
        startXRef.current = e.clientX
        startWidthRef.current = width
        setDragging(true)
      }}
      className="absolute top-0 bottom-0 z-30 group"
      style={{
        [side]: -3,
        width: 6,
        cursor: 'col-resize',
      }}
    >
      <div
        className="w-px h-full mx-auto transition-colors"
        style={{
          background: dragging ? 'var(--accent)' : 'var(--border)',
        }}
      />
      {/* 호버 시 강조 */}
      <div
        className="absolute inset-y-0 mx-auto"
        style={{
          width: 2,
          left: 2,
          background: dragging ? 'var(--accent)' : 'transparent',
          opacity: dragging ? 1 : 0,
        }}
      />
    </div>
  )
}
