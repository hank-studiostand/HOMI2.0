import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'
import { generateSeedanceI2V } from '@/lib/seedance'

// ── Kling JWT (HS256) ─────────────────────────────────────────────────────────
function generateKlingJWT(apiKey: string, apiSecret: string): string {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: apiKey,
    exp: Math.floor(Date.now() / 1000) + 1800,
    nbf: Math.floor(Date.now() / 1000) - 5,
  })).toString('base64url')
  const sig = crypto
    .createHmac('sha256', apiSecret)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${sig}`
}

// ── Kling I2V ─────────────────────────────────────────────────────────────────
async function generateKlingI2V(params: {
  sourceImageUrl: string
  prompt: string
  duration: number
  aspectRatio: string
  modelName?: string
}): Promise<string> {
  const apiKey    = process.env.KLING_API_KEY    ?? ''
  const apiSecret = process.env.KLING_API_SECRET ?? ''
  const baseUrl   = 'https://api.klingai.com'

  if (!apiKey || !apiSecret) throw new Error('KLING_API_KEY / KLING_API_SECRET not set')

  const jwt = generateKlingJWT(apiKey, apiSecret)

  // 1) 생성 요청 — 엔진 별 모델 매핑
  const body = {
    model_name:   params.modelName ?? 'kling-v2',
    image:        params.sourceImageUrl,
    prompt:       params.prompt,
    duration:     params.duration,
    aspect_ratio: params.aspectRatio,
    cfg_scale:    0.5,
    mode:         'std',
  }

  console.log('[I2V] Kling create request:', JSON.stringify(body))

  const createRes = await fetch(`${baseUrl}/v1/videos/image2video`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  })

  const createText = await createRes.text()
  console.log('[I2V] Kling create response:', createRes.status, createText)

  if (!createRes.ok) {
    throw new Error(`Kling create failed (${createRes.status}): ${createText}`)
  }

  const createData = JSON.parse(createText)
  const taskId = createData.data?.task_id
  if (!taskId) throw new Error(`Kling: task_id not returned. Response: ${createText}`)

  // 2) 폴링 (최대 5분, 10초 간격)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 10_000))

    const pollJwt = generateKlingJWT(apiKey, apiSecret)
    const pollRes  = await fetch(`${baseUrl}/v1/videos/image2video/${taskId}`, {
      headers: { 'Authorization': `Bearer ${pollJwt}` },
    })
    const pollData = await pollRes.json()
    const status   = pollData.data?.task_status

    console.log(`[I2V] Poll #${i + 1} status: ${status}`)

    if (status === 'succeed') {
      const url = pollData.data?.task_result?.videos?.[0]?.url ?? ''
      if (!url) throw new Error('Kling: succeeded but no video URL in response')
      return url
    }
    if (status === 'failed') {
      throw new Error(`Kling task failed: ${pollData.data?.task_status_msg ?? 'unknown error'}`)
    }
  }

  throw new Error('Kling I2V: polling timeout after 5 minutes')
}

// ── Route Handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const {
    attemptId,
    prompt,
    sourceImageUrl,
    projectId,
    sceneId,
    engine      = 'kling',  // 'kling' | 'kling3' | 'seedance-2'
    duration    = 5,
    aspectRatio = '16:9',
  } = await req.json()

  console.log('[I2V] generate called', { attemptId, sceneId, duration, aspectRatio, hasSource: !!sourceImageUrl })

  const supabase = await createClient()

  // 기본 검증
  if (!sourceImageUrl) {
    await supabase.from('prompt_attempts').update({ status: 'failed' }).eq('id', attemptId)
    return NextResponse.json({ error: 'sourceImageUrl is required' }, { status: 400 })
  }
  if (!prompt?.trim()) {
    await supabase.from('prompt_attempts').update({ status: 'failed' }).eq('id', attemptId)
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  try {
    let videoUrl: string
    if (engine === 'seedance-2' || engine === 'seedance') {
      videoUrl = await generateSeedanceI2V({
        prompt, imageUrl: sourceImageUrl, duration, aspectRatio,
        resolution: '720p',
      })
    } else if (engine === 'kling3') {
      videoUrl = await generateKlingI2V({ sourceImageUrl, prompt, duration, aspectRatio, modelName: 'kling-v2' })
    } else {
      // 기본 Kling (kling, kling-1.6 등)
      videoUrl = await generateKlingI2V({ sourceImageUrl, prompt, duration, aspectRatio, modelName: 'kling-v1-6' })
    }

    if (!videoUrl) throw new Error('No video URL returned')

    // assets 테이블에 저장
    const { data: asset } = await supabase.from('assets').insert({
      project_id: projectId,
      scene_id:   sceneId,
      type:       'i2v',
      name:       `i2v_${Date.now()}.mp4`,
      url:        videoUrl,
      tags:       [],
      metadata:   { prompt, source_image: sourceImageUrl, engine, duration, aspect_ratio: aspectRatio },
      attempt_id: attemptId,
    }).select().single()

    // 취소된 경우 업데이트 스킵
    const { data: currentAttempt } = await supabase
      .from('prompt_attempts').select('status').eq('id', attemptId).single()
    if (currentAttempt?.status === 'failed') {
      return NextResponse.json({ success: false, error: '사용자가 취소한 작업' }, { status: 409 })
    }

    if (asset) {
      await supabase.from('attempt_outputs').insert({
        attempt_id: attemptId,
        asset_id:   asset.id,
      })
    }

    await supabase.from('prompt_attempts').update({ status: 'done' }).eq('id', attemptId)
    return NextResponse.json({ success: true, videoUrl })

  } catch (err) {
    console.error('[I2V] generate error:', err)
    await supabase.from('prompt_attempts').update({ status: 'failed' }).eq('id', attemptId)
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'I2V 생성 실패: ' + msg }, { status: 500 })
  }
}

