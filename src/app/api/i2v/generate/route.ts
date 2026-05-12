import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'
import { generateSeedanceI2V, generateSeedanceT2V } from '@/lib/seedance'
import { markAttemptFailed } from '@/lib/attemptStatus'

// Seedance 15초 영상은 폴링이 2~4분 걸려서 Vercel 기본(10s/60s) 안에 안 끝남.
// Pro plan 최대치 300s로 설정.
export const runtime = 'nodejs'
export const maxDuration = 300

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

// ── Kling 모델명 매핑 — Kling 공식 API model_name 형식 ──
// API 가 받는 정확한 model_name: kling-v1, kling-v1-5, kling-v1-6, kling-v2-master, kling-v2-1-master
// 코드 1201 "model is not supported" 방지
function mapKlingModelName(engine: string): string {
  switch (engine) {
    case 'kling3-omni': return 'kling-v2-1-master'  // 최신 Kling 2.1 (Omni 별도 모델 없음 — 통합 사용)
    case 'kling3':      return 'kling-v2-1-master'  // 최신 Kling 2.1
    case 'kling2':      return 'kling-v2-master'    // Kling 2.0
    case 'kling1-6':
    case 'kling-1-6':
    case 'kling':       return 'kling-v1-6'         // Kling 1.6
    default:            return 'kling-v1-6'
  }
}

// ── Kling 에러 코드 → 한국어 메시지 ──
function formatKlingError(status: number, body: string): string {
  try {
    const j = JSON.parse(body)
    const code = j.code
    const msg = j.message ?? body
    const map: Record<number, string> = {
      1000: '인증 실패 — API 키를 확인해주세요.',
      1001: '인증 만료 — JWT 토큰을 갱신해주세요.',
      1101: '요청 형식 오류 — 파라미터를 확인해주세요.',
      1102: '필수 파라미터 누락.',
      1103: '파라미터 값이 허용 범위를 벗어남.',
      1201: 'Kling 모델을 지원하지 않습니다 — 다른 엔진(Seedance 등)을 사용하거나 관리자에게 문의해주세요.',
      1202: '이미지 형식 오류 — JPG/PNG 권장.',
      1203: '이미지가 너무 크거나 작음 (해상도/용량).',
      1301: '컨텐츠 안전 검열 — 프롬프트나 이미지에 부적절한 내용이 포함되어 있어요.',
      1401: '계정 잔액 부족.',
      1402: '월 한도 초과.',
      1501: '동시 작업 한도 초과 — 잠시 후 다시 시도해주세요.',
      1502: '서비스 일시 점검.',
    }
    const friendly = code && map[code as number] ? map[code as number] : msg
    return `Kling ${status} (code ${code ?? '?'}): ${friendly}`
  } catch {
    return `Kling ${status}: ${body.slice(0, 300)}`
  }
}

