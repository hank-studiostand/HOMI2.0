// T2V Freestyle 엔드포인트 — 씬 비종속 (project-level) 영상 생성
// asset-make/generate와 같은 패턴 — assets 테이블에 직접 저장 (scene_id: null)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import crypto from 'crypto'
import { generateSeedanceT2V } from '@/lib/seedance'

// ── Kling JWT (HS256) — 기존 t2v 라우트와 동일 ──────────────────
function generateKlingJWT(apiKey: string, apiSecret: string): string {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: apiKey,
    exp: Math.floor(Date.now() / 1000) + 1800,
    nbf: Math.floor(Date.now() / 1000) - 5,
  })).toString('base64url')
  const sig = crypto.createHmac('sha256', apiSecret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

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
  const createRes = await fetch(`${baseUrl}/v1/videos/text2video`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model_name: modelName, prompt,
      negative_prompt: negativePrompt || undefined,
      cfg_scale: cfgScale, mode, duration,
      aspect_ratio: aspectRatio,
    }),
  })
  if (!createRes.ok) throw new Error(`Kling T2V create ${createRes.status}: ${await createRes.text()}`)
  const cd = await createRes.json()
  const taskId = cd.data?.task_id
  if (!taskId) throw new Error(`Kling: task_id 미반환`)

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 10_000))
    const newJwt = generateKlingJWT(apiKey, apiSecret)
    const pollRes = await fetch(`${baseUrl}/v1/videos/text2video/${taskId}`, {
      headers: { 'Authorization': `Bearer ${newJwt}` },
    })
    const pd = await pollRes.json()
    const status = pd.data?.task_status
    if (status === 'succeed') return pd.data?.task_result?.videos?.[0]?.url ?? ''
    if (status === 'failed') throw new Error(`Kling task failed: ${pd.data?.task_status_msg ?? ''}`)
  }
  throw new Error('Kling T2V polling timeout')
}

const KLING_MODEL: Record<string, string> = {
  'kling3':      'kling-v3',
  'kling3-omni': 'kling-v3-omni',
}

export async function POST(req: NextRequest) {
  try {
    const {
      projectId,
      sceneId,
      prompt,
      negativePrompt = '',
      cameraTokens = '',
      mood = '',
      aspectRatio = '16:9',
      duration    = 5,
      engine      = 'seedance-2',
      mode        = 'std',
      cfgScale    = 0.5,
      name        = '',
      referenceImageUrls,
    } = await req.json() as {
      projectId: string
      sceneId?: string
      prompt: string
      negativePrompt?: string
      cameraTokens?: string
      mood?: string
      aspectRatio?: string
      duration?: number
      engine?: string
      mode?: 'std' | 'pro'
      cfgScale?: number
      name?: string
      referenceImageUrls?: string[]
    }

    if (!projectId)      return NextResponse.json({ error: 'projectId 필요' }, { status: 400 })
    if (!prompt?.trim()) return NextResponse.json({ error: '프롬프트가 비어있습니다' }, { status: 400 })

    const admin = createAdminClient()

    // 합성 프롬프트
    const fullPromptParts = [prompt.trim()]
    if (cameraTokens.trim()) fullPromptParts.push(cameraTokens.trim())
    if (mood.trim())         fullPromptParts.push(`mood: ${mood.trim()}`)
    const fullPrompt = fullPromptParts.join(', ')

    let videoUrl = ''
    let modelName = ''

    if (engine === 'seedance-2' || engine === 'seedance') {
      modelName = process.env.SEEDANCE_MODEL_T2V || 'doubao-seedance-1-0-pro-250528'
      videoUrl = await generateSeedanceT2V({
        prompt: fullPrompt, duration, aspectRatio, resolution: '720p',
      })
    } else if (engine === 'kling3' || engine === 'kling3-omni') {
      modelName = KLING_MODEL[engine] ?? 'kling-v3'
      videoUrl = await callKlingT2V(modelName, fullPrompt, negativePrompt, duration, aspectRatio, mode, cfgScale)
    } else {
      throw new Error(`지원하지 않는 엔진: ${engine}`)
    }

    if (!videoUrl) throw new Error('비디오 URL이 반환되지 않았습니다')

    const baseName = (name.trim() || prompt.trim().slice(0, 30) || 't2v')
      .replace(/\s+/g, '_').replace(/[^\w.-]+/g, '_').slice(0, 40)
    const assetName = `${baseName}_${Date.now()}.mp4`

    const { data: asset, error: insErr } = await admin.from('assets').insert({
      project_id: projectId,
      scene_id: sceneId ?? null,            // 씬 선택 시 씬에 묶임, 아니면 freestyle
      type: 'i2v',
      name: assetName,
      url: videoUrl,
      thumbnail_url: null,
      tags: ['t2v', 'freestyle'],
      metadata: {
        source: 't2v-freestyle',
        engine, model: modelName,
        prompt: fullPrompt, negative_prompt: negativePrompt,
        camera: cameraTokens || null, mood: mood || null,
        duration, aspect_ratio: aspectRatio, mode,
        reference_image_urls: Array.isArray(referenceImageUrls) ? referenceImageUrls : [],
      },
    }).select('id, url, name, created_at').single()

    if (insErr) throw new Error(`Asset 저장 실패: ${insErr.message}`)

    try {
      await admin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId)
    } catch {}

    return NextResponse.json({ success: true, asset })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[T2V freestyle] 실패:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
