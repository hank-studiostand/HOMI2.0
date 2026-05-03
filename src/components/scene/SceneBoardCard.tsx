'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Image as ImageIcon, Video, Wand2, Loader2, Check } from 'lucide-react'
import type { Scene } from '@/types'
import Pill from '@/components/ui/Pill'
import AssigneePicker from './AssigneePicker'

// 씬 ID → 그라디언트 (prototype의 ShotArt 대체용 placeholder)
function gradientFor(sceneNumber: string): string {
  const palette = [
    'linear-gradient(135deg, #7c2d12 0%, #f97316 50%, #fcd34d 100%)',
    'linear-gradient(135deg, #1e3a5f 0%, #38bdf8 100%)',
    'linear-gradient(135deg, #1c1917 0%, #44403c 100%)',
    'linear-gradient(135deg, #14532d 0%, #22c55e 100%)',
    'linear-gradient(135deg, #581c87 0%, #ec4899 100%)',
    'linear-gradient(135deg, #1e3a8a 0%, #6366f1 100%)',
  ]
  const seq = parseInt(sceneNumber.split('-')[0] ?? '1', 10) || 1
  return palette[(seq - 1) % palette.length]
}

interface Props {
  scene: Scene
  projectId: string
  onUpdate?: (id: string, updates: Partial<Scene>) => void
  onGeneratePrompt?: (id: string) => void
  isGenerating?: boolean
}

interface Stats {
  hasMasterPrompt: boolean
  t2iDone: number
  t2iTotal: number
  i2vDone: number
  i2vTotal: number
  thumbnail: string | null
}

