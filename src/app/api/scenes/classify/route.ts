import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface ClassifiedScene {
  scene_number: string
  title: string
  content: string
  order_index: number
}

// ─────────────────────────────────────────────────────────────
// Claude tool_use로 구조화된 출력 강제
// → 스키마 검증된 JSON이 보장되므로 문자열 파싱 실패가 사라짐
// ─────────────────────────────────────────────────────────────
const EMIT_SCENES_TOOL: Anthropic.Tool = {
  name: 'emit_scenes',
  description: '분류된 씬 목록을 반환합니다.',
  input_schema: {
    type: 'object',
    properties: {
      scenes: {
        type: 'array',
        description: '시퀀스-씬-컷 계층으로 분류된 샷 목록',
        items: {
          type: 'object',
          properties: {
            scene_number: {
              type: 'string',
              description: '"시퀀스번호-씬번호-컷번호" 형식 (예: "1-1-1")',
            },
            title: { type: 'string', description: '장소—샷설명' },
            content: {
              type: 'string',
              description: '2~3문장의 시각적 묘사 (피사체, 구도, 분위기)',
            },
            order_index: { type: 'number' },
          },
          required: ['scene_number', 'title', 'content', 'order_index'],
        },
      },
    },
    required: ['scenes'],
  },
}

// tool_use 응답에서 scenes 배열 추출
function extractScenesFromMessage(
  message: Anthropic.Message,
): ClassifiedScene[] {
  // stop_reason 검증 — max_tokens면 결과가 잘린 상태이므로 알림
  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      'Claude 응답이 max_tokens 한도에 도달했습니다. 대본 길이를 줄이거나 max_tokens를 늘리세요.',
    )
  }

  const toolUseBlock = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
  )

  if (!toolUseBlock) {
    // 모델이 tool을 안 썼다면 — 매우 드물지만 텍스트로 온 경우 로그 후 에러
    const textBlock = message.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    )
    const preview = textBlock?.text?.slice(0, 300) ?? '(빈 응답)'
    console.error('[classify] tool_use 블록 없음. 응답 프리뷰:', preview)
    throw new Error(`Claude가 구조화된 응답을 반환하지 않았습니다: ${preview}`)
  }

  const input = toolUseBlock.input as { scenes?: ClassifiedScene[] }
  if (!Array.isArray(input.scenes)) {
    throw new Error('tool_use 입력에 scenes 배열이 없습니다.')
  }
  return input.scenes
}

// 사용자가 직접 정의한 씬 텍스트들로 AI 설명 생성
async function classifyFromManualScenes(
  manualScenes: string[],
): Promise<ClassifiedScene[]> {
  // 병렬 처리: 시퀀스별 호출이 서로 독립적이므로 allSettled로 동시 실행
  const tasks = manualScenes.map(
    async (sceneText, i): Promise<ClassifiedScene[]> => {
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        tools: [EMIT_SCENES_TOOL],
        tool_choice: { type: 'tool', name: 'emit_scenes' },
        messages: [
          {
            role: 'user',
            content: `영상 연출 전문가로서 아래 대본 텍스트를 AI 이미지 생성용 샷(컷) 단위로 분류하세요.

시퀀스 ${i + 1} 대본:
${sceneText}

3단계 계층 규칙 (시퀀스-씬-컷):
- scene_number는 "시퀀스번호-씬번호-컷번호" 형식 (예: "${i + 1}-1-1", "${i + 1}-1-2", "${i + 1}-2-1")
- 시퀀스(${i + 1})는 이 대본 블록의 큰 단위
- 씬은 같은 장소/시간대의 연속된 장면 묶음
- 컷은 카메라 앵글·피사체·배경이 바뀌는 최소 단위
- 씬 안에 컷이 하나면 "${i + 1}-1-1"처럼 컷번호 1로 표기
- content는 2~3문장으로 간결하게 (피사체, 구도, 분위기 포함)

emit_scenes 툴을 호출해서 결과를 반환하세요.`,
          },
        ],
      })

      return extractScenesFromMessage(message)
    },
  )

  const settled = await Promise.allSettled(tasks)
  const results: ClassifiedScene[] = []
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      results.push(...result.value)
    } else {
      console.error(`[classify] 시퀀스 ${i + 1} 실패:`, result.reason)
      // 실패한 시퀀스는 원본 텍스트 기반 기본값으로 폴백
      results.push({
        scene_number: `${i + 1}-1-1`,
        title: `시퀀스 ${i + 1}`,
        content: manualScenes[i].substring(0, 200),
        order_index: results.length,
      })
    }
  })

  return results
}

export async function POST(req: NextRequest) {
  const { scriptId, projectId, content, manualScenes } = await req.json()
  const admin = createAdminClient()

  let scenes: ClassifiedScene[] = []

  try {
    if (manualScenes && Array.isArray(manualScenes) && manualScenes.length > 0) {
      // ── 경로 A: 사용자가 직접 씬 경계를 지정한 경우 ──
      scenes = await classifyFromManualScenes(manualScenes)
    } else {
      // ── 경로 B: 대본 전체를 AI가 자동 분류 ──
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        tools: [EMIT_SCENES_TOOL],
        tool_choice: { type: 'tool', name: 'emit_scenes' },
        messages: [
          {
            role: 'user',
            content: `당신은 영상 연출 전문가입니다. 아래 대본을 AI 이미지 생성을 위한 개별 샷(컷) 단위로 분류하세요.

대본:
${content}

3단계 계층 규칙 (시퀀스-씬-컷):
- scene_number는 "시퀀스번호-씬번호-컷번호" 형식 (예: "1-1-1", "1-1-2", "1-2-1", "2-1-1")
- 시퀀스: 대본의 큰 흐름 단위 (장소·시간대가 크게 바뀌면 새 시퀀스)
- 씬: 같은 시퀀스 내 연속 장면 묶음 (소규모 장소·상황 변화)
- 컷: 카메라 앵글·피사체·배경이 바뀌는 최소 단위
- content는 2~3문장으로 간결하게 (피사체, 구도, 분위기 포함)

emit_scenes 툴을 호출해서 결과를 반환하세요.`,
          },
        ],
      })

      scenes = extractScenesFromMessage(message)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[classify] AI 분석 실패:', err)
    return NextResponse.json({ error: `AI 분석 실패: ${msg}` }, { status: 500 })
  }

  if (scenes.length === 0) {
    return NextResponse.json({ error: '씬 파싱 결과 없음' }, { status: 500 })
  }

  // 기존 씬 삭제
  const { error: delErr } = await admin
    .from('scenes')
    .delete()
    .eq('project_id', projectId)
  if (delErr)
    return NextResponse.json(
      { error: `삭제 실패: ${delErr.message}` },
      { status: 500 },
    )

  // 새 씬 삽입
  const toInsert = scenes.map((s, i) => ({
    project_id: projectId,
    script_id: scriptId,
    scene_number: String(s.scene_number ?? i + 1),
    title: s.title ?? '',
    content: s.content ?? '',
    order_index: typeof s.order_index === 'number' ? s.order_index : i,
  }))

  const { error: insErr } = await admin.from('scenes').insert(toInsert)
  if (insErr)
    return NextResponse.json(
      { error: `삽입 실패: ${insErr.message}` },
      { status: 500 },
    )

  // 프로젝트 updated_at 갱신
  await admin
    .from('projects')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', projectId)

  return NextResponse.json({ success: true, count: scenes.length })
}
