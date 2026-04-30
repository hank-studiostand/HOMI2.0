'use client'

import { useState, useRef } from 'react'
import { Camera, Aperture, Box, MapPin, Clapperboard, RectangleHorizontal } from 'lucide-react'
import type { SceneSettings as SceneSettingsType, EngineType, AngleType, LensType } from '@/types'
import { cn } from '@/lib/utils'

// 한글 IME 조합 문제 해결용 훅
function useKoreanInput(initialValue: string, onCommit: (v: string) => void) {
  const [local, setLocal] = useState(initialValue)
  const composing = useRef(false)
  return {
    value: local,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setLocal(e.target.value)
      if (!composing.current) onCommit(e.target.value)
    },
    onCompositionStart: () => { composing.current = true },
    onCompositionEnd: (e: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      composing.current = false
      onCommit((e.target as HTMLInputElement).value)
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onCommit(e.target.value)
    },
  }
}

const ASPECT_RATIOS: { value: string; label: string }[] = [
  { value: '16:9',   label: '16:9 — 와이드스크린' },
  { value: '9:16',   label: '9:16 — 세로 (숏폼)' },
  { value: '1:1',    label: '1:1 — 정사각형' },
  { value: '4:3',    label: '4:3 — 스탠다드' },
  { value: '3:2',    label: '3:2 — 사진' },
  { value: '4:5',    label: '4:5 — 인스타그램' },
  { value: '21:9',   label: '21:9 — 울트라와이드' },
  { value: '2.35:1', label: '2.35:1 — 시네마스코프' },
  { value: '2.39:1', label: '2.39:1 — 아나모픽' },
]

const ENGINES: { value: EngineType; label: string }[] = [
  { value: 'nanobanana', label: '나노바나나' },
  { value: 'gpt-image', label: 'GPT Image' },
  { value: 'midjourney', label: 'Midjourney' },
  { value: 'stable-diffusion', label: 'Stable Diffusion' },
  { value: 'dalle', label: 'DALL-E 3' },
]
const ANGLES: { value: string; label: string }[] = [
  { value: 'eye-level', label: '아이레벨' },
  { value: 'low-angle', label: '로우앵글' },
  { value: 'high-angle', label: '하이앵글' },
  { value: 'birds-eye', label: '버즈아이' },
  { value: 'dutch-angle', label: '더치앵글' },
  { value: 'overhead', label: '오버헤드' },
  { value: 'extreme-close-up', label: 'ECU 익스트림 클로즈업' },
  { value: 'close-up', label: 'CU 클로즈업' },
  { value: 'medium-close-up', label: 'MCU 미디엄 클로즈업' },
  { value: 'medium-shot', label: 'MS 미디엄샷' },
  { value: 'medium-long-shot', label: 'MLS 미디엄 롱샷' },
  { value: 'long-shot', label: 'LS 롱샷' },
  { value: 'extreme-long-shot', label: 'ELS 익스트림 롱샷' },
  { value: 'pov', label: 'POV 시점샷' },
  { value: 'over-the-shoulder', label: 'OTS 어깨너머샷' },
  { value: 'two-shot', label: '투샷' },
  { value: 'insert-shot', label: '인서트샷' },
]
const LENSES: { value: LensType; label: string }[] = [
  { value: 'wide', label: '광각' },
  { value: 'standard', label: '표준' },
  { value: 'telephoto', label: '망원' },
  { value: 'fisheye', label: '어안' },
  { value: 'macro', label: '매크로' },
  { value: 'anamorphic', label: '아나모픽' },
]

interface SceneSettingsProps {
  settings: Partial<SceneSettingsType>
  onChange: (updates: Partial<SceneSettingsType>) => void
}

function ToggleGroup<T extends string>({
  label, icon: Icon, options, value, onChange
}: {
  label: string
  icon: React.ElementType
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={13} style={{ color: 'var(--text-secondary)' }} />
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => (
          <button key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
              value === opt.value
                ? 'text-white'
                : 'hover-surface'
            )}
            style={value === opt.value
              ? { background: 'var(--accent)' }
              : { background: 'var(--surface-3)', color: 'var(--text-secondary)' }
            }>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function SceneSettings({ settings, onChange }: SceneSettingsProps) {
  const s = {
    engine: settings.engine ?? 'nanobanana',
    angle: settings.angle ?? 'eye-level',
    lens: settings.lens ?? 'standard',
    aspect_ratio: (settings as any).aspect_ratio ?? '16:9',
    object_count: settings.object_count ?? 1,
    mood: settings.mood ?? '',
    lighting: settings.lighting ?? '',
    notes: settings.notes ?? '',
  }

  const moodInput = useKoreanInput(s.mood, v => onChange({ mood: v }))
  const lightingInput = useKoreanInput(s.lighting, v => onChange({ lighting: v }))
  const notesInput = useKoreanInput(s.notes, v => onChange({ notes: v }))

  const inputStyle = { background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }

  return (
    <div className="space-y-5">
      <ToggleGroup label="엔진" icon={Clapperboard}
        options={ENGINES} value={s.engine as EngineType}
        onChange={v => onChange({ engine: v })} />

      <ToggleGroup label="앵글 / 샷 종류" icon={Camera}
        options={ANGLES} value={s.angle as AngleType}
        onChange={v => onChange({ angle: v as AngleType })} />

      <ToggleGroup label="렌즈" icon={Aperture}
        options={LENSES} value={s.lens as LensType}
        onChange={v => onChange({ lens: v })} />

      <ToggleGroup label="화면비" icon={RectangleHorizontal}
        options={ASPECT_RATIOS} value={s.aspect_ratio}
        onChange={v => onChange({ ...(settings as any), aspect_ratio: v } as any)} />

      {/* Object Count */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Box size={13} style={{ color: 'var(--text-secondary)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>오브제 수</span>
        </div>
        <div className="flex items-center gap-3">
          <input type="range" min={0} max={10} value={s.object_count}
            onChange={e => onChange({ object_count: parseInt(e.target.value) })}
            className="flex-1"
            style={{ accentColor: 'var(--accent)' }} />
          <span className="text-sm font-mono w-6 text-center" style={{ color: 'var(--text-primary)' }}>
            {s.object_count}
          </span>
        </div>
      </div>

      {/* Mood & Lighting */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>무드</label>
          <input {...moodInput} placeholder="무드 입력..."
            className="w-full px-2.5 py-1.5 rounded-lg text-sm" style={inputStyle} />
        </div>
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>조명</label>
          <input {...lightingInput} placeholder="조명 입력..."
            className="w-full px-2.5 py-1.5 rounded-lg text-sm" style={inputStyle} />
        </div>
      </div>

      {/* Notes */}
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <MapPin size={13} style={{ color: 'var(--text-secondary)' }} />
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>메모</label>
        </div>
        <textarea {...notesInput} rows={2} placeholder="추가 메모..."
          className="w-full px-2.5 py-1.5 rounded-lg text-sm resize-none" style={inputStyle} />
      </div>
    </div>
  )
}
