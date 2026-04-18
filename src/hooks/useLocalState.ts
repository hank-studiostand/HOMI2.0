'use client'

import { useState, useEffect, useRef } from 'react'

/**
 * useState + localStorage 영속화.
 * - SSR 안전 (초기 렌더 시 initial 반환, 마운트 후 localStorage 값으로 치환)
 * - 디바운스된 쓰기: 빠른 연속 업데이트(타이핑 등) 시 마지막 값만 저장
 * - 언마운트 시 대기 중이던 쓰기를 즉시 플러시해서 손실 방지
 */
const DEFAULT_DEBOUNCE_MS = 300

export function useLocalState<T>(
  key: string,
  initial: T,
  options: { debounceMs?: number } = {},
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const initialized = useRef(false)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestValue = useRef<T>(initial)

  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return initial
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw) as T
    } catch (err) {
      console.debug(`[useLocalState] read 실패 (${key}):`, err)
    }
    return initial
  })

  // 디바운스된 쓰기
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      latestValue.current = state
      return
    }
    latestValue.current = state

    if (pendingTimer.current) clearTimeout(pendingTimer.current)
    pendingTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(latestValue.current))
      } catch (err) {
        console.debug(`[useLocalState] write 실패 (${key}):`, err)
      }
      pendingTimer.current = null
    }, debounceMs)
  }, [key, state, debounceMs])

  // 언마운트 시 대기 중인 쓰기 플러시
  useEffect(() => {
    return () => {
      if (pendingTimer.current) {
        clearTimeout(pendingTimer.current)
        try {
          localStorage.setItem(key, JSON.stringify(latestValue.current))
        } catch (err) {
          console.debug(`[useLocalState] unmount flush 실패 (${key}):`, err)
        }
      }
    }
  }, [key])

  return [state, setState]
}
