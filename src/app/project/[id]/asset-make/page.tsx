'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import {
  Sparkles, Loader2, Image as ImageIcon, X, Upload, Wand2, Plus, Check, Library, Trash2,
} from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import CameraReferencePanel, { buildCameraPrompt } from '@/components/ui/CameraReferencePanel'
import type { Asset, RootAssetSeed } from '@/types'

interface MadeAsset {
  id: string
  url: string
  name: string
  prompt: string
  ratio: string
  createdAt: string
  promotedToRoot?: boolean
}

// 화면비 문자열 → CSS aspectRatio
function ratioToCss(r: string): string {
  if (!r || !r.includes(':')) return '16/9'
  return r.replace(':', '/')
}

const RATIOS: { value: string; label: string }[] = [
  { value: '16:9',  label: '16:9 (와이드)' },
  { value: '9:16',  label: '9:16 (세로)' },
  { value: '1:1',   label: '1:1 (정사각)' },
  { value: '4:3',   label: '4:3' },
  { value: '3:2',   label: '3:2' },
  { value: '4:5',   label: '4:5 (포트레이트)' },
  { value: '21:9',  label: '21:9 (시네마)' },
]

const ENGINES: { value: string; label: string; available: boolean }[] = [
  { value: 'nanobanana',       label: '나노바나나 (Gemini 2.5 Flash Image)', available: true },
  { value: 'midjourney',       label: 'Midjourney',       available: false },
  { value: 'gpt-image',        label: 'GPT Image',         available: false },
  { value: 'stable-diffusion', label: 'Stable Diffusion',  available: false },
]

const COUNTS = [1, 2, 4, 6, 8]

