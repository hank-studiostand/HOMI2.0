'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Camera, Eye } from 'lucide-react'

// ── 카메라 앵글 프리셋 ────────────────────────────────────────
const ANGLES = [
  { key: 'eye_level',  label: '아이레벨',   desc: 'Eye Level', prompt: 'eye level shot' },
  { key: 'low',        label: '로우앵글',    desc: 'Low Angle', prompt: 'low angle shot' },
  { key: 'high',       label: '하이앵글',    desc: 'High Angle', prompt: 'high angle shot' },
  { key: 'birds_eye',  label: '버즈아이',    desc: "Bird's Eye View", prompt: "bird's eye view shot" },
  { key: 'dutch',      label: '더치앵글',    desc: 'Dutch Angle', prompt: 'dutch angle shot, tilted camera' },
  { key: 'worms_eye',  label: '웜즈아이',    desc: "Worm's Eye View", prompt: "worm's eye view shot" },
  { key: 'pov',        label: 'POV',        desc: 'Point of View', prompt: 'POV shot, first person perspective' },
  { key: 'over_shoulder', label: '오버숄더', desc: 'Over the Shoulder', prompt: 'over the shoulder shot' },
]

// ── 샷 사이즈 프리셋 ──────────────────────────────────────────
const SHOT_SIZES = [
  { key: 'extreme_wide', label: 'EWS',  desc: '익스트림 와이드', prompt: 'extreme wide shot, establishing shot' },
  { key: 'wide',         label: 'WS',   desc: '와이드샷',        prompt: 'wide shot' },
  { key: 'medium_wide',  label: 'MWS',  desc: '미디엄 와이드',   prompt: 'medium wide shot' },
  { key: 'medium',       label: 'MS',   desc: '미디엄샷',        prompt: 'medium shot' },
  { key: 'medium_close', label: 'MCU',  desc: '미디엄 클로즈',   prompt: 'medium close-up shot' },
  { key: 'close_up',     label: 'CU',   desc: '클로즈업',        prompt: 'close-up shot' },
  { key: 'extreme_close',label: 'ECU',  desc: '익스트림 클로즈', prompt: 'extreme close-up shot' },
  { key: 'insert',       label: 'IS',   desc: '인서트',          prompt: 'insert shot, detail shot' },
]

// ── 렌즈 프리셋 ───────────────────────────────────────────────
const LENSES = [
  { key: '14mm',  label: '14mm',  desc: '초광각',   prompt: '14mm ultra wide angle lens' },
  { key: '24mm',  label: '24mm',  desc: '광각',     prompt: '24mm wide angle lens' },
  { key: '35mm',  label: '35mm',  desc: '준광각',   prompt: '35mm lens, slightly wide' },
  { key: '50mm',  label: '50mm',  desc: '표준',     prompt: '50mm standard lens, natural perspective' },
  { key: '85mm',  label: '85mm',  desc: '인물',     prompt: '85mm portrait lens, slight compression' },
  { key: '135mm', label: '135mm', desc: '망원',     prompt: '135mm telephoto lens, compressed perspective' },
  { key: 'macro', label: 'Macro', desc: '마크로',   prompt: 'macro lens, extreme close detail' },
  { key: 'fisheye',label: 'Fish', desc: '어안',     prompt: 'fisheye lens, 180 degree distortion' },
]

// ── 조명 프리셋 ───────────────────────────────────────────────
const LIGHTING = [
  { key: 'natural',   label: '자연광',   prompt: 'natural daylight, soft shadows' },
  { key: 'golden',    label: '골든아워', prompt: 'golden hour lighting, warm tones' },
  { key: 'blue_hour', label: '블루아워', prompt: 'blue hour lighting, cool tones' },
  { key: 'studio',    label: '스튜디오', prompt: 'studio lighting, three point lighting' },
  { key: 'dramatic',  label: '드라마틱', prompt: 'dramatic lighting, high contrast chiaroscuro' },
  { key: 'backlit',   label: '역광',    prompt: 'backlit, rim lighting, silhouette effect' },
  { key: 'neon',      label: '네온',    prompt: 'neon lighting, cyberpunk atmosphere' },
  { key: 'candlelight',label: '촛불',   prompt: 'candlelight, warm intimate lighting' },
]

