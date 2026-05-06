// Bytedance ARK / Volcengine "Doubao SeeDance" 비디오 생성 헬퍼
// — T2V / I2V 공통 진입점
// — 비동기 task 생성 → polling
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
  duration?: number      // 초 단위 — 보통 5 또는 10
  resolution?: '480p' | '720p' | '1080p'
  aspectRatio?: string   // '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
  cameraFixed?: boolean
  watermark?: boolean
  imageUrl?: string      // I2V에서만 사용 (없으면 T2V로 동작)
}

interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

function getEnv(): { apiKey: string; baseUrl: string } {
  const apiKey = process.env.SEEDANCE_API_KEY ?? ''
  const baseUrl = (process.env.SEEDANCE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  if (!apiKey) throw new Error('SEEDANCE_API_KEY 가 설정되지 않았습니다. .env.local 확인 후 서버 재시작.')
  return { apiKey, baseUrl }
}

// 컨트롤 플래그를 prompt 뒤에 --key value 형식으로 붙이는 게 ARK 컨벤션
function buildPromptWithFlags(p: SeedanceParams): string {
  const flags: string[] = []
  if (p.duration)              flags.push(`--duration ${p.duration}`)
  if (p.resolution)            flags.push(`--resolution ${p.resolution}`)
  if (p.aspectRatio)           flags.push(`--ratio ${p.aspectRatio}`)
  if (p.cameraFixed !== undefined) flags.push(`--camerafixed ${p.cameraFixed ? 'true' : 'false'}`)
  if (p.watermark !== undefined)   flags.push(`--watermark ${p.watermark ? 'true' : 'false'}`)
  return flags.length > 0 ? `${p.prompt} ${flags.join(' ')}` : p.prompt
}

async function createTask(model: string, content: ContentPart[]): Promise<string> {
  const { apiKey, baseUrl } = getEnv()
  const res = await fetch(`${baseUrl}/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, content }),
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

// ── T2V ─────────────────────────────────────────────────────────
export async function generateSeedanceT2V(params: SeedanceParams): Promise<string> {
  const model = process.env.SEEDANCE_MODEL_T2V || DEFAULT_MODEL_T2V
  const text = buildPromptWithFlags(params)
  const taskId = await createTask(model, [{ type: 'text', text }])
  return await pollTask(taskId)
}

// ── I2V ─────────────────────────────────────────────────────────
export async function generateSeedanceI2V(params: SeedanceParams & { imageUrl: string }): Promise<string> {
  const model = process.env.SEEDANCE_MODEL_I2V || DEFAULT_MODEL_I2V
  const text = buildPromptWithFlags(params)
  const taskId = await createTask(model, [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: params.imageUrl } },
  ])
  return await pollTask(taskId)
}
