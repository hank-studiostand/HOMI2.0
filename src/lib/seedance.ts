// Bytedance ARK / BytePlus "Dreamina SeeDance 2.0" 비디오 생성 헬퍼
// — T2V / I2V / R2V (reference-to-video) 공통 진입점
// — 비동기 task 생성 → 5초 간격 polling
//
// API 포맷 (BytePlus 공식 샘플 기준):
//   POST /api/v3/contents/generations/tasks
//   Body: {
//     model: "dreamina-seedance-2-0-260128",
//     content: [
//       { type: "text", text: "..." },
//       { type: "image_url", image_url: { url: "..." }, role: "reference_image" },
//       ...
//     ],
//     ratio: "16:9",        ← prompt에 --ratio 안 붙임
//     duration: 5,
//     watermark: false,
//     generate_audio: false,
//   }
//
// 환경변수:
//   SEEDANCE_API_KEY        — Bearer 토큰
//   SEEDANCE_BASE_URL       — 'https://ark.ap-southeast.bytepluses.com/api/v3' (BytePlus 국제) 또는
//                             'https://ark.cn-beijing.volces.com/api/v3' (Volcengine 중국)
//   SEEDANCE_MODEL_T2V      — 텍스트→비디오 모델 ID (기본 dreamina-seedance-2-0-260128)
//   SEEDANCE_MODEL_I2V      — 이미지→비디오 모델 ID

const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3'
const DEFAULT_MODEL_T2V = 'dreamina-seedance-2-0-260128'
const DEFAULT_MODEL_I2V = 'dreamina-seedance-2-0-260128'

interface SeedanceParams {
  prompt: string
  duration?: number              // 초 단위 (5 / 10 / 15 등 모델 지원 범위)
  resolution?: '480p' | '720p' | '1080p'   // 해상도 (지원 시)
  aspectRatio?: string           // '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
  cameraFixed?: boolean
  watermark?: boolean
  generateAudio?: boolean        // BGM/효과음 자동 생성 (지원 모델 한정)
}

interface ContentPart {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url'
  text?: string
  image_url?: { url: string }
  video_url?: { url: string }
  audio_url?: { url: string }
  role?: 'reference_image' | 'reference_video' | 'reference_audio' | 'first_frame' | 'last_frame'
}

function getEnv(): { apiKey: string; baseUrl: string } {
  const apiKey = process.env.SEEDANCE_API_KEY ?? ''
  const baseUrl = (process.env.SEEDANCE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  if (!apiKey) throw new Error('SEEDANCE_API_KEY 가 설정되지 않았습니다. .env.local 확인 후 서버 재시작.')
  return { apiKey, baseUrl }
}

interface CreateTaskBody {
  model: string
  content: ContentPart[]
  ratio?: string
  duration?: number
  resolution?: string
  watermark?: boolean
  camerafixed?: boolean
  generate_audio?: boolean
}

async function createTask(body: CreateTaskBody): Promise<string> {
  const { apiKey, baseUrl } = getEnv()
  const res = await fetch(`${baseUrl}/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Seedance create ${res.status}: ${text.slice(0, 600)}`)
  let json: any
  try { json = JSON.parse(text) } catch { throw new Error(`Seedance create JSON 파싱 실패: ${text.slice(0, 300)}`) }
  const taskId = json.id ?? json.task_id ?? json.data?.id ?? json.data?.task_id
  if (!taskId) throw new Error(`Seedance: task_id 미반환 — ${text.slice(0, 400)}`)
  return String(taskId)
}

// 5분 동안 5초 간격으로 polling — 60회
async function pollTask(taskId: string, maxAttempts = 60, intervalMs = 5_000): Promise<string> {
  const { apiKey, baseUrl } = getEnv()
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs))
    const res = await fetch(`${baseUrl}/contents/generations/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    const text = await res.text()
    if (!res.ok) {
      console.warn(`[Seedance] poll ${i + 1} ${res.status}: ${text.slice(0, 200)}`)
      continue
    }
    let json: any
    try { json = JSON.parse(text) } catch { continue }
    const status = (json.status ?? json.data?.status ?? '').toString().toLowerCase()
    console.log(`[Seedance] poll #${i + 1} status=${status}`)

    if (status === 'succeeded' || status === 'success' || status === 'succeed') {
      const url = json.content?.video_url
              ?? json.data?.content?.video_url
              ?? json.data?.video_url
              ?? json.video_url
      if (!url) throw new Error(`Seedance: succeeded but video URL missing — ${text.slice(0, 400)}`)
      return String(url)
    }
    if (status === 'failed' || status === 'fail' || status === 'cancelled' || status === 'canceled') {
      const reason = json.error?.message ?? json.data?.error?.message ?? text.slice(0, 300)
      throw new Error(`Seedance task ${status}: ${reason}`)
    }
  }
  throw new Error(`Seedance polling timeout (${(maxAttempts * intervalMs) / 1000}s)`)
}

