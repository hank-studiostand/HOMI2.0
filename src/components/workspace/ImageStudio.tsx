'use client'

// ImageStudio — Nano Banana Pro 스타일 이미지 생성 페이지

import { useState, useMemo, useRef, useEffect } from 'react'
import {
  Plus, ChevronDown, Sparkles, History as HistoryIcon, X,
  Image as ImageIcon, Pencil, RotateCw, Trash2, Loader2, AlertCircle, Check,
} from 'lucide-react'
import AssetUploadButton from './AssetUploadButton'

interface RecentItem {
  id: string
  url: string | null
  prompt?: string
  engine?: string
  created_at: string
  attempt_id: string
}

interface LatestAttempt {
  id: string
  status: string  // 'generating' | 'done' | 'failed'
  prompt: string
  outputs: Array<{ id: string; url: string | null; archived: boolean }>
}

const MODELS = [
  { value: 'nanobanana', label: 'Nano Banana 2.5', initial: 'N' },
  { value: 'gpt-image',  label: 'GPT Image 1',     initial: 'G' },
  { value: 'midjourney', label: 'Midjourney',      initial: 'M' },
]
const RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16']
const COUNTS = [1, 2, 3, 4] as const
const QUALITIES = ['1K', '2K', '4K'] as const

export default function ImageStudio({
  projectId,
  sceneId,
  promptDraft,
  onPromptChange,
  engine,
  onEngineChange,
  ratio,
  onRatioChange,
  generating,
  onGenerate,
  optimizing,
  onOptimize,
  recentOutputs,
  onSelectOutput,
  onZoomOutput,
  count,
  onCountChange,
  quality,
  onQualityChange,
  referenceUrls,
  onReferenceAdd,
  onReferenceRemove,
  latestAttempt,
  onRetry,
  onDeleteLatest,
  lastError,
}: {
  projectId: string
  sceneId: string | null
  promptDraft: string
  onPromptChange: (v: string) => void
  engine: string
  onEngineChange: (v: string) => void
  ratio: string
  onRatioChange: (v: string) => void
  generating: boolean
  onGenerate: () => Promise<void> | void
  optimizing?: boolean
  onOptimize?: () => Promise<void> | void
  recentOutputs: RecentItem[]
  onSelectOutput?: (id: string) => void
  onZoomOutput?: (id: string) => void
  count?: number
  onCountChange?: (n: number) => void
  quality?: '1K' | '2K' | '4K'
  onQualityChange?: (q: '1K' | '2K' | '4K') => void
  referenceUrls?: string[]
  onReferenceAdd?: (file: File) => Promise<void> | void
  onReferenceRemove?: (url: string) => void
  latestAttempt?: LatestAttempt | null
  onRetry?: () => void
  onDeleteLatest?: () => void
  lastError?: string | null
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [ratioOpen, setRatioOpen] = useState(false)
  const [countOpen, setCountOpen] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const currentModel = useMemo(() => MODELS.find(m => m.value === engine) ?? MODELS[0], [engine])

  function autoGrow(el: HTMLTextAreaElement | null) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }
  useEffect(() => { autoGrow(taRef.current) }, [promptDraft])

  useEffect(() => {
    function close() { setModelOpen(false); setRatioOpen(false); setCountOpen(false); setQualityOpen(false) }
    if (modelOpen || ratioOpen || countOpen || qualityOpen) {
      window.addEventListener('click', close)
      return () => window.removeEventListener('click', close)
    }
  }, [modelOpen, ratioOpen, countOpen, qualityOpen])

  const refs = referenceUrls ?? []
  const hasResult = !!latestAttempt && (latestAttempt.outputs.length > 0 || latestAttempt.status === 'failed' || latestAttempt.status === 'generating')
  const isFailed = latestAttempt?.status === 'failed'
  const isGenerating = latestAttempt?.status === 'generating' || generating
  const successOutputs = latestAttempt?.outputs.filter(o => !!o.url) ?? []

  const heroThumbs = recentOutputs.filter(o => !!o.url).slice(0, 4)

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Top bar */}
      <div style={{
        padding: '12px 18px',
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid var(--line)', flexShrink: 0,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: 'var(--ink-3)',
          padding: '5px 12px', background: 'var(--bg-2)', borderRadius: 999,
          border: '1px solid var(--line)',
        }}>이미지 생성</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setHistoryOpen(o => !o)}
          style={{
            padding: '6px 12px', borderRadius: 'var(--r-md)',
            border: '1px solid var(--line)',
            background: historyOpen ? 'var(--bg-3)' : 'transparent',
            color: 'var(--ink-2)', display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 500,
          }}
          title="히스토리 패널"
        >
          <HistoryIcon size={13} /> History
          {recentOutputs.length > 0 && (
            <span style={{
              padding: '0 6px', borderRadius: 999,
              background: 'var(--accent-soft)', color: 'var(--accent)',
              fontSize: 10, fontWeight: 700,
            }}>{recentOutputs.length}</span>
          )}
        </button>
      </div>

      {/* 중앙 — 결과 있으면 결과 + 사이드, 없으면 hero */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column' }}>
        {hasResult ? (
          <ResultArea
            attempt={latestAttempt!}
            outputs={successOutputs}
            isFailed={isFailed}
            isGenerating={isGenerating}
            onRetry={onRetry}
            onDelete={onDeleteLatest}
            onZoom={onZoomOutput}
            lastError={lastError}
          />
        ) : (
          <Hero thumbs={heroThumbs} />
        )}
      </div>

      {/* 하단 프롬프트 바 */}
      <div style={{ padding: '0 18px 20px', flexShrink: 0 }}>
        <div style={{
          maxWidth: 980, margin: '0 auto',
          background: 'var(--bg-2)',
          border: '1px solid var(--line-strong)',
          borderRadius: 18,
          boxShadow: '0 4px 18px rgba(0,0,0,0.06)',
          display: 'flex', flexDirection: 'column', overflow: 'visible',
        }}>
          {/* refs strip — 업로드된 레퍼런스 미리보기 */}
          {refs.length > 0 && (
            <div style={{
              padding: '10px 14px 0', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: '0.04em' }}>
                Reference
              </span>
              {refs.map(u => (
                <span key={u} style={{
                  position: 'relative',
                  width: 80, height: 80, borderRadius: 10, overflow: 'hidden',
                  border: '1px solid var(--line-strong)',
                }}>
                  <img src={u} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {onReferenceRemove && (
                    <button
                      onClick={() => onReferenceRemove(u)}
                      style={{
                        position: 'absolute', top: 4, right: 4,
                        width: 22, height: 22, padding: 0, borderRadius: 999,
                        background: 'rgba(0,0,0,0.7)', color: '#fff',
                        border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      title="제거"
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* 프롬프트 입력 영역 */}
          <div style={{ padding: '14px 16px 8px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <input ref={fileInputRef} type="file" accept="image/*" hidden
              onChange={async e => {
                const f = e.target.files?.[0]
                if (f && onReferenceAdd) await onReferenceAdd(f)
                if (e.target) e.target.value = ''
              }} />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="레퍼런스 이미지 업로드"
              style={{
                width: 32, height: 32, padding: 0,
                borderRadius: 8, background: 'var(--bg-3)',
                border: '1px solid var(--line)', color: 'var(--ink-3)', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}
            >
              <Plus size={16} />
            </button>
            <textarea
              ref={taRef}
              value={promptDraft}
              onChange={e => onPromptChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void onGenerate() }
              }}
              placeholder="장면을 묘사하세요... (Cmd/Ctrl+Enter로 생성)"
              rows={1}
              style={{
                flex: 1, minHeight: 32,
                background: 'transparent', border: 'none', outline: 'none', resize: 'none',
                fontSize: 14, color: 'var(--ink)', lineHeight: 1.6, padding: 6,
              }}
            />
          </div>

          {/* 옵션 칩 + Generate */}
          <div style={{
            padding: '6px 10px 10px 12px',
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          }}>
            <ChipDropdown open={modelOpen} onToggle={() => setModelOpen(o => !o)}
              label={currentModel.label}
              icon={<span style={initialBubble}>{currentModel.initial}</span>}
              options={MODELS.map(m => ({ value: m.value, label: m.label, initial: m.initial }))}
              current={engine}
              onPick={v => { onEngineChange(v); setModelOpen(false) }}
            />
            {onOptimize && (
              <button
                onClick={() => void onOptimize()}
                disabled={!!optimizing}
                title="현재 엔진에 맞게 프롬프트 최적화"
                style={pillBtn(false)}
              >
                {optimizing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                <span>{optimizing ? '최적화중...' : '프롬프트 최적화'}</span>
              </button>
            )}
            <ChipDropdown open={ratioOpen} onToggle={() => setRatioOpen(o => !o)}
              label={ratio} mono
              options={RATIOS.map(r => ({ value: r, label: r }))}
              current={ratio}
              onPick={v => { onRatioChange(v); setRatioOpen(false) }}
            />
            {onCountChange && (
              <ChipDropdown open={countOpen} onToggle={() => setCountOpen(o => !o)}
                label={`${count ?? 1}/4`}
                options={COUNTS.map(n => ({ value: String(n), label: `${n}장` }))}
                current={String(count ?? 1)}
                onPick={v => { onCountChange(Number(v)); setCountOpen(false) }}
              />
            )}
            {onQualityChange && (
              <ChipDropdown open={qualityOpen} onToggle={() => setQualityOpen(o => !o)}
                label={quality ?? '1K'}
                options={QUALITIES.map(q => ({ value: q, label: q }))}
                current={quality ?? '1K'}
                onPick={v => { onQualityChange(v as '1K' | '2K' | '4K'); setQualityOpen(false) }}
              />
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              style={pillBtn(false)}
              title="스케치 / 손그림 업로드 — 레퍼런스로 사용"
            >
              <Pencil size={11} />
              <span>Draw</span>
            </button>

            <span style={{ flex: 1 }} />

            <button
              onClick={() => void onGenerate()}
              disabled={generating || !promptDraft.trim()}
              style={{
                padding: '10px 22px', borderRadius: 12,
                background: generating || !promptDraft.trim() ? 'var(--bg-3)' : 'var(--accent)',
                color: generating || !promptDraft.trim() ? 'var(--ink-4)' : '#fff',
                border: 'none', fontSize: 13, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', gap: 8,
                cursor: generating || !promptDraft.trim() ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                boxShadow: generating || !promptDraft.trim() ? 'none' : '0 4px 12px rgba(0,0,0,0.12)',
              }}
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {generating ? '큐 등록 중...' : 'Generate'}
              <span style={{
                fontSize: 11, opacity: 0.85,
                padding: '1px 6px', borderRadius: 999,
                background: 'rgba(255,255,255,0.2)',
              }}>{count ?? 1}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 우측 슬라이드 History 패널 */}
      {historyOpen && (
        <div onClick={() => setHistoryOpen(false)}
          style={{
            position: 'absolute', inset: 0, zIndex: 30,
            background: 'rgba(0,0,0,0.18)', backdropFilter: 'blur(2px)',
          }}>
          <aside onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: 0, right: 0, bottom: 0,
              width: 'min(440px, 92%)', background: 'var(--bg)',
              borderLeft: '1px solid var(--line)',
              display: 'flex', flexDirection: 'column',
              boxShadow: '-12px 0 32px rgba(0,0,0,0.12)',
            }}>
            <div style={{
              padding: '14px 18px', borderBottom: '1px solid var(--line)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <HistoryIcon size={14} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>이미지 히스토리</span>
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{recentOutputs.length}장</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setHistoryOpen(false)} className="btn" style={{ padding: 6 }}>
                <X size={13} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {recentOutputs.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', fontSize: 12, color: 'var(--ink-4)' }}>
                  아직 생성된 이미지가 없어요.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  {recentOutputs.map(o => (
                    <button key={o.id}
                      onClick={() => {
                        if (o.url && onZoomOutput) onZoomOutput(o.id)
                        else if (onSelectOutput) onSelectOutput(o.id)
                      }}
                      style={{
                        padding: 0, border: '1px solid var(--line)',
                        borderRadius: 10, overflow: 'hidden',
                        background: 'var(--bg-2)', aspectRatio: '1',
                        cursor: 'pointer', display: 'block', position: 'relative',
                      }}
                      title={o.prompt ?? ''}
                    >
                      {o.url ? (
                        <img src={o.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{
                          width: '100%', height: '100%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'var(--ink-5)',
                        }}>생성 중</div>
                      )}
                      {o.engine && (
                        <span style={{
                          position: 'absolute', bottom: 6, left: 6,
                          padding: '2px 6px', borderRadius: 4,
                          fontSize: 9, fontWeight: 600,
                          background: 'rgba(0,0,0,0.6)', color: '#fff',
                        }}>{o.engine}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

// ── 결과 영역 — 최근 attempt + 상태 + Retry/Delete ──
function ResultArea({
  attempt, outputs, isFailed, isGenerating, onRetry, onDelete, onZoom, lastError,
}: {
  attempt: LatestAttempt
  outputs: Array<{ id: string; url: string | null; archived: boolean }>
  isFailed: boolean
  isGenerating: boolean
  onRetry?: () => void
  onDelete?: () => void
  onZoom?: (id: string) => void
  lastError?: string | null
}) {
  return (
    <div style={{ flex: 1, display: 'flex', gap: 18, alignItems: 'flex-start', maxWidth: 1180, margin: '0 auto', width: '100%' }}>
      {/* 좌측 — 상태 + 액션 */}
      <aside style={{
        width: 240, flexShrink: 0,
        display: 'flex', flexDirection: 'column', gap: 10,
        position: 'sticky', top: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {isGenerating ? (
            <span style={statusChip('var(--accent)')}>
              <Loader2 size={11} className="animate-spin" /> Generating
            </span>
          ) : isFailed ? (
            <>
              <span style={statusChip('var(--danger, #c43)')}><X size={11} /> Failed</span>
              <span style={statusChip('var(--ink-4)', true)}><AlertCircle size={11} /> Credits refunded</span>
            </>
          ) : (
            <span style={statusChip('var(--ok, var(--accent))')}><Check size={11} /> Done</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: isFailed ? 'var(--ink-2)' : 'var(--ink-3)', lineHeight: 1.55 }}>
          {isFailed ? (
            <>
              <b style={{ color: 'var(--ink)' }}>다시 시도하거나</b><br />
              입력 / 프롬프트를 변경해주세요.
              {lastError && (
                <div style={{ marginTop: 6, padding: 6, fontSize: 10, background: 'var(--bg-2)', borderRadius: 6, color: 'var(--ink-4)', wordBreak: 'break-word' }}>
                  {lastError.slice(0, 200)}
                </div>
              )}
            </>
          ) : isGenerating ? (
            '잠시만 기다려주세요. 결과는 자동으로 표시돼요.'
          ) : (
            '이미지가 생성됐어요. 클릭으로 확대.'
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', padding: 8, background: 'var(--bg-2)', borderRadius: 8, maxHeight: 100, overflow: 'auto' }}>
          {attempt.prompt}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {onRetry && (
            <button onClick={onRetry} className="btn"
              style={{ flex: 1, padding: '8px 10px', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <RotateCw size={11} /> Retry
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="btn"
              style={{ flex: 1, padding: '8px 10px', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <Trash2 size={11} /> Delete
            </button>
          )}
        </div>
      </aside>

      {/* 우측 — 결과 그리드 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {outputs.length > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: outputs.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            gap: 10,
          }}>
            {outputs.map(o => (
              <button key={o.id}
                onClick={() => o.url && onZoom?.(o.id)}
                style={{
                  padding: 0, border: '1px solid var(--line)',
                  borderRadius: 14, overflow: 'hidden',
                  background: 'var(--bg-2)', cursor: 'pointer', display: 'block',
                  aspectRatio: outputs.length === 1 ? '4/5' : '1',
                }}
              >
                {o.url ? (
                  <img src={o.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{
                    width: '100%', height: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--ink-5)', fontSize: 12,
                  }}>생성 중</div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div style={{
            border: '1px dashed var(--line-strong)', borderRadius: 14,
            padding: 60, textAlign: 'center', color: 'var(--ink-4)',
            background: 'var(--bg-2)',
          }}>
            {isGenerating ? '생성 중...' : isFailed ? '결과 없음' : '결과를 기다리는 중...'}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Hero (결과 없을 때) ──
function Hero({ thumbs }: { thumbs: RecentItem[] }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', textAlign: 'center',
    }}>
      <div style={{
        display: 'flex', gap: 10, marginBottom: 28,
        alignItems: 'center', justifyContent: 'center', maxWidth: 560,
      }}>
        {[0, 1, 2, 3].map(i => {
          const it = thumbs[i]
          const rotate = [-3, 4, -2, 5][i]
          return (
            <div key={i} style={{
              width: 110, height: 130, borderRadius: 16,
              background: it?.url ? 'var(--bg-3)' : 'var(--bg-2)',
              border: '1px solid var(--line-strong)', overflow: 'hidden',
              transform: `rotate(${rotate}deg)`,
              boxShadow: '0 6px 18px rgba(0,0,0,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              {it?.url ? (
                <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <ImageIcon size={28} style={{ color: 'var(--ink-5)', opacity: 0.4 }} />
              )}
            </div>
          )
        })}
      </div>
      <h1 style={{
        margin: '0 0 8px', fontSize: 28, fontWeight: 800,
        letterSpacing: '-0.02em', color: 'var(--ink)', lineHeight: 1.2,
      }}>
        이미지 생성 시작하기 <span style={{ color: 'var(--accent)' }}>HOMI</span>
      </h1>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-3)', maxWidth: 540, lineHeight: 1.6 }}>
        장면 · 인물 · 분위기 · 스타일을 묘사하면, AI가 바로 이미지로 만들어드려요.
      </p>
    </div>
  )
}

// ── ChipDropdown ──
function ChipDropdown({
  open, onToggle, label, icon, mono, options, current, onPick,
}: {
  open: boolean
  onToggle: () => void
  label: string
  icon?: React.ReactNode
  mono?: boolean
  options: Array<{ value: string; label: string; initial?: string }>
  current: string
  onPick: (v: string) => void
}) {
  return (
    <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button onClick={onToggle} style={pillBtn(open)}>
        {icon}
        <span style={mono ? { fontFamily: 'var(--font-mono)' } : undefined}>{label}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div style={popupStyle}>
          {options.map(o => (
            <button key={o.value}
              onClick={() => onPick(o.value)}
              style={popupItem(o.value === current)}>
              {o.initial && <span style={initialBubble}>{o.initial}</span>}
              <span style={mono ? { fontFamily: 'var(--font-mono)' } : undefined}>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── style helpers ──
const initialBubble: React.CSSProperties = {
  width: 18, height: 18, borderRadius: 999,
  background: 'var(--accent-soft)', color: 'var(--accent)',
  fontSize: 10, fontWeight: 800,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}

function pillBtn(active: boolean): React.CSSProperties {
  return {
    padding: '6px 11px', borderRadius: 999,
    background: active ? 'var(--bg-3)' : 'var(--bg)',
    border: '1px solid var(--line)', color: 'var(--ink-2)',
    fontSize: 11, fontWeight: 500,
    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
  }
}

const popupStyle: React.CSSProperties = {
  position: 'absolute', bottom: 'calc(100% + 4px)', left: 0,
  zIndex: 50, minWidth: 160,
  background: 'var(--bg)', border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 4,
}

function popupItem(active: boolean): React.CSSProperties {
  return {
    width: '100%', padding: '6px 10px',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--ink-2)',
    border: 'none', borderRadius: 'var(--r-sm)',
    fontSize: 12, fontWeight: 500, textAlign: 'left',
    display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
  }
}

function statusChip(color: string, muted = false): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 999,
    background: muted ? 'var(--bg-2)' : `color-mix(in oklab, ${color} 12%, var(--bg))`,
    color: color,
    border: `1px solid ${muted ? 'var(--line)' : `color-mix(in oklab, ${color} 30%, transparent)`}`,
    fontSize: 10, fontWeight: 700,
  }
}
