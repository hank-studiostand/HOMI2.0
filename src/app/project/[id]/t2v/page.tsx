'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import {
  Clapperboard, Loader2, Film, X, Wand2, Plus, Trash2, Play, Image as ImageIcon,
} from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import CameraReferencePanel, { buildCameraPrompt } from '@/components/ui/CameraReferencePanel'
import ImageLightbox, { type LightboxItem } from '@/components/ui/ImageLightbox'
import type { Asset } from '@/types'

interface MadeVideo {
  id: string
  url: string
  name: string
  prompt: string
  ratio: string
  duration: number
  engine: string
  createdAt: string
}

function ratioToCss(r: string): string {
  if (!r || !r.includes(':')) return '16/9'
  return r.replace(':', '/')
}

const RATIOS: { value: string; label: string }[] = [
  { value: '16:9',  label: '16:9 (와이드)' },
  { value: '9:16',  label: '9:16 (세로)' },
  { value: '1:1',   label: '1:1' },
  { value: '4:3',   label: '4:3' },
  { value: '21:9',  label: '21:9 (시네마)' },
]

const DURATIONS = [5, 10]

const ENGINES: { value: string; label: string; available: boolean; note?: string }[] = [
  { value: 'seedance-2', label: 'Seedance 2.0',          available: true,  note: '추천 — 빠르고 안정적' },
  { value: 'kling3',     label: 'Kling 3.0',              available: true },
  { value: 'kling3-omni',label: 'Kling 3.0 Omni',         available: true,  note: '멀티샷 / 오디오' },
]

const MODES: { value: 'std' | 'pro'; label: string; desc: string }[] = [
  { value: 'std', label: 'Standard', desc: '빠름' },
  { value: 'pro', label: 'Pro',      desc: '고품질' },
]