// ── Kling I2V ─────────────────────────────────────────────────────────────────
async function generateKlingI2V(params: {
  sourceImageUrl: string
  endImageUrl?: string | null
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
  // image: start frame (필수), image_tail: end frame (선택)
  const body: Record<string, any> = {
    model_name:   params.modelName ?? 'kling-v2',
    image:        params.sourceImageUrl,
    prompt:       params.prompt,
    duration:     params.duration,
    aspect_ratio: params.aspectRatio,
    cfg_scale:    0.5,
    mode:         'std',
  }
  if (params.endImageUrl) {
    body.image_tail = params.endImageUrl
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
    throw new Error(formatKlingError(createRes.status, createText))
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
    endFrameUrl,            // 끝 프레임 (선택) — Seedance last_frame, Kling image_tail
    projectId,
    sceneId,
    engine      = 'kling',  // 'kling' | 'kling3' | 'seedance-2'
    duration    = 5,
    aspectRatio = '16:9',
    mode        = 'i2v',    // 'i2v' | 'r2v' | 'v2v'  (v2v = 영상 참고)
    referenceImageUrls,     // R2V 모드
    referenceVideoUrl,      // V2V 모드 — 영상 참고 (Seedance 전용)
    resolution  = '720p',
    generateAudio,          // Seedance 오디오 생성 옵션
  } = await req.json()

  console.log('[I2V] generate called', {
    attemptId, sceneId, mode, engine, duration, aspectRatio, resolution,
    hasSource: !!sourceImageUrl,
    refCount: Array.isArray(referenceImageUrls) ? referenceImageUrls.length : 0,
    hasVideoRef: !!referenceVideoUrl,
  })

  const supabase = await createClient()

  // 기본 검증
  if (!prompt?.trim()) {
    await markAttemptFailed(supabase, attemptId, 'prompt is required')
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }
  const isR2V = mode === 'r2v'
  const isV2V = mode === 'v2v' || !!referenceVideoUrl
  if (!isR2V && !isV2V && !sourceImageUrl) {
    await markAttemptFailed(supabase, attemptId, '시작 이미지(start frame)가 없어요. mode=r2v 또는 mode=v2v 모드로 전환해주세요.')
    return NextResponse.json({ error: 'sourceImageUrl is required (또는 mode=r2v / v2v 전달)' }, { status: 400 })
  }
  if (isR2V) {
    if (engine !== 'seedance-2') {
      await markAttemptFailed(supabase, attemptId, 'R2V (참고 이미지) 모드는 Seedance 2 엔진만 지원합니다.')
      return NextResponse.json({ error: 'R2V mode is only supported on engine=seedance-2' }, { status: 400 })
    }
    if (!Array.isArray(referenceImageUrls) || referenceImageUrls.length === 0) {
      await markAttemptFailed(supabase, attemptId, 'R2V 모드는 참고 이미지가 1장 이상 필요합니다.')
      return NextResponse.json({ error: 'r2v requires referenceImageUrls (1+)' }, { status: 400 })
    }
  }
  if (isV2V && engine !== 'seedance-2' && engine !== 'seedance') {
    await markAttemptFailed(supabase, attemptId, 'V2V (영상 참고) 모드는 Seedance 엔진만 지원합니다.')
    return NextResponse.json({ error: 'V2V (영상 참고) 모드는 Seedance 엔진만 지원해요. 다른 엔진은 자동으로 첫 프레임으로 변환됩니다.' }, { status: 400 })
  }

  try {
    let videoUrl: string
    if (isV2V) {
      // V2V — Seedance T2V + reference_video (영상 참고)
      videoUrl = await generateSeedanceT2V({
        prompt, duration, aspectRatio, resolution,
        referenceVideoUrl: referenceVideoUrl as string,
        // 이미지 레퍼런스도 있으면 같이
        referenceImageUrls: Array.isArray(referenceImageUrls) ? (referenceImageUrls as string[]).slice(0, 4) : undefined,
        generateAudio,
      })
    } else if (isR2V) {
      // R2V — Seedance T2V + reference_image[] (Seedance가 4장 한도)
      videoUrl = await generateSeedanceT2V({
        prompt, duration, aspectRatio, resolution,
        referenceImageUrls: (referenceImageUrls as string[]).slice(0, 4),
        generateAudio,
      })
    } else if (engine === 'seedance-2' || engine === 'seedance') {
      videoUrl = await generateSeedanceI2V({
        prompt, imageUrl: sourceImageUrl, endImageUrl: endFrameUrl ?? null,
        duration, aspectRatio, resolution, generateAudio,
      })
    } else {
      // engine 별 model_name 매핑 (kling3 → kling-v2-1-master, kling → kling-v1-6 등)
      videoUrl = await generateKlingI2V({
        sourceImageUrl, endImageUrl: endFrameUrl ?? null,
        prompt, duration, aspectRatio,
        modelName: mapKlingModelName(engine),
      })
    }

    if (!videoUrl) throw new Error('No video URL returned')

    // assets 테이블에 저장
    const { data: asset } = await supabase.from('assets').insert({
      project_id: projectId,
      scene_id:   sceneId,
      type:       'i2v',
      name:       `${isV2V ? 'v2v' : isR2V ? 'r2v' : 'i2v'}_${Date.now()}.mp4`,
      url:        videoUrl,
      tags:       [],
      metadata:   {
        prompt, engine, duration,
        aspect_ratio: aspectRatio, resolution,
        mode: isV2V ? 'v2v' : isR2V ? 'r2v' : 'i2v',
        ...(isV2V
          ? {
              reference_video: referenceVideoUrl,
              ...(Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0
                ? { reference_images: (referenceImageUrls as string[]).slice(0, 4) }
                : {}),
            }
          : isR2V
            ? { reference_images: (referenceImageUrls as string[]).slice(0, 4) }
            : { source_image: sourceImageUrl }),
      },
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
    const msg = err instanceof Error ? err.message : String(err)
    await markAttemptFailed(supabase, attemptId, msg)
    return NextResponse.json({ error: 'I2V 생성 실패: ' + msg }, { status: 500 })
  }
}