export default function SceneBoardCard({
  scene, projectId, onUpdate, onGeneratePrompt, isGenerating,
}: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [stats, setStats] = useState<Stats>({
    hasMasterPrompt: false, t2iDone: 0, t2iTotal: 0, i2vDone: 0, i2vTotal: 0, thumbnail: null,
  })

  useEffect(() => {
    void (async () => {
      const [{ data: mp }, { data: attempts }] = await Promise.all([
        supabase.from('master_prompts').select('id').eq('scene_id', scene.id).limit(1),
        supabase
          .from('prompt_attempts')
          .select('id, type, status, outputs:attempt_outputs(id, asset:assets(url, archived))')
          .eq('scene_id', scene.id),
      ])

      const t2iAtt = (attempts ?? []).filter(a => a.type === 't2i')
      const i2vAtt = (attempts ?? []).filter(a => a.type === 'i2v')

      // 첫 번째 archived T2I output을 썸네일로
      let thumbnail: string | null = null
      for (const a of t2iAtt) {
        const outputs = ((a.outputs ?? []) as any[])
        const archived = outputs.find((o: any) => o.asset?.archived && o.asset?.url)
        if (archived) { thumbnail = archived.asset.url; break }
        const any = outputs.find((o: any) => o.asset?.url)
        if (any && !thumbnail) thumbnail = any.asset.url
      }

      setStats({
        hasMasterPrompt: (mp?.length ?? 0) > 0,
        t2iDone: t2iAtt.filter(a => a.status === 'done').length,
        t2iTotal: t2iAtt.length,
        i2vDone: i2vAtt.filter(a => a.status === 'done').length,
        i2vTotal: i2vAtt.length,
        thumbnail,
      })
    })()
  }, [scene.id, supabase])

  // 워크스페이스로 이동 (없으면 t2i 페이지로 폴백)
  const workspaceHref = `/project/${projectId}/workspace?scene=${scene.id}`

  // 상태 결정
  const status: { label: string; variant: 'draft' | 'ready' | 'gen' | 'review' | 'approved' } =
    stats.i2vDone > 0
      ? { label: '완료', variant: 'approved' }
      : stats.t2iDone > 0
        ? { label: '검토', variant: 'review' }
        : stats.hasMasterPrompt
          ? { label: '생산중', variant: 'gen' }
          : { label: 'Draft', variant: 'draft' }

  return (
    <div
      className="card fade-in overflow-hidden transition-all"
      style={{
        cursor: 'pointer',
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-lg)',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
      onClick={() => router.push(workspaceHref)}
    >
      {/* 썸네일 + 오버레이 */}
      <div
        style={{
          aspectRatio: '16/9',
          background: stats.thumbnail ? 'var(--bg-3)' : gradientFor(scene.scene_number),
          position: 'relative',
        }}
      >
        {stats.thumbnail && (
          <img
            src={stats.thumbnail}
            alt=""
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
        {/* 다크 오버레이 (프로토타입) */}
        {!stats.thumbnail && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)' }} />
        )}
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4 }}>
          <span
            className="pill mono"
            style={{
              background: 'rgba(0,0,0,0.6)', color: '#fff',
              borderColor: 'transparent', backdropFilter: 'blur(8px)',
            }}
          >
            {scene.scene_number}
          </span>
        </div>
        <div style={{ position: 'absolute', top: 8, right: 8 }}>
          <Pill variant={status.variant}>{status.label}</Pill>
        </div>
      </div>

      {/* 본문 */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
          {scene.title || '제목 없음'}
        </div>
        <div
          style={{
            fontSize: 11, color: 'var(--ink-4)',
            marginBottom: 10, lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {scene.content || '내용 없음'}
        </div>

        {/* 진행 칩 + 오너 */}
        <div className="flex items-center" style={{ gap: 10, fontSize: 11, color: 'var(--ink-3)' }}>
          {stats.hasMasterPrompt && (
            <span className="row-tight" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Wand2 size={11} style={{ color: 'var(--accent)' }} />
              <span>프롬프트</span>
            </span>
          )}
          <span className="row-tight" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <ImageIcon size={11} />
            <span>{stats.t2iDone}/{stats.t2iTotal}</span>
          </span>
          {stats.i2vTotal > 0 && (
            <span className="row-tight" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Video size={11} />
              <span>{stats.i2vDone}/{stats.i2vTotal}</span>
            </span>
          )}

          <div style={{ flex: 1 }} />

          {/* AssigneePicker (이벤트 전파 차단) */}
          <span onClick={(e) => e.stopPropagation()}>
            <AssigneePicker
              projectId={projectId}
              sceneId={scene.id}
              assignedTo={scene.assigned_to}
              onAssigned={(uid) => onUpdate?.(scene.id, { assigned_to: uid })}
              size="sm"
            />
          </span>
        </div>

        {/* 마스터 프롬프트 미생성 시 인라인 액션 */}
        {!stats.hasMasterPrompt && onGeneratePrompt && (
          <button
            onClick={(e) => { e.stopPropagation(); onGeneratePrompt(scene.id) }}
            disabled={isGenerating}
            className="w-full transition-all disabled:opacity-50"
            style={{
              marginTop: 10,
              padding: '6px 10px',
              borderRadius: 'var(--r-md)',
              fontSize: 12, fontWeight: 500,
              background: 'var(--accent-soft)', color: 'var(--accent)',
              border: '1px solid var(--accent-line)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {isGenerating
              ? <><Loader2 size={11} className="animate-spin" /> 생성중...</>
              : <><Wand2 size={11} /> 마스터 프롬프트 생성</>
            }
          </button>
        )}
        {stats.hasMasterPrompt && (
          <Link
            href={workspaceHref}
            onClick={(e) => e.stopPropagation()}
            className="w-full transition-all"
            style={{
              marginTop: 10,
              padding: '6px 10px',
              borderRadius: 'var(--r-md)',
              fontSize: 12, fontWeight: 500,
              background: 'var(--bg-3)', color: 'var(--ink-2)',
              border: '1px solid var(--line)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Check size={11} /> 워크스페이스 열기
          </Link>
        )}
      </div>
    </div>
  )
}
