import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateViaOpenAI } from '@/lib/openai-images'
import { markAttemptFailed } from '@/lib/attemptStatus'

// ── NanoBanana (Gemini) 에러 코드 → 한국어 친화적 메시지 ──
function formatNanobananaError(status: number, body: string): string {
  try {
    const j = JSON.parse(body)
    const errStatus = j?.error?.status ?? ''
    const errMsg = j?.error?.message ?? body
    const map: Record<string, string> = {
      UNAVAILABLE:        'Gemini 서비스가 일시적으로 사용 불가능합니다. 잠시 후 다시 시도해주세요.',
      RESOURCE_EXHAUSTED: '호출 한도 초과 — 분당 호출량이 너무 많습니다. 잠시 후 다시 시도해주세요.',
      DEADLINE_EXCEEDED:  '응답 시간 초과 — 다시 시도해주세요.',
      INTERNAL:           'Gemini 내부 오류 — 잠시 후 다시 시도해주세요.',
      INVALID_ARGUMENT:   '요청 형식 오류 — 프롬프트나 레퍼런스 이미지를 확인해주세요.',
      PERMISSION_DENIED:  '권한 없음 — API 키 또는 결제 정보를 확인해주세요.',
      FAILED_PRECONDITION:'프롬프트가 안전 정책에 위배되었을 수 있어요.',
    }
    const friendly = map[errStatus] ?? errMsg
    return `NanoBanana ${status} (${errStatus || 'ERROR'}): ${friendly}`
  } catch {
    return `NanoBanana ${status}: ${body.slice(0, 300)}`
  }
}

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
  // Gemini 2.5 Flash Image는 다중 입력 이미지를 character/space identity 참조로 사용 가능.
  const parts: any[] = []
  if (referenceImages && referenceImages.length > 0) {
    for (const img of referenceImages) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.b64 } })
    }
    const refInstruction = `IMPORTANT: The ${referenceImages.length} image(s) above are REFERENCE images showing specific characters, spaces, or objects whose identity must be preserved. Treat people in the references as the same characters (same face, body, clothing). Treat spaces as the same locations (same architecture, lighting, props). Treat objects as the same items.\n\nNow generate a NEW image with the following scene description, while keeping the identity of any subject from the reference images consistent:\n\n${fullPrompt}`
    parts.push({ text: refInstruction })
  } else {
    parts.push({ text: fullPrompt })
  }

  // Gemini 지원 비율로 변환
  const geminiRatio = (() => {
    const supported = ['21:9','16:9','4:3','3:2','1:1','9:16','3:4','2:3','5:4','4:5']
    return supported.includes(aspectRatio) ? aspectRatio : '16:9'
  })()

  // 단일 호출 — 503/429/500 자동 재시도 (지수 백오프, 최대 3회)
  const reqBody = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: geminiRatio },
    },
  })
  async function callOnce(callNo: number): Promise<{ b64: string; mimeType: string } | null> {
    let lastError = ''
    for (let retry = 0; retry < 3; retry++) {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
        { method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, body: reqBody },
      )
      if (res.ok) {
        const json = await res.json()
        for (const cand of json.candidates ?? []) {
          for (const part of cand.content?.parts ?? []) {
            if (part.inlineData?.data) {
              return { b64: part.inlineData.data, mimeType: part.inlineData.mimeType ?? 'image/png' }
            }
          }
        }
        return null  // 200 OK 인데 이미지 없음 — 빈 응답 (검열 가능성)
      }
      const body = await res.text()
      lastError = body
      // 재시도 가능한 코드: 503 / 429 / 500
      if (res.status === 503 || res.status === 429 || res.status === 500) {
        const wait = 1500 * Math.pow(2, retry)  // 1.5s → 3s → 6s
        console.warn(`[NanoBanana] call#${callNo} status=${res.status}, retry ${retry + 1}/3 in ${wait}ms`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      throw new Error(formatNanobananaError(res.status, body))
    }
    throw new Error(formatNanobananaError(503, lastError || '{}'))
  }

  const results = await Promise.allSettled(
    Array.from({ length: count }, (_, i) => callOnce(i + 1))
  )
  const images: Array<{ b64: string; mimeType: string }> = []
  const errors: string[] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) images.push(r.value)
    else if (r.status === 'rejected') errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
  }
  // 전부 실패면 첫 에러 throw, 부분 성공이면 진행
  if (images.length === 0 && errors.length > 0) throw new Error(errors[0])
  if (errors.length > 0) console.warn(`[NanoBanana] ${images.length}/${count} 성공 — 일부 실패: ${errors[0].slice(0, 150)}`)
  return images
}

