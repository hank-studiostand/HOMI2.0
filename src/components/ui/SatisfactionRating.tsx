'use client'

import { useEffect, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SatisfactionScore } from '@/types'

const LABELS = ['', '매우불만족', '불만족', '보통', '만족', '매우만족']
const PLACEHOLDER: Record<number, string> = {
  1: '뭐가 별로였나요? (선택)',
  2: '아쉬운 점을 적어주세요 (선택)',
  3: '보완할 점이 있다면? (선택)',
  4: '좋았던 점을 한 줄로 (선택)',
  5: '매우 만족! 어떤 점이 좋았나요? (선택)',
}

interface SatisfactionRatingProps {
  value: SatisfactionScore | null
  onChange?: (score: SatisfactionScore) => void
  readonly?: boolean
  size?: 'sm' | 'md'
  // 피드백 (MVP)
  feedback?: string
  onFeedbackCommit?: (feedback: string) => void
  showFeedback?: boolean   // true면 별점이 있을 때만 자동 노출
}

export default function SatisfactionRating({
  value,
  onChange,
  readonly,
  size = 'md',
  feedback = '',
  onFeedbackCommit,
  showFeedback = true,
}: SatisfactionRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [draft, setDraft] = useState(feedback)
  const composing = useRef(false)
  const active = hovered ?? value ?? 0
  const iconSize = size === 'sm' ? 14 : 18

  useEffect(() => { setDraft(feedback) }, [feedback])

  function commit() {
    if (composing.current) return
    if (draft === feedback) return
    onFeedbackCommit?.(draft)
  }

  const showInput = showFeedback && !readonly && !!onFeedbackCommit && (value ?? 0) > 0

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n}
            type="button"
            disabled={readonly}
            onClick={() => onChange?.(n as SatisfactionScore)}
            onMouseEnter={() => !readonly && setHovered(n)}
            onMouseLeave={() => setHovered(null)}
            className={cn('transition-all', readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110')}
          >
            <Star
              size={iconSize}
              className={cn('transition-colors', n <= active ? 'fill-current text-amber-400' : 'text-zinc-600')}
            />
          </button>
        ))}
        {active > 0 && (
          <span className="text-xs ml-1" style={{ color: 'var(--text-secondary)' }}>
            {LABELS[active]}
          </span>
        )}
      </div>

      {showInput && (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={(e) => {
            composing.current = false
            const v = (e.target as HTMLTextAreaElement).value
            if (v !== feedback) onFeedbackCommit?.(v)
          }}
          onBlur={commit}
          rows={2}
          placeholder={PLACEHOLDER[value ?? 0] ?? '피드백 (선택)'}
          className="w-full px-2 py-1.5 rounded text-xs resize-none"
          style={{
            background: 'var(--surface-3)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
          maxLength={500}
        />
      )}
    </div>
  )
}
