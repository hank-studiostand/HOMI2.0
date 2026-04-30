'use client'

import { cn } from '@/lib/utils'

export type PillVariant =
  | 'draft' | 'ready' | 'gen' | 'review' | 'revise'
  | 'approved' | 'removed' | 'locked' | 'completed' | 'danger'

interface Props {
  variant?: PillVariant
  showDot?: boolean
  className?: string
  children: React.ReactNode
}

/**
 * 레퍼런스 디자인의 .pill 클래스를 래핑한 React 컴포넌트.
 * 상태별 색·배경은 globals.css에 정의된 .pill.{variant} 가 처리.
 */
export default function Pill({ variant = 'draft', showDot, className, children }: Props) {
  return (
    <span className={cn('pill', variant, className)}>
      {showDot && <span className="dot" />}
      {children}
    </span>
  )
}
