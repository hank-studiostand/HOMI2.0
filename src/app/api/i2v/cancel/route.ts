import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { attemptId } = await req.json()
  if (!attemptId) return NextResponse.json({ error: 'attemptId required' }, { status: 400 })

  const supabase = await createClient()

  // 현재 상태 확인 — 이미 완료된 경우엔 취소 불가
  const { data: attempt } = await supabase
    .from('prompt_attempts')
    .select('status')
    .eq('id', attemptId)
    .single()

  if (!attempt) return NextResponse.json({ error: 'attempt not found' }, { status: 404 })
  if (attempt.status === 'done') {
    return NextResponse.json({ cancelled: false, reason: 'already_done' })
  }

  // 상태를 failed로 업데이트하여 취소 처리
  await supabase
    .from('prompt_attempts')
    .update({ status: 'failed' })
    .eq('id', attemptId)
    .in('status', ['pending', 'generating'])  // 생성 중인 것만 취소

  return NextResponse.json({ cancelled: true })
}
