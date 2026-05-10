'use client'

// VideoStudio — Higgsfield Seedance 2.0 스타일 영상 생성 페이지
// 좌측: Create Video / Edit Video / Motion Control 탭, 프리셋, 업로드, 프롬프트, 옵션, Generate
// 우측: 초기 안내 (MAKE VIDEOS IN ONE CLICK 3컬럼) / History / How it works

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  Plus, ChevronDown, Sparkles, History as HistoryIcon, BookOpen,
  Image as ImageIcon, Video, Music, Volume2, VolumeX,
  Wand2, X, Upload, FilmIcon as Film, Layers, Pencil,
} from 'lucide-react'
import AssetUploadButton from './AssetUploadButton'

// lucide doesn't export FilmIcon — use Film
// (이미 import 위에서 alias)

interface RecentItem {
  id: string
  url: string | null
  prompt?: string
  engine?: string
  created_at: string
  attempt_id: string
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
}) {
  const [tab, setTab] = useState<typeof TABS[number]['value']>('create')
  const [presetModalOpen, setPresetModalOpen] = useState(false)
  // 업로드 에셋 — VideoStudio 자체 트래킹 (Shot Workspace 비독립).
  // image1/image2/video1/audio1 처럼 종류별 자동 넘버링 + 프롬프트에 @토큰 삽입.
  const [uploadedAssets, setUploadedAssets] = useState<Array<{
    id: string; url: string; name: string; kind: 'image' | 'video' | 'audio'; token: string
  }>>([])
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
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드 가능해요 (영상/오디오는 곧 지원)')
      return
    }
    // 클라이언트 base64 → 임시 URL로 사용 (서버 저장은 생성 시 처리)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      onSourceImageChange(dataUrl)
    }
    reader.readAsDataURL(file)
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
          {/* DISCOVER PRESETS 카드 */}
          <div style={{
            position: 'relative',
            borderRadius: 14, overflow: 'hidden',
            background: 'linear-gradient(135deg, var(--accent-soft) 0%, rgba(250,250,250,0.4) 100%)',
            border: '1px solid var(--accent-line)',
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.02em', color: 'var(--accent)' }}>
                DISCOVER PRESETS
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                Seedance 2.0
              </div>
            </div>
            <button
              onClick={() => setPresetModalOpen(true)}
              className="btn primary"
              style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              title="시네마틱 프리셋 — 클릭하면 프롬프트에 자동 주입">
              Explore
            </button>
          </div>

          {/* 미디어 업로드 */}
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
              padding: sourceImageUrl ? 8 : '24px 16px',
              background: sourceImageUrl ? 'var(--bg)' : 'var(--bg-2)',
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 8, position: 'relative',
            }}
          >
            <input ref={fileInputRef} type="file" accept="image/*" hidden
              onChange={e => { const f = e.target.files?.[0]; void onFilePicked(f ?? null) }} />
            {sourceImageUrl ? (
              <>
                <img src={sourceImageUrl} alt="" style={{
                  width: '100%', maxHeight: 160, objectFit: 'contain',
                  borderRadius: 10, background: 'var(--bg-3)',
                }} />
                <button
                  onClick={e => { e.stopPropagation(); onSourceImageChange(null) }}
                  style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 22, height: 22, padding: 0, borderRadius: 999,
                    background: 'rgba(0,0,0,0.6)', color: '#fff',
                    border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  title="이미지 제거"
                ><X size={12} /></button>
                <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                  Start Frame (영상 시작)
                </span>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 4 }}>
                  <span style={iconBubble}><ImageIcon size={14} /></span>
                  <span style={iconBubble}><Video size={14} /></span>
                  <span style={iconBubble}><Music size={14} /></span>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>Start Frame</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>영상 첫 프레임 (이미지)</div>
                </div>
              </>
            )}
          </div>

          {/* End Frame 슬롯 — 옵션 (Seedance last_frame / Kling image_tail) */}
          {onEndFrameChange && (
            <EndFrameSlot
              endFrameUrl={endFrameUrl ?? null}
              onChange={onEndFrameChange}
            />
          )}

          {/* 일반 에셋 업로드 — 이미지/영상/음악 */}
          <AssetUploadButton
            projectId={projectId}
            sceneId={sceneId}
            compact
            onUploaded={(asset) => {
              setUploadedAssets(prev => {
                // kind별 자동 넘버링 — image1, video1, audio1
                const sameKind = prev.filter(p => p.kind === asset.kind)
                const n = sameKind.length + 1
                const token = `@${asset.kind}${n}`
                return [...prev, { id: asset.id, url: asset.url, name: asset.name, kind: asset.kind, token }]
              })
            }}
          />

          {/* 업로드 에셋 토큰 strip — 클릭 시 프롬프트에 @image1 식 토큰 삽입 */}
          {uploadedAssets.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.04em', alignSelf: 'center' }}>
                ELEMENTS
              </span>
              {uploadedAssets.map(a => (
                <button
                  key={a.id}
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
                  title={`${a.name} 클릭 시 프롬프트에 ${a.token} 삽입`}
                  style={{
                    padding: '4px 8px', borderRadius: 999,
                    fontSize: 11, fontWeight: 600,
                    background: 'var(--accent-soft)', color: 'var(--accent)',
                    border: '1px solid var(--accent-line)',
                    display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                  }}
                >
                  {a.kind === 'image' ? <ImageIcon size={10} /> : a.kind === 'video' ? <Video size={10} /> : <Music size={10} />}
                  {a.token}
                  <span
                    onClick={(e) => { e.stopPropagation(); setUploadedAssets(prev => prev.filter(p => p.id !== a.id)) }}
                    style={{ marginLeft: 4, padding: '0 2px', cursor: 'pointer', opacity: 0.6 }}
                    title="제거"
                  >×</span>
                </button>
              ))}
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
              onChange={e => onPromptChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void onGenerate() }
              }}
              placeholder="장면을 자세히 묘사하세요. @로 자산 참조 가능"
              rows={3}
              style={{
                width: '100%', minHeight: 64,
                background: 'transparent', border: 'none', outline: 'none', resize: 'none',
                fontSize: 13, color: 'var(--ink)',
                lineHeight: 1.55,
              }}
            />
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

          {/* Duration / Ratio / Resolution chips */}
          <div style={{ display: 'flex', gap: 8 }}>
            <PopupChip label={`${duration}s`} icon="⏱"
              open={durationOpen} onToggle={() => setDurationOpen(o => !o)}
              options={DURATIONS.map(d => ({ value: String(d), label: `${d}s` }))}
              current={String(duration)}
              onPick={v => { onDurationChange(Number(v)); setDurationOpen(false) }}
            />
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

        {/* Generate 버튼 — 좌측 패널 하단 sticky */}
        <div style={{
          padding: 12,
          borderTop: '1px solid var(--line)',
          background: 'var(--bg-1)',
          flexShrink: 0,
        }}>
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
            <span style={{
              padding: '2px 8px', borderRadius: 999,
              background: 'rgba(255,255,255,0.22)', fontSize: 11,
            }}>
              {duration <= 5 ? 21 : duration <= 7 ? 30 : duration <= 10 ? 42 : 63}
            </span>
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
          {rightTab === 'history' && <HistoryContent items={recentOutputs} onZoom={onZoomOutput} />}
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

