'use client'

// /project/[id]/video-studio
// 영상 생성 전용 페이지 — Phase 1: 빈 화면 + 안내. Phase 2에서 Higgsfield Seedance 스타일 풀 UI.

import { useParams, useRouter } from 'next/navigation'
import { Clapperboard, Film, Video as VideoIcon } from 'lucide-react'

export default function VideoStudioPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg)',
    }}>
      <div style={{
        padding: '12px 18px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--bg-1)',
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0,
      }}>
        <Clapperboard size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>영상 생성</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>Phase 2 — UI 재설계 예정</span>
      </div>

      <div style={{
        flex: 1, overflow: 'auto',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 32, gap: 24,
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: 24,
          background: 'var(--accent-soft)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Film size={36} />
        </div>
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            영상 생성 페이지 준비 중
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            Higgsfield · Seedance 2.0 스타일의 풀 UI로 곧 다시 만나요.<br />
            지금은 Shot Workspace의 영상 생성 토글을 사용해주세요.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => router.push(`/project/${projectId}/workspace`)}
            className="btn primary"
            style={{ padding: '10px 18px', fontSize: 13, fontWeight: 600 }}
          >
            <Clapperboard size={13} style={{ marginRight: 6 }} />
            Shot Workspace에서 영상 만들기
          </button>
          <button
            onClick={() => router.push(`/project/${projectId}/t2v`)}
            className="btn"
            style={{ padding: '10px 18px', fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}
          >
            <VideoIcon size={13} style={{ marginRight: 6 }} />
            기존 T2V 페이지
          </button>
        </div>
      </div>
    </div>
  )
}
