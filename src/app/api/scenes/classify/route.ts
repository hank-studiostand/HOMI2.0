import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// JSON이 중간에 잘렸을 때 복구 시도
function repairJson(text: string): any[] {
  // 정상 파싱 먼저 시도
  try {
    const match = text.match(/\[[\s\S]*\]/)
    if (match) return JSON.parse(match[0])
  } catch {}

  // 잘린 JSON 복구: 마지막 완전한 객체까지만 추출
  try {
    const start = text.indexOf('[')
    if (start === -1) return []
    let depth = 0
    let lastCompleteEnd = -1
    let inString = false
    let escape = false

    for (let i = start; i < text.length; i++) {
      const c = text[i]
      if (escape) { escape = false; continue }
      if (c === '\\' && inString) { escape = true; continue }
      if (c === '"') { inString = !inString; continue }
      if (inString) continue
      if (c === '{') depth++
      if (c === '}') {
        depth--
        if (depth === 0) lastCompleteEnd = i
      }
    }

    if (lastCompleteEnd === -1) return []
    const repaired = text.slice(start, lastCompleteEnd + 1) + ']'
    return JSON.parse(repaired)
  } catch {
    return []
  }
}

// 사용자가 직접 정의한 씬 텍스트들로 AI 설명 생성
async function classifyFromManualScenes(manualScenes: string[]): Promise<any[]> {
  const results: any[] = []

  for (let i = 0; i < manualScenes.length; i++) {
    const sceneText = manualScenes[i]
    try {
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
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

JSON 배열로만 응답:
[{"scene_number":"${i + 1}-1-1","title":"장소—샷설명","content":"간결한 시각 묘사","order_index":0}]`
        }]
      })

      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      const parsed = repairJson(text)
      results.push(...parsed)
    } catch {
      // 실패한 씬은 기본값으로 추가
      results.push({
        scene_number: String(i + 1),
        title: `씬 ${i + 1}`,
        content: sceneText.substring(0, 200),
        order_index: results.length,
      })
    }
  }

  return results
}

export async function POST(req: NextRequest) {
  const { scriptId, projectId, content, manualScenes } = await req.json()
  const admin = createAdminClient()

  let scenes: any[] = []

  try {
    if (manualScenes && Array.isArray(manualScenes) && manualScenes.length > 0) {
      // ── 경로 A: 사용자가 직접 씬 경계를 지정한 경우 ──
      scenes = await classifyFromManualScenes(manualScenes)
    } else {
      // ── 경로 B: 대본 전체를 AI가 자동 분류 ──
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        messages: [{
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

JSON 배열로만 응답:
[{"scene_number":"1-1-1","title":"장소—샷설명","content":"간결한 시각 묘사","order_index":0}]`
        }]
      })

      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      scenes = repairJson(text)
    }
  } catch (err) {
    return NextResponse.json({ error: `AI 분석 실패: ${String(err)}` }, { status: 500 })
  }

  if (scenes.length === 0) {
    return NextResponse.json({ error: '씬 파싱 결과 없음' }, { status: 500 })
  }

  // 기존 씬 삭제
  const { error: delErr } = await admin.from('scenes').delete().eq('project_id', projectId)
  if (delErr) return NextResponse.json({ error: `삭제 실패: ${delErr.message}` }, { status: 500 })

  // 새 씬 삽입
  const toInsert = scenes.map((s: any, i: number) => ({
    project_id: projectId,
    script_id: scriptId,
    scene_number: String(s.scene_number ?? i + 1),
    title: s.title ?? '',
    content: s.content ?? '',
    order_index: typeof s.order_index === 'number' ? s.order_index : i,
  }))

  const { error: insErr } = await admin.from('scenes').insert(toInsert)
  if (insErr) return NextResponse.json({ error: `삽입 실패: ${insErr.message}` }, { status: 500 })

  // 프로젝트 updated_at 갱신
  await admin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId)

  return NextResponse.json({ success: true, count: scenes.length })
}
