'use client'

// VideoStudio — Higgsfield Seedance 2.0 스타일 영상 생성 페이지
// 좌측: Create Video / Edit Video / Motion Control 탭, 프리셋, 업로드, 프롬프트, 옵션, Generate
// 우측: 초기 안내 (MAKE VIDEOS IN ONE CLICK 3컬럼) / History / How it works

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  Plus, ChevronDown, Sparkles, History as HistoryIcon, BookOpen,
  Image as ImageIcon, Video, Music, Volume2, VolumeX,
  Wand2, X, Upload, FilmIcon as Film, Layers, Pencil, Loader2,
} from 'lucide-react'
import AssetUploadButton from './AssetUploadButton'
import { fileToFrameOrDataUrl } from '@/lib/videoFrame'
import { createClient } from '@/lib/supabase/client'

// lucide doesn't export FilmIcon — use Film
// (이미 import 위에서 alias)

interface RecentItem {
  id: string
  url: string | null
  prompt?: string
  engine?: string
  created_at: string
  attempt_id: string
  status?: string                            // pending / generating / done / failed
  failureReason?: string | null              // 실패 시 사유
  metadata?: Record<string, any> | null      // attempt metadata (mode, resolution, duration, refs 등)
}

interface RootAssetLite {
  id: string
  name: string
  category: string
  reference_image_urls?: string[] | null
}

const TABS = [
  { value: 'create', label: 'Create Video' },
  { value: 'edit',   label: 'Edit Video' },
  { value: 'motion', label: 'Motion Control' },
] as const

const MODELS = [
  { value: 'seedance-2',  label: 'Seedance 2.0' },
  { value: 'kling3',      label: 'Kling 3.0' },
  { value: 'kling3-omni', label: 'Kling 3.0 Omni' },
]
const DURATIONS = [5, 7, 10, 15]
const RATIOS = ['16:9', '9:16', '1:1', '4:3', '21:9']
const RESOLUTIONS = ['480p', '720p', '1080p'] as const

