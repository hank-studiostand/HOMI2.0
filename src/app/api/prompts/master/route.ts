import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { sceneId, content: manualContent, negativePrompt: manualNeg } = body as {
    sceneId: string
    content?: string
    negativePrompt?: string
  }
  const admin = createAdminClient()

  // 수동 입력 모드 — AI 호출 건너뛰고 바로 저장
  if (manualContent && manualContent.trim()) {
    const { data: existing } = await admin
      .from('master_prompts')
      .select('version')
      .eq('scene_id', sceneId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error: insErr } = await admin.from('master_prompts').insert({
      scene_id: sceneId,
      content: manualContent.trim(),
      negative_prompt: manualNeg ?? 'blurry, low quality, distorted, ugly, bad anatomy, watermark, text, logo',
      version: (existing?.version ?? 0) + 1,
    })
    if (insErr) {
      return NextResponse.json({ error: `저장 실패: ${insErr.message}` }, { status: 500 })
    }
    return NextResponse.json({ success: true, prompt: manualContent.trim() })
  }

  const { data: scene, error: sceneErr } = await admin
    .from('scenes')
    .select('*, settings:scene_settings(*)')
    .eq('id', sceneId)
    .single()

  if (sceneErr || !scene) {
    return NextResponse.json({ error: `씬 조회 실패: ${sceneErr?.message}` }, { status: 404 })
  }

  // Supabase 관계 조회 결과가 배열일 수도 있음
  const settings = Array.isArray(scene.settings)
    ? (scene.settings[0] ?? {})
    : (scene.settings ?? {})

  const engineMap: Record<string, string> = {
    nanobanana: '나노바나나', midjourney: 'Midjourney',
    'stable-diffusion': 'Stable Diffusion', dalle: 'DALL-E 3',
  }
  const angleMap: Record<string, string> = {
    'eye-level': 'eye level shot', 'low-angle': 'low angle shot',
    'high-angle': 'high angle shot', 'birds-eye': "bird's eye view",
    'dutch-angle': 'dutch angle', 'overhead': 'overhead shot',
  }
  const lensMap: Record<string, string> = {
    wide: 'wide angle lens', standard: 'standard lens',
    telephoto: 'telephoto lens', fisheye: 'fisheye lens',
    macro: 'macro lens', anamorphic: 'anamorphic lens',
  }

  let promptContent = ''
  let negContent = 'blurry, low quality, distorted, ugly, bad anatomy, watermark, text, logo'

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',  // 마스터 프롬프트는 Haiku로 (가장 빠름)
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are a professional cinematographer creating an AI image generation prompt.

Scene content:
${scene.content}

Technical settings:
- Camera angle: ${angleMap[settings.angle] ?? settings.angle ?? 'eye level shot'}
- Lens: ${lensMap[settings.lens] ?? settings.lens ?? 'standard lens'}
- Aspect ratio: ${(settings as any).aspect_ratio ?? '16:9'}
- Number of subjects: ${settings.object_count ?? 1}
- Mood: ${settings.mood || 'cinematic'}
- Lighting: ${settings.lighting || 'natural'}
- Notes: ${settings.notes || 'none'}

Write a detailed image generation prompt in English.
Requirements:
- Describe exactly what is VISIBLE in the frame
- Include camera angle, lens type, composition
- Include subject positions, actions, expressions
- Include atmosphere, lighting, color palette
- Max 150 words

Respond ONLY in this exact format:
PROMPT: [the prompt text]
NEGATIVE: [10 negative keywords, comma separated]`
      }]
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const promptMatch = text.match(/PROMPT:\s*([\s\S]*?)(?=NEGATIVE:|$)/)
    const negMatch = text.match(/NEGATIVE:\s*([\s\S]*)/)
    promptContent = promptMatch?.[1]?.trim() ?? text.trim()
    negContent = negMatch?.[1]?.trim() ?? negContent
  } catch (err) {
    return NextResponse.json({ error: `AI 생성 실패: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }

  // 기존 버전 확인
  const { data: existing } = await admin
    .from('master_prompts')
    .select('version')
    .eq('scene_id', sceneId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error: insErr } = await admin.from('master_prompts').insert({
    scene_id: sceneId,
    content: promptContent,
    negative_prompt: negContent,
    version: (existing?.version ?? 0) + 1,
  })

  if (insErr) {
    return NextResponse.json({ error: `저장 실패: ${insErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true, prompt: promptContent })
}
