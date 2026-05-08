'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react'

export interface LightboxItem {
  url: string
  name?: string
  caption?: string
  isVideo?: boolean
}

interface ImageLightboxProps {
  items: LightboxItem[]
  initialIndex?: number
  onClose: () => void
}

export default function ImageLightbox({ items, initialIndex = 0, onClose }: ImageLightboxProps) {
  const [idx, setIdx] = useState(Math.max(0, Math.min(initialIndex, items.length - 1)))

  const go = useCallback((dir: -1 | 1) => {
    if (items.length <= 1) return
    setIdx(i => (i + dir + items.length) % items.length)
  }, [items.length])

  // 키보드 단축키
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); go(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1)  }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose])

  if (items.length === 0) return null
  const cur = items[idx]
  const hasMany = items.length > 1

  function handleDownload() {
    // 서버 프록시로 요청 — Content-Disposition: attachment 으로 강제 다운로드 (CORS 우회)
    const filename = cur.name || `${cur.isVideo ? 'video' : 'image'}_${idx + 1}.${cur.isVideo ? 'mp4' : 'png'}`
    const proxyUrl = `/api/download?url=${encodeURIComponent(cur.url)}&name=${encodeURIComponent(filename)}`
    const a = document.createElement('a')
    a.href = proxyUrl
    a.download = filename  // 힌트 (서버가 Content-Disposition으로 우선 결정)
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0, 0, 0, 0.88)',
        backdropFilter: 'blur(6px)',
        display: 'flex', flexDirection: 'column',
        animation: 'lightbox-fade 0.15s ease',
      }}
    >
      {/* 상단 바 */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          color: '#fff',
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14, fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              opacity: 0.95,
            }}
            title={cur.name}
          >
            {cur.name || '이미지'}
          </div>
          {cur.caption && (
            <div
              style={{
                fontSize: 11, opacity: 0.65, marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
              title={cur.caption}
            >
              {cur.caption}
            </div>
          )}
        </div>
        {hasMany && (
          <span style={{ fontSize: 12, opacity: 0.7, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {idx + 1} / {items.length}
          </span>
        )}
        <button
          onClick={handleDownload}
          title="다운로드"
          style={{
            padding: 8, borderRadius: 8,
            background: 'rgba(255,255,255,0.1)',
            color: '#fff', flexShrink: 0,
          }}
        >
          <Download size={16} />
        </button>
        <button
          onClick={onClose}
          title="닫기 (ESC)"
          style={{
            padding: 8, borderRadius: 8,
            background: 'rgba(255,255,255,0.1)',
            color: '#fff', flexShrink: 0,
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* 본문 */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          flex: 1, position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 60px 24px',
          minHeight: 0,
        }}
      >
        {hasMany && (
          <button
            onClick={() => go(-1)}
            title="이전 (←)"
            style={{
              position: 'absolute', left: 12,
              padding: 12, borderRadius: 999,
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              display: 'grid', placeItems: 'center',
            }}
          >
            <ChevronLeft size={22} />
          </button>
        )}
        {cur.isVideo ? (
          <video
            src={cur.url}
            controls
            autoPlay
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }}
          />
        ) : (
          <img
            src={cur.url}
            alt={cur.name ?? ''}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 8,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          />
        )}
        {hasMany && (
          <button
            onClick={() => go(1)}
            title="다음 (→)"
            style={{
              position: 'absolute', right: 12,
              padding: 12, borderRadius: 999,
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              display: 'grid', placeItems: 'center',
            }}
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>

      <style>{`
        @keyframes lightbox-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
