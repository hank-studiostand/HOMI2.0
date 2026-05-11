'use client'

// 일반 에셋 업로드 — 이미지 / 영상 / 음악 모두 지원
// Start Frame / End Frame / Reference 슬롯과 별개로, 자유롭게 프로젝트에 미디어를 업로드.
// 업로드된 파일은 assets 테이블에 type='reference', metadata.kind = 'image|video|audio',
// metadata.source = 'upload'로 저장되어 라이브러리에 누적됨.

import { useRef, useState, useCallback } from 'react'
import { Upload, Image as ImageIcon, Film, Music, X, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type AssetKind = 'image' | 'video' | 'audio'

export interface UploadedAsset {
  id: string
  url: string
  name: string
  kind: AssetKind
}

interface Props {
  projectId: string
  sceneId?: string | null
  // 업로드 후 호출 — 부모가 즉시 반영하고 싶을 때
  onUploaded?: (asset: UploadedAsset) => void
  // 초기 업로드 히스토리 (외부에서 관리하면 패스)
  recent?: UploadedAsset[]
  // 컴팩트 모드 (좁은 패널용 — 라벨 없음)
  compact?: boolean
  // 내부 썸네일 그리드 숨김 (부모가 Elements 같은 자체 UI로 보여줄 때)
  hideRecentGrid?: boolean
}

function detectKind(file: File): AssetKind | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return null
}

function sanitize(name: string): string {
  // 한글/특수문자가 storage path에서 잘리는 이슈 방지
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
}

export default function AssetUploadButton({
  projectId, sceneId = null, onUploaded, recent = [], compact = false, hideRecentGrid = false,
}: Props) {
  const supabase = createClient()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<UploadedAsset[]>(recent)
  const [error, setError] = useState<string | null>(null)

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setError(null)
    const next: UploadedAsset[] = []
    for (const file of Array.from(files)) {
      const kind = detectKind(file)
      if (!kind) {
        setError(`${file.name} — 지원하지 않는 형식 (이미지/영상/음악만)`)
        continue
      }
      try {
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
        const safeName = sanitize(file.name) || `upload.${ext}`
        const path = `uploads/${projectId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${safeName}`
        const { data, error: upErr } = await supabase.storage.from('assets').upload(path, file, {
          contentType: file.type, upsert: false,
        })
        if (upErr) throw upErr
        const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(data.path)

        // assets 테이블 row 생성
        const { data: row, error: insErr } = await supabase.from('assets').insert({
          project_id: projectId,
          scene_id:   sceneId ?? null,
          type:       'reference',                    // 일반 업로드는 reference 타입
          name:       file.name,
          url:        publicUrl,
          tags:       ['upload', kind],
          metadata:   {
            source:    'upload',
            kind,
            mime:      file.type,
            size_kb:   Math.round(file.size / 1024),
            uploaded_at: new Date().toISOString(),
          },
        }).select().single()
        if (insErr || !row) throw insErr ?? new Error('insert 실패')

        const asset: UploadedAsset = {
          id: row.id, url: publicUrl, name: file.name, kind,
        }
        next.push(asset)
        onUploaded?.(asset)
      } catch (e: any) {
        setError(e?.message ?? String(e))
      }
    }
    if (next.length > 0) {
      setItems(prev => [...next, ...prev])
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }, [projectId, sceneId, supabase, onUploaded])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        style={{ display: 'none' }}
        onChange={e => handleFiles(e.target.files)}
      />

      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        style={{
          padding: compact ? '6px 10px' : '10px 14px',
          background: 'var(--bg-2)',
          border: '1px dashed var(--line)',
          borderRadius: 'var(--r-md)',
          color: 'var(--ink-2)',
          fontSize: compact ? 11 : 12,
          fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.7 : 1,
        }}
        title="이미지·영상·음악 업로드 (Drag & Drop 시에는 페이지 위에 놓아주세요)"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
        <span>{compact ? '에셋 업로드' : '에셋 업로드 (이미지·영상·음악)'}</span>
      </button>

      {error && (
        <div style={{
          padding: '6px 10px',
          background: 'color-mix(in oklab, var(--err) 8%, transparent)',
          border: '1px solid color-mix(in oklab, var(--err) 30%, transparent)',
          borderRadius: 'var(--r-sm)',
          color: 'var(--err)', fontSize: 11,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <X size={11} />
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: 'transparent', color: 'var(--err)' }}>닫기</button>
        </div>
      )}

            {/* 업로드 히스토리 (이번 세션) — 부모가 자체 UI 사용 시 숨김 */}
      {!hideRecentGrid && items.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: compact ? 'repeat(3, 1fr)' : 'repeat(auto-fill, minmax(72px, 1fr))',
          gap: 6,
        }}>
          {items.slice(0, 12).map(it => (
            <div
              key={it.id}
              title={`${it.name} (${it.kind})`}
              style={{
                aspectRatio: '1/1',
                borderRadius: 'var(--r-sm)',
                background: 'var(--bg-3)',
                border: '1px solid var(--line)',
                overflow: 'hidden',
                position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {it.kind === 'image' && (
                <img src={it.url} alt={it.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              {it.kind === 'video' && (
                <video src={it.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              {it.kind === 'audio' && (
                <Music size={20} style={{ color: 'var(--accent)' }} />
              )}
              <div
                style={{
                  position: 'absolute', top: 3, left: 3,
                  padding: '1px 4px', borderRadius: 4,
                  background: 'rgba(0,0,0,0.65)', color: '#fff',
                  fontSize: 8, fontWeight: 700, letterSpacing: '0.04em',
                }}
              >
                {it.kind === 'image' ? <ImageIcon size={8} /> :
                 it.kind === 'video' ? <Film size={8} /> :
                 <Music size={8} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
