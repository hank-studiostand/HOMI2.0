import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface RootAssetMarks {
  character: string
  space: string
  object: string
  misc: string
}

interface MarkResult {
  sceneId: string
  marks?: RootAssetMarks
  error?: string
}

interface SceneInput {
  id: string
  content: string
}

const EMIT_BATCH_TOOL: Anthropic.Tool = {
  name: 'emit_scene_marks',
  description: '각 씬에서 시각적으로 존재하는(언급만 된 것이 아닌) 인물/공간/오브제/기타를 추출하여 반환합니다.',
  input_schema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        description: '각 씬별 마크 — 입력 순서와 동일',
        items: {
          type: 'object',
          properties: {
            scene_id: { type: 'string', description: '입력으로 받은 씬 id를 그대로 반환' },
            character: {
              type: 'string',
              description: '이 씬에 시각적으로 등장하는 인물 이름 (쉼표 구분). 화자가 다른 인물을 언급만 했다면 그 인물은 제외. 없으면 빈 문자열.',
            },
            space: {
              type: 'string',
              description: '카메라가 비추는 실제 공간. 인물이 "병원 가자"고 말해도 현재 화면이 거실이면 "거실". scene heading에 INT./EXT. 표시가 있으면 우선 참고. 없으면 빈 문자열.',
            },
            object: {
              type: 'string',
              description: '이 씬 화면 안에 보이는 주요 오브제 (쉼표 구분). 대사나 회상으로만 언급된 사물은 제외. 없으면 빈 문자열.',
            },
            misc: {
              type: 'string',
              description: '시간대/날씨/분위기 등 시각적으로 의미 있는 보조 정보. 없으면 빈 문자열.',
            },
          },
          required: ['scene_id', 'character', 'space', 'object', 'misc'],
        },
      },
    },
    required: ['results'],
  },
}

const SYSTEM = `당신은 한국 시나리오 분석 전문가입니다. 영상 컷 단위 대본을 읽고, 각 컷에서 카메라가 실제로 비추는 시각 정보를 추출합니다.

핵심 규칙:
1. **현재 화면 vs 언급만**:
   - "엄마가 그랬어" → 엄마는 character에 포함하지 않음 (화면에 없음)
   - "병원 가자" → space는 현재 카메라가 비추는 곳 (병원이 아닌 거실)
   - 회상/플래시백/꿈은 본문에 명시되지 않은 한 현재 씬의 일부로 보지 않음

2. **연속성 단서 활용**:
   - 직전 컷이 "S#1. 거실 - 낮"이고 현재 컷에 장소 정보가 없으면, space에 "거실"을 그대로 사용
   - scene heading (예: "S#3. 카페 - 밤", "INT. 침실 - 새벽")이 있으면 그것이 우선

3. **인물/오브제는 화면 등장 기준**:
   - 화자/청자 모두 등장하면 character에 둘 다 포함
   - 대화 속에 언급된 다른 인물은 제외
   - 오브제는 "보이거나 손에 든 것" — 추상 개념이나 대사 속 사물은 제외

4. **빈 값**: 정보가 없거나 불명확하면 빈 문자열 ""을 사용. 추측하지 마세요.

5. **출력 형식**: 인물/오브제는 쉼표(,)로 구분. 공간/기타는 한 단어 또는 짧은 구절.`

const FEW_SHOT_EXAMPLE = `예시 1 (언급 vs 실제):
입력: { id: "ex1", content: "거실. 엄마와 진오가 마주 앉아있다. 엄마: '병원 한번 가봐.' 진오는 휴대폰만 만지작거린다." }
출력: { scene_id: "ex1", character: "엄마, 진오", space: "거실", object: "휴대폰", misc: "" }
   ⚠ 병원은 언급만 된 곳이라 space에 들어가지 않음

예시 2 (헤더 활용):
입력: { id: "ex2", content: "S#3. 카페 — 낮. 미정이 창가 자리에서 노트북을 두드린다. 옆에 식어버린 라떼가 보인다." }
출력: { scene_id: "ex2", character: "미정", space: "카페", object: "노트북, 라떼", misc: "낮" }

예시 3 (연속성):
입력: [
  { id: "ex3a", content: "S#1. 침실 - 새벽. 진오가 자고 있다. 알람이 울린다." },
  { id: "ex3b", content: "진오가 이불을 걷어차고 일어선다. 베개가 바닥에 떨어진다." }
]
출력: [
  { scene_id: "ex3a", character: "진오", space: "침실", object: "알람시계", misc: "새벽" },
  { scene_id: "ex3b", character: "진오", space: "침실", object: "이불, 베개", misc: "" }
]
   ⚠ 3b는 장소 표시가 없지만 직전 컷의 침실을 이어받음`

async function extractMarksBatch(sceneInputs: SceneInput[]): Promise<MarkResult[]> {
  const fullScript = sceneInputs.map((s, i) => `[컷 ${i + 1}, id="${s.id}"]\n${s.content.trim()}`).join('\n\n---\n\n')

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: SYSTEM,
    tools: [EMIT_BATCH_TOOL],
    tool_choice: { type: 'tool', name: 'emit_scene_marks' },
    messages: [{
      role: 'user',
      content: `${FEW_SHOT_EXAMPLE}

──────────

이제 아래 ${sceneInputs.length}개 컷을 차례대로 분석하세요. 컷 간 장소 연속성을 고려하여, 각 컷의 ID를 그대로 유지한 채 마크를 추출해 emit_scene_marks 툴로 반환하세요.

전체 대본:
${fullScript}`,
    }],
  })

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  )
  if (!toolUse) throw new Error('Claude tool_use 블록 없음')

  const input = toolUse.input as { results?: any[] }
  const out = (input.results ?? []) as Array<{
    scene_id: string
    character?: string
    space?: string
    object?: string
    misc?: string
  }>

  const byId = new Map<string, RootAssetMarks>()
  for (const r of out) {
    byId.set(r.scene_id, {
      character: r.character ?? '',
      space:     r.space ?? '',
      object:    r.object ?? '',
      misc:      r.misc ?? '',
    })
  }

  return sceneInputs.map(s => {
    const marks = byId.get(s.id)
    if (marks) return { sceneId: s.id, marks }
    return { sceneId: s.id, error: '결과에 매칭되는 씬이 없음' }
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  let sceneInputs: SceneInput[] = []

  if (Array.isArray(body.scenes)) {
    sceneInputs = body.scenes
      .filter((s: any) => s && typeof s.id === 'string' && typeof s.content === 'string')
      .map((s: any) => ({ id: s.id, content: s.content }))
      .filter((s: SceneInput) => s.content.trim().length > 0)
  }

  if (sceneInputs.length === 0) {
    return NextResponse.json({ error: 'scenes 배열 필요 (id, content)' }, { status: 400 })
  }

  // 컷이 매우 많으면 청크 단위 — 인접 컷끼리 묶여 연속성 보존
  const CHUNK = 25
  const chunks: SceneInput[][] = []
  for (let i = 0; i < sceneInputs.length; i += CHUNK) {
    chunks.push(sceneInputs.slice(i, i + CHUNK))
  }

  try {
    const all: MarkResult[] = []
    for (const chunk of chunks) {
      const res = await extractMarksBatch(chunk)
      all.push(...res)
    }
    return NextResponse.json({ results: all })
  } catch (err) {
    console.error('[extract-marks]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
