import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'
import { generateSeedanceT2V } from '@/lib/seedance'
import { markAttemptFailed } from '@/lib/attemptStatus'

// 영상 폴링 — Vercel Pro Node 함수 800s (13분 20초) 로 설정
export const runtime = 'nodejs'
export const maxDuration = 800

// ── Kling JWT (HS256) ──────────────────────────────────────────────
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

// ── 공통 Kling T2V 호출 ────────────────────────────────────────────
async function callKlingT2V(
  modelName: string,
  prompt: string,
  negativePrompt: string,
  duration: number,
  aspectRatio: string,
  mode: 'std' | 'pro',
  cfgScale: number,
): Promise<string> {
  const apiKey    = process.env.KLING_API_KEY    ?? ''
  const apiSecret = process.env.KLING_API_SECRET ?? ''
  const baseUrl   = process.env.KLING_API_URL    ?? 'https://api.klingai.com'

  if (!apiKey || !apiSecret) throw new Error('KLING_API_KEY / KLING_API_SECRET not set')

  const jwt = generateKlingJWT(apiKey, apiSecret)

  // 1) 생성 요청 — Kling T2V API
  //   duration: "5" | "10" STRING, mode: v2/v3 master 계열은 'pro' 만
  const isNewModel = /^kling-v[23]/.test(modelName)
  const durStr = String(Math.max(5, Math.min(10, duration ?? 5)))
  const safeDuration = durStr === '5' || durStr === '10' ? durStr : '5'
  const body: Record<string, any> = {
    model_name:   modelName,
    prompt:       prompt.trim().slice(0, 2500),
    duration:     safeDuration,
    mode:         isNewModel ? 'pro' : mode,
    cfg_scale:    cfgScale,
    aspect_ratio: aspectRatio,
  }
  if (negativePrompt) body.negative_prompt = negativePrompt
  const createRes = await fetch(`${baseUrl}/v1/videos/text2video`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!createRes.ok) {
    const errBody = await createRes.text()
    throw new Error(`[${modelName}] ` + formatKlingError(createRes.status, errBody))
  }

  const createData = await createRes.json()
  const taskId     = createData.data?.task_id
  if (!taskId) throw new Error(`Kling (${modelName}): task_id not returned — ${JSON.stringify(createData)}`)

  // 2) 폴링 — Vercel 800s 한도 내 (70회 × 10초)
  for (let i = 0; i < 70; i++) {
    await new Promise(r => setTimeout(r, 10_000))
    const newJwt  = generateKlingJWT(apiKey, apiSecret)
    const pollRes = await fetch(`${baseUrl}/v1/videos/text2video/${taskId}`, {
      headers: { 'Authorization': `Bearer ${newJwt}` },
    })
    const pollData = await pollRes.json()
    const status   = pollData.data?.task_status

    if (status === 'succeed') return pollData.data?.task_result?.videos?.[0]?.url ?? ''
    if (status === 'failed')  throw new Error(`Kling (${modelName}) task failed: ${pollData.data?.task_status_msg ?? ''}`)
  }
  throw new Error(`Kling (${modelName}): polling timeout after ~11 minutes`)
}

// ─────────────────────────────────────────────────────────────────
// engine → model_name 매핑
// 허용값: kling-v1/v1-5/v1-6, kling-v2-master, kling-v2-1-master, kling-v3-master, kling-v3
// ENV override 지원
const ENGINE_MODEL: Record<string, string> = {
  'kling3':      process.env.KLING_MODEL_V3       ?? 'kling-v3-master',
  'kling3-omni': process.env.KLING_MODEL_V3_OMNI  ?? process.env.KLING_MODEL_V3 ?? 'kling-v3-master',
  'kling2':      process.env.KLING_MODEL_V2_1     ?? 'kling-v2-1-master',
  'kling':       'kling-v1-6',
}

