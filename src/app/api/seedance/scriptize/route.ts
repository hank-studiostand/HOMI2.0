import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// /api/seedance/scriptize
// 대본 일부분(또는 한 씬 전체)을 Seedance 2.0 R2V/I2V 친화 프롬프트로 변환.
// - 입력: { projectId, sceneId?, scriptText }
// - 처리:
//     1) 프로젝트의 루트에셋(characters/spaces/objects) 조회
//     2) 씬이 지정되면 character_variations / 씬 비주얼 세팅 조회
//     3) Claude에 "샘플 + 가이드 + 컨텍스트 + 대본" 주입 → 영문 시나리오 프롬프트 생성
//     4) 대본에 등장하는 캐릭터/장소를 루트에셋과 이름 매칭 → @image1, @image2... 토큰 부여
//     5) 응답: { prompt, refs: [{ token, rootAssetId, name, url, category }], rawScript }

interface RootAssetRow {
  id: string
  name: string
  category: 'character' | 'space' | 'object' | 'misc' | string
  description?: string | null
  reference_image_urls?: string[] | null
}

interface SceneRow {
  id: string
  scene_number?: string | null
  content?: string | null
  character_variations?: Record<string, string> | null
  settings?: { angle?: string; lens?: string; lighting?: string; mood?: string } | null
}

const SEEDANCE_GUIDE = `Seedance 2.0 (Doubao SeeDance) — multi-shot R2V cinematic prompt rules:
- Open with a brief master line: total length, number of shots, location, time of day, character roster.
- Use \`@image1\`, \`@image2\`, ... tokens to refer to provided reference images. Repeat the same token consistently whenever that subject/space appears.
- Then enumerate shots as \`[SHOT N — framing, t_start–t_end]\`. Per shot: subject + concrete physical action + camera move + framing + lighting + atmosphere.
- Allowed framings: Wide Shot, Medium Wide, Medium Shot, Medium Close-Up, Close-Up, Extreme Close-Up, Over-The-Shoulder, Top-Down, Low Angle.
- Avoid abstract verbs ("feel", "express"). Use observable physical actions.
- Maintain consistency: same clothing per character, same set design across shots.
- If dialogue is present, render as: \`Dialogue (@imageN, Korean, <gender> voice, <tone>): "<line>"\`.
- End with a brief continuity reminder, e.g. "Maintain identity of @image1 and @image2, consistent set design of @image3 throughout."
- Output is ONE single English prompt block, no markdown, no commentary, no JSON unless explicitly asked.
- Cinematic style defaults: 35mm film look, photorealistic, shallow depth of field, natural lip-sync. Adjust if user provides specific look.`

const SAMPLE_PROMPT = `A 15-second cinematic short film with 4 continuous shots, set in a warm dining room @image3 in the evening. Two Korean characters in their 30s: @image1 (Jinwoo, man, casual sweater) and @image2 (Sujin, woman, thin-framed glasses, loose home wear). Maintain consistent character appearance and consistent dining room @image3 environment across all shots. Cinematic 35mm film look, warm amber color grade, soft pendant lighting, shallow depth of field, photorealistic, natural Korean lip-sync.
[SHOT 1 — Wide Shot, 0:00–0:04] Wide static eye-level shot of the warm dining room @image3. Amber pendant light glows above the wooden dining table. @image1 and @image2 sit facing each other across the table. @image1 taps his smartphone screen twice with his index finger, then looks up at @image2 and speaks naturally.
Dialogue (@image1, Korean, male voice, casual relaxed tone): "우리 예매한 영화, 그냥 취소할까?"
[SHOT 2 — Medium Close-Up on @image2, 0:04–0:08] Static medium close-up of @image2 seated at the same dining table @image3. She gently pushes her glasses up the bridge of her nose with one finger, then slowly rolls her stiff neck side to side with a tired sigh.
Dialogue (@image2, Korean, female voice, soft and tired): "응... 오늘 밖으로 나갈 체력은 안 남아있어."
[SHOT 3 — Over-The-Shoulder, 0:08–0:12] Over-the-shoulder shot from behind @image2's left shoulder, focused on @image1 across the dining table @image3. @image1 calmly taps the red "Cancel" button on a movie ticket booking screen, then lifts his eyes and gives a relaxed, knowing smile.
Dialogue (@image1, Korean, male voice, light and playful): "그럴 줄 알았다. 그럼 집에서 넷플릭스 정주행?"
[SHOT 4 — Medium Shot on @image2, 0:12–0:15] Static medium shot of @image2 at the dining table @image3. Her face brightens with a happy smile, eyes lighting up behind her glasses. She leans forward with visible excitement.
Dialogue (@image2, Korean, female voice, cheerful and energetic): "콜! 너무 좋아."
Total duration: 15 seconds. Maintain identity of @image1 and @image2, and consistent set design of @image3 throughout.`