// ── 추천 콤보 프리셋 (한 클릭으로 4개 동시 설정) ─────────────
type ComboPreset = {
  key: string
  label: string
  desc: string
  angle: string
  shotSize: string
  lens: string
  lighting: string
}
const COMBO_PRESETS: ComboPreset[] = [
  { key: 'cinematic_wide',  label: '시네마틱 와이드',   desc: '광활한 풍경 / 오프닝',
    angle: 'eye_level', shotSize: 'wide',         lens: '24mm', lighting: 'golden' },
  { key: 'emotion_closeup', label: '감정 클로즈업',     desc: '인물 디테일 / 표정',
    angle: 'eye_level', shotSize: 'close_up',     lens: '85mm', lighting: 'natural' },
  { key: 'dynamic_action',  label: '다이내믹 액션',     desc: '동작 / 박력',
    angle: 'low',        shotSize: 'medium_wide',  lens: '35mm', lighting: 'dramatic' },
  { key: 'intimate_pov',    label: '친밀한 POV',        desc: '주관적 시선',
    angle: 'pov',        shotSize: 'medium_close', lens: '35mm', lighting: 'candlelight' },
  { key: 'iconic_estab',    label: '확립샷 아이코닉',    desc: '오프닝 / 장소',
    angle: 'low',        shotSize: 'extreme_wide', lens: '14mm', lighting: 'golden' },
  { key: 'product_macro',   label: '제품 마크로',        desc: '오브제 디테일',
    angle: 'eye_level', shotSize: 'extreme_close',lens: 'macro',lighting: 'studio' },
]

interface CameraReferencePanelProps {
  selectedAngle?: string
  selectedShotSize?: string
  selectedLens?: string
  selectedLighting?: string
  onSelect: (type: 'angle' | 'shotSize' | 'lens' | 'lighting', key: string, prompt: string) => void
  onDeselect: (type: 'angle' | 'shotSize' | 'lens' | 'lighting') => void
}