// ── Kling 에러 → 한국어 (message 우선 매칭) ──
function formatKlingError(status: number, body: string): string {
  try {
    const j = JSON.parse(body)
    const code = j.code
    const msg = String(j.message ?? body)
    const msgLc = msg.toLowerCase()
    if (/balance.*not enough|insufficient.*balance|insufficient.*credit/i.test(msgLc)) {
      return `Kling: 잔액이 부족합니다. Kling 계정 크레딧을 충전해주세요. (status ${status})`
    }
    if (/model.*not.*support/i.test(msgLc)) {
      return `Kling: 선택한 모델을 사용할 수 없어요. 다른 엔진을 사용해보세요. (status ${status})`
    }
    if (/risk|safety|content.*polic|sensitive/i.test(msgLc)) {
      return `Kling: 안전 검열 — 프롬프트에 부적절한 내용이 포함됐을 수 있어요. (status ${status})`
    }
    if (/auth|unauthorized|invalid.*key/i.test(msgLc)) {
      return `Kling: 인증 실패 — API 키 확인. (status ${status})`
    }
    if (/rate.*limit|too many|quota/i.test(msgLc)) {
      return `Kling: 호출 한도 초과 — 잠시 후 다시 시도. (status ${status})`
    }
    const codeMap: Record<number, string> = {
      1102: '잔액 부족 — Kling 계정 크레딧 충전 필요',
      1201: '지원되지 않는 모델',
      1301: '컨텐츠 안전 검열',
      1401: '계정 잔액 부족',
      1501: '동시 작업 한도 초과',
    }
    if (typeof code === 'number' && codeMap[code]) {
      return `Kling (code ${code}): ${codeMap[code]}`
    }
    return `Kling ${status}${code ? ' (code ' + code + ')' : ''}: ${msg}`
  } catch {
    return `Kling ${status}: ${body.slice(0, 300)}`
  }
}
// ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const {
    attemptId,
    prompt,
    negativePrompt = '',
    projectId,
    sceneId,
    engine      = 'kling3',   // 'kling3' | 'kling3-omni'
    duration    = 5,
    aspectRatio = '16:9',
    mode        = 'std',      // 'std' | 'pro'
    cfgScale    = 0.5,
  } = await req.json()

  const supabase = await createClient()

  try {
    let modelName: string
    let videoUrl: string
    if (engine === 'seedance-2' || engine === 'seedance') {
      modelName = process.env.SEEDANCE_MODEL_T2V || 'dreamina-seedance-2-0-260128'
      videoUrl = await generateSeedanceT2V({
        prompt, duration, aspectRatio, resolution: '720p',
      })
    } else {
      modelName = ENGINE_MODEL[engine] ?? ENGINE_MODEL['kling3']
      videoUrl = await callKlingT2V(modelName, prompt, negativePrompt, duration, aspectRatio, mode, cfgScale)
    }

    if (videoUrl) {
      const { data: asset } = await supabase.from('assets').insert({
        project_id: projectId,
        scene_id:   sceneId,
        type:       'i2v',
        name:       `t2v_${Date.now()}.mp4`,
        url:        videoUrl,
        tags:       ['t2v'],
        metadata: {
          prompt, engine, model: modelName, duration,
          aspect_ratio: aspectRatio, mode, cfg_scale: cfgScale,
          tags: ['t2v'],
        },
        attempt_id: attemptId,
      }).select().single()

      if (asset) {
        await supabase.from('attempt_outputs').insert({ attempt_id: attemptId, asset_id: asset.id })
      }
      await supabase.from('prompt_attempts').update({ status: 'done' }).eq('id', attemptId)
    } else {
      await markAttemptFailed(supabase, attemptId, '영상 URL이 반환되지 않았어요. 엔진 응답이 비어있습니다.')
    }

    return NextResponse.json({ success: !!videoUrl, engine, model: modelName })
  } catch (err) {
    console.error('[T2V] generate error:', err)
    const msg = err instanceof Error ? err.message : String(err)
    await markAttemptFailed(supabase, attemptId, msg)
    return NextResponse.json({ error: 'T2V 생성 실패: ' + msg }, { status: 500 })
  }
}
