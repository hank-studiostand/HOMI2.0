// /api/t2v/optimize
// Seedance 2.0 (Bytedance Doubao) 모델에 최적화된 영상 프롬프트 최적화기.
// 핵심: 컷 단위(Shot 1, Shot 2…)로 화면을 묘사하는 영문 프롬프트.

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface ReqBody {
  draft: string
  duration?: number              // 5 / 10 / 15
  aspectRatio?: string
  cameraTokens?: string          // 콤마로 join 된 영문 토큰
  mood?: string
  referenceLabels?: string[]     // 레퍼런스 이미지의 이름들 (정체성 유지)
  sceneContext?: string          // (선택) 씬 본문 — 스토리 컨텍스트로 사용
}

export async function POST(req: NextRequest) {
  try {
    const {
      draft,
      duration = 5,
      aspectRatio = '16:9',
      cameraTokens = '',
      mood = '',
      referenceLabels = [],
      sceneContext = '',
    } = (await req.json()) as ReqBody

    if (!draft?.trim()) {
      return NextResponse.json({ error: 'draft 필요' }, { status: 400 })
    }

    // 길이 → 컷 분할 가이드
    // 5s: 1 cut (단일 묘사) / 10s: 2 cuts / 15s: 3 cuts
    const shotCount = duration <= 5 ? 1 : duration <= 10 ? 2 : 3
    const perShotSec = Math.floor(duration / shotCount)

    const refStr = referenceLabels.filter(Boolean).join(', ')

    const systemPrompt = `You are a senior cinematographer and prompt engineer specialized in **Seedance 2.0 (ByteDance Doubao SeeDance)** video generation.

Seedance 2.0 prompting best practices:
1. Describe **what is visually on screen** in concrete, photographic terms — not abstract emotions.
2. Use **Shot N** structure when the video is longer than ~5 seconds. Each Shot becomes one continuous take.
3. Per shot specify: subject + action + camera move + framing + lighting + atmosphere.
4. Use camera language: "dolly in", "tracking shot", "handheld", "static wide", "slow pan left", "tilt up", "rack focus".
5. Avoid contradictory instructions. Avoid abstract verbs like "feel", "express" — use observable physical actions.
6. Keep continuity across shots: same character clothing, same location lighting, consistent palette.
7. If reference identities are provided, preserve them as **fixed visual identity** ("the same character: ...").
8. End with one line of style/lighting/palette: e.g., "cinematic, golden hour, warm earth tones, film grain".

Output rules:
- Return ONE English prompt, no preface, no markdown headings.
- Must be ${shotCount === 1 ? 'a single continuous shot description' : `${shotCount} shots labeled "Shot 1:", "Shot 2:"${shotCount === 3 ? ', "Shot 3:"' : ''}, each ~${perShotSec}s`}.
- Preserve the user's draft intent and key nouns.
- Hard cap: 180 words.
- DO NOT include duration/resolution flags (--duration, --resolution) — those are appended later by the caller.`

    const userMessage = `User draft (Korean or English — translate to English):
"""
${draft.trim()}
"""

Duration: ${duration} seconds (=> ${shotCount} shot${shotCount > 1 ? 's' : ''}, ~${perShotSec}s each)
Aspect ratio: ${aspectRatio}
${cameraTokens ? `Camera tokens (incorporate naturally): ${cameraTokens}` : ''}
${mood ? `Mood: ${mood}` : ''}
${refStr ? `Reference subjects/spaces (preserve identity exactly): ${refStr}` : ''}
${sceneContext ? `Scene context (story background — adapt the scene to a Seedance-friendly visual treatment):\n"""\n${sceneContext}\n"""` : ''}

Now write the optimized Seedance 2.0 prompt.`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const text = message.content[0]?.type === 'text' ? message.content[0].text : ''
    const optimized = text.trim().replace(/^["']|["']$/g, '')

    return NextResponse.json({
      optimized,
      shotCount,
      durationPerShot: perShotSec,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[t2v/optimize] failed:', msg)
    return NextResponse.json({ error: `최적화 실패: ${msg}` }, { status: 500 })
  }
}
