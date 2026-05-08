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
  'seedance-2': `Seedance 2.0 (Doubao SeeDance / Dreamina) — multi-shot R2V/I2V cinematic prompt guide:
STRUCTURE
- Open with a one-line master describing total length (e.g. "15-second cinematic short film, 4 continuous shots"), location, time-of-day, character roster.
- If reference images are provided, refer to them with consistent @image1, @image2, @image3 tokens. Reuse the SAME token whenever that subject/space reappears.
- Enumerate shots: \`[SHOT N — framing, m:ss–m:ss]\` (e.g. "[SHOT 1 — Wide Shot, 0:00–0:04]"). Allowed framings: Wide Shot, Medium Wide, Medium Shot, Medium Close-Up, Close-Up, Extreme Close-Up, Over-The-Shoulder, Top-Down, Low Angle.
- Per shot: subject (with @imageN token) + concrete physical action + camera move + framing + lighting + atmosphere.
- Dialogue: render as \`Dialogue (@imageN, Korean, <gender> voice, <tone>): "한국어 대사"\` — preserve the original Korean line.
- End with continuity reminder: e.g. "Maintain identity of @image1 and @image2, consistent set design of @image3 throughout."
STYLE DEFAULTS
- 35mm film look, photorealistic, shallow depth of field, natural Korean lip-sync.
- Warm color grading default unless user specifies; switchable to cool/neutral.
DO
- Use observable physical actions ("taps the smartphone twice", "rolls neck side to side", "leans forward").
- Per-shot lighting cues ("amber pendant light glows", "soft warm key from camera left").
DO NOT
- Use abstract emotion verbs ("feels", "expresses").
- Invent new @imageN tokens not in the provided list.
- Output JSON, markdown, or commentary — return ONE single English prompt block.`,

  'kling3': `Kling 3.0 / Kling v2 — image-to-video best practices:
- Lead with subject + concrete action, then setting, then visual style.
- Specify lens (35mm, 50mm, anamorphic), aperture if relevant, lighting (golden hour, candlelight, neon), and color palette.
- Camera movement: dolly in/out, tracking, handheld, slow pan, tilt up, crane, rack focus — with explicit speed (slow, fast).
- Concise, dense English — no filler. Aim for 60–120 words per shot.
- For multi-action shots, write as numbered beats: "(1) action ... (2) action ...".
- If source image is provided (I2V), describe motion/camera move FROM that frame outward — don't redescribe the subject's static appearance.`,

  'kling3-omni': `Kling 3.0 Omni — multi-shot + native audio support:
- All Kling 3.0 rules apply.
- May describe several shots in sequence; mark transitions explicitly: "Cut to:", "Match cut to:", "Dissolve to:".
- Specify audio: "BGM: warm piano (60bpm)", "SFX: rain on glass", "Ambience: soft café chatter".`,

  'nanobanana': `Nano Banana (Google Gemini 2.5 Flash Image) — text-to-image best practices:
- Subject-first photographic description: subject → action/pose → setting → lighting → style.
- Lens vocabulary: 24mm wide, 35mm reportage, 50mm portrait, 85mm telephoto, 100mm macro; aperture if relevant (f/1.4 shallow DOF).
- Lighting language: rim light, backlit, soft window light, cinematic key, neon, candlelight, golden hour, blue hour.
- Reference identity: when reference subjects are provided, name them in parentheses and pin key attributes (hair, age, clothing) once.
- ONE paragraph, max 120 words. Avoid lists/bullets in the output.
- For Korean subjects, mention "Korean" once and let the model handle ethnicity naturally — don't over-specify facial features.`,

  'gpt-image': `OpenAI gpt-image-1 — text-to-image best practices:
- Clear noun-rich descriptions. Avoid metaphor and adjective stacking.
- Specify medium explicitly: "studio photograph", "35mm film still", "oil painting", "concept art", "matte painting".
- Color palette: name 2–3 dominant colors and lighting source ("warm tungsten + cyan window light").
- Compositional cues: foreground / midground / background layering.
- Quality is set to "high" by default — describe details that benefit from it (textures, micro-expressions, fabric weave).
- For text rendering, quote exactly what should appear: \`text reading "HOMI"\` — gpt-image-1 honors short typographic strings.`,

  'midjourney': `Midjourney v6/v7 — text-to-image best practices:
- Subject + style + medium first, then composition, then lighting, then mood.
- Use camera-style language: "shot on Hasselblad", "Kodak Portra 400 film grain", "anamorphic lens flare".
- Avoid weight overuse; keep --ar / --stylize / --chaos appended only if user specified.
- Single paragraph, comma-separated phrases preferred over full sentences.`,
}