export async function POST(req: NextRequest) {
  const {
    attemptId, prompt, negativePrompt, engine, projectId, sceneId, aspectRatio,
    referenceImageUrls,   // string[] | undefined — 레퍼런스 이미지 URL 목록
    count: rawCount,      // number | undefined — 1~4
    quality: rawQuality,  // '1K' | '2K' | '4K' | undefined
  } = await req.json()
  const count: number = Math.max(1, Math.min(4, Number(rawCount) || 4))
  const quality: '1K' | '2K' | '4K' =
    rawQuality === '2K' || rawQuality === '4K' ? rawQuality : '1K'
  const admin = createAdminClient()

  const errorDetail = ''

  try {
    let imageUrls: string[] = []

    if (engine === 'nanobanana') {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다. 서버를 재시작했는지 확인하세요.')

      // 레퍼런스 이미지 base64 변환 (있는 경우) — Gemini 2.5 Flash Image는 다중 이미지 지원
      let referenceImages: Array<{ b64: string; mimeType: string }> | undefined
      if (Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0) {
        const targetUrls = referenceImageUrls.slice(0, 8) // 최대 8장
        console.log(`[T2I] 레퍼런스 ${referenceImageUrls.length}장 요청 → ${targetUrls.length}장 fetch 시도`)
        const fetched = await Promise.allSettled(
          targetUrls.map((url: string) => fetchImageAsBase64(url))
        )
        referenceImages = fetched
          .filter((r): r is PromiseFulfilledResult<{ b64: string; mimeType: string }> => r.status === 'fulfilled')
          .map(r => r.value)
        fetched.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.warn(`[T2I] 레퍼런스 fetch 실패: ${targetUrls[i]} —`, r.reason instanceof Error ? r.reason.message : r.reason)
          }
        })
        console.log(`[T2I] 레퍼런스 이미지 ${referenceImages.length}/${targetUrls.length}장 base64 첨부 완료`)
      }

      const images = await generateViaNanobanana(apiKey, prompt, aspectRatio ?? '16:9', count, referenceImages)

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
        body: JSON.stringify({ prompt, n: count }),
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

    } else if (engine === 'gpt-image' || engine === 'gpt-image-1' || engine === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다. .env.local에 키를 추가하고 서버를 재시작하세요.')

      // 레퍼런스 이미지 base64 변환 (있는 경우)
      let referenceImages: Array<{ b64: string; mimeType: string }> | undefined
      if (Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0) {
        const fetched = await Promise.allSettled(
          referenceImageUrls.slice(0, 5).map((url: string) => fetchImageAsBase64(url))
        )
        referenceImages = fetched
          .filter((r): r is PromiseFulfilledResult<{ b64: string; mimeType: string }> => r.status === 'fulfilled')
          .map(r => r.value)
        console.log(`[T2I/openai] 레퍼런스 ${referenceImages.length}장 첨부`)
      }

      const images = await generateViaOpenAI(apiKey, prompt, aspectRatio ?? '16:9', count, referenceImages)
      if (images.length === 0) throw new Error('OpenAI에서 이미지가 생성되지 않았습니다.')

      for (const img of images) {
        const url = await uploadBase64(admin, img.b64, img.mimeType, projectId, attemptId)
        imageUrls.push(url)
      }
      console.log(`[T2I] gpt-image-1으로 ${imageUrls.length}장 생성 완료`)

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
    console.error('[T2I] generate 실패:', msg)
    await markAttemptFailed(admin, attemptId, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
