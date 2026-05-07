/**
 * 생성 완료 알림 유틸리티
 * - 브라우저 알림 (Notification API)
 * - Slack 웹훅 전송
 *
 * Slack 메시지 포맷 (사용자 요청):
 *   프로젝트명 - 씬넘버 - 씬이름 - N차 시도 - 성공/실패
 */

export type NotifType = 't2i' | 'i2v' | 't2v' | 'lipsync'

interface NotifOptions {
  type: NotifType
  status: 'done' | 'failed'
  message?: string
  projectName?: string
  sceneNumber?: string
  sceneName?: string
  attemptNumber?: number
  slackWebhookUrl?: string
}

const TYPE_LABEL: Record<NotifType, string> = {
  t2i: '이미지 생성',
  i2v: '영상 생성',
  t2v: 'T2V 생성',
  lipsync: '립싱크',
}

function buildFormattedLine(o: NotifOptions): string {
  const parts: string[] = []
  if (o.projectName)  parts.push(o.projectName)
  if (o.sceneNumber)  parts.push(`#${o.sceneNumber}`)
  if (o.sceneName)    parts.push(o.sceneName)
  if (o.attemptNumber && o.attemptNumber > 0) parts.push(`${o.attemptNumber}차 시도`)
  parts.push(o.status === 'done' ? '성공' : '실패')
  return parts.join(' - ')
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  const result = await Notification.requestPermission()
  return result === 'granted'
}

function sendBrowserNotification(options: NotifOptions) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return

  const label = TYPE_LABEL[options.type]
  const formatted = buildFormattedLine(options)
  const title = `${label} ${options.status === 'done' ? '완료' : '실패'}`
  const body = options.status === 'done'
    ? formatted
    : `${formatted}\n${options.message ?? ''}`.trim()

  try {
    const notif = new Notification(title, { body, icon: '/favicon.ico' })
    notif.onclick = () => { window.focus(); notif.close() }
  } catch (err) {
    console.warn('[notifications] 브라우저 알림 발송 실패:', err)
  }
}

async function sendSlackNotification(options: NotifOptions) {
  if (!options.slackWebhookUrl) return
  const label = TYPE_LABEL[options.type]
  const formatted = buildFormattedLine(options)
  const emoji = options.status === 'done' ? ':white_check_mark:' : ':x:'
  const text = options.status === 'done'
    ? `${emoji} *${label}*  ${formatted}`
    : `${emoji} *${label}*  ${formatted}${options.message ? `\n> ${options.message}` : ''}`

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

export async function sendGenerationNotification(options: NotifOptions) {
  sendBrowserNotification(options)
  if (options.slackWebhookUrl) {
    await sendSlackNotification(options)
  }
}

export function getSlackWebhookUrl(projectId: string): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(`slack-webhook-${projectId}`) ?? ''
}

export function setSlackWebhookUrl(projectId: string, url: string) {
  if (typeof window === 'undefined') return
  if (url) {
    localStorage.setItem(`slack-webhook-${projectId}`, url)
  } else {
    localStorage.removeItem(`slack-webhook-${projectId}`)
  }
}

export function getNotificationsEnabled(projectId: string): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(`notif-enabled-${projectId}`) !== 'false'
}

export function setNotificationsEnabled(projectId: string, enabled: boolean) {
  if (typeof window === 'undefined') return
  localStorage.setItem(`notif-enabled-${projectId}`, String(enabled))
}
