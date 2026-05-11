import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'
import { generateSeedanceT2V } from '@/lib/seedance'
import { markAttemptFailed } from '@/lib/attemptStatus'

// Seedance 영상 폴링 길이 (15s 영상 ~ 3분) — Vercel Pro maxDuration 300s
export const runtime = 'nodejs'
export const maxDuration = 300

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

  // 1) 생성 요청
  const createRes = await fetch(`${baseUrl}/v1/videos/text2video`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model_name:      modelName,
      prompt,
      negative_prompt: negativePrompt || undefined,
      cfg_scale:       cfgScale,
      mode,
      duration,
      aspect_ratio:    aspectRatio,
    }),
  })

  if (!createRes.ok) {
    throw new Error(`Kling T2V (${modelName}) create failed (${createRes.status}): ${await createRes.text()}`)
  }

  const createData = await createRes.json()
  const taskId     = createData.data?.task_id
  if (!taskId) throw new Error(`Kling (${modelName}): task_id not returned — ${JSON.stringify(createData)}`)

  // 2) 폴링 (최대 5분, 10초 간격)
  for (let i = 0; i < 30; i++) {
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
  throw new Error(`Kling (${modelName}): polling timeout after 5 minutes`)
}

// ─────────────────────────────────────────────────────────────────
// engine → model_name 매핑
// 실제 model_name은 Kling 공식 API 문서 확인 후 수정 가능
const ENGINE_MODEL: Record<string, string> = {
  'kling3':      'kling-v3',        // Kling 3.0
  'kling3-omni': 'kling-v3-omni',  // Kling 3.0 Omni (모델명 확인 필요)
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
