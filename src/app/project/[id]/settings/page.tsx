'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import {
  Bell, BellOff, MessageSquare, Save, CheckCircle2, AlertCircle,
  ExternalLink, Info, Webhook,
} from 'lucide-react'
import {
  getSlackWebhookUrl, setSlackWebhookUrl,
  getNotificationsEnabled, setNotificationsEnabled,
  requestNotificationPermission,
} from '@/lib/notifications'

// ── 섹션 래퍼 ───────────────────────────────────────────────────────────────
function Section({
  title, icon: Icon, children,
}: {
  title: string; icon: React.ElementType; children: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl border p-5 space-y-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: 'var(--accent)' }} />
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      </div>
      {children}
    </div>
  )
}

// ── 토글 ─────────────────────────────────────────────────────────────────────
function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="relative inline-flex items-center w-11 h-6 rounded-full transition-all"
      style={{ background: enabled ? 'var(--accent)' : 'var(--surface-3)', border: '1px solid var(--border)' }}
    >
      <span
        className="absolute w-4 h-4 rounded-full bg-white shadow-sm transition-all"
        style={{ left: enabled ? '22px' : '3px' }}
      />
    </button>
  )
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { id: projectId } = useParams<{ id: string }>()

  const [notifsEnabled, setNotifsEnabled]       = useState(false)
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>('default')

  const [slackUrl, setSlackUrl]                 = useState('')
  const [slackSaved, setSlackSaved]             = useState(false)
  const [slackTesting, setSlackTesting]         = useState(false)
  const [slackTestResult, setSlackTestResult]   = useState<'ok' | 'fail' | null>(null)

  useEffect(() => {
    setNotifsEnabled(getNotificationsEnabled(projectId))
    setSlackUrl(getSlackWebhookUrl(projectId))
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setBrowserPermission(Notification.permission)
    }
  }, [projectId])

  async function handleEnableNotifs(val: boolean) {
    if (val) {
      const granted = await requestNotificationPermission()
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setBrowserPermission(Notification.permission)
      }
      if (!granted) return
    }
    setNotifsEnabled(val)
    setNotificationsEnabled(projectId, val)
  }

  function handleSaveSlack() {
    setSlackWebhookUrl(projectId, slackUrl.trim())
    setSlackSaved(true)
    setSlackTestResult(null)
    setTimeout(() => setSlackSaved(false), 2000)
  }

  async function handleTestSlack() {
    const url = slackUrl.trim()
    if (!url) return
    setSlackTesting(true)
    setSlackTestResult(null)
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ':white_check_mark: *AI 영상 협업툴 — 테스트 알림*\nSlack 연동이 정상적으로 설정되었습니다!',
        }),
      })
      setSlackTestResult('ok')
    } catch (err) {
      console.error('[settings] Slack 테스트 실패:', err)
      setSlackTestResult('fail')
    } finally {
      setSlackTesting(false)
    }
  }

  const permissionLabel: Record<NotificationPermission, string> = {
    granted:  '허용됨',
    denied:   '차단됨 (브라우저 설정에서 변경)',
    default:  '미설정',
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>프로젝트 설정</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>알림 및 연동 설정</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-xl mx-auto space-y-5">

          {/* ── 브라우저 알림 ── */}
          <Section title="브라우저 알림" icon={Bell}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  이미지/영상 생성이 완료되거나 실패하면 브라우저 알림을 받습니다.
                </p>
                <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  <span>현재 권한:</span>
                  <span
                    style={{
                      color: browserPermission === 'granted' ? 'var(--success)'
                        : browserPermission === 'denied' ? 'var(--danger)'
                        : 'var(--warning)',
                    }}
                  >
                    {permissionLabel[browserPermission]}
                  </span>
                </div>
              </div>
              <Toggle enabled={notifsEnabled} onChange={handleEnableNotifs} />
            </div>

            {browserPermission === 'denied' && (
              <div
                className="flex items-start gap-2 p-3 rounded-lg text-xs"
                style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
              >
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                <span>
                  브라우저가 알림을 차단했습니다. 브라우저 주소줄 자물쇠 아이콘에서 알림을 허용으로 변경해주세요.
                </span>
              </div>
            )}

            {notifsEnabled && browserPermission === 'granted' && (
              <div
                className="flex items-center gap-2 p-3 rounded-lg text-xs"
                style={{ background: 'var(--success-bg)', border: '1px solid var(--success)', color: 'var(--success)' }}
              >
                <CheckCircle2 size={13} />
                <span>생성 완료 시 브라우저 알림을 받습니다.</span>
              </div>
            )}
          </Section>

          {/* ── Slack 웹훅 ── */}
          <Section title="Slack 알림 연동" icon={Webhook}>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Slack 인커밍 웹훅 URL을 등록하면 생성 완료/실패 시 자동으로 메시지를 보냅니다.
            </p>

            <div className="space-y-2">
              <label className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                Slack 인커밍 웹훅 URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={slackUrl}
                  onChange={e => { setSlackUrl(e.target.value); setSlackSaved(false); setSlackTestResult(null) }}
                  placeholder="https://hooks.slack.com/services/..."
                  className="flex-1 px-3 py-2 rounded-lg text-xs"
                  style={{
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveSlack}
                  disabled={!slackUrl.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                  style={{ background: 'var(--accent)', color: 'white' }}
                >
                  {slackSaved
                    ? <><CheckCircle2 size={12} /> 저장됨</>
                    : <><Save size={12} /> 저장</>
                  }
                </button>

                <button
                  onClick={handleTestSlack}
                  disabled={!slackUrl.trim() || slackTesting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs transition-all disabled:opacity-40 hover-surface"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  {slackTesting ? '전송 중...' : '테스트 전송'}
                </button>

                {slackTestResult === 'ok' && (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--success)' }}>
                    <CheckCircle2 size={12} /> 전송 성공
                  </span>
                )}
                {slackTestResult === 'fail' && (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--danger)' }}>
                    <AlertCircle size={12} /> 전송 실패
                  </span>
                )}
              </div>
            </div>

            <div
              className="flex items-start gap-2 p-3 rounded-lg text-xs"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}
            >
              <Info size={12} className="shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
              <div style={{ color: 'var(--text-muted)' }}>
                <p className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Slack 웹훅 설정 방법</p>
                <ol className="space-y-0.5 list-decimal list-inside">
                  <li>Slack 워크스페이스 &rarr; 앱 관리 &rarr; 인커밍 웹훅 검색 및 추가</li>
                  <li>채널 선택 &rarr; 웹훅 URL 복사</li>
                  <li>위 입력창에 붙여넣기 후 저장</li>
                </ol>
                <a
                  href="https://api.slack.com/messaging/webhooks"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 mt-2 hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  <ExternalLink size={10} /> Slack 공식 문서 보기
                </a>
              </div>
            </div>
          </Section>

          {/* ── 알림 미리보기 ── */}
          <Section title="알림 미리보기" icon={Bell}>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              생성 완료 시 아래와 같은 알림이 표시됩니다.
            </p>
            <div className="space-y-2">
              <div
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: 'var(--success-bg)', border: '1px solid var(--success)' }}
              >
                <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />
                <div>
                  <p className="text-xs font-medium" style={{ color: 'var(--success)' }}>이미지 생성 완료 — 씬 1</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>결과를 확인해보세요.</p>
                </div>
              </div>
              <div
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)' }}
              >
                <AlertCircle size={16} style={{ color: 'var(--danger)' }} />
                <div>
                  <p className="text-xs font-medium" style={{ color: 'var(--danger)' }}>영상 생성 실패 — 씬 2</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>프롬프트를 확인 후 다시 시도해주세요.</p>
                </div>
              </div>
            </div>
          </Section>

        </div>
      </div>
    </div>
  )
}
