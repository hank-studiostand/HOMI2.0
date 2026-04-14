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
  const { sourceImageUrl, editPrompt, projectId, sceneId } = await req.json()
  const admin = createAdminClient()

  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.')
    }

    // 원본 이미지를 base64로 가져오기
    const { b64: sourceb64, mimeType: sourceMimeType } = await fetchImageAsBase64(sourceImageUrl)

    // Gemini를 통해 이미지 편집
    const { b64: editedBase64, mimeType: editedMimeType } = await editViaGemini(
      apiKey,
      sourceb64,
      sourceMimeType,
      editPrompt
    )

    // 편집된 이미지를 Storage에 업로드
    const editedUrl = await uploadBase64(admin, editedBase64, editedMimeType, projectId, sceneId ?? projectId)

    // Asset 레코드 생성
    const { data: asset, error: assetErr } = await admin
      .from('assets')
      .insert({
        project_id: projectId,
        scene_id: sceneId ?? null,
        type: 't2i',
        name: `edited_${Date.now()}`,
        url: editedUrl,
        thumbnail_url: editedUrl,
        tags: ['t2i-edit'],
        metadata: {
          source_image_url: sourceImageUrl,
          edit_prompt: editPrompt,
          engine: 'nanobanana',
        },
      })
      .select()
      .single()

    if (assetErr) {
      throw new Error(`Asset 저장 실패: ${assetErr.message}`)
    }

    return NextResponse.json({ success: true, asset })
  } catch (err) {
    return NextResponse.json({ error: `편집 실패: ${String(err)}` }, { status: 500 })
  }
}
