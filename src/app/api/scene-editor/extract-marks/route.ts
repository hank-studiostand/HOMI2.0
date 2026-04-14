import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { sceneIds, projectId } = await req.json()
  const admin = createAdminClient()

  try {
    const { data: scenes, error: sceneErr } = await admin
      .from('scenes')
      .select('id, content')
      .in('id', sceneIds)

    if (sceneErr || !scenes) {
      return NextResponse.json({ error: `씬 조회 실패: ${sceneErr?.message}` }, { status: 404 })
    }

    const results: Array<{ sceneId: string; marks?: any; error?: string }> = []

    for (const scene of scenes) {
      try {
        const message = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          messages: [{
            role: 'user',
            content: `다음 씬 대본을 읽고 아래 JSON 형식으로만 반환해주세요. 해당 없는 항목은 빈 문자열로:

{"character": "등장 인물 이름들(쉼표)", "space": "장소", "object": "주요 오브제", "misc": "기타 참고"}

대본:
${scene.content}

JSON만 반환:`,
          }]
        })

        const text = message.content[0].type === 'text' ? message.content[0].text : ''
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        const marks = jsonMatch ? JSON.parse(jsonMatch[0]) : { character: '', space: '', object: '', misc: '' }

        // Update scene with root_asset_marks
        await admin
          .from('scenes')
          .update({ root_asset_marks: marks, updated_at: new Date().toISOString() })
          .eq('id', scene.id)

        results.push({ sceneId: scene.id, marks })
      } catch (err) {
        results.push({ sceneId: scene.id, error: String(err) })
      }
    }

    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json({ error: `추출 실패: ${String(err)}` }, { status: 500 })
  }
}
