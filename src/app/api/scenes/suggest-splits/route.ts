import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// 클라이언트와 동일한 씬 헤더 패턴
const SCENE_HEADER_RE = /^(?:씬|scene|s)[\s\-.]?\d+|^(?:INT|EXT|내부|외부)[.\s]/i

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { content } = await req.json()
  if (!content?.trim()) return NextResponse.json({ error: '대본 없음' }, { status: 400 })

  const lines: string[] = content.split('\n')

  // 1차: 정규식으로 씬 헤더 감지
  const detectedBreaks = new Set<number>([0])
  lines.forEach((line, i) => {
    if (i > 0 && SCENE_HEADER_RE.test(line.trim())) detectedBreaks.add(i)
  })

  // 패턴으로 감지된 씬이 2개 이상이면 AI 없이 바로 반환
  if (detectedBreaks.size >= 2) {
    return NextResponse.json({
      scene_starts: Array.from(detectedBreaks).sort((a, b) => a - b),
      source: 'regex',
    })
  }

  // 2차: 패턴 감지 안 됐을 때만 AI 사용
  try {
    // AI에게는 라인 인덱스와 텍스트 preview 제공 (비어있는 줄은 생략)
    const preview = lines
      .map((line, i) => ({ i, text: line.trim() }))
      .filter(({ text }) => text.length > 0)
      .slice(0, 80) // 최대 80라인 미리보기
      .map(({ i, text }) => `[${i}] ${text.substring(0, 100)}`)
      .join('\n')

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `영상 대본의 라인들을 보고 씬(장면)이 바뀌는 라인 인덱스를 찾으세요.

라인 목록 (총 ${lines.length}줄, 비어있는 줄 제외):
${preview}

씬 경계 기준: 장소 변경, 시간대 변경, 주요 인물/피사체 변경, 새로운 사건 시작

씬이 시작되는 라인 인덱스 배열을 반환하세요. 항상 0 포함.
JSON만 반환:
{"scene_starts": [0, 12, 28, 45]}`
      }]
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('파싱 실패')

    const parsed = JSON.parse(jsonMatch[0])
    let scene_starts: number[] = parsed.scene_starts ?? [0]

    // 유효성 검증
    scene_starts = scene_starts
      .filter((n: any) => typeof n === 'number' && n >= 0 && n < lines.length)
      .sort((a: number, b: number) => a - b)
    if (!scene_starts.includes(0)) scene_starts.unshift(0)

    return NextResponse.json({ scene_starts, source: 'ai' })
  } catch (err) {
    console.warn('[suggest-splits] AI 파싱 실패, 폴백 사용:', err)
    // 실패 시 20줄마다 씬 하나로 폴백
    const fallback = Array.from(
      { length: Math.ceil(lines.length / 20) },
      (_, i) => i * 20
    )
    return NextResponse.json({ scene_starts: fallback, source: 'fallback' })
  }
}
