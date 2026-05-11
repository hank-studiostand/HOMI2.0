// attempt 상태 업데이트 헬퍼 — metadata.failureReason 머지 포함
// Server-side 전용. Supabase server client 인스턴스를 받아서 동작.

/**
 * attempt 를 failed 상태로 마킹하면서 metadata.failureReason 머지.
 * - 기존 metadata 를 읽어 spread → failureReason 키 추가 → update
 * - reason 은 길어도 잘리지 않게 500자로 자름 (DB jsonb)
 * - metadata 컬럼 미적용 환경에서는 status 만 업데이트하는 fallback
 */
export async function markAttemptFailed(
  supabase: any,
  attemptId: string,
  reason: string,
): Promise<void> {
  try {
    const { data: cur } = await supabase
      .from('prompt_attempts')
      .select('metadata')
      .eq('id', attemptId)
      .single()
    const prev = (cur?.metadata && typeof cur.metadata === 'object') ? cur.metadata : {}
    const next = { ...prev, failureReason: String(reason ?? '알 수 없는 오류').slice(0, 500) }
    await supabase
      .from('prompt_attempts')
      .update({ status: 'failed', metadata: next })
      .eq('id', attemptId)
  } catch (err) {
    // metadata 컬럼 미적용 환경 fallback — status 만 업데이트
    console.warn('[markAttemptFailed] metadata merge failed, falling back to status-only:', err)
    try {
      await supabase
        .from('prompt_attempts')
        .update({ status: 'failed' })
        .eq('id', attemptId)
    } catch {}
  }
}
