import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// /api/prompts/optimize
// 사용자가 입력한 draft + 현재 옵션(카메라/화면비/레퍼런스/씬 컨텍스트)을 합쳐서
// 잘 다듬어진 영문 이미지/영상 생성 프롬프트로 최적화.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    sceneId,
    draft,
    aspectRatio,
    cameraTokens,        // ['eye level shot', '35mm lens', ...]
    referenceLabels,     // ['캐릭터: 지수', '공간: 카페'...]
    type = 't2i',
  } = body as {
    sceneId: string
    draft: string
    aspectRatio?: string
    cameraTokens?: string[]
    referenceLabels?: string[]
    type?: 't2i' | 'i2v'
  }

  if (!draft || !draft.trim()) {
    return NextResponse.json({ error: 'draft 필요' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: scene } = await admin
    .from('scenes')
    .select('content, title, scene_number')
    .eq('id', sceneId)
    .maybeSingle()

  const sceneContext = scene
    ? `Scene ${scene.scene_number} - ${scene.title}\n${scene.content ?? ''}`
    : ''

  const cameraStr = (cameraTokens ?? []).filter(Boolean).join(', ')
  const refStr = (referenceLabels ?? []).filter(Boolean).join(', ')

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      messages: [{
        role: 'user',
        content: `You are a senior cinematographer / prompt engineer. Optimize a draft AI ${type === 't2i' ? 'image' : 'video'} generation prompt by integrating user-selected technical options into a coherent, vivid English prompt.

User draft:
"""
${draft.trim()}
"""

${sceneContext ? `Scene context:\n"""\n${sceneContext}\n"""\n` : ''}
${cameraStr ? `Camera/composition tokens (must be incorporated): ${cameraStr}` : ''}
${aspectRatio ? `Aspect ratio: ${aspectRatio}` : ''}
${refStr ? `Reference subjects/spaces (treat as fixed identity): ${refStr}` : ''}

Output requirements:
- One single English prompt, max 130 words.
- Preserve the user's intent and key nouns/actions from the draft.
- Naturally weave in the camera tokens and reference subjects.
- Add atmosphere, lighting, color palette, and material details that fit the scene.
- Do NOT use bullet points, headings, or quotes — just one continuous descriptive paragraph.
- Do NOT include any preface like "Here is..." — return ONLY the prompt itself.`,
      }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    return NextResponse.json({ optimized: text.trim() })
  } catch (err) {
    return NextResponse.json(
      { error: `최적화 실패: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    )
  }
}
