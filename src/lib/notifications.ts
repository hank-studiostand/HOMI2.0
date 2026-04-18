/**
 * 생성 완료 알림 유틸리티
 * - 브라우저 알림 (Notification API)
 * - Slack 웹훅 전송
 */

export type NotifType = 't2i' | 'i2v' | 't2v'

interface NotifOptions {
  type: NotifType
  sceneName?: string
  status: 'done' | 'failed'
  message?: string
  projectName?: string
  slackWebhookUrl?: string
}

const TYPE_LABEL: Record<NotifType, string> = {
  t2i: '이미지 생성',
  i2v: '영상 생성',
  t2v: 'T2V 생성',
}

/** 브라우저 알림 권한 요청 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  const result = await Notification.requestPermission()
  return result === 'granted'
}

/** 브라우저 알림 발송 */
function sendBrowserNotification(options: NotifOptions) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  const label   = TYPE_LABEL[options.type]
  const scene   = options.sceneName ? ` — ${options.sceneName}` : ''
  const project = options.projectName ? `[${options.projectName}] ` : ''

  const title = options.status === 'done'
    ? `${project}${label} 완료${scene}`
    : `${project}${label} 실패${scene}`

  const body = options.status === 'done'
    ? '결과를 확인해보세요.'
    : options.message ?? '생성 중 오류가 발생했습니다.'

  const icon = '/favicon.ico'

  try {
    const notif = new Notification(title, { body, icon })
    notif.onclick = () => { window.focus(); notif.close() }
  } catch (err) {
    console.warn('[notifications] 브라우저 알림 발송 실패:', err)
  }
}

/** Slack 웹훅 전송 */
async function sendSlackNotification(options: NotifOptions) {
  if (!options.slackWebhookUrl) return

  const label   = TYPE_LABEL[options.type]
  const scene   = options.sceneName ? `*씬:* ${options.sceneName}` : ''
  const project = options.projectName ? `*프로젝트:* ${options.projectName}\n` : ''

  const text = options.status === 'done'
    ? `:white_check_mark: *${label} 완료*\n${project}${scene}`
    : `:x: *${label} 실패*\n${project}${scene}\n${options.message ?? ''}`

  try {
    const res = await fetch(options.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      console.warn('[notifications] Slack 웹훅 응답 ' + res.status)
    }
  } catch (err) {
    console.warn('[notifications] Slack 웹훅 전송 실패:', err)
  }
}

/** 통합 알림 발송 (브라우저 + Slack) */
export async function sendGenerationNotification(options: NotifOptions) {
  sendBrowserNotification(options)
  if (options.slackWebhookUrl) {
    sendSlackNotification(options)
  }
}

/** localStorage에서 Slack 웹훅 URL 로드 */
export function getSlackWebhookUrl(projectId: string): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(`slack-webhook-${projectId}`) ?? ''
}

/** localStorage에 Slack 웹훅 URL 저장 */
export function setSlackWebhookUrl(projectId: string, url: string) {
  if (typeof window === 'undefined') return
  if (url) {
    localStorage.setItem(`slack-webhook-${projectId}`, url)
  } else {
    localStorage.removeItem(`slack-webhook-${projectId}`)
  }
}

/** 알림 활성화 여부 로드 */
export function getNotificationsEnabled(projectId: string): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(`notif-enabled-${projectId}`) !== 'false'
}

/** 알림 활성화 여부 저장 */
export function setNotificationsEnabled(projectId: string, enabled: boolean) {
  if (typeof window === 'undefined') return
  localStorage.setItem(`notif-enabled-${projectId}`, String(enabled))
}