export default function AssetMakePage() {
  const params = useParams<{ id: string }>()
  const projectId = params.id
  const supabase = createClient()

  // ── 입력 상태 ──────────────────────────────────────────────
  const [prompt, setPrompt] = useState('')
  const [name, setName] = useState('')
  const [mood, setMood] = useState('')
  const [ratio, setRatio] = useState('16:9')
  const [engine, setEngine] = useState('nanobanana')
  const [count, setCount] = useState(4)

  // 카메라 레퍼런스 (앵글/샷사이즈/렌즈/조명)
  const [camera, setCamera] = useState<{
    angle?: string; shotSize?: string; lens?: string; lighting?: string
  }>({})
  const [cameraTokens, setCameraTokens] = useState<string>('')

  // 레퍼런스 이미지 (기존 에셋에서 선택)
  const [refOpen, setRefOpen] = useState(false)
  const [allAssets, setAllAssets] = useState<Asset[]>([])
  const [selectedRefIds, setSelectedRefIds] = useState<string[]>([])

  // 업로드형 레퍼런스 (직접 업로드)
  const [uploadedRefUrls, setUploadedRefUrls] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)

  // 생성 상태
  const [generating, setGenerating] = useState(false)

  // 결과 (이번 세션에서 만든 것 + 기존 asset-make 에셋)
  const [made, setMade] = useState<MadeAsset[]>([])

  // ── 초기 로드 — 프로젝트 에셋 + 기존 asset-make 결과 ────────
  useEffect(() => {
    if (!projectId) return
    void (async () => {
      const { data: assets } = await supabase
        .from('assets')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(200)
      const list = (assets ?? []) as Asset[]
      setAllAssets(list)
      // 기존 asset-make 결과 — metadata.source === 'asset-make' 또는 tags 포함
      const prior = list
        .filter(a => {
          const m: any = a.metadata ?? {}
          return m?.source === 'asset-make' || (Array.isArray(a.tags) && a.tags.includes('asset-make'))
        })
        .map(a => ({
          id: a.id,
          url: a.url,
          name: a.name,
          prompt: ((a.metadata as any)?.prompt as string) ?? '',
          ratio: ((a.metadata as any)?.aspect_ratio as string) ?? '16:9',
          createdAt: a.created_at,
        }))
      setMade(prior)
    })()
  }, [projectId])

  // ── 카메라 토큰 자동 합성 ─────────────────────────────────
  useEffect(() => {
    setCameraTokens(buildCameraPrompt(camera))
  }, [camera])

  // ── 합성 프롬프트 미리보기 ─────────────────────────────────
  const fullPromptPreview = useMemo(() => {
    const parts: string[] = []
    if (prompt.trim())          parts.push(prompt.trim())
    if (cameraTokens)           parts.push(cameraTokens)
    if (mood.trim())            parts.push(`mood: ${mood.trim()}`)
    return parts.join(', ')
  }, [prompt, cameraTokens, mood])

  // ── 카메라 패널 핸들러 ─────────────────────────────────────
  function onCameraSelect(type: 'angle' | 'shotSize' | 'lens' | 'lighting', key: string) {
    setCamera(p => ({ ...p, [type]: key }))
  }
  function onCameraDeselect(type: 'angle' | 'shotSize' | 'lens' | 'lighting') {
    setCamera(p => { const n = { ...p }; delete n[type]; return n })
  }

  // ── 레퍼런스 이미지 직접 업로드 ────────────────────────────
  async function handleUploadRef(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const newUrls: string[] = []
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
          toast.warning('이미지 파일만 업로드 가능합니다')
          continue
        }
        const path = `asset-make-refs/${projectId}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`
        const { data, error } = await supabase.storage.from('assets').upload(path, file)
        if (error) {
          toast.error(`업로드 실패: ${error.message}`)
          continue
        }
        const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(data.path)
        newUrls.push(publicUrl)
      }
      setUploadedRefUrls(p => [...p, ...newUrls].slice(0, 3))
      if (newUrls.length > 0) toast.success(`레퍼런스 ${newUrls.length}장 추가됨`)
    } finally {
      setUploading(false)
    }
  }

  // ── 생성 트리거 ────────────────────────────────────────────
  async function handleGenerate() {
    if (!prompt.trim()) {
      toast.warning('프롬프트를 입력해주세요')
      return
    }
    if (generating) return
    setGenerating(true)
    try {
      // 레퍼런스 URL 모음 (선택된 에셋 + 업로드된 것) — 최대 3장
      const selectedAssetUrls = selectedRefIds
        .map(id => allAssets.find(a => a.id === id)?.url)
        .filter((u): u is string => !!u)
      const referenceImageUrls = [...selectedAssetUrls, ...uploadedRefUrls].slice(0, 3)

      const res = await fetch('/api/asset-make/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          prompt: prompt.trim(),
          cameraTokens,
          mood: mood.trim() || undefined,
          aspectRatio: ratio,
          count,
          engine,
          referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
          name: name.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast.error(json.error ?? '생성 실패')
        return
      }
      const newOnes: MadeAsset[] = (json.assets ?? []).map((a: any) => ({
        id: a.id,
        url: a.url,
        name: a.name,
        prompt: fullPromptPreview,
        ratio,
        createdAt: new Date().toISOString(),
      }))
      setMade(p => [...newOnes, ...p])
      // allAssets에도 반영해서 다음번 레퍼런스로 활용 가능
      const newAssetRows = newOnes.map(n => ({
        id: n.id, project_id: projectId, scene_id: null,
        type: 'reference' as const, name: n.name, url: n.url, thumbnail_url: n.url,
        tags: ['asset-make'], metadata: { source: 'asset-make', aspect_ratio: n.ratio }, archived: false,
        attempt_id: null, satisfaction_score: null, created_at: n.createdAt,
      })) as unknown as Asset[]
      setAllAssets(p => [...newAssetRows, ...p])
      toast.success(`${newOnes.length}장 생성 완료`)
    } catch (e: any) {
      toast.error(`생성 실패: ${e.message ?? String(e)}`)
    } finally {
      setGenerating(false)
    }
  }

  // ── 결과 → 루트에셋 promote ───────────────────────────────
  async function promoteToRoot(asset: MadeAsset) {
    try {
      const seedName = asset.name.replace(/\.[a-z]+$/i, '')
      const { error } = await supabase.from('root_asset_seeds').insert({
        project_id: projectId,
        category: 'misc',
        name: seedName,
        description: asset.prompt.slice(0, 200),
        reference_image_urls: [asset.url],
      })
      if (error) throw error
      setMade(p => p.map(m => m.id === asset.id ? { ...m, promotedToRoot: true } : m))
      toast.success('루트 에셋으로 등록되었습니다')
    } catch (e: any) {
      toast.error(`promote 실패: ${e.message ?? String(e)}`)
    }
  }

  // ── 결과 삭제 (asset 행 삭제) ──────────────────────────────
  async function deleteMade(asset: MadeAsset) {
    if (!confirm('이 결과를 삭제하시겠어요?')) return
    try {
      const { error } = await supabase.from('assets').delete().eq('id', asset.id)
      if (error) throw error
      setMade(p => p.filter(m => m.id !== asset.id))
      setAllAssets(p => p.filter(a => a.id !== asset.id))
      toast.success('삭제됨')
    } catch (e: any) {
      toast.error(`삭제 실패: ${e.message ?? String(e)}`)
    }
  }

  // ── 레퍼런스 후보 — asset-make 결과 + 일반 reference 에셋 ──
  const refCandidates = useMemo(
    () => allAssets.filter(a => !a.archived && (a.type === 'reference' || a.type === 't2i')),
    [allAssets]
  )

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      {/* ── 페이지 헤더 ── */}
      <div
        style={{
          padding: '20px 28px 16px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--bg)',
          position: 'sticky',
          top: 0,
          zIndex: 3,
        }}
      >
        <div className="flex items-end justify-between" style={{ gap: 16 }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            <div
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: 'var(--accent-soft)',
                display: 'grid', placeItems: 'center',
                flexShrink: 0,
              }}
            >
              <Sparkles size={18} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                에셋 메이킹
              </h1>
              <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>
                프롬프트 · 레퍼런스 · 카메라 · 무드로 임의의 이미지 에셋을 만들어 프로젝트에 추가합니다.
              </p>
            </div>
          </div>
          <div className="flex items-center" style={{ gap: 8 }}>
            <span className="text-xs" style={{ color: 'var(--ink-4)' }}>
              생성된 에셋 <b style={{ color: 'var(--ink-2)' }}>{made.length}</b>장
            </span>
          </div>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(420px, 480px) 1fr',
          gap: 20,
          padding: '20px 28px',
          alignItems: 'start',
        }}
      >
        {/* ─── LEFT: 입력 패널 ─────────────────────────────── */}
        <div
          className="card"
          style={{
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            position: 'sticky',
            top: 16,
            maxHeight: 'calc(100vh - 96px)',
            overflowY: 'auto',
          }}
        >
          {/* 이름 */}
          <Field label="에셋 이름 (선택)">
            <input
              className="input"
              placeholder="예: forest_hero, retro_diner, antique_lamp"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </Field>

          {/* 프롬프트 */}
          <Field label="프롬프트" required>
            <textarea
              className="textarea"
              rows={5}
              placeholder="예: 깊은 숲속의 안개 낀 석조 다리, 이끼와 양치식물, 새벽의 푸른 빛..."
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
            />
          </Field>

          {/* 레퍼런스 이미지 */}
          <Field label={`레퍼런스 이미지 ${(selectedRefIds.length + uploadedRefUrls.length) > 0 ? `(${selectedRefIds.length + uploadedRefUrls.length}/3)` : '(선택, 최대 3장)'}`}>
            <div className="flex gap-2 mb-2 flex-wrap">
              {/* 선택된 에셋 */}
              {selectedRefIds.map(id => {
                const a = allAssets.find(x => x.id === id)
                if (!a) return null
                return (
                  <RefThumb
                    key={id}
                    url={a.thumbnail_url ?? a.url}
                    label={a.name}
                    onRemove={() => setSelectedRefIds(p => p.filter(x => x !== id))}
                  />
                )
              })}
              {/* 업로드된 */}
              {uploadedRefUrls.map((u, i) => (
                <RefThumb
                  key={u}
                  url={u}
                  label={`업로드 ${i + 1}`}
                  onRemove={() => setUploadedRefUrls(p => p.filter(x => x !== u))}
                />
              ))}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                className="btn"
                onClick={() => setRefOpen(true)}
                disabled={selectedRefIds.length + uploadedRefUrls.length >= 3}
                type="button"
              >
                <Library size={13} /> 에셋에서 선택
              </button>
              <label
                className="btn"
                style={{ cursor: uploading || (selectedRefIds.length + uploadedRefUrls.length >= 3) ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}
              >
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {uploading ? '업로드 중…' : '직접 업로드'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  disabled={uploading || (selectedRefIds.length + uploadedRefUrls.length >= 3)}
                  onChange={e => { void handleUploadRef(e.target.files); e.currentTarget.value = '' }}
                />
              </label>
            </div>
          </Field>

          {/* 카메라 레퍼런스 (앵글/샷사이즈/렌즈/조명) */}
          <Field label="카메라 (선택)">
            <CameraReferencePanel
              selectedAngle={camera.angle}
              selectedShotSize={camera.shotSize}
              selectedLens={camera.lens}
              selectedLighting={camera.lighting}
              onSelect={(type, key) => onCameraSelect(type, key)}
              onDeselect={onCameraDeselect}
            />
          </Field>

          {/* 무드 */}
          <Field label="무드 (선택)">
            <input
              className="input"
              placeholder="예: nostalgic, ominous, dreamy, gritty noir..."
              value={mood}
              onChange={e => setMood(e.target.value)}
            />
          </Field>

          {/* 화면비 */}
          <Field label="화면비">
            <div className="flex flex-wrap gap-1.5">
              {RATIOS.map(r => (
                <button
                  key={r.value}
                  type="button"
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

          {/* 엔진 */}
          <Field label="엔진">
            <select
              className="input"
              value={engine}
              onChange={e => setEngine(e.target.value)}
            >
              {ENGINES.map(e => (
                <option key={e.value} value={e.value} disabled={!e.available}>
                  {e.label}{!e.available ? ' (준비중)' : ''}
                </option>
              ))}
            </select>
          </Field>

          {/* 매수 */}
          <Field label="생성 매수">
            <div className="flex gap-1.5">
              {COUNTS.map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className="btn"
                  style={{
                    background: count === n ? 'var(--accent-soft)' : 'var(--bg-3)',
                    color: count === n ? 'var(--accent)' : 'var(--ink-2)',
                    border: `1px solid ${count === n ? 'var(--accent-line)' : 'var(--line)'}`,
                    minWidth: 38,
                    fontWeight: 500,
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>

          {/* 합성 프롬프트 미리보기 */}
          {fullPromptPreview && (
            <div
              style={{
                padding: 10,
                borderRadius: 8,
                background: 'var(--bg-2)',
                border: '1px solid var(--line)',
                fontSize: 11,
                lineHeight: 1.5,
                color: 'var(--ink-3)',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                최종 프롬프트
              </div>
              <div style={{ color: 'var(--ink-2)' }}>{fullPromptPreview}</div>
            </div>
          )}

          {/* 생성 버튼 */}
          <button
            className="btn primary"
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            style={{ height: 40, fontSize: 14, fontWeight: 600 }}
          >
            {generating ? <><Loader2 size={14} className="animate-spin" /> 생성 중…</> : <><Wand2 size={14} /> {count}장 생성</>}
          </button>
        </div>

        {/* ─── RIGHT: 결과 갤러리 ──────────────────────────── */}
        <div className="card" style={{ padding: 16, minHeight: 400 }}>
          <div className="flex items-center justify-between mb-3">
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>생성 결과</h2>
            <span className="text-xs" style={{ color: 'var(--ink-4)' }}>
              {made.length === 0 ? '아직 생성된 에셋이 없습니다' : `${made.length}장`}
            </span>
          </div>

          {made.length === 0 ? (
            <div
              style={{
                border: '1px dashed var(--line-strong)',
                borderRadius: 12,
                padding: 48,
                textAlign: 'center',
                color: 'var(--ink-4)',
                background: 'var(--bg-2)',
              }}
            >
              <ImageIcon size={32} style={{ opacity: 0.4, margin: '0 auto 12px' }} />
              <p style={{ fontSize: 13, marginBottom: 6 }}>왼쪽에서 프롬프트를 입력하고 <b style={{ color: 'var(--ink-2)' }}>생성</b>을 눌러주세요.</p>
              <p style={{ fontSize: 11, opacity: 0.7 }}>레퍼런스/카메라/무드를 함께 지정하면 더 일관된 결과가 나옵니다.</p>
            </div>
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
            >
              {made.map(asset => (
                <ResultCard
                  key={asset.id}
                  asset={asset}
                  onPromote={() => promoteToRoot(asset)}
                  onDelete={() => deleteMade(asset)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── 에셋에서 선택 모달 ──────────────────────────── */}
      {refOpen && (
        <RefPickerModal
          assets={refCandidates}
          selected={selectedRefIds}
          onClose={() => setRefOpen(false)}
          onConfirm={ids => { setSelectedRefIds(ids); setRefOpen(false) }}
          maxRemaining={Math.max(0, 3 - uploadedRefUrls.length)}
        />
      )}
    </div>
  )
}

// ── 보조 컴포넌트 ───────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--ink-3)',
          marginBottom: 6,
          display: 'block',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}{required && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>*</span>}
      </label>
      {children}
    </div>
  )
}

function RefThumb({ url, label, onRemove }: { url: string; label: string; onRemove: () => void }) {
  return (
    <div
      style={{
        position: 'relative',
        width: 64, height: 64,
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--line)',
        background: 'var(--bg-3)',
      }}
    >
      <img src={url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <button
        type="button"
        onClick={onRemove}
        style={{
          position: 'absolute', top: 2, right: 2,
          width: 18, height: 18, borderRadius: 999,
          background: 'rgba(0,0,0,0.65)', color: 'white',
          display: 'grid', placeItems: 'center', cursor: 'pointer',
        }}
      >
        <X size={11} />
      </button>
    </div>
  )
}

function ResultCard({
  asset,
  onPromote,
  onDelete,
}: {
  asset: MadeAsset
  onPromote: () => void
  onDelete: () => void
}) {
  return (
    <div
      style={{
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid var(--line)',
        background: 'var(--bg-2)',
      }}
    >
      <div style={{ aspectRatio: ratioToCss(asset.ratio), background: 'var(--bg-3)', position: 'relative' }}>
        <img src={asset.url} alt={asset.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {asset.promotedToRoot && (
          <div
            style={{
              position: 'absolute', top: 6, left: 6,
              padding: '2px 6px', borderRadius: 6,
              background: 'var(--accent)', color: 'white',
              fontSize: 10, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 3,
            }}
          >
            <Check size={10} /> 루트
          </div>
        )}
      </div>
      <div style={{ padding: 8 }}>
        <div
          style={{
            fontSize: 12, fontWeight: 500,
            color: 'var(--ink-2)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 4,
          }}
        >
          {asset.name}
        </div>
        {asset.prompt && (
          <div
            style={{
              fontSize: 10, color: 'var(--ink-4)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              marginBottom: 6,
              lineHeight: 1.4,
            }}
            title={asset.prompt}
          >
            {asset.prompt}
          </div>
        )}
        <div className="flex gap-1">
          <button
            className="btn"
            onClick={onPromote}
            disabled={asset.promotedToRoot}
            style={{ flex: 1, fontSize: 11, padding: '5px 8px', justifyContent: 'center' }}
            title="루트 에셋으로 등록"
          >
            <Plus size={11} /> {asset.promotedToRoot ? '등록됨' : '루트로'}
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

// ─── 에셋 선택 모달 ─────────────────────────────────────────
function RefPickerModal({
  assets,
  selected,
  onClose,
  onConfirm,
  maxRemaining,
}: {
  assets: Asset[]
  selected: string[]
  onClose: () => void
  onConfirm: (ids: string[]) => void
  maxRemaining: number
}) {
  const [picked, setPicked] = useState<string[]>(selected)
  const cap = Math.min(3, maxRemaining + selected.filter(s => true).length)

  function toggle(id: string) {
    setPicked(p => {
      if (p.includes(id)) return p.filter(x => x !== id)
      if (p.length >= cap) return p
      return [...p, id]
    })
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: 'min(800px, 100%)',
          maxHeight: '80vh',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>레퍼런스 에셋 선택</h3>
            <p style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
              최대 {cap}장 ({picked.length}/{cap} 선택됨)
            </p>
          </div>
          <button onClick={onClose} className="btn" style={{ padding: 6 }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {assets.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 48, fontSize: 12 }}>
              사용 가능한 레퍼런스 에셋이 없습니다.
            </div>
          ) : (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
            >
              {assets.map(a => {
                const isPicked = picked.includes(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggle(a.id)}
                    style={{
                      borderRadius: 8,
                      overflow: 'hidden',
                      border: `2px solid ${isPicked ? 'var(--accent)' : 'var(--line)'}`,
                      background: 'var(--bg-3)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex', flexDirection: 'column',
                    }}
                  >
                    <div style={{ aspectRatio: '1', position: 'relative', background: 'var(--bg-3)' }}>
                      <img
                        src={a.thumbnail_url ?? a.url}
                        alt={a.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      {isPicked && (
                        <div
                          style={{
                            position: 'absolute', top: 4, right: 4,
                            width: 18, height: 18, borderRadius: 999,
                            background: 'var(--accent)', color: 'white',
                            display: 'grid', placeItems: 'center',
                          }}
                        >
                          <Check size={11} />
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 10, padding: '4px 6px',
                        color: 'var(--ink-3)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        textAlign: 'left',
                      }}
                    >
                      {a.name}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--line)',
            display: 'flex', gap: 8, justifyContent: 'flex-end',
          }}
        >
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={() => onConfirm(picked)}>
            <Check size={13} /> 적용
          </button>
        </div>
      </div>
    </div>
  )
}
