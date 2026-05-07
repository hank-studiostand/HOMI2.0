import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// /api/prompts/optimize
// 사용자가 입력한 draft + 현재 옵션(카메라/화면비/레퍼런스/씬 컨텍스트 + 엔진)을 합쳐서
// 엔진별 best-practice에 맞는 영문 프롬프트로 최적화.
//
// 우선순위:
//   1) 요청 body의 customEngineGuide (프론트에서 사용자가 편집한 프리셋)
//   2) .env의 ENGINE_OPT_<NAME> (서버 운영자 설정)
//   3) 코드 내장 ENGINE_GUIDE 맵 (fallback)

const ENGINE_GUIDE: Record<string, string> = {
  'seedance-2': `Seedance 2.0 (Doubao SeeDance) — text-to-video best practices:
- Describe what is visually on screen in concrete, photographic terms (no abstract emotions).
- For multi-second videos, structure as "Shot 1:", "Shot 2:" etc.
- Per shot: subject + action + camera move + framing + lighting + atmosphere.
- Use camera language: dolly in, tracking shot, handheld, slow pan, tilt up, rack focus.
- Preserve continuity across shots: same character clothing, same lighting palette.
- Avoid abstract verbs ("feel", "express") — use observable physical actions.`,

  'kling3': `Kling 3.0 — image/video generation best practices:
- Lead with subject + action, then setting, then style.
- Specify lens (e.g. 35mm, anamorphic), lighting (golden hour, candlelight), and palette.
- Concise, dense English — avoid filler.
- Camera movement labels: dolly, crane, handheld; explicit speeds (slow, fast).`,

  'kling3-omni': `Kling 3.0 Omni — multi-shot / native audio support:
- Can describe several shots in sequence; mark transitions explicitly.
- Specify ambient sound or music cues if relevant ("BGM: warm piano").
- Same as Kling 3.0 baseline rules.`,

  'nanobanana': `Nano Banana (Gemini 2.5 Flash Image) — text-to-image best practices:
- Subject-first photographic descriptions.
- Specify lens (24mm wide, 50mm portrait, 85mm telephoto), aperture if relevant.
- Lighting words: rim light, backlit, soft window light, cinematic key.
- Reference identity: when reference subjects are provided, name them and pin attributes.
- One paragraph, max 120 words.`,

  'gpt-image': `OpenAI gpt-image-1 — text-to-image:
- Clear noun-rich descriptions; avoid metaphor.
- Specify medium ("studio photograph", "oil painting", "concept art").
- Include color palette and lighting.
- Compositional cues: foreground / midground / background.`,
}

function getEngineGuide(engine?: string, customEngineGuide?: string): string {
  if (!engine) return ''
  // 1) 사용자(클라이언트) 정의 프리셋 우선
  if (customEngineGuide && customEngineGuide.trim()) {
    return `User preset for engine (${engine}):\n${customEngineGuide.trim()}`
  }
  // 2) 서버 환경변수 override (예: ENGINE_OPT_SEEDANCE_2)
  const envKey = `ENGINE_OPT_${engine.toUpperCase().replace(/[-]/g, '_')}`
  const envOverride = process.env[envKey]
  if (envOverride) return `Custom engine guide (${engine}):\n${envOverride.trim()}`
  // 3) 내장 가이드 fallback
  return ENGINE_GUIDE[engine] ? `Engine guide (${engine}):\n${ENGINE_GUIDE[engine]}` : ''
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    sceneId,
    draft,
    aspectRatio,
    cameraTokens,
    referenceLabels,
    type = 't2i',
    engine,
    customEngineGuide,
  } = body as {
    sceneId: string
    draft: string
    aspectRatio?: string
    cameraTokens?: string[]
    referenceLabels?: string[]
    type?: 't2i' | 'i2v'
    engine?: string
    customEngineGuide?: string
  }

  if (!draft || !draft.trim()) {
    return NextResponse.json({ error: 'draft 필요' }, { status: 400 })
  }

  const admin = createAdminClient()
  let sceneContext = ''
  if (sceneId) {
    const { data: scene } = await admin
      .from('scenes')
      .select('content, title, scene_number')
      .eq('id', sceneId)
      .maybeSingle()
    if (scene) {
      sceneContext = `Scene ${scene.scene_number} - ${scene.title}\n${scene.content ?? ''}`
    }
  }

  const cameraStr = (cameraTokens ?? []).filter(Boolean).join(', ')
  const refStr = (referenceLabels ?? []).filter(Boolean).join(', ')
  const engineGuide = getEngineGuide(engine, customEngineGuide)

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      messages: [{
        role: 'user',
        content: `You are a senior cinematographer / prompt engineer. Optimize a draft AI ${type === 't2i' ? 'image' : 'video'} generation prompt by integrating user-selected technical options into a coherent, vivid English prompt that follows the target engine's best practices.

User draft (may include "[인물: 이름]" / "[공간: ...]" identity blocks — preserve these as fixed identity descriptions):
"""
${draft.trim()}
"""

${sceneContext ? `Scene context:\n"""\n${sceneContext}\n"""\n` : ''}
${cameraStr ? `Camera/composition tokens (must be incorporated): ${cameraStr}` : ''}
${aspectRatio ? `Aspect ratio: ${aspectRatio}` : ''}
${refStr ? `Reference subjects/spaces (treat as fixed identity): ${refStr}` : ''}
${engineGuide ? `\n${engineGuide}\n` : ''}

Output requirements:
- One English prompt that follows the engine guide above (if provided).
- Preserve the user's intent, character identity blocks, and key nouns/actions from the draft.
- Naturally weave in the camera tokens, reference subjects, and aspect ratio considerations.
- Do NOT add a preface or quotes — return ONLY the prompt itself.
- Hard cap: 200 words.`,
      }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const optimized = text.trim().replace(/^["']|["']$/g, '')
    return NextResponse.json({ optimized, engineUsed: engine ?? null, presetApplied: !!(customEngineGuide && customEngineGuide.trim()) })
  } catch (err) {
    return NextResponse.json(
      { error: `최적화 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
}