interface EngineGuideResolution {
  guide: string
  source: 'user-preset' | 'env-override' | 'builtin' | 'web-search-needed'
}

function resolveEngineGuide(engine?: string, customEngineGuide?: string): EngineGuideResolution {
  if (!engine) return { guide: '', source: 'builtin' }
  // 1) 사용자(클라이언트) 정의 프리셋 우선
  if (customEngineGuide && customEngineGuide.trim()) {
    return {
      guide: `User preset for engine (${engine}):\n${customEngineGuide.trim()}`,
      source: 'user-preset',
    }
  }
  // 2) 서버 환경변수 override (예: ENGINE_OPT_SEEDANCE_2)
  const envKey = `ENGINE_OPT_${engine.toUpperCase().replace(/[-]/g, '_')}`
  const envOverride = process.env[envKey]
  if (envOverride) {
    return {
      guide: `Custom engine guide (${engine}):\n${envOverride.trim()}`,
      source: 'env-override',
    }
  }
  // 3) 내장 가이드 fallback
  if (ENGINE_GUIDE[engine]) {
    return {
      guide: `Engine guide (${engine}):\n${ENGINE_GUIDE[engine]}`,
      source: 'builtin',
    }
  }
  // 4) 가이드 없음 — Claude가 web_search로 찾도록
  return { guide: '', source: 'web-search-needed' }
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
  const { guide: engineGuide, source: guideSource } = resolveEngineGuide(engine, customEngineGuide)
  const needsWebSearch = guideSource === 'web-search-needed' && !!engine

  try {
    const userMessage = `You are a senior cinematographer / prompt engineer. Optimize a draft AI ${type === 't2i' ? 'image' : 'video'} generation prompt by integrating user-selected technical options into a coherent, vivid English prompt that follows the target engine's best practices.

User draft (may include "[인물: 이름]" / "[공간: ...]" identity blocks — preserve these as fixed identity descriptions):
"""
${draft.trim()}
"""

${sceneContext ? `Scene context:\n"""\n${sceneContext}\n"""\n` : ''}
${cameraStr ? `Camera/composition tokens (must be incorporated): ${cameraStr}` : ''}
${aspectRatio ? `Aspect ratio: ${aspectRatio}` : ''}
${refStr ? `Reference subjects/spaces (treat as fixed identity): ${refStr}` : ''}
${engineGuide ? `\n${engineGuide}\n` : ''}
${needsWebSearch ? `\nNo built-in guide is available for engine "${engine}". Use the web_search tool ONCE to look up best-practice prompt structure for "${engine} prompt engineering best practices", then apply the findings.\n` : ''}

Output requirements:
- One English prompt that strictly follows the engine guide above${needsWebSearch ? ' (or your web_search findings)' : ''}.
- Preserve the user's intent, character identity blocks, and key nouns/actions from the draft.
- Naturally weave in the camera tokens, reference subjects, and aspect ratio considerations.
- For multi-shot video engines (Seedance/Kling-omni), structure as [SHOT N — framing, m:ss–m:ss] blocks if total duration is known.
- Do NOT add a preface or quotes — return ONLY the prompt itself.
- For images: hard cap 200 words. For multi-shot videos (Seedance): no hard cap, but stay focused per shot.`

    // web_search tool은 가이드가 없을 때만 활성화 (불필요한 토큰/지연 방지)
    const tools: any[] = needsWebSearch
      ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]
      : []

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      ...(tools.length > 0 ? { tools } : {}),
      messages: [{ role: 'user', content: userMessage }],
    } as any)

    const textBlocks = message.content.filter((b: any) => b.type === 'text') as Array<{ type: 'text'; text: string }>
    const text = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : ''
    const optimized = text.trim().replace(/^["']|["']$/g, '').replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim()

    return NextResponse.json({
      optimized,
      engineUsed: engine ?? null,
      guideSource,
      webSearchUsed: needsWebSearch,
      presetApplied: !!(customEngineGuide && customEngineGuide.trim()),
    })
  } catch (err) {
    console.error('[optimize] error:', err)
    return NextResponse.json(
      { error: `최적화 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
}
