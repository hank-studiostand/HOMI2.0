'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SatisfactionScore } from '@/types'

const LABELS = ['', '매우불만족', '불만족', '보통', '만족', '매우만족']

interface SatisfactionRatingProps {
  value: SatisfactionScore | null
  onChange?: (score: SatisfactionScore) => void
  readonly?: boolean
  size?: 'sm' | 'md'
}

export default function SatisfactionRating({
  value, onChange, readonly, size = 'md'
}: SatisfactionRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const active = hovered ?? value ?? 0
  const iconSize = size === 'sm' ? 14 : 18

  return (
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
  )
}