export default function CameraReferencePanel({
  selectedAngle,
  selectedShotSize,
  selectedLens,
  selectedLighting,
  onSelect,
  onDeselect,
}: CameraReferencePanelProps) {
  const [open, setOpen] = useState(false)

  const selectedCount = [selectedAngle, selectedShotSize, selectedLens, selectedLighting].filter(Boolean).length

  function toggle(type: 'angle' | 'shotSize' | 'lens' | 'lighting', key: string, prompt: string) {
    const current = { angle: selectedAngle, shotSize: selectedShotSize, lens: selectedLens, lighting: selectedLighting }[type]
    if (current === key) {
      onDeselect(type)
    } else {
      onSelect(type, key, prompt)
    }
  }

  return (
    <div className="rounded overflow-hidden" style={{ border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}` }}>
      {/* 헤더 토글 */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover-surface transition-all"
        style={{
          color: open ? 'var(--accent)' : 'var(--text-secondary)',
          background: open ? 'var(--accent-subtle)' : 'var(--surface)',
        }}
      >
        <Camera size={12} />
        <span className="font-medium">카메라 레퍼런스</span>
        <span className="text-[10px] opacity-60 flex-1 text-left ml-1">앵글 · 샷사이즈 · 렌즈 · 조명</span>
        {selectedCount > 0 && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium mr-1"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            {selectedCount}개 선택
          </span>
        )}
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>

      {open && (
        <div className="p-3 space-y-4 border-t" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>

          {/* 추천 콤보 — 한 번에 4개 설정 */}
          <Section label="추천 콤보">
            <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {COMBO_PRESETS.map(c => {
                const active = (
                  selectedAngle === c.angle &&
                  selectedShotSize === c.shotSize &&
                  selectedLens === c.lens &&
                  selectedLighting === c.lighting
                )
                return (
                  <button
                    key={c.key}
                    onClick={() => {
                      const a = ANGLES.find(x => x.key === c.angle)
                      const s = SHOT_SIZES.find(x => x.key === c.shotSize)
                      const l = LENSES.find(x => x.key === c.lens)
                      const li = LIGHTING.find(x => x.key === c.lighting)
                      if (a) onSelect('angle', c.angle, a.prompt)
                      if (s) onSelect('shotSize', c.shotSize, s.prompt)
                      if (l) onSelect('lens', c.lens, l.prompt)
                      if (li) onSelect('lighting', c.lighting, li.prompt)
                    }}
                    className="px-2 py-1.5 rounded text-left transition-all hover-surface"
                    style={{
                      background: active ? 'var(--accent-subtle)' : 'var(--surface-2)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    <div className="text-[11px] font-semibold">{c.label}</div>
                    <div className="text-[9px] opacity-60 truncate">{c.desc}</div>
                  </button>
                )
              })}
            </div>
          </Section>

          {/* 앵글 */}
          <Section label="앵글" icon={Eye}>
            <Grid>
              {ANGLES.map(item => (
                <PresetChip
                  key={item.key}
                  label={item.label}
                  desc={item.desc}
                  selected={selectedAngle === item.key}
                  onClick={() => toggle('angle', item.key, item.prompt)}
                />
              ))}
            </Grid>
          </Section>

          {/* 샷 사이즈 */}
          <Section label="샷 사이즈">
            <Grid>
              {SHOT_SIZES.map(item => (
                <PresetChip
                  key={item.key}
                  label={item.label}
                  desc={item.desc}
                  selected={selectedShotSize === item.key}
                  onClick={() => toggle('shotSize', item.key, item.prompt)}
                />
              ))}
            </Grid>
          </Section>

          {/* 렌즈 */}
          <Section label="렌즈">
            <Grid cols={4}>
              {LENSES.map(item => (
                <PresetChip
                  key={item.key}
                  label={item.label}
                  desc={item.desc}
                  selected={selectedLens === item.key}
                  onClick={() => toggle('lens', item.key, item.prompt)}
                />
              ))}
            </Grid>
          </Section>

          {/* 조명 */}
          <Section label="조명">
            <Grid cols={4}>
              {LIGHTING.map(item => (
                <PresetChip
                  key={item.key}
                  label={item.label}
                  desc={item.key}
                  selected={selectedLighting === item.key}
                  onClick={() => toggle('lighting', item.key, item.prompt)}
                />
              ))}
            </Grid>
          </Section>

          {/* 선택된 프롬프트 미리보기 */}
          {selectedCount > 0 && (
            <div
              className="p-2.5 rounded text-[11px] leading-relaxed"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <span className="font-medium" style={{ color: 'var(--text-muted)' }}>추가될 프롬프트: </span>
              <span style={{ color: 'var(--accent)' }}>
                {[
                  selectedAngle    && ANGLES.find(a => a.key === selectedAngle)?.prompt,
                  selectedShotSize && SHOT_SIZES.find(a => a.key === selectedShotSize)?.prompt,
                  selectedLens     && LENSES.find(a => a.key === selectedLens)?.prompt,
                  selectedLighting && LIGHTING.find(a => a.key === selectedLighting)?.prompt,
                ].filter(Boolean).join(', ')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 내부 컴포넌트 ────────────────────────────────────────────

function Section({ label, icon: Icon, children }: { label: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
        {Icon && <Icon size={10} />}
        {label}
      </p>
      {children}
    </div>
  )
}

function Grid({ children, cols = 4 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div className={`grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {children}
    </div>
  )
}

function PresetChip({ label, desc, selected, onClick }: {
  label: string; desc: string; selected: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-1.5 rounded text-center transition-all hover-surface"
      style={{
        background: selected ? 'var(--accent-subtle)' : 'var(--surface-2)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        color: selected ? 'var(--accent)' : 'var(--text-secondary)',
      }}
    >
      <div className="text-[11px] font-semibold">{label}</div>
      <div className="text-[9px] opacity-60 truncate">{desc}</div>
    </button>
  )
}

// ── 카메라 레퍼런스 → 프롬프트 변환 유틸 ────────────────────

export function buildCameraPrompt(selections: {
  angle?: string
  shotSize?: string
  lens?: string
  lighting?: string
}): string {
  const parts: string[] = []
  if (selections.angle)    { const a = ANGLES.find(x => x.key === selections.angle);    if (a) parts.push(a.prompt) }
  if (selections.shotSize) { const s = SHOT_SIZES.find(x => x.key === selections.shotSize); if (s) parts.push(s.prompt) }
  if (selections.lens)     { const l = LENSES.find(x => x.key === selections.lens);    if (l) parts.push(l.prompt) }
  if (selections.lighting) { const li = LIGHTING.find(x => x.key === selections.lighting); if (li) parts.push(li.prompt) }
  return parts.join(', ')
}
