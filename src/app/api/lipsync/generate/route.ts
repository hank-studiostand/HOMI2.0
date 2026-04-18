import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// 실패 시 공통 처리: DB에 failed 기록 + 에러 응답
async function recordFailure(
  supabase: Awaited<ReturnType<typeof createClient>>,
  attemptId: string,
  stage: string,
  detail: string,
) {
  console.error('[lipsync] ' + stage + ':', detail)
  await supabase
    .from('prompt_attempts')
    .update({ status: 'failed' })
    .eq('id', attemptId)
  return NextResponse.json(
    { success: false, error: stage + ': ' + detail },
    { status: 500 },
  )
}

export async function POST(req: NextRequest) {
  const { attemptId, videoUrl, audioUrl, projectId, sceneId } = await req.json()
  const supabase = await createClient()

  try {
    // 1) SyncLabs 작업 생성
    const syncRes = await fetch('https://api.synclabs.so/video', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.SYNCLABS_API_KEY ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ videoUrl, audioUrl, synergize: true }),
    })

    if (!syncRes.ok) {
      const errText = await syncRes.text().catch(() => '')
      return await recordFailure(
        supabase,
        attemptId,
        'SyncLabs 작업 생성 실패',
        'HTTP ' + syncRes.status + ': ' + (errText.slice(0, 300) || '(응답 본문 없음)'),
      )
    }

    const syncData = await syncRes.json()
    const jobId: string | undefined = syncData.id
    if (!jobId) {
      return await recordFailure(
        supabase,
        attemptId,
        'SyncLabs 응답 이상',
        'job id 없음. 응답: ' + JSON.stringify(syncData).slice(0, 300),
      )
    }

    // 2) 폴링 (최대 5분, 15초 간격)
    let resultUrl = ''
    let lastStatus = 'unknown'
    let failureReason = ''
    const MAX_POLLS = 20
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, 15_000))
      const pollRes = await fetch(
        'https://api.synclabs.so/video/' + jobId,
        {
          headers: { 'x-api-key': process.env.SYNCLABS_API_KEY ?? '' },
        },
      )

      if (!pollRes.ok) {
        failureReason =
          '폴링 HTTP ' + pollRes.status + ' (시도 ' + (i + 1) + '/' + MAX_POLLS + ')'
        console.warn('[lipsync] ' + failureReason)
        continue
      }

      const pollData = await pollRes.json()
      lastStatus = pollData.status ?? 'unknown'

      if (lastStatus === 'completed') {
        resultUrl = pollData.url ?? ''
        break
      }
      if (lastStatus === 'failed') {
        failureReason = pollData.error ?? pollData.message ?? '(SyncLabs가 실패 이유를 반환하지 않음)'
        break
      }
    }

    if (!resultUrl) {
      const detail =
        lastStatus === 'failed'
          ? 'SyncLabs 실패: ' + failureReason
          : '5분 폴링 후에도 완료되지 않음 (마지막 상태: ' + lastStatus + ')'
      return await recordFailure(supabase, attemptId, '립싱크 생성 실패', detail)
    }

    // 3) 성공 — DB에 저장
    const { data: asset, error: insErr } = await supabase
      .from('assets')
      .insert({
        project_id: projectId,
        scene_id: sceneId,
        type: 'lipsync',
        name: 'lipsync_' + Date.now() + '.mp4',
        url: resultUrl,
        tags: [],
        metadata: { source_video: videoUrl, audio: audioUrl },
        attempt_id: attemptId,
      })
      .select()
      .single()

    if (insErr || !asset) {
      return await recordFailure(
        supabase,
        attemptId,
        '에셋 저장 실패',
        insErr?.message ?? '(알 수 없음)',
      )
    }

    await supabase
      .from('attempt_outputs')
      .insert({ attempt_id: attemptId, asset_id: asset.id })
    await supabase
      .from('prompt_attempts')
      .update({ status: 'done' })
      .eq('id', attemptId)

    return NextResponse.json({ success: true, url: resultUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return await recordFailure(supabase, attemptId, '예외 발생', msg)
  }
}