interface RefAssignment {
  token: string         // "@image1"
  rootAssetId: string
  name: string
  url: string | null
  category: string
  description?: string
}

// 루트에셋 후보 중 대본에서 언급된 것들만 골라서 토큰 부여.
// Claude가 "어떤 자산이 등장하는지" 직접 판단하도록 한 번 더 호출.
async function pickReferencedAssets(
  scriptText: string,
  assets: RootAssetRow[],
  variationsMap: Record<string, string>,
): Promise<RefAssignment[]> {
  if (assets.length === 0) return []

  const assetList = assets.map((a, i) => {
    const v = variationsMap[a.id]?.trim()
    const variationNote = v ? ` (이 씬 변동: ${v})` : ''
    return `${i + 1}. id=${a.id} | category=${a.category} | name="${a.name}"${variationNote} | desc=${(a.description ?? '').slice(0, 200)}`
  }).join('\n')

  const sys = `You select which root assets are referenced in a Korean film script segment. Reply with strict JSON only.`
  const user = `다음은 사용 가능한 프로젝트 루트에셋 목록입니다:
${assetList}

다음은 영상으로 변환할 대본 일부입니다:
"""
${scriptText}
"""

대본에 등장하거나 명백히 사용될 자산만 골라 JSON 배열로 응답하세요. 등장 순서대로 정렬.
형식: [{"id":"...","name":"...","category":"...","whyMatched":"한 줄 사유"}]
- 동일 자산은 한 번만 포함.
- 캐릭터/공간/오브제는 모두 후보지만 대본 텍스트와 의미적으로 매칭되는 것만.
- 매칭이 약하면 제외. JSON 외 다른 텍스트 금지.`

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: sys,
    messages: [{ role: 'user', content: user }],
  })
  const block = resp.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
  const raw = (block?.text ?? '').trim()
  let picks: Array<{ id: string }> = []
  try {
    // 코드펜스/잡음 제거
    const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
    picks = JSON.parse(cleaned)
  } catch (e) {
    console.warn('[scriptize] pickReferencedAssets JSON 파싱 실패:', raw.slice(0, 300))
    return []
  }

  const byId = new Map(assets.map(a => [a.id, a]))
  const refs: RefAssignment[] = []
  let n = 1
  for (const p of picks) {
    const a = byId.get(p.id)
    if (!a) continue
    if (refs.some(r => r.rootAssetId === a.id)) continue
    refs.push({
      token: `@image${n}`,
      rootAssetId: a.id,
      name: a.name,
      url: (a.reference_image_urls && a.reference_image_urls[0]) ?? null,
      category: a.category,
      description: a.description ?? '',
    })
    n++
    if (n > 8) break  // Seedance reference 한도 4 + 여유 4
  }
  return refs
}