export default function VideoStudio({
  projectId,
  sceneId,
  promptDraft,
  onPromptChange,
  engine,
  onEngineChange,
  duration,
  onDurationChange,
  ratio,
  onRatioChange,
  resolution,
  onResolutionChange,
  generating,
  onGenerate,
  sourceImageUrl,
  onSourceImageChange,
  endFrameUrl,
  onEndFrameChange,
  refs,
  onRefsChange,
  rootAssets,
  recentOutputs,
  onZoomOutput,
  audioOn,
  onAudioToggle,
  optimizing,
  onOptimize,
  uploadedAssets: uploadedAssetsProp,
  onUploadedAssetsChange,
}: {
  projectId: string
  sceneId: string | null
  promptDraft: string
  onPromptChange: (v: string) => void
  engine: string
  onEngineChange: (v: string) => void
  duration: number
  onDurationChange: (v: number) => void
  ratio: string
  onRatioChange: (v: string) => void
  resolution: '480p' | '720p' | '1080p'
  onResolutionChange: (v: '480p' | '720p' | '1080p') => void
  generating: boolean
  onGenerate: () => Promise<void> | void
  sourceImageUrl: string | null
  onSourceImageChange: (url: string | null) => void
  endFrameUrl?: string | null
  onEndFrameChange?: (url: string | null) => void
  refs: Array<{ token: string; rootAssetId: string; name: string; url: string | null; category: string }>
  onRefsChange: (next: Array<{ token: string; rootAssetId: string; name: string; url: string | null; category: string }>) => void
  rootAssets: RootAssetLite[]
  recentOutputs: RecentItem[]
  onZoomOutput?: (id: string) => void
  audioOn: boolean
  onAudioToggle: (next: boolean) => void
  optimizing?: boolean
  onOptimize?: () => Promise<void> | void
  uploadedAssets?: Array<{ id: string; url: string; name: string; kind: 'image' | 'video' | 'audio'; token: string }>
  onUploadedAssetsChange?: (next: Array<{ id: string; url: string; name: string; kind: 'image' | 'video' | 'audio'; token: string }>) => void
}) {
  const [tab, setTab] = useState<typeof TABS[number]['value']>('create')
  const [presetModalOpen, setPresetModalOpen] = useState(false)
  // 업로드 에셋 — 부모(page)가 sessionStorage 로 영속화. props 없으면 내부 state 사용 (fallback)
  const [internalUploaded, setInternalUploaded] = useState<Array<{
    id: string; url: string; name: string; kind: 'image' | 'video' | 'audio'; token: string
  }>>([])
  // Elements 드래그 reorder
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  // 프롬프트 @ 자동완성 드롭다운
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionAnchor, setMentionAnchor] = useState<{ start: number; end: number } | null>(null)
  const uploadedAssets = uploadedAssetsProp ?? internalUploaded
  const setUploadedAssets: React.Dispatch<React.SetStateAction<typeof internalUploaded>> = (updater) => {
    if (onUploadedAssetsChange) {
      const next = typeof updater === 'function' ? (updater as any)(uploadedAssets) : updater
      onUploadedAssetsChange(next)
    } else {
      setInternalUploaded(updater)
    }
  }
  const [rightTab, setRightTab] = useState<'guide' | 'history' | 'how'>('guide')
  const [modelOpen, setModelOpen] = useState(false)
  const [durationOpen, setDurationOpen] = useState(false)
  const [ratioOpen, setRatioOpen] = useState(false)
  const [resolutionOpen, setResolutionOpen] = useState(false)
  const [elementsPickerOpen, setElementsPickerOpen] = useState(false)
  const [elementsQuery, setElementsQuery] = useState('')
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  const currentModel = useMemo(() => MODELS.find(m => m.value === engine) ?? MODELS[0], [engine])
  const isR2V = refs.length > 0 && engine === 'seedance-2'

  function autoGrow(el: HTMLTextAreaElement | null) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }
  useEffect(() => { autoGrow(taRef.current) }, [promptDraft])

  // Ctrl/Cmd+V — 클립보드 이미지 → 에셋 업로드 자동 추가 (Elements)
  useEffect(() => {
    const supabase = createClient()
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (const it of Array.from(items)) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          const file = it.getAsFile()
          if (!file) continue
          e.preventDefault()
          void (async () => {
            try {
              const ext = (file.type.split('/')[1] || 'png').toLowerCase()
              const path = `uploads/${projectId}/${Date.now()}_paste.${ext}`
              const { data, error } = await supabase.storage.from('assets').upload(path, file, {
                contentType: file.type, upsert: false,
              })
              if (error) { console.warn('paste upload error', error.message); return }
              const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(data.path)
              const { data: row } = await supabase.from('assets').insert({
                project_id: projectId,
                scene_id: sceneId ?? null,
                type: 'reference',
                name: file.name || `paste_${Date.now()}.${ext}`,
                url: publicUrl,
                tags: ['upload', 'image', 'paste'],
                metadata: { source: 'upload', kind: 'image', via: 'clipboard' },
              }).select().single()
              if (!row) return
              setUploadedAssets(prev => {
                const sameKind = prev.filter(p => p.kind === 'image')
                const n = sameKind.length + 1
                return [...prev, {
                  id: row.id, url: publicUrl, name: row.name as string,
                  kind: 'image' as const, token: `@image${n}`,
                }]
              })
            } catch (err) {
              console.warn('paste upload failed', err)
            }
          })()
          break  // 한 번에 하나만
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sceneId])

  // outside click — popup 닫기
  useEffect(() => {
    function close() {
      setModelOpen(false); setDurationOpen(false); setRatioOpen(false); setResolutionOpen(false)
    }
    if (modelOpen || durationOpen || ratioOpen || resolutionOpen) {
      window.addEventListener('click', close)
      return () => window.removeEventListener('click', close)
    }
  }, [modelOpen, durationOpen, ratioOpen, resolutionOpen])

  // 추가용 — element pick (드롭다운에서 선택 시 @imageN 토큰 부여)
  const filteredAssets = useMemo(() => {
    const usedIds = new Set(refs.map(r => r.rootAssetId))
    return rootAssets.filter(a => {
      if (usedIds.has(a.id)) return false
      if (!elementsQuery.trim()) return true
      return a.name.toLowerCase().includes(elementsQuery.toLowerCase())
        || (a.category ?? '').toLowerCase().includes(elementsQuery.toLowerCase())
    }).slice(0, 30)
  }, [rootAssets, refs, elementsQuery])

  function addReference(a: RootAssetLite) {
    const usedNums = refs.map(r => parseInt(r.token.replace('@image', ''), 10)).filter(n => !isNaN(n))
    const nextNum = (usedNums.length ? Math.max(...usedNums) : 0) + 1
    const nextToken = `@image${nextNum}`
    onRefsChange([...refs, {
      token: nextToken,
      rootAssetId: a.id,
      name: a.name,
      url: (Array.isArray(a.reference_image_urls) && a.reference_image_urls[0]) || null,
      category: a.category,
    }])
    // 프롬프트 끝에 토큰 자동 삽입
    const cur = (promptDraft || '').replace(/\s+$/, '')
    onPromptChange(cur ? `${cur} ${nextToken}` : nextToken)
  }

  function removeReference(token: string) {
    onRefsChange(refs.filter(r => r.token !== token))
  }

  // 미디어 업로드 — 이미지만 (I2V 소스)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const onFilePicked = useCallback(async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      alert('이미지 또는 영상 파일만 업로드 가능해요')
      return
    }
    // 영상이면 클라이언트 사이드에서 첫 프레임 JPEG로 변환
    try {
      const dataUrl = await fileToFrameOrDataUrl(file)
      onSourceImageChange(dataUrl)
    } catch (err) {
      alert('프레임 추출 실패: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [onSourceImageChange])

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* ── 좌측 컨트롤 패널 ─────────────────────── */}
      <aside style={{
        width: 360, flexShrink: 0,
        borderRight: '1px solid var(--line)',
        background: 'var(--bg-1)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* 탭 */}
        <div style={{
          display: 'flex', gap: 18, padding: '12px 18px 0',
          borderBottom: '1px solid var(--line)',
        }}>
          {TABS.map(t => (
            <button key={t.value}
              onClick={() => setTab(t.value)}
              style={{
                padding: '6px 0', background: 'transparent', border: 'none',
                borderBottom: tab === t.value ? '2px solid var(--accent)' : '2px solid transparent',
                color: tab === t.value ? 'var(--ink)' : 'var(--ink-4)',
                fontSize: 12, fontWeight: tab === t.value ? 700 : 500,
                cursor: 'pointer',
              }}
            >{t.label}</button>
          ))}
        </div>

        {/* 컨트롤 본문 — 스크롤 (탭별 분기) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'edit' && (
            <EditVideoPanel
              recentOutputs={recentOutputs}
              onPickVideo={(url) => {
                onSourceImageChange(url)
                setTab('create')
                alert('영상이 소스로 선택됐어요. Create 탭에서 프롬프트로 변형/리믹스하세요.')
              }}
            />
          )}
          {tab === 'motion' && (
            <MotionControlPanel
              promptDraft={promptDraft}
              onAppend={(token) => {
                const cur = (promptDraft || '').replace(/\s+$/, '')
                onPromptChange(cur ? `${cur}, ${token}` : token)
              }}
            />
          )}
          {tab === 'create' && (<>
          {/* Model */}
          <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.04em', marginBottom: 4 }}>
              Model
            </div>
            <button onClick={() => setModelOpen(o => !o)}
              style={{
                width: '100%', padding: '10px 12px',
                background: 'var(--bg-2)', border: '1px solid var(--line)',
                borderRadius: 12,
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 13, fontWeight: 600, color: 'var(--ink)',
                cursor: 'pointer',
              }}>
              <span>{currentModel.label}</span>
              <span style={{
                marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 1,
              }}>
                <span style={{ width: 3, height: 8, background: 'var(--accent)', borderRadius: 1 }} />
                <span style={{ width: 3, height: 12, background: 'var(--accent)', borderRadius: 1 }} />
                <span style={{ width: 3, height: 6, background: 'var(--accent)', borderRadius: 1 }} />
              </span>
              <span style={{ flex: 1 }} />
              <ChevronDown size={14} style={{ color: 'var(--ink-4)' }} />
            </button>
            {modelOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                background: 'var(--bg)', border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                padding: 4, zIndex: 50,
              }}>
                {MODELS.map(m => (
                  <button key={m.value}
                    onClick={() => { onEngineChange(m.value); setModelOpen(false) }}
                    style={popupItem(m.value === engine)}>
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* SEEDANCE PRESETS 카드 — 작게, Edit 버튼 */}
          <div style={{
            position: 'relative',
            borderRadius: 10, overflow: 'hidden',
            background: 'linear-gradient(135deg, var(--accent-soft) 0%, rgba(250,250,250,0.4) 100%)',
            border: '1px solid var(--accent-line)',
            padding: '8px 10px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--accent)' }}>
                {engine === 'seedance-2' ? 'SEEDANCE PRESETS' : engine === 'kling3-omni' ? 'KLING 3.0 OMNI PRESETS' : 'KLING 3.0 PRESETS'}
              </div>
              <div style={{ fontSize: 9, color: 'var(--ink-4)', marginTop: 1 }}>
                엔진별 베스트 프롬프트 프리셋
              </div>
            </div>
            <button
              onClick={() => setPresetModalOpen(true)}
              className="btn"
              style={{ padding: '4px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
              title="프롬프트 프리셋 편집">
              Edit
            </button>
          </div>

          {/* Start Frame + End Frame — 한 줄에 나란히 (반응형: 좁아지면 wrap) */}
          <div style={{ display: 'grid', gridTemplateColumns: onEndFrameChange ? '1fr 1fr' : '1fr', gap: 8 }}>
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault()
                const file = e.dataTransfer.files?.[0]
                if (file) void onFilePicked(file)
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `1.5px dashed ${sourceImageUrl ? 'var(--accent-line)' : 'var(--line-strong)'}`,
                borderRadius: 14,
                padding: sourceImageUrl ? 6 : '16px 10px',
                background: sourceImageUrl ? 'var(--bg)' : 'var(--bg-2)',
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 6, position: 'relative', minHeight: 110,
              }}
            >
              <input ref={fileInputRef} type="file" accept="image/*,video/*" hidden
                onChange={e => { const f = e.target.files?.[0]; void onFilePicked(f ?? null) }} />
              {sourceImageUrl ? (
                <>
                  {sourceImageUrl.startsWith('data:video') || /\.(mp4|webm|mov)(\?|$)/i.test(sourceImageUrl)
                    ? <video src={sourceImageUrl} muted controls style={{ width: '100%', maxHeight: 110, objectFit: 'contain', borderRadius: 8, background: 'var(--bg-3)' }} />
                    : <img src={sourceImageUrl} alt="" style={{ width: '100%', maxHeight: 110, objectFit: 'contain', borderRadius: 8, background: 'var(--bg-3)' }} />}
                  <button
                    onClick={e => { e.stopPropagation(); onSourceImageChange(null) }}
                    style={{
                      position: 'absolute', top: 4, right: 4,
                      width: 20, height: 20, padding: 0, borderRadius: 999,
                      background: 'rgba(0,0,0,0.6)', color: '#fff',
                      border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    title="제거"
                  ><X size={11} /></button>
                  <span style={{ fontSize: 9, color: 'var(--ink-4)', fontWeight: 600 }}>Start</span>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 3 }}>
                    <span style={iconBubble}><ImageIcon size={12} /></span>
                    <span style={iconBubble}><Video size={12} /></span>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>+ Start Frame</div>
                    <div style={{ fontSize: 9, color: 'var(--ink-4)', marginTop: 1 }}>영상 시작</div>
                  </div>
                </>
              )}
            </div>

            {onEndFrameChange && (
              <EndFrameSlot
                endFrameUrl={endFrameUrl ?? null}
                onChange={onEndFrameChange}
              />
            )}
          </div>

          {/* 일반 에셋 업로드 — 이미지/영상/음악 */}
          <AssetUploadButton
            projectId={projectId}
            sceneId={sceneId}
            hideRecentGrid
            onUploaded={(asset) => {
              setUploadedAssets(prev => {
                // kind별 자동 넘버링 — image1, video1, audio1 (현재 길이 + 1)
                const sameKind = prev.filter(p => p.kind === asset.kind)
                const n = sameKind.length + 1
                const token = `@${asset.kind}${n}`
                return [...prev, { id: asset.id, url: asset.url, name: asset.name, kind: asset.kind, token }]
              })
            }}
          />

          {/* Elements — 업로드 에셋: 썸네일+토큰 카드, 클릭 시 프롬프트에 @imageN 삽입, ✕ 시 자동 재넘버링 */}
          {uploadedAssets.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.05em' }}>
                ELEMENTS · 클릭 = @토큰 삽입 · 드래그 = 순서 변경 (시드값 자동 재배치)
              </span>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
                gap: 6,
              }}>
                {uploadedAssets.map((a, idx) => (
                  <div key={a.id}
                    draggable
                    onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(idx)) } catch {} }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIdx(idx) }}
                    onDragLeave={() => { if (dragOverIdx === idx) setDragOverIdx(null) }}
                    onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const from = dragIdx
                      const to = idx
                      setDragIdx(null); setDragOverIdx(null)
                      if (from === null || from === to) return
                      setUploadedAssets(prev => {
                        const arr = [...prev]
                        const [moved] = arr.splice(from, 1)
                        arr.splice(to, 0, moved)
                        // 같은 kind 내에서 순서대로 재넘버링 — @imageN cascade rename
                        const counters: Record<string, number> = {}
                        const renamed = arr.map(p => {
                          counters[p.kind] = (counters[p.kind] ?? 0) + 1
                          return { ...p, token: `@${p.kind}${counters[p.kind]}` }
                        })
                        // 프롬프트 텍스트의 기존 토큰도 새 매핑으로 치환 — 토큰 cascade
                        // 단순화: 자산은 같은 자산을 가리키므로 (id 동일), 기존 → 새 토큰 매핑을 만들어 텍스트 일괄 치환
                        const tokenMap = new Map<string, string>()
                        for (let i = 0; i < arr.length; i++) {
                          if (arr[i].token !== renamed[i].token) tokenMap.set(arr[i].token, renamed[i].token)
                        }
                        if (tokenMap.size > 0) {
                          // 충돌 회피용 두 단계 치환: 우선 임시 토큰으로, 그 다음 최종 토큰으로
                          let txt = promptDraft
                          let i = 0
                          const tmp = new Map<string, string>()
                          tokenMap.forEach((newTok, oldTok) => {
                            const ph = `@__tmp${i++}__`
                            tmp.set(oldTok, ph)
                            txt = txt.split(oldTok).join(ph)
                          })
                          tmp.forEach((ph, oldTok) => {
                            const newTok = tokenMap.get(oldTok)!
                            txt = txt.split(ph).join(newTok)
                          })
                          if (txt !== promptDraft) onPromptChange(txt)
                        }
                        return renamed
                      })
                    }}
                    style={{
                      position: 'relative',
                      opacity: dragIdx === idx ? 0.5 : 1,
                      outline: dragOverIdx === idx && dragIdx !== idx ? '2px solid var(--accent)' : 'none',
                      outlineOffset: 1,
                      borderRadius: 'var(--r-md)',
                    }}
                  >
                    <button
                      onClick={() => {
                        const ta = taRef.current
                        if (!ta) {
                          onPromptChange((promptDraft + ' ' + a.token).trim())
                          return
                        }
                        const start = ta.selectionStart ?? promptDraft.length
                        const end   = ta.selectionEnd ?? start
                        const next = promptDraft.slice(0, start) + a.token + ' ' + promptDraft.slice(end)
                        onPromptChange(next)
                        setTimeout(() => {
                          ta.focus()
                          const pos = start + a.token.length + 1
                          ta.setSelectionRange(pos, pos)
                        }, 0)
                      }}
                      title={`${a.name} — 클릭하면 프롬프트에 ${a.token} 삽입`}
                      style={{
                        width: '100%', aspectRatio: '1/1', padding: 0, overflow: 'hidden',
                        borderRadius: 'var(--r-md)',
                        background: 'var(--bg-3)',
                        border: '1px solid var(--accent-line)',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: 'relative',
                      }}
                    >
                      {a.kind === 'image' && <img src={a.url} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      {a.kind === 'video' && <video src={a.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      {a.kind === 'audio' && <Music size={22} style={{ color: 'var(--accent)' }} />}
                      {/* token 배지 */}
                      <span style={{
                        position: 'absolute', left: 4, bottom: 4,
                        padding: '1px 5px', borderRadius: 4,
                        background: 'rgba(0,0,0,0.7)', color: '#fff',
                        fontSize: 9, fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                      }}>{a.token}</span>
                    </button>
                    {/* 삭제 ✕ — 클릭 시 해당 자산 제거 + 같은 kind 안에서 토큰 재넘버링 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setUploadedAssets(prev => {
                          const next = prev.filter(p => p.id !== a.id)
                          // kind별 카운터 리셋 후 재할당 (image1, image2... 빈 자리 채움)
                          const counters: Record<string, number> = {}
                          return next.map(p => {
                            counters[p.kind] = (counters[p.kind] ?? 0) + 1
                            return { ...p, token: `@${p.kind}${counters[p.kind]}` }
                          })
                        })
                      }}
                      title="제거"
                      style={{
                        position: 'absolute', top: 3, right: 3,
                        width: 18, height: 18, padding: 0, borderRadius: 999,
                        background: 'rgba(0,0,0,0.7)', color: '#fff',
                        border: 'none', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 프롬프트 */}
          <div style={{
            border: '1px solid var(--line)',
            borderRadius: 14, padding: 12,
            background: 'var(--bg-2)',
            position: 'relative',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.04em', marginBottom: 6 }}>
              Prompt
            </div>
            <textarea
              ref={taRef}
              value={promptDraft}
              onChange={e => {
                const v = e.target.value
                onPromptChange(v)
                // 커서 위치 기준 직전 @토큰 감지
                const cursor = e.target.selectionStart ?? v.length
                const before = v.slice(0, cursor)
                const m = before.match(/@([a-zA-Z]*)$/)
                if (m) {
                  setMentionOpen(true)
                  setMentionQuery(m[1])
                  setMentionAnchor({ start: cursor - m[0].length, end: cursor })
                } else {
                  setMentionOpen(false)
                }
              }}
              onKeyDown={e => {
                if (e.key === 'Escape') { setMentionOpen(false); return }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void onGenerate() }
              }}
              placeholder="장면을 자세히 묘사하세요. @로 자산 참조 가능 · 이미지 ctrl+v로 붙여넣기"
              rows={3}
              style={{
                width: '100%', minHeight: 64,
                background: 'transparent', border: 'none', outline: 'none', resize: 'none',
                fontSize: 13, color: 'var(--ink)',
                lineHeight: 1.55,
              }}
            />
            {/* @ 멘션 드롭다운 */}
            {mentionOpen && uploadedAssets.length > 0 && (() => {
              const q = mentionQuery.toLowerCase()
              const filtered = uploadedAssets.filter(a =>
                a.token.toLowerCase().includes('@' + q) || a.kind.startsWith(q) || a.name.toLowerCase().includes(q)
              )
              if (filtered.length === 0) return null
              const insertToken = (tok: string) => {
                if (!mentionAnchor) return
                const next = promptDraft.slice(0, mentionAnchor.start) + tok + ' ' + promptDraft.slice(mentionAnchor.end)
                onPromptChange(next)
                setMentionOpen(false)
                setTimeout(() => {
                  const ta = taRef.current
                  if (!ta) return
                  ta.focus()
                  const pos = mentionAnchor.start + tok.length + 1
                  ta.setSelectionRange(pos, pos)
                }, 0)
              }
              return (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 12, right: 12, zIndex: 80,
                  background: 'var(--bg)', border: '1px solid var(--line)',
                  borderRadius: 'var(--r-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                  padding: 6, maxHeight: 280, overflowY: 'auto',
                }}>
                  <div style={{ fontSize: 9, color: 'var(--ink-4)', fontWeight: 700, padding: '2px 6px', letterSpacing: '0.04em' }}>
                    @ 자산 선택 — Esc 로 닫기
                  </div>
                  {filtered.map(a => (
                    <button key={a.id}
                      onClick={() => insertToken(a.token)}
                      style={{
                        width: '100%', padding: '6px 8px',
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 8, borderRadius: 'var(--r-sm)',
                        color: 'var(--ink-2)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {a.kind === 'image' && <img src={a.url} alt="" style={{ width: 28, height: 28, borderRadius: 4, objectFit: 'cover' }} />}
                      {a.kind === 'video' && <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', background: 'var(--bg-3)', borderRadius: 4 }}><Video size={14} /></span>}
                      {a.kind === 'audio' && <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', background: 'var(--bg-3)', borderRadius: 4 }}><Music size={14} /></span>}
                      <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', minWidth: 60 }}>{a.token}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{a.name}</span>
                    </button>
                  ))}
                </div>
              )
            })()}
            {/* @토큰 매핑 인디케이터 — 프롬프트의 @image1 / @video2 등이 실제 업로드된 자산과 매칭되는지 표시 */}
            {(() => {
              const tokens = Array.from(new Set(
                (promptDraft.match(/@(image|video|audio)\d+/g) ?? []).map(t => t.toLowerCase())
              ))
              if (tokens.length === 0) return null
              return (
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4,
                  padding: '6px 8px', background: 'var(--bg-3)',
                  borderRadius: 'var(--r-sm)', border: '1px solid var(--line)',
                }}>
                  <span style={{ fontSize: 9, color: 'var(--ink-4)', fontWeight: 700, marginRight: 4, alignSelf: 'center' }}>
                    매핑
                  </span>
                  {tokens.map(tok => {
                    const matched = uploadedAssets.find(a => a.token.toLowerCase() === tok)
                    const isOk = !!matched
                    return (
                      <span key={tok} title={isOk ? `${tok} → ${matched!.name}` : `${tok} → 매칭된 자산 없음`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          padding: '2px 6px 2px 2px',
                          borderRadius: 999,
                          background: isOk ? 'var(--accent-soft)' : 'var(--bg)',
                          color: isOk ? 'var(--accent)' : 'var(--err)',
                          border: `1px solid ${isOk ? 'var(--accent-line)' : 'color-mix(in oklab, var(--err) 30%, transparent)'}`,
                          fontSize: 10, fontWeight: 600,
                        }}>
                        {isOk && matched.kind === 'image' && (
                          <img src={matched.url} alt="" style={{ width: 14, height: 14, borderRadius: 999, objectFit: 'cover' }} />
                        )}
                        {isOk && matched.kind === 'video' && (
                          <Video size={10} style={{ marginLeft: 2 }} />
                        )}
                        {isOk && matched.kind === 'audio' && (
                          <Music size={10} style={{ marginLeft: 2 }} />
                        )}
                        {!isOk && (
                          <span style={{
                            width: 14, height: 14, borderRadius: 999, background: 'var(--bg-3)', color: 'var(--err)',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700,
                          }}>?</span>
                        )}
                        {tok}
                      </span>
                    )
                  })}
                </div>
              )
            })()}
            {/* refs 칩 */}
            {refs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {refs.map(r => (
                  <span key={r.token} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 6px 2px 2px',
                    borderRadius: 999,
                    background: 'var(--bg)', border: '1px solid var(--line-strong)',
                    fontSize: 10, color: 'var(--ink-2)',
                  }} title={`${r.token} = ${r.category}: ${r.name}`}>
                    {r.url ? <img src={r.url} alt="" style={{ width: 16, height: 16, borderRadius: 999, objectFit: 'cover' }} />
                          : <span style={{ width: 16, height: 16, borderRadius: 999, background: 'var(--bg-3)' }} />}
                    <span className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>{r.token}</span>
                    <span>{r.name}</span>
                    <button onClick={() => removeReference(r.token)}
                      style={{ width: 14, height: 14, padding: 0, border: 'none', background: 'transparent', color: 'var(--ink-4)', cursor: 'pointer' }}>
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Elements + Audio 토글 */}
            <div style={{ display: 'flex', gap: 6, marginTop: 4, position: 'relative' }} onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setElementsPickerOpen(o => !o)}
                style={miniBtn(elementsPickerOpen)}
                title="@ 자산 추가"
              >
                <Layers size={11} /> Elements ({rootAssets.length})
              </button>
              <button
                onClick={() => {
                  const next = !audioOn
                  onAudioToggle(next)
                  if (next && engine !== 'kling3-omni') {
                    if (confirm('Audio 자동 생성은 Kling 3.0 Omni만 지원합니다. 엔진을 전환할까요?')) {
                      onEngineChange('kling3-omni')
                    }
                  }
                }}
                style={miniBtn(audioOn)}
                title={audioOn ? 'Audio 생성 — Kling 3.0 Omni 권장' : 'Audio 자동 생성 (지원 모델 한정)'}
              >
                {audioOn ? <Volume2 size={11} /> : <VolumeX size={11} />}
                {audioOn ? 'On' : 'Off'}
              </button>
              {elementsPickerOpen && (
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                  width: 280, maxHeight: 320, overflow: 'hidden',
                  background: 'var(--bg)', border: '1px solid var(--line)',
                  borderRadius: 'var(--r-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  display: 'flex', flexDirection: 'column', zIndex: 50,
                }}>
                  <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
                    <input autoFocus value={elementsQuery}
                      onChange={e => setElementsQuery(e.target.value)}
                      placeholder="자산 검색..."
                      style={{
                        width: '100%', padding: '5px 8px',
                        background: 'var(--bg-2)', border: '1px solid var(--line)',
                        borderRadius: 'var(--r-sm)', fontSize: 12,
                        color: 'var(--ink)', outline: 'none',
                      }}
                    />
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1, padding: 4 }}>
                    {filteredAssets.length === 0 ? (
                      <div style={{ padding: 16, fontSize: 11, color: 'var(--ink-4)', textAlign: 'center' }}>
                        {rootAssets.length === 0 ? '자산이 없어요' : '결과 없음'}
                      </div>
                    ) : filteredAssets.map(a => {
                      const thumb = (Array.isArray(a.reference_image_urls) && a.reference_image_urls[0]) || null
                      return (
                        <button key={a.id}
                          onClick={() => { addReference(a); setElementsPickerOpen(false); setElementsQuery('') }}
                          style={{
                            width: '100%', padding: 6,
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: 'transparent', border: 'none', borderRadius: 'var(--r-sm)',
                            cursor: 'pointer', textAlign: 'left',
                          }}
                        >
                          {thumb ? <img src={thumb} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />
                                : <span style={{ width: 24, height: 24, borderRadius: 4, background: 'var(--bg-3)' }} />}
                          <span style={{ flex: 1 }}>
                            <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>{a.name}</span>
                            <span style={{ display: 'block', fontSize: 9, color: 'var(--ink-4)' }}>{a.category}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Duration slider (3-15s) */}
          <div style={{
            padding: '8px 12px', background: 'var(--bg-2)',
            border: '1px solid var(--line)', borderRadius: 'var(--r-md)',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>⏱</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)' }}>Duration</span>
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{duration}s</span>
            </div>
            <input
              type="range"
              min={3} max={15} step={1}
              value={duration}
              onChange={e => onDurationChange(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--ink-5)' }}>
              <span>3s</span>
              <span>9s</span>
              <span>15s</span>
            </div>
          </div>

          {/* Ratio / Resolution chips */}
          <div style={{ display: 'flex', gap: 8 }}>
            <PopupChip label={ratio} icon="□"
              open={ratioOpen} onToggle={() => setRatioOpen(o => !o)}
              options={RATIOS.map(r => ({ value: r, label: r }))}
              current={ratio}
              onPick={v => { onRatioChange(v); setRatioOpen(false) }}
            />
            <PopupChip label={resolution} icon="◇"
              open={resolutionOpen} onToggle={() => setResolutionOpen(o => !o)}
              options={RESOLUTIONS.map(r => ({ value: r, label: r }))}
              current={resolution}
              onPick={v => { onResolutionChange(v as any); setResolutionOpen(false) }}
            />
          </div>

          {/* R2V 모드 안내 */}
          {isR2V && (
            <div style={{
              padding: '6px 10px',
              background: 'var(--violet-soft, var(--accent-soft))',
              border: '1px solid var(--violet, var(--accent-line))',
              borderRadius: 'var(--r-sm)',
              fontSize: 10, color: 'var(--violet, var(--accent))', fontWeight: 600,
            }}>
              📽 R2V 모드 — Reference {refs.length}개로 영상 생성
            </div>
          )}
          </>)}
        </div>

        {/* Optimize + Generate — 좌측 패널 하단 sticky */}
        <div style={{
          padding: 12,
          borderTop: '1px solid var(--line)',
          background: 'var(--bg-1)',
          flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {onOptimize && (
            <button
              onClick={() => void onOptimize()}
              disabled={!!optimizing}
              title="현재 엔진에 맞게 프롬프트 최적화"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 'var(--r-md)',
                fontSize: 12, fontWeight: 600,
                background: 'var(--accent-soft)', color: 'var(--accent)',
                border: '1px solid var(--accent-line)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
                opacity: optimizing ? 0.6 : 1,
              }}
            >
              <Sparkles size={12} />
              {optimizing ? '최적화중...' : '프롬프트 최적화'}
            </button>
          )}
          <button
            onClick={() => void onGenerate()}
            disabled={generating || !promptDraft.trim()}
            style={{
              width: '100%', padding: '14px 18px',
              borderRadius: 14,
              background: generating || !promptDraft.trim() ? 'var(--bg-3)' : 'var(--accent)',
              color: generating || !promptDraft.trim() ? 'var(--ink-4)' : '#fff',
              border: 'none',
              fontSize: 14, fontWeight: 700,
              cursor: generating || !promptDraft.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              transition: 'all 0.15s',
              boxShadow: generating || !promptDraft.trim() ? 'none' : '0 6px 16px rgba(0,0,0,0.14)',
            }}
          >
            <Sparkles size={15} />
            {generating ? '생성 중...' : 'Generate'}
          </button>
        </div>
      </aside>

      {/* ── 우측 메인 — 가이드 / History / How it works ────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 우측 탭 */}
        <div style={{
          padding: '12px 18px',
          borderBottom: '1px solid var(--line)',
          display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
        }}>
          <button onClick={() => setRightTab('history')}
            style={rightTabBtn(rightTab === 'history')}>
            <HistoryIcon size={13} /> History
            {recentOutputs.length > 0 && (
              <span style={{
                padding: '0 6px', borderRadius: 999,
                background: 'var(--accent-soft)', color: 'var(--accent)',
                fontSize: 10, fontWeight: 700,
              }}>{recentOutputs.length}</span>
            )}
          </button>
          <button onClick={() => setRightTab('how')}
            style={rightTabBtn(rightTab === 'how')}>
            <BookOpen size={13} /> How it works
          </button>
          <button onClick={() => setRightTab('guide')}
            style={rightTabBtn(rightTab === 'guide')}>
            <Wand2 size={13} /> Quick Start
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {rightTab === 'guide' && <GuideContent />}
          {rightTab === 'history' && (
            <HistoryContent
              items={recentOutputs}
              onZoom={onZoomOutput}
              generating={generating}
              currentPrompt={promptDraft}
              uploadedAssets={uploadedAssets}
              currentEngine={engine}
              currentDuration={duration}
              currentRatio={ratio}
              currentResolution={resolution}
              onCancelGenerating={() => { /* placeholder — 추후 큐 cancel */ }}
            />
          )}
          {rightTab === 'how' && <HowItWorksContent />}
        </div>
      </main>

      {/* Preset 모달 */}
      {presetModalOpen && (
        <PresetModal
          onClose={() => setPresetModalOpen(false)}
          onApply={(text) => {
            const cur = (promptDraft || '').replace(/\s+$/, '')
            onPromptChange(cur ? `${cur}, ${text}` : text)
            setPresetModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ── 서브 컨텐츠 ──────────────────────────────────────
function GuideContent() {
  const cols = [
    { title: 'ADD IMAGE', desc: '이미지를 업로드하거나 생성해서 영상의 첫 프레임으로 사용', icon: <Upload size={28} /> },
    { title: 'CHOOSE PRESET', desc: '카메라 워크 / 프레이밍 / VFX 프리셋을 골라 움직임 제어', icon: <Pencil size={28} /> },
    { title: 'GET VIDEO', desc: 'Generate 클릭 → 결과 영상이 History에 저장됨', icon: <Video size={28} /> },
  ]
  return (
    <div style={{ padding: '36px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 720 }}>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
          MAKE VIDEOS IN ONE CLICK
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-3)' }}>
          250+ 프리셋 — 카메라 / 프레이밍 / VFX. 직접 제어 모드도 지원해요.
        </p>
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 16, maxWidth: 920, width: '100%', marginTop: 16,
      }}>
        {cols.map(c => (
          <div key={c.title} style={{
            padding: 20, borderRadius: 16,
            background: 'var(--bg-2)', border: '1px solid var(--line)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            textAlign: 'center', minHeight: 220,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'var(--accent-soft)', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{c.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--ink)' }}>
              {c.title}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
              {c.desc}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HistoryContent({
  items, onZoom, generating, currentPrompt, uploadedAssets,
  currentEngine, currentDuration, currentRatio, currentResolution, onCancelGenerating,
}: {
  items: RecentItem[]
  onZoom?: (id: string) => void
  generating?: boolean
  currentPrompt?: string
  uploadedAssets?: Array<{ id: string; url: string; name: string; kind: 'image' | 'video' | 'audio'; token: string }>
  currentEngine?: string
  currentDuration?: number
  currentRatio?: string
  currentResolution?: string
  onCancelGenerating?: () => void
}) {
  // 뷰 모드 + 줌 (sessionStorage 영속)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    if (typeof window === 'undefined') return 'list'
    try { return (window.sessionStorage.getItem('vs:viewMode') as any) || 'list' } catch { return 'list' }
  })
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window === 'undefined') return 1
    try { const v = parseFloat(window.sessionStorage.getItem('vs:zoom') || '1'); return isFinite(v) && v > 0.5 && v < 2.5 ? v : 1 } catch { return 1 }
  })
  function setView(m: 'list' | 'grid') { setViewMode(m); try { window.sessionStorage.setItem('vs:viewMode', m) } catch {} }
  function setZoomPersist(z: number) { setZoom(z); try { window.sessionStorage.setItem('vs:zoom', String(z)) } catch {} }

  // 실패한 attempt 별로 그룹핑 — 첫 output의 metadata.failureReason 가 있으면 표시
  const failed = items.filter(o => o.status === 'failed')
  const succeeded = items.filter(o => o.status !== 'failed' && !!o.url)

  // 카드 너비 — viewMode + zoom 반영
  const baseListW = 420
  const baseGridW = 220
  const cardMinW = (viewMode === 'list' ? baseListW : baseGridW) * zoom

  const showProgress = !!generating

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 컨트롤 바 — zoom slider + List/Grid 토글 */}
      <div style={{
        padding: '8px 18px', borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 600 }}>{items.length}개</span>
        <span style={{ flex: 1 }} />
        {/* Zoom */}
        <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>크기</span>
        <input type="range" min={0.7} max={2.0} step={0.05} value={zoom}
          onChange={e => setZoomPersist(parseFloat(e.target.value))}
          style={{ width: 100, accentColor: 'var(--accent)' }}
          title="카드 크기 조절" />
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', minWidth: 32 }}>{Math.round(zoom * 100)}%</span>
        {/* List / Grid */}
        <div style={{ display: 'inline-flex', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
          <button onClick={() => setView('list')}
            style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: viewMode === 'list' ? 'var(--accent-soft)' : 'transparent',
              color: viewMode === 'list' ? 'var(--accent)' : 'var(--ink-3)',
              border: 'none', borderRadius: 'var(--r-sm)',
            }}>List</button>
          <button onClick={() => setView('grid')}
            style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: viewMode === 'grid' ? 'var(--accent-soft)' : 'transparent',
              color: viewMode === 'grid' ? 'var(--accent)' : 'var(--ink-3)',
              border: 'none', borderRadius: 'var(--r-sm)',
            }}>Grid</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Progress 카드 — 생성 중 */}
        {showProgress && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: viewMode === 'list' ? '1fr 1fr' : '1fr',
            gap: 12,
            border: '1px solid var(--accent-line)',
            background: 'var(--bg-1)',
            borderRadius: 14, padding: 12,
          }}>
            <div style={{
              aspectRatio: '16/9', background: 'var(--bg-3)',
              borderRadius: 'var(--r-md)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              position: 'relative', overflow: 'hidden',
            }}>
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>Processing</span>
              {onCancelGenerating && (
                <button onClick={onCancelGenerating}
                  style={{
                    position: 'absolute', top: 8, right: 8,
                    padding: '3px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                    background: 'var(--bg)', border: '1px solid var(--line-strong)',
                    color: 'var(--ink-3)', cursor: 'pointer',
                  }}>⊘ Cancel</button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={11} style={{ color: 'var(--accent)' }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
                  {currentEngine?.toUpperCase() ?? 'SEEDANCE'}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                  {currentResolution} · {currentDuration}s · {currentRatio}
                </span>
              </div>
              {currentPrompt && (
                <div style={{
                  fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.5,
                  maxHeight: 140, overflowY: 'auto',
                  background: 'var(--bg-2)', padding: 8, borderRadius: 'var(--r-sm)',
                  whiteSpace: 'pre-wrap',
                }}>{currentPrompt}</div>
              )}
              {uploadedAssets && uploadedAssets.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {uploadedAssets.slice(0, 8).map(a => (
                    <span key={a.id} style={{
                      width: 32, height: 32, borderRadius: 'var(--r-sm)',
                      overflow: 'hidden', background: 'var(--bg-3)',
                      border: '1px solid var(--accent-line)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      position: 'relative',
                    }}>
                      {a.kind === 'image' && <img src={a.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      {a.kind === 'video' && <video src={a.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      {a.kind === 'audio' && <Music size={12} />}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 실패 카드들 */}
        {failed.map(f => (
          <div key={f.id} style={{
            border: '1px solid color-mix(in oklab, var(--err) 30%, var(--line))',
            background: 'color-mix(in oklab, var(--err) 4%, var(--bg-1))',
            borderRadius: 14, padding: 12,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: 999,
              background: 'color-mix(in oklab, var(--err) 18%, transparent)',
              color: 'var(--err)',
              display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
              <X size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--err)' }}>
                생성 실패
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>
                {f.failureReason ?? '알 수 없는 오류 — 다시 시도해주세요.'}
              </div>
              {f.prompt && (
                <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.prompt}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* 빈 상태 */}
        {!showProgress && succeeded.length === 0 && failed.length === 0 && (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--ink-4)' }}>
            <HistoryIcon size={36} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-3)' }}>아직 생성된 영상이 없어요</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>좌측 패널에서 프롬프트를 입력하고 Generate 해보세요.</div>
          </div>
        )}

        {/* 성공 결과 — List(1열 큰 카드) 또는 Grid(다열) */}
        {succeeded.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinW}px, 1fr))`,
            gap: 12,
          }}>
            {succeeded.map(o => (
              <button key={o.id}
                onClick={() => o.url && onZoom?.(o.id)}
                style={{
                  padding: 0, border: '1px solid var(--line)',
                  borderRadius: 12, overflow: 'hidden',
                  aspectRatio: '16/9',
                  background: 'var(--bg-2)', cursor: 'pointer', position: 'relative',
                }}
                title={o.prompt ?? ''}
              >
                {o.url ? (
                  <video src={o.url} muted playsInline preload="metadata"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{
                    width: '100%', height: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--ink-5)', fontSize: 12,
                  }}>생성 중</div>
                )}
                {o.engine && (
                  <span style={{
                    position: 'absolute', bottom: 6, left: 6,
                    padding: '2px 8px', borderRadius: 999,
                    fontSize: 10, fontWeight: 600,
                    background: 'rgba(0,0,0,0.65)', color: '#fff',
                  }}>{o.engine}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function HowItWorksContent() {
  const steps = [
    { n: 1, title: '소스 준비', desc: '업로드한 이미지를 첫 프레임으로 사용하거나, @로 캐릭터/장소 자산을 참조' },
    { n: 2, title: '프롬프트 작성', desc: '어떤 동작·카메라 무브·분위기인지 묘사. 한국어 OK' },
    { n: 3, title: '엔진/길이/해상도 선택', desc: 'Seedance(다중 자산 R2V) / Kling 3.0 / Omni(오디오 동시생성)' },
    { n: 4, title: 'Generate', desc: '큐에 등록 → 결과는 History 탭에 자동 추가' },
  ]
  return (
    <div style={{ padding: '32px 28px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>
        How it works
      </h1>
      <p style={{ margin: '6px 0 24px', fontSize: 13, color: 'var(--ink-3)' }}>
        영상 생성 4단계 — 평균 60~180초 소요
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {steps.map(s => (
          <div key={s.n} style={{
            display: 'flex', gap: 14,
            padding: 14, borderRadius: 12,
            background: 'var(--bg-2)', border: '1px solid var(--line)',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 999,
              background: 'var(--accent)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 14, flexShrink: 0,
            }}>{s.n}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{s.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.55 }}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── style helpers ───────────────────────────────────────
const iconBubble: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 999,
  background: 'var(--bg-3)', color: 'var(--ink-3)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}

function miniBtn(active: boolean): React.CSSProperties {
  return {
    padding: '4px 9px', borderRadius: 999,
    background: active ? 'var(--accent-soft)' : 'var(--bg)',
    border: '1px solid var(--line)',
    color: active ? 'var(--accent)' : 'var(--ink-3)',
    fontSize: 10, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 4,
    cursor: 'pointer',
  }
}

function rightTabBtn(active: boolean): React.CSSProperties {
  return {
    padding: '6px 14px', borderRadius: 999,
    background: active ? 'var(--bg-3)' : 'transparent',
    border: '1px solid ' + (active ? 'var(--line-strong)' : 'transparent'),
    color: active ? 'var(--ink)' : 'var(--ink-4)',
    fontSize: 12, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 6,
    cursor: 'pointer',
  }
}

function popupItem(active: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '7px 10px',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--ink-2)',
    border: 'none', borderRadius: 'var(--r-sm)',
    fontSize: 12, fontWeight: 500,
    textAlign: 'left',
    display: 'flex', alignItems: 'center', gap: 8,
    cursor: 'pointer',
  }
}

function PopupChip({
  label, icon, open, onToggle, options, current, onPick,
}: {
  label: string; icon: string;
  open: boolean; onToggle: () => void;
  options: Array<{ value: string; label: string }>;
  current: string;
  onPick: (v: string) => void;
}) {
  return (
    <div style={{ flex: 1, position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button onClick={onToggle}
        style={{
          width: '100%', padding: '8px 10px',
          background: 'var(--bg-2)', border: '1px solid var(--line)',
          borderRadius: 12,
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: 'var(--ink-2)', fontWeight: 500,
          cursor: 'pointer',
        }}>
        <span style={{ opacity: 0.7 }}>{icon}</span>
        <span>{label}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--bg)', border: '1px solid var(--line)',
          borderRadius: 'var(--r-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          padding: 4, zIndex: 50,
        }}>
          {options.map(o => (
            <button key={o.value}
              onClick={() => onPick(o.value)}
              style={popupItem(o.value === current)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const initialBubble: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 999,
  background: 'var(--accent)', color: '#fff',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 700, fontSize: 11,
}


// ── EditVideoPanel ─────────────────────────────────────────────────
function EditVideoPanel({
  recentOutputs, onPickVideo,
}: {
  recentOutputs: Array<{ id: string; url: string | null; prompt?: string; engine?: string; created_at: string; attempt_id: string }>
  onPickVideo: (url: string) => void
}) {
  const videos = recentOutputs.filter(o => !!o.url).slice(0, 30)
  if (videos.length === 0) {
    return (
      <div style={{ padding: 30, textAlign: "center", color: "var(--ink-5)", fontSize: 12 }}>
        아직 생성된 영상이 없어요.
        <div style={{ marginTop: 6, fontSize: 11 }}>Create 탭에서 먼저 한 영상을 만들어보세요.</div>
      </div>
    )
  }
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-4)", letterSpacing: "0.04em", marginBottom: 6 }}>
        그래더하거나 리믹스할 영상 선택
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
        {videos.map(v => (
          <button key={v.id}
            onClick={() => v.url && onPickVideo(v.url)}
            style={{
              padding: 0, border: "1px solid var(--line)", borderRadius: "var(--r-md)",
              overflow: "hidden", background: "var(--bg-2)", cursor: "pointer",
              aspectRatio: "16/9",
            }}
            title={v.prompt ?? ""}
          >
            <video src={v.url ?? undefined} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </button>
        ))}
      </div>
    </div>
  )
}
