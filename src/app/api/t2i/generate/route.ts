import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const ASPECT_RATIO_MAP: Record<string, string> = {
  '16:9': '16:9', '9:16': '9:16', '1:1': '1:1',
  '4:3': '4:3',  '3:2': '4:3',  '4:5': '3:4',
  '21:9': '16:9', '2.35:1': '16:9', '2.39:1': '16:9',
}
function toGeminiRatio(r?: string) { return ASPECT_RATIO_MAP[r ?? ''] ?? '16:9' }

// base64 이미지 → Supabase Storage 업로드 → public URL
async function uploadBase64(
  admin: ReturnType<typeof createAdminClient>,
  b64: string,
  mimeType: string,
  projectId: string,
  attemptId: string,
): Promise<string> {
  const ext  = mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const path = `t2i/${projectId}/${attemptId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  const buf  = Buffer.from(b64, 'base64')
  const { data, error } = await admin.storage.from('assets').upload(path, buf, {
    contentType: mimeType, upsert: false,
  })
  if (error) throw new Error(`Storage 업로드 실패: ${error.message}`)
  const { data: { publicUrl } } = admin.storage.from('assets').getPublicUrl(data.path)
  return publicUrl
}

// 외부 URL → base64 인코딩 (레퍼런스 이미지 첨부용)
async function fetchImageAsBase64(url: string): Promise<{ b64: string; mimeType: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`레퍼런스 이미지 가져오기 실패 (${res.status}): ${url}`)
  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  const buffer = await res.arrayBuffer()
  return {
    b64: Buffer.from(buffer).toString('base64'),
    mimeType: contentType.split(';')[0].trim(),
  }
}

// 화면비 → 프롬프트 suffix 텍스트
const RATIO_SUFFIX: Record<string, string> = {
  '16:9':   'widescreen 16:9 aspect ratio',
  '9:16':   'vertical 9:16 aspect ratio portrait',
  '1:1':    'square 1:1 aspect ratio',
  '4:3':    '4:3 aspect ratio',
  '3:2':    '3:2 aspect ratio',
  '4:5':    '4:5 aspect ratio portrait',
  '21:9':   'ultra-wide 21:9 cinematic aspect ratio',
  '2.35:1': 'cinemascope 2.35:1 aspect ratio',
  '2.39:1': 'anamorphic 2.39:1 aspect ratio',
}

// ── Gemini 2.5 Flash Image = 나노바나나 ──────────────────────────
async function generateViaNanobanana(
  apiKey: string,
  prompt: string,
  aspectRatio: string,
  count: number = 4,
  referenceImages?: Array<{ b64: string; mimeType: string }>,
): Promise<Array<{ b64: string; mimeType: string }>> {
  const ratioSuffix = RATIO_SUFFIX[aspectRatio] ?? 'widescreen 16:9 aspect ratio'
  const fullPrompt  = `${prompt}\n\n${ratioSuffix}`

  // parts 구성: 레퍼런스 이미지가 있으면 앞에 삽입
  const parts: any[] = []
  if (referenceImages && referenceImages.length > 0) {
    for (const img of referenceImages) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.b64 } })
    }
    // 레퍼런스 이미지가 있을 때 프롬프트 텍스트에 참고 문구 추가
    parts.push({
      text: `Use the above reference image(s) as a visual style and composition guide. Generate a new image based on the following description:\n\n${fullPrompt}`,
    })
  } else {
    parts.push({ text: fullPrompt })
  }

  // Gemini 지원 비율로 변환
  const geminiRatio = (() => {
    const supported = ['21:9','16:9','4:3','3:2','1:1','9:16','3:4','2:3','5:4','4:5']
    return supported.includes(aspectRatio) ? aspectRatio : '16:9'
  })()

  // 나노바나나는 1회 호출에 이미지 1장 → count만큼 병렬 호출
  const calls = Array.from({ length: count }, () =>
    fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
      {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: geminiRatio },
          },
        }),
      }
    )
  )

  const responses = await Promise.allSettled(calls)
  const images: Array<{ b64: string; mimeType: string }> = []

  for (const result of responses) {
    if (result.status === 'rejected') continue
    const res = result.value
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`NanoBanana ${res.status}: ${body}`)
    }
    const json = await res.json()
    for (const cand of json.candidates ?? []) {
      for (const part of cand.content?.parts ?? []) {
        if (part.inlineData?.data) {
          images.push({ b64: part.inlineData.data, mimeType: part.inlineData.mimeType ?? 'image/png' })
        }
      }
    }
  }
  return images
}

export async function POST(req: NextRequest) {
  const {
    attemptId, prompt, negativePrompt, engine, projectId, sceneId, aspectRatio,
    referenceImageUrls,   // string[] | undefined — 레퍼런스 이미지 URL 목록
  } = await req.json()
  const admin = createAdminClient()

  const errorDetail = ''

  try {
    let imageUrls: string[] = []

    if (engine === 'nanobanana') {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다. 서버를 재시작했는지 확인하세요.')

      // 레퍼런스 이미지 base64 변환 (있는 경우)
      let referenceImages: Array<{ b64: string; mimeType: string }> | undefined
      if (Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0) {
        const fetched = await Promise.allSettled(
          referenceImageUrls.slice(0, 3).map((url: string) => fetchImageAsBase64(url))  // 최대 3장
        )
        referenceImages = fetched
          .filter((r): r is PromiseFulfilledResult<{ b64: string; mimeType: string }> => r.status === 'fulfilled')
          .map(r => r.value)
        console.log(`[T2I] 레퍼런스 이미지 ${referenceImages.length}장 첨부`)
      }

      const images = await generateViaNanobanana(apiKey, prompt, aspectRatio ?? '16:9', 4, referenceImages)

      if (images.length === 0) throw new Error('이미지가 생성되지 않았습니다. 프롬프트를 수정해보세요.')

      for (const img of images) {
        const url = await uploadBase64(admin, img.b64, img.mimeType, projectId, attemptId)
        imageUrls.push(url)
      }

      console.log(`[T2I] nanobanana(gemini-2.5-flash-image)로 ${imageUrls.length}장 생성 완료`)

    } else if (engine === 'midjourney') {
      const mjUrl = process.env.MIDJOURNEY_API_URL
      const mjKey = process.env.MIDJOURNEY_API_KEY
      if (!mjUrl) throw new Error('MIDJOURNEY_API_URL이 설정되지 않았습니다.')
      if (!mjKey) throw new Error('MIDJOURNEY_API_KEY가 설정되지 않았습니다.')

      const res = await fetch(`${mjUrl}/imagine`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${mjKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, n: 4 }),
      })

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Midjourney API ${res.status}: ${body.slice(0, 500)}`)
      }

      const data = await res.json()
      console.log('[T2I] midjourney 응답 구조:', JSON.stringify(data).slice(0, 300))

      // 응답 필드명이 제공업체마다 다름 — 흔한 후보들을 순회
      const rawUrls: string[] = (
        data.images ??
        data.imageUrls ??
        data.urls ??
        data.results ??
        (Array.isArray(data) ? data : []) ??
        []
      )
        .map((item: any) => typeof item === 'string' ? item : (item?.url ?? item?.image_url ?? item?.imageUrl))
        .filter((u: any): u is string => typeof u === 'string' && u.length > 0)

      if (rawUrls.length === 0) {
        throw new Error(`Midjourney 응답에서 이미지 URL을 찾지 못했습니다. 응답 프리뷰: ${JSON.stringify(data).slice(0, 300)}`)
      }

      // 외부 URL은 만료될 수 있으므로 Supabase Storage로 미러링
      for (const extUrl of rawUrls) {
        try {
          const { b64, mimeType } = await fetchImageAsBase64(extUrl)
          const storedUrl = await uploadBase64(admin, b64, mimeType, projectId, attemptId)
          imageUrls.push(storedUrl)
        } catch (e) {
          console.error('[T2I] midjourney 이미지 저장 실패:', extUrl, e)
        }
      }

      if (imageUrls.length === 0) {
        throw new Error('Midjourney 이미지를 Storage에 저장하지 못했습니다.')
      }

      console.log(`[T2I] midjourney로 ${imageUrls.length}장 저장 완료`)

    } else if (engine === 'gpt-image') {
      // TODO: OPENAI_API_KEY 추가 후 https://api.openai.com/v1/images/generations 호출
      // 모델: gpt-image-1, response_format: 'b64_json'
      throw new Error('GPT Image 엔진은 아직 준비 중입니다. OPENAI_API_KEY 설정 후 활성화됩니다.')

    } else if (engine === 'stable-diffusion' || engine === 'dalle') {
      throw new Error(`${engine} 엔진은 아직 준비 중입니다.`)

    } else {
      throw new Error(`지원하지 않는 엔진: ${engine}`)
    }

    // asset + attempt_output 저장
    for (const url of imageUrls) {
      const { data: asset } = await admin.from('assets').insert({
        project_id: projectId, scene_id: sceneId,
        type: 't2i', name: `t2i_${Date.now()}.png`,
        url, thumbnail_url: url, tags: [],
        metadata: {
          engine, prompt, aspect_ratio: aspectRatio,
          reference_count: referenceImageUrls?.length ?? 0,
        },
        attempt_id: attemptId,
      }).select().single()

      if (asset) {
        await admin.from('attempt_outputs').insert({ attempt_id: attemptId, asset_id: asset.id })
      }
    }

    await admin.from('prompt_attempts').update({ status: 'done' }).eq('id', attemptId)
    return NextResponse.json({ success: true, count: imageUrls.length })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[T2I] 생성 실패:', msg)
    await admin.from('prompt_attempts').update({ status: 'failed' }).eq('id', attemptId)
    return NextResponse.json({ error: msg, detail: errorDetail }, { status: 500 })
  }
}
