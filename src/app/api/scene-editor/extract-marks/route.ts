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

// 구조화된 출력 강제 — 파싱 실패 제거
const EMIT_MARKS_TOOL: Anthropic.Tool = {
  name: 'emit_marks',
  description: '씬 대본에서 추출한 루트 에셋 마크를 반환합니다.',
  input_schema: {
    type: 'object',
    properties: {
      character: { type: 'string', description: '등장 인물 이름들(쉼표로 구분). 없으면 빈 문자열' },
      space: { type: 'string', description: '장소. 없으면 빈 문자열' },
      object: { type: 'string', description: '주요 오브제. 없으면 빈 문자열' },
      misc: { type: 'string', description: '기타 참고. 없으면 빈 문자열' },
    },
    required: ['character', 'space', 'object', 'misc'],
  },
}

async function extractMarks(sceneContent: string): Promise<RootAssetMarks> {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    tools: [EMIT_MARKS_TOOL],
    tool_choice: { type: 'tool', name: 'emit_marks' },
    messages: [
      {
        role: 'user',
        content: `다음 씬 대본을 읽고 emit_marks 툴을 호출해서 등장인물·장소·오브제·기타를 추출하세요. 해당 없는 항목은 빈 문자열로.

대본:
${sceneContent}`,
      },
    ],
  })

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  )
  if (!toolUse) {
    throw new Error('tool_use 블록 없음')
  }
  const input = toolUse.input as Partial<RootAssetMarks>
  return {
    character: input.character ?? '',
    space: input.space ?? '',
    object: input.object ?? '',
    misc: input.misc ?? '',
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  // 새 포맷: { scenes: [{id, content}], projectId } — 로컬 편집 상태 지원
  // 이전 포맷: { sceneIds, projectId } — DB 저장 후 (현재 사용 안함)
  let sceneInputs: SceneInput[] = []

  if (Array.isArray(body.scenes)) {
    sceneInputs = body.scenes
      .filter((s: any) => s && typeof s.id === 'string' && typeof s.content === 'string')
      .map((s: any) => ({ id: s.id, content: s.content }))
  } else {
    return NextResponse.json(
      { error: 'scenes 배열이 필요합니다 ([{id, content}])' },
      { status: 400 },
    )
  }

  if (sceneInputs.length === 0) {
    return NextResponse.json({ results: [] })
  }

  try {
    // 병렬 처리: 씬별 Claude 호출
    const tasks = sceneInputs.map(
      async (scene): Promise<MarkResult> => {
        try {
          if (!scene.content.trim()) {
            return {
              sceneId: scene.id,
              marks: { character: '', space: '', object: '', misc: '' },
            }
          }
          const marks = await extractMarks(scene.content)
          return { sceneId: scene.id, marks }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[extract-marks] 씬 ${scene.id} 실패:`, err)
          return { sceneId: scene.id, error: msg }
        }
      },
    )

    const results = await Promise.all(tasks)
    return NextResponse.json({ results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[extract-marks] 전체 실패:', err)
    return NextResponse.json({ error: `추출 실패: ${msg}` }, { status: 500 })
  }
}
