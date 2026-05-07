// OpenAI gpt-image-1 헬퍼
// - 레퍼런스 이미지 있으면 /v1/images/edits (멀티파트)
// - 없으면 /v1/images/generations (JSON)
// - 응답은 항상 base64 (gpt-image-1 기본)

const OPENAI_BASE = 'https://api.openai.com/v1'
// 품질: gpt-image-1은 'low' / 'medium' / 'high' / 'auto' 지원. 기본은 medium 수준.
// 'high'로 명시하면 디테일/선명도 크게 향상 (토큰 비용 ~2배).
const OPENAI_QUALITY = (process.env.OPENAI_IMAGE_QUALITY ?? 'high') as 'low' | 'medium' | 'high' | 'auto'

// 화면비 → OpenAI 지원 사이즈
export function aspectRatioToOpenAISize(ratio: string): '1024x1024' | '1024x1536' | '1536x1024' {
  const r = (ratio ?? '').trim()
  // 정사각
  if (r === '1:1') return '1024x1024'
  // 세로
  if (['9:16', '4:5', '2:3', '3:4'].includes(r)) return '1024x1536'
  // 그 외는 가로 (16:9, 21:9, 4:3, 3:2, 2.35:1, 2.39:1, 5:4 등)
  return '1536x1024'
}

export interface OpenAIImageResult {
  b64: string
  mimeType: string
}

// ── /v1/images/generations (텍스트 → 이미지) ──────────────────
async function callGenerations(
  apiKey: string,
  prompt: string,
  size: string,
  n: number,
): Promise<OpenAIImageResult[]> {
  const res = await fetch(`${OPENAI_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n,
      size,
      quality: OPENAI_QUALITY,
      output_format: 'png',
      // gpt-image-1은 항상 b64_json 반환 — response_format 파라미터 없음
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI generations ${res.status}: ${body.slice(0, 600)}`)
  }
  const json = await res.json()
  const data: any[] = json.data ?? []
  return data
    .filter(d => typeof d?.b64_json === 'string')
    .map(d => ({ b64: d.b64_json as string, mimeType: 'image/png' }))
}

// ── /v1/images/edits (레퍼런스 이미지 + 프롬프트) ─────────────
async function callEdits(
  apiKey: string,
  prompt: string,
  size: string,
  n: number,
  referenceImages: OpenAIImageResult[],
): Promise<OpenAIImageResult[]> {
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('prompt', prompt)
  form.append('n', String(n))
  form.append('size', size)
  form.append('quality', OPENAI_QUALITY)
  form.append('output_format', 'png')

  // 레퍼런스 이미지 — 최대 ~10장까지 image[] 으로 첨부
  for (let i = 0; i < referenceImages.length; i++) {
    const img = referenceImages[i]
    const buf = Buffer.from(img.b64, 'base64')
    const ext = img.mimeType === 'image/jpeg' ? 'jpg' : 'png'
    // Node 18+ Blob 사용
    const blob = new Blob([new Uint8Array(buf)], { type: img.mimeType })
    form.append('image[]', blob, `ref_${i}.${ext}`)
  }

  const res = await fetch(`${OPENAI_BASE}/images/edits`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },  // Content-Type은 FormData가 자동 설정
    body: form,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI edits ${res.status}: ${body.slice(0, 600)}`)
  }
  const json = await res.json()
  const data: any[] = json.data ?? []
  return data
    .filter(d => typeof d?.b64_json === 'string')
    .map(d => ({ b64: d.b64_json as string, mimeType: 'image/png' }))
}

// ── 외부 진입점 ────────────────────────────────────────────────
export async function generateViaOpenAI(
  apiKey: string,
  prompt: string,
  aspectRatio: string,
  count: number,
  referenceImages?: OpenAIImageResult[],
): Promise<OpenAIImageResult[]> {
  if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.')
  const size = aspectRatioToOpenAISize(aspectRatio)
  const n = Math.max(1, Math.min(10, count))

  // OpenAI는 한 번 호출에서 여러 장 생성 가능 (n 파라미터)
  if (referenceImages && referenceImages.length > 0) {
    return await callEdits(apiKey, prompt, size, n, referenceImages)
  }
  return await callGenerations(apiKey, prompt, size, n)
}