export default function T2VPage() {
  const params = useParams<{ id: string }>()
  const projectId = params.id
  const supabase = createClient()

  // ── 입력 상태 ──────────────────────────────────────────────
  const [prompt, setPrompt] = useState('')
  const [negPrompt, setNegPrompt] = useState('')
  const [name, setName] = useState('')
  const [mood, setMood] = useState('')
  const [ratio, setRatio] = useState('16:9')
  const [duration, setDuration] = useState(5)
  const [engine, setEngine] = useState<string>('seedance-2')
  const [mode, setMode] = useState<'std' | 'pro'>('std')

  // 카메라 레퍼런스
  const [camera, setCamera] = useState<{ angle?: string; shotSize?: string; lens?: string; lighting?: string }>({})
  const [cameraTokens, setCameraTokens] = useState('')

  // 라이트박스
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  // 진행 상태
  const [generating, setGenerating] = useState(false)

  // 결과
  const [made, setMade] = useState<MadeVideo[]>([])

  // 카메라 토큰 자동 합성
  useEffect(() => { setCameraTokens(buildCameraPrompt(camera)) }, [camera])

  // 합성 프롬프트 미리보기
  const fullPromptPreview = useMemo(() => {
    const parts: string[] = []
    if (prompt.trim())   parts.push(prompt.trim())
    if (cameraTokens)    parts.push(cameraTokens)
    if (mood.trim())     parts.push(`mood: ${mood.trim()}`)
    return parts.join(', ')
  }, [prompt, cameraTokens, mood])

  // 초기 로드 — 기존 t2v-freestyle 결과
  useEffect(() => {
    if (!projectId) return
    void (async () => {
      const { data } = await supabase
        .from('assets').select('*')
        .eq('project_id', projectId)
        .eq('type', 'i2v')
        .order('created_at', { ascending: false })
        .limit(200)
      const list = (data ?? []) as Asset[]
      const prior = list
        .filter(a => {
          const m: any = a.metadata ?? {}
          return m?.source === 't2v-freestyle' || (Array.isArray(a.tags) && a.tags.includes('t2v') && a.tags.includes('freestyle'))
        })
        .map(a => {
          const m: any = a.metadata ?? {}
          return {
            id: a.id,
            url: a.url,
            name: a.name,
            prompt: (m.prompt as string) ?? '',
            ratio: (m.aspect_ratio as string) ?? '16:9',
            duration: Number(m.duration ?? 5),
            engine: (m.engine as string) ?? '',
            createdAt: a.created_at,
          }
        })
      setMade(prior)
    })()
  }, [projectId])

  function onCameraSelect(type: 'angle' | 'shotSize' | 'lens' | 'lighting', key: string) {
    setCamera(p => ({ ...p, [type]: key }))
  }
  function onCameraDeselect(type: 'angle' | 'shotSize' | 'lens' | 'lighting') {
    setCamera(p => { const n = { ...p }; delete n[type]; return n })
  }

  async function handleGenerate() {
    if (!prompt.trim()) { toast.warning('프롬프트를 입력해주세요'); return }
    if (generating) return
    setGenerating(true)
    try {
      const res = await fetch('/api/t2v/freestyle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          prompt: prompt.trim(),
          negativePrompt: negPrompt.trim() || undefined,
          cameraTokens, mood: mood.trim() || undefined,
          aspectRatio: ratio,
          duration,
          engine,
          mode,
          name: name.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.error ?? 'T2V 생성 실패')
        return
      }
      const a = json.asset
      const newOne: MadeVideo = {
        id: a.id, url: a.url, name: a.name,
        prompt: fullPromptPreview, ratio, duration, engine,
        createdAt: a.created_at ?? new Date().toISOString(),
      }
      setMade(p => [newOne, ...p])
      toast.success('영상 생성 완료')
    } catch (e: any) {
      toast.error(`생성 실패: ${e?.message ?? String(e)}`)
    } finally {
      setGenerating(false)
    }
  }

  async function deleteMade(v: MadeVideo) {
    if (!confirm('이 영상을 삭제하시겠어요?')) return
    try {
      const { error } = await supabase.from('assets').delete().eq('id', v.id)
      if (error) throw error
      setMade(p => p.filter(m => m.id !== v.id))
      toast.success('삭제됨')
    } catch (e: any) {
      toast.error(`삭제 실패: ${e?.message ?? String(e)}`)
    }
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      {/* ── 페이지 헤더 ── */}
      <div
        style={{
          padding: '20px 28px 16px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--bg)',
          position: 'sticky', top: 0, zIndex: 3,
        }}
      >
        <div className="flex items-end justify-between" style={{ gap: 16 }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'var(--accent-soft)',
              display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
              <Clapperboard size={18} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                T2V — 텍스트로 영상
              </h1>
              <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>
                프롬프트 · 카메라 · 무드 · 화면비 · 길이로 영상 에셋을 만들어 프로젝트에 추가합니다.
              </p>
            </div>
          </div>
          <span className="text-xs" style={{ color: 'var(--ink-4)' }}>
            생성된 영상 <b style={{ color: 'var(--ink-2)' }}>{made.length}</b>편
          </span>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(420px, 480px) 1fr',
          gap: 20, padding: '20px 28px', alignItems: 'start',
        }}
      >
        {/* ── LEFT: 입력 ─────────────────────────────────── */}
        <div
          className="card"
          style={{
            padding: 16,
            display: 'flex', flexDirection: 'column', gap: 14,
            position: 'sticky', top: 16,
            maxHeight: 'calc(100vh - 96px)', overflowY: 'auto',
          }}
        >
          <Field label="이름 (선택)">
            <input
              className="input"
              placeholder="예: forest_arrival, retro_neon_alley"
              value={name} onChange={e => setName(e.target.value)}
            />
          </Field>

          <Field label="프롬프트" required>
            <textarea
              className="textarea" rows={5}
              placeholder="예: 이른 새벽, 안개 낀 숲길에서 카메라가 천천히 전진. 양옆으로 양치식물 잎이 흔들리고..."
              value={prompt} onChange={e => setPrompt(e.target.value)}
            />
          </Field>

          <Field label="부정 프롬프트 (선택)">
            <input
              className="input"
              placeholder="예: blurry, low quality, watermark"
              value={negPrompt} onChange={e => setNegPrompt(e.target.value)}
            />
          </Field>

          <Field label="카메라 (선택)">
            <CameraReferencePanel
              selectedAngle={camera.angle}
              selectedShotSize={camera.shotSize}
              selectedLens={camera.lens}
              selectedLighting={camera.lighting}
              onSelect={(t, k) => onCameraSelect(t, k)}
              onDeselect={onCameraDeselect}
            />
          </Field>

          <Field label="무드 (선택)">
            <input
              className="input"
              placeholder="예: nostalgic, ominous, dreamy, gritty noir..."
              value={mood} onChange={e => setMood(e.target.value)}
            />
          </Field>

          <Field label="화면비">
            <div className="flex flex-wrap" style={{ gap: 6 }}>
              {RATIOS.map(r => (
                <button
                  key={r.value} type="button"
                  onClick={() => setRatio(r.value)}
                  className="btn"
                  style={{
                    background: ratio === r.value ? 'var(--accent-soft)' : 'var(--bg-3)',
                    color: ratio === r.value ? 'var(--accent)' : 'var(--ink-2)',
                    border: `1px solid ${ratio === r.value ? 'var(--accent-line)' : 'var(--line)'}`,
                    fontWeight: 500,
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="영상 길이">
            <div className="flex" style={{ gap: 6 }}>
              {DURATIONS.map(d => (
                <button
                  key={d} type="button"
                  onClick={() => setDuration(d)}
                  className="btn"
                  style={{
                    background: duration === d ? 'var(--accent-soft)' : 'var(--bg-3)',
                    color: duration === d ? 'var(--accent)' : 'var(--ink-2)',
                    border: `1px solid ${duration === d ? 'var(--accent-line)' : 'var(--line)'}`,
                    minWidth: 56, fontWeight: 500,
                  }}
                >
                  {d}초
                </button>
              ))}
            </div>
          </Field>

          <Field label="엔진">
            <div className="flex flex-col" style={{ gap: 4 }}>
              {ENGINES.map(e => (
                <button
                  key={e.value} type="button"
                  onClick={() => e.available && setEngine(e.value)}
                  disabled={!e.available}
                  style={{
                    padding: '8px 10px', borderRadius: 'var(--r-md)',
                    background: engine === e.value ? 'var(--accent-soft)' : 'var(--bg-2)',
                    color: engine === e.value ? 'var(--accent)' : 'var(--ink-2)',
                    border: `1px solid ${engine === e.value ? 'var(--accent-line)' : 'var(--line)'}`,
                    textAlign: 'left',
                    opacity: e.available ? 1 : 0.5,
                    cursor: e.available ? 'pointer' : 'not-allowed',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{e.label}</div>
                  {e.note && <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>{e.note}</div>}
                </button>
              ))}
            </div>
          </Field>

          {(engine === 'kling3' || engine === 'kling3-omni') && (
            <Field label="Kling 모드">
              <div className="flex" style={{ gap: 6 }}>
                {MODES.map(m => (
                  <button
                    key={m.value} type="button"
                    onClick={() => setMode(m.value)}
                    className="btn"
                    style={{
                      flex: 1, padding: '6px 10px',
                      background: mode === m.value ? 'var(--accent-soft)' : 'var(--bg-3)',
                      color: mode === m.value ? 'var(--accent)' : 'var(--ink-2)',
                      border: `1px solid ${mode === m.value ? 'var(--accent-line)' : 'var(--line)'}`,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 11 }}>{m.label}</div>
                    <div style={{ fontSize: 9, opacity: 0.7 }}>{m.desc}</div>
                  </button>
                ))}
              </div>
            </Field>
          )}

          {fullPromptPreview && (
            <div
              style={{
                padding: 10, borderRadius: 8,
                background: 'var(--bg-2)', border: '1px solid var(--line)',
                fontSize: 11, lineHeight: 1.5, color: 'var(--ink-3)',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                최종 프롬프트
              </div>
              <div style={{ color: 'var(--ink-2)' }}>{fullPromptPreview}</div>
            </div>
          )}

          <button
            className="btn primary"
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            style={{ height: 40, fontSize: 14, fontWeight: 600 }}
          >
            {generating
              ? <><Loader2 size={14} className="animate-spin" /> 생성 중… (2~5분 소요)</>
              : <><Wand2 size={14} /> 영상 생성</>}
          </button>
          {generating && (
            <p style={{ fontSize: 10, color: 'var(--ink-4)', textAlign: 'center', margin: 0 }}>
              영상 생성은 시간이 오래 걸려요. 이 페이지를 떠나도 결과는 저장됩니다.
            </p>
          )}
        </div>

        {/* ── RIGHT: 결과 ─────────────────────────────────── */}
        <div className="card" style={{ padding: 16, minHeight: 400 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>생성 결과</h2>
            <span className="text-xs" style={{ color: 'var(--ink-4)' }}>
              {made.length === 0 ? '아직 생성된 영상이 없습니다' : `${made.length}편`}
            </span>
          </div>
          {made.length === 0 ? (
            <div
              style={{
                border: '1px dashed var(--line-strong)',
                borderRadius: 12, padding: 48,
                textAlign: 'center', color: 'var(--ink-4)',
                background: 'var(--bg-2)',
              }}
            >
              <Film size={32} style={{ opacity: 0.4, margin: '0 auto 12px' }} />
              <p style={{ fontSize: 13, marginBottom: 6 }}>왼쪽에서 프롬프트를 입력하고 <b style={{ color: 'var(--ink-2)' }}>영상 생성</b>을 눌러주세요.</p>
              <p style={{ fontSize: 11, opacity: 0.7 }}>Seedance 2.0 / Kling 3.0 — 프로젝트 어디서든 다시 볼 수 있어요.</p>
            </div>
          ) : (
            <div
              className="grid"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}
            >
              {made.map((v, i) => (
                <VideoCard
                  key={v.id}
                  video={v}
                  onDelete={() => deleteMade(v)}
                  onZoom={() => setLightboxIdx(i)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 라이트박스 ── */}
      {lightboxIdx !== null && (
        <ImageLightbox
          items={made.map(v => ({
            url: v.url,
            name: v.name,
            caption: v.prompt,
            isVideo: true,
          })) as LightboxItem[]}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  )
}

// ─── 보조 컴포넌트 ──────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label
        style={{
          fontSize: 11, fontWeight: 600,
          color: 'var(--ink-3)', marginBottom: 6, display: 'block',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}
      >
        {label}{required && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>*</span>}
      </label>
      {children}
    </div>
  )
}

function VideoCard({
  video, onDelete, onZoom,
}: {
  video: MadeVideo
  onDelete: () => void
  onZoom: () => void
}) {
  return (
    <div
      style={{
        borderRadius: 10, overflow: 'hidden',
        border: '1px solid var(--line)', background: 'var(--bg-2)',
      }}
    >
      <div
        onClick={onZoom}
        title="클릭해서 크게 재생"
        style={{
          aspectRatio: ratioToCss(video.ratio),
          background: '#000',
          position: 'relative',
          cursor: 'zoom-in',
        }}
      >
        <video
          src={video.url}
          muted loop
          onMouseEnter={e => { (e.target as HTMLVideoElement).play().catch(()=>{}) }}
          onMouseLeave={e => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0 }}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'absolute', top: 6, left: 6,
            padding: '2px 7px', borderRadius: 6,
            fontSize: 10, fontWeight: 600,
            background: 'rgba(0,0,0,0.65)', color: '#fff',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          <Play size={9} fill="currentColor" />
          {video.duration}초 · {video.engine}
        </div>
      </div>
      <div style={{ padding: 8 }}>
        <div
          style={{
            fontSize: 12, fontWeight: 500, color: 'var(--ink-2)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 4,
          }}
          title={video.name}
        >
          {video.name}
        </div>
        {video.prompt && (
          <div
            style={{
              fontSize: 10, color: 'var(--ink-4)',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              overflow: 'hidden', marginBottom: 6, lineHeight: 1.4,
            }}
            title={video.prompt}
          >
            {video.prompt}
          </div>
        )}
        <div className="flex" style={{ gap: 4 }}>
          <button
            className="btn"
            onClick={onZoom}
            style={{ flex: 1, fontSize: 11, padding: '5px 8px', justifyContent: 'center' }}
          >
            <ImageIcon size={11} /> 크게 보기
          </button>
          <button
            className="btn"
            onClick={onDelete}
            style={{ fontSize: 11, padding: '5px 8px', color: 'var(--danger)' }}
            title="삭제"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}