function HistoryContent({ items, onZoom }: { items: RecentItem[]; onZoom?: (id: string) => void }) {
  if (items.length === 0) {
    return (
      <div style={{ padding: 80, textAlign: 'center', color: 'var(--ink-4)' }}>
        <HistoryIcon size={40} style={{ opacity: 0.3, marginBottom: 14 }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-3)' }}>아직 생성된 영상이 없어요</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>좌측 패널에서 프롬프트를 입력하고 Generate 해보세요.</div>
      </div>
    )
  }
  return (
    <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
      {items.map(o => (
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

// ── EndFrameSlot — End frame 별도 업로드 슬롯 ──
function EndFrameSlot({
  endFrameUrl,
  onChange,
}: {
  endFrameUrl: string | null
  onChange: (url: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  function pick(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 가능해요')
      return
    }
    const reader = new FileReader()
    reader.onload = () => onChange(String(reader.result || ''))
    reader.readAsDataURL(file)
  }
  return (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files?.[0] ?? null) }}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `1.5px dashed ${endFrameUrl ? 'var(--accent-line)' : 'var(--line-strong)'}`,
        borderRadius: 14,
        padding: endFrameUrl ? 8 : '20px 16px',
        background: endFrameUrl ? 'var(--bg)' : 'var(--bg-2)',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 6, position: 'relative',
      }}>
      <input ref={inputRef} type="file" accept="image/*" hidden
        onChange={e => { pick(e.target.files?.[0] ?? null); if (e.target) e.target.value = '' }} />
      {endFrameUrl ? (
        <>
          <img src={endFrameUrl} alt="" style={{
            width: '100%', maxHeight: 130, objectFit: 'contain',
            borderRadius: 10, background: 'var(--bg-3)',
          }} />
          <button
            onClick={e => { e.stopPropagation(); onChange(null) }}
            style={{
              position: 'absolute', top: 4, right: 4,
              width: 22, height: 22, padding: 0, borderRadius: 999,
              background: 'rgba(0,0,0,0.6)', color: '#fff',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title="끝 프레임 제거"
          ><X size={12} /></button>
          <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>
            End Frame (영상 끝)
          </span>
        </>
      ) : (
        <>
          <div style={{
            width: 28, height: 28, borderRadius: 999,
            background: 'var(--bg-3)', color: 'var(--ink-4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ImageIcon size={13} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' }}>End Frame (선택)</div>
            <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>영상 끝 프레임 — Seedance/Kling 지원</div>
          </div>
        </>
      )}
    </div>
  )
}


// ── Edit Video 탭 — 프로젝트의 영상 결과 picker ──
function EditVideoPanel({
  recentOutputs, onPickVideo,
}: {
  recentOutputs: RecentItem[]
  onPickVideo: (url: string) => void
}) {
  const videos = recentOutputs.filter(o => !!o.url).slice(0, 30)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
        영상 편집 — 기존 결과 선택
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5 }}>
        편집할 영상을 클릭하면 첫 프레임이 소스로 들어가요. Create 탭에서 새 프롬프트로 변형/리믹스하세요.
      </div>
      {videos.length === 0 ? (
        <div style={{
          padding: 30, textAlign: 'center', color: 'var(--ink-5)', fontSize: 12,
          background: 'var(--bg-2)', borderRadius: 12, border: '1px dashed var(--line)',
        }}>
          편집할 영상이 없어요. 먼저 Create 탭에서 영상을 생성하세요.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {videos.map(v => (
            <button key={v.id}
              onClick={() => v.url && onPickVideo(v.url)}
              style={{
                padding: 0, border: '1px solid var(--line)',
                borderRadius: 10, overflow: 'hidden',
                aspectRatio: '16/9', background: 'var(--bg-2)',
                cursor: 'pointer', position: 'relative',
              }}
              title={v.prompt ?? ''}
            >
              <video src={v.url ?? ''} muted playsInline preload="metadata"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {v.engine && (
                <span style={{
                  position: 'absolute', bottom: 4, left: 4,
                  padding: '1px 6px', borderRadius: 4,
                  fontSize: 9, fontWeight: 600,
                  background: 'rgba(0,0,0,0.65)', color: '#fff',
                }}>{v.engine}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Motion Control 탭 — 카메라/모션 프리셋 (클릭 시 프롬프트에 토큰 주입) ──
function MotionControlPanel({
  promptDraft, onAppend,
}: {
  promptDraft: string
  onAppend: (token: string) => void
}) {
  const sections = [
    { title: '카메라 무브', tokens: [
      'slow dolly in', 'slow dolly out', 'tracking shot left to right', 'tracking shot right to left',
      'crane up', 'crane down', 'handheld with subtle shake', 'gimbal smooth glide',
      'orbital 360 rotation', 'whip pan', 'tilt up', 'tilt down',
    ]},
    { title: '프레이밍', tokens: [
      'extreme close-up', 'close-up', 'medium close-up', 'medium shot',
      'medium wide', 'wide shot', 'establishing shot', 'over-the-shoulder', 'top-down birds-eye',
    ]},
    { title: '렌즈/포커스', tokens: [
      '24mm wide', '35mm', '50mm portrait', '85mm telephoto', 'anamorphic',
      'shallow depth of field f/1.4', 'rack focus', 'macro lens',
    ]},
    { title: '속도/시간', tokens: [
      'slow motion', 'time-lapse', 'hyper-lapse', 'natural pace',
      'freeze frame', 'cinematic 24fps look',
    ]},
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
        Motion Control — 카메라 / 프레이밍 프리셋
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5 }}>
        클릭하면 프롬프트에 자동으로 추가돼요.
      </div>
      {sections.map(sec => (
        <div key={sec.title}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.04em', marginBottom: 6 }}>
            {sec.title}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {sec.tokens.map(t => {
              const active = promptDraft.toLowerCase().includes(t.toLowerCase())
              return (
                <button key={t}
                  onClick={() => onAppend(t)}
                  style={{
                    padding: '5px 9px', borderRadius: 999,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-2)',
                    color: active ? 'var(--accent)' : 'var(--ink-2)',
                    border: '1px solid ' + (active ? 'var(--accent-line)' : 'var(--line)'),
                    fontSize: 10, fontWeight: 500, cursor: 'pointer',
                  }}>
                  {active ? '✓ ' : ''}{t}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Preset 모달 — 시네마틱 무드/스타일 프리셋 ──
function PresetModal({ onClose, onApply }: { onClose: () => void; onApply: (text: string) => void }) {
  const cats = [
    { title: '톤/그레이드', presets: [
      '35mm film look, warm amber color grade',
      'cool teal-and-orange cinematic grade',
      'desaturated documentary look',
      'high-contrast noir black and white',
      'pastel dreamy palette',
      'neon cyberpunk magenta-cyan',
    ]},
    { title: '조명', presets: [
      'soft window light from camera left',
      'golden hour backlight',
      'harsh midday sun',
      'rim light separating subject from background',
      'candlelight warm ambient',
      'practical light from neon signs',
      'blue hour exterior twilight',
    ]},
    { title: '분위기', presets: [
      'intimate, contemplative, slow rhythm',
      'tense thriller atmosphere',
      'whimsical, joyful, light-hearted',
      'eerie, unsettling, dreamlike',
      'epic, grand scale',
      'minimalist, restrained',
    ]},
    { title: '카메라', presets: [
      'static eye-level shot, cinematic 35mm',
      'slow tracking shot from behind subject',
      'handheld documentary style',
      'gimbal smooth glide circling subject',
      'crane shot rising up',
      'over-the-shoulder dialogue framing',
    ]},
  ]
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(820px, 100%)', maxHeight: '88vh',
        background: 'var(--bg)', border: '1px solid var(--line)',
        borderRadius: 'var(--r-md)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Sparkles size={14} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Discover Presets</span>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>시네마틱 무드/스타일 — 클릭하여 프롬프트에 추가</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} className="btn" style={{ padding: 6 }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {cats.map(c => (
            <div key={c.title}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.04em', marginBottom: 6 }}>
                {c.title}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
                {c.presets.map(p => (
                  <button key={p}
                    onClick={() => onApply(p)}
                    style={{
                      padding: '8px 12px', borderRadius: 8,
                      background: 'var(--bg-2)', color: 'var(--ink-2)',
                      border: '1px solid var(--line)',
                      fontSize: 11, textAlign: 'left',
                      cursor: 'pointer', lineHeight: 1.5,
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)'}
                  >{p}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
