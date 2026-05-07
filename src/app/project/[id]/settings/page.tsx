'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import {
  Bell, BellOff, MessageSquare, Save, CheckCircle2, AlertCircle,
  ExternalLink, Info, Webhook, Users, UserPlus, X, Edit2, Loader2, Crown,
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
          text: ':white_check_mark: *HOMI — 테스트 알림*  ' +
            '프로젝트 - 씬넘버 - 씬이름 - N차 시도 - 성공  (실제 알림은 이런 형식으로 전송돼요)',
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

          {/* ── 프로젝트 인원 / R&R ── */}
          <MembersSection projectId={projectId} />

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

// ── 프로젝트 인원 / R&R 관리 ───────────────────────────────────────────────
interface MemberRow {
  user_id: string
  role: 'owner' | 'editor' | 'viewer'
  role_label: string | null
  email: string
  display_name: string
  avatar_url: string
}

const ROLE_PRESETS = ['기획', '감독', '편집', 'AI 아티스트', '카메라', '사운드', '연출', '제작 PD', 'QA', '클라이언트']

function MembersSection({ projectId }: { projectId: string }) {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [meId, setMeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [labelDraft, setLabelDraft] = useState('')

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/projects/${projectId}/members`)
      const j = await r.json()
      if (!r.ok) {
        setError(j.error ?? '멤버 조회 실패')
        return
      }
      setMembers(j.members ?? [])
      setOwnerId(j.ownerId ?? null)
      setMeId(j.meId ?? null)
      setError(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [projectId])

  const isOwner = !!meId && meId === ownerId

  async function patch(userId: string, body: { role?: string; roleLabel?: string }) {
    setBusyUserId(userId)
    try {
      const r = await fetch(`/api/projects/${projectId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...body }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? '저장 실패'); return false }
      await load()
      return true
    } finally {
      setBusyUserId(null)
    }
  }

  async function remove(userId: string) {
    if (!confirm('이 멤버를 프로젝트에서 제거할까요?')) return
    setBusyUserId(userId)
    try {
      const r = await fetch(`/api/projects/${projectId}/members?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) { setError(j.error ?? '제거 실패'); return }
      await load()
    } finally {
      setBusyUserId(null)
    }
  }

  function startEditLabel(m: MemberRow) {
    setEditingUserId(m.user_id)
    setLabelDraft(m.role_label ?? '')
  }
  async function commitLabel(userId: string) {
    const ok = await patch(userId, { roleLabel: labelDraft.trim() })
    if (ok) setEditingUserId(null)
  }

  return (
    <Section title="프로젝트 인원 / R&R" icon={Users}>
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        멤버 권한(owner/editor/viewer)과 별개로 R&R 라벨을 자유롭게 입력할 수 있어요. 권한 변경/제거는 owner만 가능합니다.
      </p>

      {error && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
          style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
        >
          <AlertCircle size={12} /> {error}
          <button onClick={() => setError(null)} className="ml-auto opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={12} className="animate-spin" /> 멤버 불러오는 중...
        </div>
      ) : members.length === 0 ? (
        <div className="text-xs italic text-center py-4" style={{ color: 'var(--text-muted)' }}>
          멤버가 없어요. 상단 토글의 멤버 초대 버튼으로 추가해주세요.
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 6 }}>
          {members.map(m => {
            const isMemberOwner = m.user_id === ownerId
            const isEditing = editingUserId === m.user_id
            const busy = busyUserId === m.user_id
            return (
              <div
                key={m.user_id}
                className="flex items-center"
                style={{
                  padding: '8px 10px', gap: 10,
                  background: 'var(--surface-3)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md, 8px)',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {/* 아바타 */}
                <div
                  style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: m.avatar_url ? `url(${m.avatar_url}) center/cover` : 'var(--accent-soft, #fde68a)',
                    color: 'var(--accent, #d97706)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, flexShrink: 0,
                  }}
                >
                  {!m.avatar_url && (m.display_name || m.email || '?').charAt(0).toUpperCase()}
                </div>

                {/* 이름/이메일 */}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="flex items-center" style={{ gap: 5, fontSize: 13, color: 'var(--text-primary)' }}>
                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.display_name || m.email.split('@')[0] || '(이름 없음)'}
                    </span>
                    {isMemberOwner && (
                      <span title="프로젝트 소유자" style={{ color: 'var(--accent, #d97706)' }}>
                        <Crown size={11} />
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.email}
                  </div>
                </div>

                {/* 권한 (role) */}
                <select
                  value={isMemberOwner ? 'owner' : m.role}
                  disabled={!isOwner || isMemberOwner || busy}
                  onChange={e => void patch(m.user_id, { role: e.target.value })}
                  style={{
                    padding: '4px 6px', fontSize: 11,
                    background: 'var(--bg, #fff)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    cursor: (!isOwner || isMemberOwner) ? 'not-allowed' : 'pointer',
                    minWidth: 76,
                  }}
                  title={isMemberOwner ? 'owner는 변경 불가' : (!isOwner ? 'owner만 변경 가능' : '권한 변경')}
                >
                  {isMemberOwner ? <option value="owner">owner</option> : (
                    <>
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </>
                  )}
                </select>

                {/* R&R 라벨 (자유 입력) */}
                {isEditing ? (
                  <div className="flex items-center" style={{ gap: 4 }}>
                    <input
                      autoFocus
                      list={`role-presets-${m.user_id}`}
                      value={labelDraft}
                      onChange={e => setLabelDraft(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); void commitLabel(m.user_id) }
                        if (e.key === 'Escape') { e.preventDefault(); setEditingUserId(null) }
                      }}
                      placeholder="예: 감독"
                      style={{
                        width: 110, padding: '4px 8px', fontSize: 11,
                        background: 'var(--bg, #fff)',
                        border: '1px solid var(--accent, #d97706)',
                        borderRadius: 6,
                        color: 'var(--text-primary)',
                        outline: 'none',
                      }}
                    />
                    <datalist id={`role-presets-${m.user_id}`}>
                      {ROLE_PRESETS.map(r => <option key={r} value={r} />)}
                    </datalist>
                    <button
                      onClick={() => void commitLabel(m.user_id)}
                      title="저장 (Enter)"
                      style={{ padding: 3, color: 'var(--accent, #d97706)' }}
                    ><CheckCircle2 size={13} /></button>
                    <button
                      onClick={() => setEditingUserId(null)}
                      title="취소 (Esc)"
                      style={{ padding: 3, color: 'var(--text-muted)' }}
                    ><X size={13} /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => isOwner && startEditLabel(m)}
                    disabled={!isOwner}
                    title={isOwner ? 'R&R 라벨 편집' : 'owner만 편집 가능'}
                    className="flex items-center"
                    style={{
                      padding: '4px 8px', minWidth: 110,
                      gap: 4, fontSize: 11, fontWeight: 500,
                      background: m.role_label ? 'var(--accent-soft, #fde68a)' : 'transparent',
                      color: m.role_label ? 'var(--accent, #d97706)' : 'var(--text-muted)',
                      border: `1px dashed ${m.role_label ? 'transparent' : 'var(--border)'}`,
                      borderRadius: 6,
                      cursor: isOwner ? 'pointer' : 'default',
                      textAlign: 'left',
                      opacity: isOwner ? 1 : 0.7,
                    }}
                  >
                    {m.role_label || (isOwner ? '+ R&R 추가' : '—')}
                    {isOwner && m.role_label && <Edit2 size={9} style={{ marginLeft: 'auto', opacity: 0.5 }} />}
                  </button>
                )}

                {/* 제거 */}
                {isOwner && !isMemberOwner && (
                  <button
                    onClick={() => void remove(m.user_id)}
                    disabled={busy}
                    title="멤버 제거"
                    style={{
                      padding: 5, color: 'var(--danger)',
                      borderRadius: 4,
                      background: 'transparent',
                      border: '1px solid transparent',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--danger-bg, #fee2e2)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
        팁: 권한(role)은 시스템 기능 접근 제한에 사용되고, R&R 라벨은 팀 운영용 표시입니다. 라벨은 자유 입력이고 빈 값으로 두면 사라집니다.
      </p>
    </Section>
  )
}