function buildExtraParams(p: SeedanceParams): Partial<CreateTaskBody> {
  const out: Partial<CreateTaskBody> = {}
  if (p.aspectRatio) out.ratio = p.aspectRatio
  if (p.duration)    out.duration = p.duration
  if (p.resolution)  out.resolution = p.resolution
  if (p.watermark !== undefined)   out.watermark = p.watermark
  if (p.cameraFixed !== undefined) out.camerafixed = p.cameraFixed
  if (p.generateAudio !== undefined) out.generate_audio = p.generateAudio
  return out
}

// ── T2V (텍스트만) — 레퍼런스 이미지 옵션으로 추가 가능 (R2V) ──────
export async function generateSeedanceT2V(
  params: SeedanceParams & { referenceImageUrls?: string[] },
): Promise<string> {
  const model = process.env.SEEDANCE_MODEL_T2V || DEFAULT_MODEL_T2V
  const content: ContentPart[] = [{ type: 'text', text: params.prompt }]
  if (params.referenceImageUrls && params.referenceImageUrls.length > 0) {
    for (const url of params.referenceImageUrls.slice(0, 4)) {
      content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
    }
  }
  const taskId = await createTask({
    model,
    content,
    ...buildExtraParams(params),
    watermark: params.watermark ?? false,
  })
  return await pollTask(taskId)
}

// ── I2V (이미지 → 비디오) ────────────────────────────────────────
// Seedance가 외부 URL fetch 시 'UnsupportedImageFormat' 에러를 자주 내므로
// 서버에서 직접 fetch → base64 data URL로 변환해서 전달.
// 외부 이미지 URL → base64 data URL (CDN UnsupportedImageFormat 회피용)
async function urlToBase64DataUrl(url: string, label: string): Promise<string> {
  try {
    const r = await fetch(url)
    if (!r.ok) {
      throw new Error(`${label} fetch 실패 (${r.status}): ${url.slice(0, 120)}`)
    }
    const ct = (r.headers.get('content-type') ?? '').toLowerCase().split(';')[0].trim()
    if (ct.startsWith('video/') || ct.startsWith('audio/')) {
      throw new Error(`${label}는 이미지여야 합니다. 받은 형식: ${ct}`)
    }
    const buf = Buffer.from(await r.arrayBuffer())
    const safeMime = (ct === 'image/png' || ct === 'image/jpeg' || ct === 'image/jpg' || ct === 'image/webp')
      ? ct
      : 'image/jpeg'
    const dataUrl = `data:${safeMime};base64,${buf.toString('base64')}`
    console.log(`[seedance] ${label} 변환: ${ct || 'unknown'} → ${safeMime}, ${(buf.length / 1024).toFixed(0)}KB`)
    return dataUrl
  } catch (e) {
    console.warn(`[seedance] ${label} base64 변환 실패, URL 그대로 시도:`, e instanceof Error ? e.message : e)
    return url
  }
}

export async function generateSeedanceI2V(
  params: SeedanceParams & { imageUrl: string; endImageUrl?: string | null },
): Promise<string> {
  const model = process.env.SEEDANCE_MODEL_I2V || DEFAULT_MODEL_I2V

  const startRef = await urlToBase64DataUrl(params.imageUrl, 'start_frame')
  const endRef = params.endImageUrl
    ? await urlToBase64DataUrl(params.endImageUrl, 'end_frame')
    : null

  const content: ContentPart[] = [
    { type: 'text', text: params.prompt },
    { type: 'image_url', image_url: { url: startRef }, role: 'first_frame' },
  ]
  if (endRef) {
    content.push({ type: 'image_url', image_url: { url: endRef }, role: 'last_frame' })
  }
  const taskId = await createTask({
    model,
    content,
    ...buildExtraParams(params),
    watermark: params.watermark ?? false,
  })
  return await pollTask(taskId)
}
