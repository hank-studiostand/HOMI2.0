'use client'

// ImageStudio — Nano Banana Pro 스타일 이미지 생성 페이지
// type === 't2i'일 때 워크스페이스 메인 영역에 렌더되는 풀 페이지 컴포넌트.
// 핵심 UX:
//   - 중앙 hero (썸네일 콜라주 + "이미지 생성 시작" 카피)
//   - 하단 큰 프롬프트 바 (+ attach / 모델 / 비율 / 카운트 / 그리기 / Generate)
//   - 우측 슬라이드 History 패널 (최근 생성 이미지 그리드)

import { useState, useMemo, useRef, useEffect } from 'react'
import { Plus, ChevronDown, Sparkles, History as HistoryIcon, X, Image as ImageIcon, Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface RecentItem {
  id: string
  url: string | null
  prompt?: string
  engine?: string
  created_at: string
  attempt_id: string
}

const MODELS = [
  { value: 'nanobanana', label: 'Nano Banana 2.5', initial: 'N' },
  { value: 'gpt-image',  label: 'GPT Image 1',     initial: 'G' },
  { value: 'midjourney', label: 'Midjourney',      initial: 'M' },
]
const RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16']
const COUNTS = [1, 2, 4, 8] as const

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
  recentOutputs,
  onSelectOutput,
  onZoomOutput,
  count,
  onCountChange,
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
  recentOutputs: RecentItem[]
  onSelectOutput?: (id: string) => void
  onZoomOutput?: (id: string) => void
  count?: number
  onCountChange?: (n: number) => void
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [ratioOpen, setRatioOpen] = useState(false)
  const [countOpen, setCountOpen] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  const currentModel = useMemo(() => MODELS.find(m => m.value === engine) ?? MODELS[0], [engine])

  function autoGrow(el: HTMLTextAreaElement | null) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }
  useEffect(() => { autoGrow(taRef.current) }, [promptDraft])

  // 닫기 outside click
  useEffect(() => {
    function close() { setModelOpen(false); setRatioOpen(false); setCountOpen(false) }
    if (modelOpen || ratioOpen || countOpen) {
      window.addEventListener('click', close)
      return () => window.removeEventListener('click', close)
    }
  }, [modelOpen, ratioOpen, countOpen])

  // Hero 콜라주용 — 최근 결과 썸네일 4장 (없으면 placeholder)
  const heroThumbs = recentOutputs.filter(o => !!o.url).slice(0, 4)

  return (
    <div style={{
      width: '100%', height: '100%',
      position: 'relative',
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Top bar */}
      <div style={{
        padding: '12px 18px',
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: 'var(--ink-3)',
          padding: '5px 12px',
          background: 'var(--bg-2)', borderRadius: 999,
          border: '1px solid var(--line)',
        }}>이미지 생성</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setHistoryOpen(o => !o)}
          style={{
            padding: '6px 12px', borderRadius: 'var(--r-md)',
            border: '1px solid var(--line)',
            background: historyOpen ? 'var(--bg-3)' : 'transparent',
            color: 'var(--ink-2)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
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

      {/* 중앙 hero */}
      <div style={{
        flex: 1, overflow: 'auto',
        padding: '40px 24px 28px',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center',
      }}>
        {/* 썸네일 콜라주 */}
        <div style={{
          display: 'flex', gap: 10,
          marginBottom: 28,
          alignItems: 'center', justifyContent: 'center',
          maxWidth: 560,
        }}>
          {[0, 1, 2, 3].map(i => {
            const it = heroThumbs[i]
            const rotate = [-3, 4, -2, 5][i]
            return (
              <div key={i} style={{
                width: 110, height: 130,
                borderRadius: 16,
                background: it?.url ? 'var(--bg-3)' : 'var(--bg-2)',
                border: '1px solid var(--line-strong)',
                overflow: 'hidden',
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
          margin: '0 0 8px',
          fontSize: 28, fontWeight: 800,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          lineHeight: 1.2,
        }}>
          이미지 생성 시작하기 <span style={{ color: 'var(--accent)' }}>HOMI</span>
        </h1>
        <p style={{
          margin: 0, fontSize: 14, color: 'var(--ink-3)',
          maxWidth: 540, lineHeight: 1.6,
        }}>
          장면 · 인물 · 분위기 · 스타일을 묘사하면, AI가 바로 이미지로 만들어드려요.
        </p>
      </div>

      {/* 하단 프롬프트 바 */}
      <div style={{
        padding: '0 18px 20px',
        flexShrink: 0,
      }}>
        <div style={{
          maxWidth: 980, margin: '0 auto',
          background: 'var(--bg-2)',
          border: '1px solid var(--line-strong)',
          borderRadius: 18,
          boxShadow: '0 4px 18px rgba(0,0,0,0.06)',
          display: 'flex', flexDirection: 'column', gap: 0,
          overflow: 'visible',
        }}>
          {/* 프롬프트 입력 영역 */}
          <div style={{
            padding: '14px 16px 8px',
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <button
              title="자산 첨부 (개발 중)"
              style={{
                width: 32, height: 32, padding: 0,
                borderRadius: 8,
                background: 'var(--bg-3)',
                border: '1px solid var(--line)',
                color: 'var(--ink-3)',
                flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
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
                background: 'transparent',
                border: 'none', outline: 'none', resize: 'none',
                fontSize: 14, color: 'var(--ink)',
                lineHeight: 1.6,
                padding: 6,
              }}
            />
          </div>

          {/* 옵션 칩 + Generate */}
          <div style={{
            padding: '6px 10px 10px 12px',
            display: 'flex', alignItems: 'center', gap: 6,
            flexWrap: 'wrap',
          }}>
            {/* 모델 칩 */}
            <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setModelOpen(o => !o)}
                style={pillBtn(modelOpen)}
                title="모델 선택"
              >
                <span style={{
                  width: 18, height: 18, borderRadius: 999,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  fontSize: 10, fontWeight: 800,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>{currentModel.initial}</span>
                <span>{currentModel.label}</span>
                <ChevronDown size={12} />
              </button>
              {modelOpen && (
                <div style={popupStyle}>
                  {MODELS.map(m => (
                    <button key={m.value}
                      onClick={() => { onEngineChange(m.value); setModelOpen(false) }}
                      style={popupItem(m.value === engine)}>
                      <span style={{
                        width: 18, height: 18, borderRadius: 999,
                        background: 'var(--accent-soft)', color: 'var(--accent)',
                        fontSize: 10, fontWeight: 800,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>{m.initial}</span>
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 비율 칩 */}
            <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
              <button onClick={() => setRatioOpen(o => !o)} style={pillBtn(ratioOpen)} title="화면비">
                <span style={{ fontFamily: 'var(--font-mono)' }}>{ratio}</span>
                <ChevronDown size={12} />
              </button>
              {ratioOpen && (
                <div style={popupStyle}>
                  {RATIOS.map(r => (
                    <button key={r}
                      onClick={() => { onRatioChange(r); setRatioOpen(false) }}
                      style={popupItem(r === ratio)}>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{r}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 카운트 칩 */}
            {onCountChange && (
              <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                <button onClick={() => setCountOpen(o => !o)} style={pillBtn(countOpen)} title="생성 개수">
                  <span>{count ?? 1}/4</span>
                  <ChevronDown size={12} />
                </button>
                {countOpen && (
                  <div style={popupStyle}>
                    {COUNTS.map(n => (
                      <button key={n}
                        onClick={() => { onCountChange(n); setCountOpen(false) }}
                        style={popupItem(n === count)}>
                        {n}장
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Draw (placeholder) */}
            <button style={pillBtn(false)} title="그림으로 시작 (개발 중)">
              <Pencil size={11} />
              <span>Draw</span>
            </button>

            <span style={{ flex: 1 }} />

            {/* Generate */}
            <button
              onClick={() => void onGenerate()}
              disabled={generating || !promptDraft.trim()}
              style={{
                padding: '10px 22px',
                borderRadius: 12,
                background: generating || !promptDraft.trim() ? 'var(--bg-3)' : 'var(--accent)',
                color: generating || !promptDraft.trim() ? 'var(--ink-4)' : '#fff',
                border: 'none',
                fontSize: 13, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', gap: 8,
                cursor: generating || !promptDraft.trim() ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                boxShadow: generating || !promptDraft.trim() ? 'none' : '0 4px 12px rgba(0,0,0,0.12)',
              }}
            >
              <Sparkles size={14} />
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
        <div
          onClick={() => setHistoryOpen(false)}
          style={{
            position: 'absolute', inset: 0, zIndex: 30,
            background: 'rgba(0,0,0,0.18)',
            backdropFilter: 'blur(2px)',
          }}
        >
          <aside
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: 0, right: 0, bottom: 0,
              width: 'min(440px, 92%)',
              background: 'var(--bg)',
              borderLeft: '1px solid var(--line)',
              display: 'flex', flexDirection: 'column',
              boxShadow: '-12px 0 32px rgba(0,0,0,0.12)',
            }}
          >
            <div style={{
              padding: '14px 18px', borderBottom: '1px solid var(--line)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <HistoryIcon size={14} style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>이미지 히스토리</span>
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{recentOutputs.length}장</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setHistoryOpen(false)} className="btn" style={{ padding: 6 }}>
                <X size={13} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {recentOutputs.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', fontSize: 12, color: 'var(--ink-4)' }}>
                  아직 생성된 이미지가 없어요.<br/>
                  하단에서 프롬프트를 입력하고 Generate 해보세요.
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 10,
                }}>
                  {recentOutputs.map(o => (
                    <button
                      key={o.id}
                      onClick={() => {
                        if (o.url && onZoomOutput) onZoomOutput(o.id)
                        else if (onSelectOutput) onSelectOutput(o.id)
                      }}
                      style={{
                        padding: 0, border: '1px solid var(--line)',
                        borderRadius: 10, overflow: 'hidden',
                        background: 'var(--bg-2)',
                        aspectRatio: '1',
                        cursor: 'pointer',
                        display: 'block',
                        position: 'relative',
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

// ── style helpers ──────────────────────────────────────────
function pillBtn(active: boolean): React.CSSProperties {
  return {
    padding: '6px 11px',
    borderRadius: 999,
    background: active ? 'var(--bg-3)' : 'var(--bg)',
    border: '1px solid var(--line)',
    color: 'var(--ink-2)',
    fontSize: 11, fontWeight: 500,
    display: 'inline-flex', alignItems: 'center', gap: 6,
    cursor: 'pointer',
  }
}

const popupStyle: React.CSSProperties = {
  position: 'absolute', bottom: 'calc(100% + 4px)', left: 0,
  zIndex: 50,
  minWidth: 160,
  background: 'var(--bg)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  padding: 4,
}

function popupItem(active: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '6px 10px',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--ink-2)',
    border: 'none',
    borderRadius: 'var(--r-sm)',
    fontSize: 12, fontWeight: 500,
    textAlign: 'left',
    display: 'inline-flex', alignItems: 'center', gap: 8,
    cursor: 'pointer',
  }
}
