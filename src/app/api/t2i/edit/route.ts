import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// base64 이미지 → Supabase Storage 업로드 → public URL
async function uploadBase64(
  admin: ReturnType<typeof createAdminClient>,
  b64: string,
  mimeType: string,
  projectId: string,
  sceneId: string,
): Promise<string> {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const path = `t2i/${projectId}/${sceneId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  const buf = Buffer.from(b64, 'base64')
  const { data, error } = await admin.storage.from('assets').upload(path, buf, {
    contentType: mimeType,
    upsert: false,
  })
  if (error) throw new Error(`Storage 업로드 실패: ${error.message}`)
  const { data: { publicUrl } } = admin.storage.from('assets').getPublicUrl(data.path)
  return publicUrl
}

// 외부 URL → base64 인코딩
async function fetchImageAsBase64(url: string): Promise<{ b64: string; mimeType: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`이미지 가져오기 실패 (${res.status}): ${url}`)
  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  const buffer = await res.arrayBuffer()
  return {
    b64: Buffer.from(buffer).toString('base64'),
    mimeType: contentType.split(';')[0].trim(),
  }
}

// Gemini 2.5 Flash Image를 사용한 이미지 편집 (Nano Banana)
async function editViaGemini(
  apiKey: string,
  sourceImageBase64: string,
  sourceImageMimeType: string,
  editPrompt: string,
): Promise<{ b64: string; mimeType: string }> {
  const fullPrompt = `Edit this image according to the following instructions:\n\n${editPrompt}`

  const parts: any[] = [
    {
      inlineData: {
        mimeType: sourceImageMimeType,
        data: sourceImageBase64,
      },
    },
    {
      text: fullPrompt,
    },
  ]

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Gemini API 오류 ${response.status}: ${body}`)
  }

  const json = await response.json()
  for (const candidate of json.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return {
          b64: part.inlineData.data,
          mimeType: part.inlineData.mimeType ?? 'image/png',
        }
      }
    }
  }

  throw new Error('편집된 이미지를 생성하지 못했습니다.')
}

export async function POST(req: NextRequest) {
  const { sourceImageUrl, editPrompt, projectId, sceneId, count = 1 } = await req.json() as {
    sourceImageUrl: string
    editPrompt: string
    projectId: string
    sceneId?: string
    count?: number
  }
  const admin = createAdminClient()
  const n = Math.max(1, Math.min(8, count))

  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.')

    // 원본 이미지를 base64로 가져오기 (한 번만 fetch)
    const { b64: sourceb64, mimeType: sourceMimeType } = await fetchImageAsBase64(sourceImageUrl)

    // 씬 바운드인 경우 prompt_attempt 생성 (최근 결과 탭에 노출되도록)
    let attemptId: string | null = null
    if (sceneId) {
      const { data: attempt } = await admin
        .from('prompt_attempts')
        .insert({
          scene_id: sceneId,
          type: 't2i',
          engine: 'nanobanana',
          prompt: `[edit] ${editPrompt}`,
          status: 'generating',
          depth: 0,
        })
        .select('id')
        .single()
      attemptId = attempt?.id ?? null
    }

    // n장 병렬 생성
    const generated = await Promise.allSettled(
      Array.from({ length: n }, () => editViaGemini(apiKey, sourceb64, sourceMimeType, editPrompt))
    )
    const succeeded = generated
      .filter((r): r is PromiseFulfilledResult<{ b64: string; mimeType: string }> => r.status === 'fulfilled')
      .map(r => r.value)

    if (succeeded.length === 0) {
      if (attemptId) await admin.from('prompt_attempts').update({ status: 'failed' }).eq('id', attemptId)
      throw new Error('편집된 이미지를 생성하지 못했습니다.')
    }

    const assets: any[] = []
    for (const img of succeeded) {
      const editedUrl = await uploadBase64(admin, img.b64, img.mimeType, projectId, sceneId ?? projectId)
      const { data: asset, error: assetErr } = await admin
        .from('assets')
        .insert({
          project_id: projectId,
          scene_id: sceneId ?? null,
          type: 't2i',
          name: `edited_${Date.now()}_${assets.length + 1}`,
          url: editedUrl,
          thumbnail_url: editedUrl,
          tags: ['t2i-edit'],
          metadata: {
            source_image_url: sourceImageUrl,
            edit_prompt: editPrompt,
            engine: 'nanobanana',
          },
          attempt_id: attemptId,
        })
        .select()
        .single()
      if (assetErr) {
        console.error('[t2i/edit] asset insert err:', assetErr.message)
        continue
      }
      if (asset && attemptId) {
        await admin.from('attempt_outputs').insert({ attempt_id: attemptId, asset_id: asset.id })
      }
      if (asset) assets.push(asset)
    }

    if (attemptId) {
      await admin.from('prompt_attempts').update({ status: 'done' }).eq('id', attemptId)
    }

    return NextResponse.json({ success: true, assets, attemptId })
  } catch (err) {
    return NextResponse.json({ error: `편집 실패: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 })
  }
}