async function generateSeedancePrompt(
  scriptText: string,
  refs: RefAssignment[],
  sceneCtx: SceneRow | null,
  durationSec: number,
): Promise<string> {
  const refTable = refs.map(r => {
    const v = (sceneCtx?.character_variations ?? {})[r.rootAssetId]?.trim()
    const variationNote = v ? ` | 이 씬 변동사항: ${v}` : ''
    return `- ${r.token} = ${r.category}: ${r.name} | 기본 설정: ${(r.description ?? '').slice(0, 300)}${variationNote}`
  }).join('\n')

  const visualHint = sceneCtx?.settings && Object.values(sceneCtx.settings).some(v => v)
    ? `\n\n씬 비주얼 세팅(반영 권장):\n${JSON.stringify(sceneCtx.settings)}`
    : ''

  const sys = `You convert Korean film script segments into Seedance 2.0 cinematic R2V prompts. Output ONE English prompt block only — no markdown, no commentary, no JSON.

${SEEDANCE_GUIDE}

Reference example (different content, same structure):
${SAMPLE_PROMPT}`

  const user = `Reference assets to use as @imageN tokens (USE THESE EXACT TOKENS, do not invent new ones):
${refTable || '(no references — pure T2V, but keep the multi-shot structure)'}
${visualHint}

Target total duration: ${durationSec} seconds.

Korean script segment to convert:
"""
${scriptText}
"""

다음 규칙을 반드시 지켜:
1. 위 표에 정의된 @imageN 토큰만 사용. 새 토큰 만들지 말 것.
2. 동일 인물/공간이 다시 나오면 같은 @imageN 그대로 재사용.
3. 캐릭터 이름은 토큰 직후 괄호로 한 번만 명시 (예: @image1 (Jinwoo)). 이후엔 토큰만.
4. 대화는 형식 \`Dialogue (@imageN, Korean, <gender> voice, <tone>): "원문"\` — 한국어 대사 그대로.
5. 씬 변동사항(예: 의상/머리 상태)이 있으면 Master 라인이나 첫 등장 SHOT에서 자연스럽게 묘사.
6. ${durationSec}초에 맞춰 SHOT 분량 조정 (5초당 1샷 권장). 시간 표기 \`[SHOT N — framing, m:ss–m:ss]\`.
7. 영문 단일 블록으로만 출력. 코드펜스 금지.`

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: sys,
    messages: [{ role: 'user', content: user }],
  })
  const block = resp.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
  const raw = (block?.text ?? '').trim()
  // 혹시 코드펜스가 끼었으면 제거
  return raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim()
}

export async function POST(req: NextRequest) {
  try {
    const { projectId, sceneId, scriptText, durationSec = 15 } = await req.json()
    if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    if (!scriptText || typeof scriptText !== 'string' || !scriptText.trim()) {
      return NextResponse.json({ error: 'scriptText is required' }, { status: 400 })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY missing' }, { status: 500 })
    }

    const supabase = createAdminClient()

    // 1) 루트에셋 (테이블명: root_asset_seeds, 대표 이미지는 reference_image_urls[0])
    const { data: rawAssets, error: aErr } = await supabase
      .from('root_asset_seeds')
      .select('id, name, category, description, reference_image_urls')
      .eq('project_id', projectId)
    if (aErr) {
      return NextResponse.json({ error: 'root_asset_seeds 조회 실패: ' + aErr.message }, { status: 500 })
    }
    const assets: RootAssetRow[] = (rawAssets ?? []) as RootAssetRow[]

    // 2) 씬 컨텍스트
    let sceneCtx: SceneRow | null = null
    let variationsMap: Record<string, string> = {}
    if (sceneId) {
      const { data: sc } = await supabase
        .from('scenes')
        .select('id, scene_number, content, character_variations, settings:scene_settings(angle, lens, lighting, mood)')
        .eq('id', sceneId)
        .maybeSingle()
      if (sc) {
        // scene_settings는 1:1 관계지만 join 결과가 객체 또는 배열로 올 수 있음
        const rawSettings: any = (sc as any).settings
        const settings = Array.isArray(rawSettings) ? rawSettings[0] : rawSettings
        sceneCtx = {
          id: sc.id,
          scene_number: (sc as any).scene_number ?? null,
          content: (sc as any).content ?? null,
          character_variations: ((sc as any).character_variations ?? {}) as Record<string, string>,
          settings: settings ?? null,
        }
        variationsMap = (sceneCtx.character_variations ?? {}) as Record<string, string>
      }
    }

    // 3) 대본에서 어떤 자산이 등장하는지 Claude가 선별 → 토큰 부여
    const refs = await pickReferencedAssets(scriptText.trim(), assets, variationsMap)

    // 4) 영문 Seedance 프롬프트 생성
    const prompt = await generateSeedancePrompt(scriptText.trim(), refs, sceneCtx, Number(durationSec) || 15)

    return NextResponse.json({
      prompt,
      refs: refs.map(r => ({
        token: r.token,
        rootAssetId: r.rootAssetId,
        name: r.name,
        url: r.url,
        category: r.category,
      })),
      rawScript: scriptText,
      durationSec: Number(durationSec) || 15,
    })
  } catch (e) {
    console.error('[scriptize] error:', e)
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'scriptize 실패: ' + msg }, { status: 500 })
  }
}
