'use client'

import { useState, useEffect, useRef } from 'react'

/**
 * useState that persists to localStorage.
 * Reads the initial value from localStorage on first mount (SSR-safe).
 * Writes back on every change.
 */
export function useLocalState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const initialized = useRef(false)

  const [state, setState] = useState<T>(() => {
    // Read from localStorage only on client
    if (typeof window === 'undefined') return initial
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw) as T
    } catch {}
    return initial
  })

  // Persist on change (skip first render since we already read it)
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      return
    }
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {}
  }, [key, state])

  return [state, setState]
}
