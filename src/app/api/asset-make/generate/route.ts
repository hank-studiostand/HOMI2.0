import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ── 화면비 → Gemini 지원 매핑 ────────────────────────────────
const SUPPORTED_GEMINI = ['21:9','16:9','4:3','3:2','1:1','9:16','3:4','2:3','5:4','4:5']

const RATIO_SUFFIX: Record<string, string> = {
  '16:9':   'widescreen 16:9 aspect ratio',
  '9:16':   'vertical 9:16 aspect ratio portrait',
  '1:1':    'square 1:1 aspect ratio',
  '4:3':    '4:3 aspect ratio',
  '3:2':    '3:2 aspect ratio',
  '4:5':    '4:5 aspect ratio portrait',
  '21:9':   'ultra-wide 21:9 cinematic aspect ratio',
}

// ── 외부 URL → base64 ──────────────────────────────────────────
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

// ── base64 → Storage 업로드 ────────────────────────────────────
async function uploadBase64(
  admin: ReturnType<typeof createAdminClient>,
  b64: string,
  mimeType: string,
  projectId: string,
): Promise<string> {
  const ext  = mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const path = `asset-make/${projectId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  const buf  = Buffer.from(b64, 'base64')
  const { data, error } = await admin.storage.from('assets').upload(path, buf, {
    contentType: mimeType, upsert: false,
  })
  if (error) throw new Error(`Storage 업로드 실패: ${error.message}`)
  const { data: { publicUrl } } = admin.storage.from('assets').getPublicUrl(data.path)
  return publicUrl
}

// ── Gemini 2.5 Flash Image (나노바나나) ───────────────────────
async function generateViaNanobanana(
  apiKey: string,
  prompt: string,
  aspectRatio: string,
  count: number,
  referenceImages?: Array<{ b64: string; mimeType: string }>,
): Promise<Array<{ b64: string; mimeType: string }>> {
  const ratioSuffix = RATIO_SUFFIX[aspectRatio] ?? 'widescreen 16:9 aspect ratio'
  const fullPrompt  = `${prompt}\n\n${ratioSuffix}`

  const parts: any[] = []
  if (referenceImages && referenceImages.length > 0) {
    for (const img of referenceImages) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.b64 } })
    }
    parts.push({
      text: `Use the above reference image(s) as a visual style and composition guide. Generate a new image based on the following description:\n\n${fullPrompt}`,
    })
  } else {
    parts.push({ text: fullPrompt })
  }

  const geminiRatio = SUPPORTED_GEMINI.includes(aspectRatio) ? aspectRatio : '16:9'

  // 1회 호출당 1장 → count장 병렬 호출
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
      console.error(`[asset-make] NanoBanana ${res.status}:`, body.slice(0, 300))
      continue
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

// ── POST ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const {
      projectId,
      prompt,
      cameraTokens,        // string — 앵글/렌즈/조명 등 영문 토큰을 콤마로 join한 문자열
      mood,                // string — 무드(자유 텍스트)
      aspectRatio,         // string
      count,               // number — 생성 매수 (기본 4)
      engine,              // 'nanobanana' (현재 유일)
      referenceImageUrls,  // string[]
      name,                // string — 사용자가 지정한 이름 (선택, 없으면 prompt 앞 30자)
    } = await req.json() as {
      projectId: string
      prompt: string
      cameraTokens?: string
      mood?: string
      aspectRatio?: string
      count?: number
      engine?: string
      referenceImageUrls?: string[]
      name?: string
    }

    if (!projectId)        return NextResponse.json({ error: 'projectId 필요' }, { status: 400 })
    if (!prompt?.trim())   return NextResponse.json({ error: '프롬프트가 비어있습니다' }, { status: 400 })

    const admin = createAdminClient()
    const eng = engine ?? 'nanobanana'
    const ratio = aspectRatio ?? '16:9'
    const n = Math.max(1, Math.min(8, count ?? 4))

    // 합성 프롬프트
    const fullPromptParts = [prompt.trim()]
    if (cameraTokens?.trim()) fullPromptParts.push(cameraTokens.trim())
    if (mood?.trim())         fullPromptParts.push(`mood: ${mood.trim()}`)
    const fullPrompt = fullPromptParts.join(', ')

    // 레퍼런스 이미지 base64
    let referenceImages: Array<{ b64: string; mimeType: string }> | undefined
    if (Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0) {
      const fetched = await Promise.allSettled(
        referenceImageUrls.slice(0, 3).map(url => fetchImageAsBase64(url))
      )
      referenceImages = fetched
        .filter((r): r is PromiseFulfilledResult<{ b64: string; mimeType: string }> => r.status === 'fulfilled')
        .map(r => r.value)
    }

    let images: Array<{ b64: string; mimeType: string }> = []
    if (eng === 'nanobanana') {
      const apiKey = process.env.GEMINI_API_KEY
      if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.')
      images = await generateViaNanobanana(apiKey, fullPrompt, ratio, n, referenceImages)
    } else {
      throw new Error(`${eng} 엔진은 에셋 메이킹에서 아직 지원되지 않습니다.`)
    }

    if (images.length === 0) {
      return NextResponse.json({ error: '이미지가 생성되지 않았습니다. 프롬프트를 수정해보세요.' }, { status: 500 })
    }

    // 업로드 + asset 등록
    const baseName = (name?.trim() || prompt.trim().slice(0, 30) || 'asset').replace(/\s+/g, '_')
    const created: Array<{ id: string; url: string; name: string }> = []
    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      const url = await uploadBase64(admin, img.b64, img.mimeType, projectId)
      const assetName = `${baseName}_${Date.now()}_${i + 1}.${img.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`
      const { data: asset, error: insErr } = await admin.from('assets').insert({
        project_id: projectId,
        scene_id: null,                 // 에셋 메이킹은 씬과 독립
        type: 'reference',              // 일반 프로젝트 에셋
        name: assetName,
        url,
        thumbnail_url: url,
        tags: ['asset-make'],
        metadata: {
          source: 'asset-make',
          engine: eng,
          prompt: fullPrompt,
          mood: mood ?? null,
          camera: cameraTokens ?? null,
          aspect_ratio: ratio,
          reference_count: referenceImages?.length ?? 0,
        },
      }).select('id, url, name').single()
      if (insErr) {
        console.error('[asset-make] asset insert 실패:', insErr.message)
        continue
      }
      if (asset) created.push({ id: asset.id, url: asset.url, name: asset.name })
    }

    // 프로젝트 updated_at 갱신
    try {
      await admin.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId)
    } catch {}

    return NextResponse.json({ success: true, assets: created, count: created.length })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[asset-make] 실패:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
