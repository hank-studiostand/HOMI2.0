'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Scene } from '@/types'
import Pill from '@/components/ui/Pill'
import { Frame, Image as ImageIcon, MessageCircle } from 'lucide-react'

// Shot Workspace — 레퍼런스 디자인의 핵심 3-패널 화면 스텁.
// 좌: 씬 메타/브리프 / 중: 결과 갤러리 / 우: 코멘트.
// 데이터 연결은 후속 단계에서.

export default function ShotWorkspacePage() {
  const { id: projectId } = useParams<{ id: string }>()
  const supabase = createClient()
  const [scenes, setScenes] = useState<Scene[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('scenes')
        .select('*')
        .eq('project_id', projectId)
        .order('order_index')
      setScenes((data ?? []) as Scene[])
      if (data && data.length > 0) setActiveId(data[0].id)
    })()
  }, [projectId, supabase])

  const active = scenes.find(s => s.id === activeId)

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div
        className="flex items-end justify-between gap-6"
        style={{
          padding: '20px 28px 16px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--bg)',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>
            Shot Workspace
          </h1>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
            씬 단위로 브리프 · 결과 · 코멘트를 한 화면에서 관리합니다.
          </p>
        </div>
      </div>

      {/* 3-panel body */}
      <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: '280px 1fr 320px', minHeight: 0 }}>
        {/* 좌: 씬 리스트 / 브리프 */}
        <aside style={{ borderRight: '1px solid var(--line)', overflowY: 'auto', padding: 12 }}>
          <div className="field-label">씬 목록</div>
          {scenes.length === 0 ? (
            <div className="empty" style={{ marginTop: 8 }}>씬이 없어요</div>
          ) : (
            <div className="flex flex-col" style={{ gap: 4 }}>
              {scenes.map(s => (
                <button
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 'var(--r-md)',
                    background: activeId === s.id ? 'var(--bg-3)' : 'transparent',
                    color: activeId === s.id ? 'var(--ink)' : 'var(--ink-2)',
                    fontSize: 13, textAlign: 'left',
                  }}
                >
                  <span className="mono" style={{ minWidth: 38, color: 'var(--accent)' }}>{s.scene_number}</span>
                  <span className="truncate flex-1">{s.title || '(제목 없음)'}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* 중: 결과 갤러리 (스텁) */}
        <main style={{ overflowY: 'auto', padding: 24 }}>
          {active ? (
            <>
              <div className="row" style={{ gap: 8, marginBottom: 16 }}>
                <Pill variant="gen" showDot>{active.scene_number}</Pill>
                <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>{active.title}</h2>
              </div>
              <div className="card card-pad" style={{ marginBottom: 16 }}>
                <div className="field-label">씬 내용</div>
                <pre className="whitespace-pre-wrap font-sans text-sm" style={{ color: 'var(--ink-2)' }}>
                  {active.content || '(내용 없음)'}
                </pre>
              </div>
              <div className="card card-pad">
                <div className="field-label flex items-center gap-2">
                  <ImageIcon size={12} /> 결과 갤러리
                </div>
                <div className="empty" style={{ marginTop: 8 }}>
                  T2I/I2V 결과는 후속 작업에서 연결됩니다.
                  <br />
                  지금은 <strong>T2I</strong> · <strong>I2V</strong> 페이지에서 작업하세요.
                </div>
              </div>
            </>
          ) : (
            <div className="empty">씬을 선택하세요</div>
          )}
        </main>

        {/* 우: 코멘트 (스텁) */}
        <aside style={{ borderLeft: '1px solid var(--line)', overflowY: 'auto', padding: 16 }}>
          <div className="field-label flex items-center gap-2">
            <MessageCircle size={12} /> 코멘트
          </div>
          <div className="empty">팀원 채팅은 우하단 토글에서.</div>
        </aside>
      </div>
    </div>
  )
}
