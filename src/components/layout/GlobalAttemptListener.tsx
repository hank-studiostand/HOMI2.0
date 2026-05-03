'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { pushToast } from '@/components/ui/GenerationToast'

// 프로젝트 전역 — 어떤 페이지에서든 prompt_attempts status 변경을 감지하고 토스트.
// (씬 페이지에 머무르지 않는 사용자도 결과 도착 알림을 받을 수 있도록)

interface Props {
  projectId: string
}

export default function GlobalAttemptListener({ projectId }: Props) {
  const supabase = createClient()
  // 동일 attempt 변경에 토스트 중복 방지
  const seenRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    let active = true

    void (async () => {
      // 이 프로젝트의 씬 id 모음 (필터 조건 — attempt_change subscription 시 사용)
      const { data: scenes } = await supabase
        .from('scenes').select('id, scene_number, title').eq('project_id', projectId)
      if (!active || !scenes) return
      const sceneById = new Map<string, { scene_number: string; title: string }>(
        scenes.map(s => [s.id, { scene_number: (s as any).scene_number, title: (s as any).title }])
      )
      const sceneIdSet = new Set(scenes.map(s => s.id as string))

      const ch = supabase
        .channel(`global-attempts-${projectId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'prompt_attempts' },
          (payload) => {
            const row = payload.new as any
            if (!sceneIdSet.has(row.scene_id)) return // 다른 프로젝트 attempt 무시
            const prev = seenRef.current.get(row.id)
            if (prev === row.status) return
            seenRef.current.set(row.id, row.status)

            const sc = sceneById.get(row.scene_id)
            const sceneName = sc ? `${sc.scene_number} ${sc.title || ''}`.trim() : ''

            if (row.status === 'completed') {
              pushToast({
                type: 'success',
                genType: row.type,
                title: `${row.type === 't2i' ? '이미지' : '영상'} 생성 완료${sceneName ? ` — ${sceneName}` : ''}`,
                message: '결과를 확인해보세요.',
              })
            } else if (row.status === 'failed') {
              pushToast({
                type: 'error',
                genType: row.type,
                title: `${row.type === 't2i' ? '이미지' : '영상'} 생성 실패${sceneName ? ` — ${sceneName}` : ''}`,
                message: row.error_message ?? '실패했습니다.',
              })
            }
          },
        )
        .subscribe()

      return () => { supabase.removeChannel(ch) }
    })()

    return () => { active = false }
  }, [projectId, supabase])

  return null
}
