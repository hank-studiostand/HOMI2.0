import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(date))
}

export function getSatisfactionColor(score: number | null) {
  if (!score) return 'text-zinc-500'
  if (score >= 4) return 'text-emerald-400'
  if (score >= 3) return 'text-yellow-400'
  return 'text-red-400'
}

export function getSatisfactionLabel(score: number | null) {
  const labels = { 1: '매우 불만족', 2: '불만족', 3: '보통', 4: '만족', 5: '매우 만족' }
  return score ? labels[score as keyof typeof labels] : '미평가'
}
