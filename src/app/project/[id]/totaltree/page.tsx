'use client'

import { useState, useEffect } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import {
  Loader2, ChevronDown, ChevronRight,
  FileText, Wand2, FolderOpen, Image, Video, Mic,
  CheckCircle2, Clock, XCircle, Layers, RefreshCw,
} from 'lucide-react'
import type { Scene } from '@/types'
import Badge from '@/components/ui/Badge'
import SceneTreeView from '@/components/scene/SceneTreeView'
import { cn } from '@/lib/utils'

// ── 타입 ─────────────────────────────────────────────────────────

interface SceneData extends Omit<Scene, 'settings' | 'master_prompt'> {
  master_prompt?: { content: string; negative_prompt: string; version: number } | null
  settings?: Record<string, any>
  referenceAssets: { id: string; url: string; name: string }[]
  t2iAttempts:    AttemptSummary[]
  i2vAttempts:    AttemptSummary[]
  t2vAttempts:    AttemptSummary[]
  lipsyncAttempts: AttemptSummary[]
}

interface AttemptSummary {
  id: string
  prompt: string
  engine: string
  status: 'pending' | 'generating' | 'done' | 'failed'
  depth: number
  outputs: { id: string; url: string | null; archived: boolean; satisfaction_score: number | null }[]
  created_at: string
  metadata?: Record<string, any>
}

// ── 상태 아이콘 ───────────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === 'done')       return <CheckCircle2 size={11} style={{ color: 'var(--success)' }} />
  if (status === 'generating') return <Clock size={11} style={{ color: 'var(--warning)' }} className="animate-pulse" />
  if (status === 'failed')     return <XCircle size={11} style={{ color: 'var(--danger)' }} />
  return <Clock size={11} style={{ color: 'var(--text-muted)' }} />
}

// ── 섹션 헤더 ─────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label, count, color }: {
  icon: React.ElementType; label: string; count?: number; color?: string
}) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon size={12} style={{ color: color ?? 'var(--text-muted)' }} />
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: color ?? 'var(--text-muted)' }}>
        {label}
      </span>
      {count !== undefined && (
        <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
          {count}
        </span>
      )}
    </div>
  )
}

// ── 빈 상태 ──────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-12 rounded" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}>
      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

// ── 이미지 그리드 ─────────────────────────────────────────────────

function ImageGrid({ attempts }: { attempts: AttemptSummary[] }) {
  if (attempts.length === 0) return <EmptyState label="아직 없음" />
  return (
    <div className="space-y-1.5">
      {attempts.map(attempt => (
        <div key={attempt.id}>
          <div className="flex items-center gap-1.5 mb-1">
            <StatusIcon status={attempt.status} />
            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
              {attempt.engine} · {attempt.depth > 0 ? `재시도 #${attempt.depth}` : '루트'}
            </span>
          </div>
          {attempt.outputs.length > 0 ? (
            <div className="grid grid-cols-3 gap-1">
              {attempt.outputs.map(o => (
                <div key={o.id} className="relative aspect-video rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  {o.url
                    ? <img src={o.url} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full animate-pulse" style={{ background: 'var(--surface-3)' }} />
                  }
                  {o.archived && <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)' }} />}
                  {o.satisfaction_score && (
                    <div className="absolute bottom-0.5 left-0.5 text-[8px] px-1 rounded" style={{ background: 'rgba(0,0,0,0.7)', color: 'white' }}>
                      ★{o.satisfaction_score}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : attempt.status === 'generating' ? (
            <div className="grid grid-cols-3 gap-1">
              {[1,2,3].map(n => <div key={n} className="aspect-video rounded animate-pulse" style={{ background: 'var(--surface-3)' }} />)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

// ── 영상 그리드 ───────────────────────────────────────────────────

function VideoGrid({ attempts }: { attempts: AttemptSummary[] }) {
  if (attempts.length === 0) return <EmptyState label="아직 없음" />
  return (
    <div className="space-y-1.5">
      {attempts.map(attempt => (
        <div key={attempt.id}>
          <div className="flex items-center gap-1.5 mb-1">
            <StatusIcon status={attempt.status} />
            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
              {attempt.engine}
              {attempt.metadata?.duration ? ` · ${attempt.metadata.duration}초` : ''}
            </span>
          </div>
          {attempt.outputs.map(o => o.url ? (
            <video key={o.id} src={o.url}
              className="w-full rounded object-cover"
              style={{ maxHeight: '60px', border: '1px solid var(--border)' }}
              muted playsInline
            />
          ) : attempt.status === 'generating' ? (
            <div key={o.id} className="h-12 rounded animate-pulse" style={{ background: 'var(--surface-3)' }} />
          ) : null)}
        </div>
      ))}
    </div>
  )
}

// ── 파이프라인 상태 칩들 ──────────────────────────────────────────

function PipelineChips({ scene }: { scene: SceneData }) {
  const mpContent = (() => {
    const mp = scene.master_prompt
    return Array.isArray(mp)
      ? (mp as any[]).sort((a, b) => b.version - a.version)[0]?.content ?? ''
      : (mp as any)?.content ?? ''
  })()

  const chip = (label: string, active: boolean, color: string, activeBg: string) => (
    <span
      className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-medium"
      style={active
        ? { background: activeBg, color }
        : { background: 'var(--surface-3)', color: 'var(--text-muted)' }
      }
    >
      {label}
    </span>
  )

  return (
    <div className="flex items-center gap-1 shrink-0">
      {chip('프롬프트', !!mpContent, '#818cf8', 'rgba(129,140,248,0.15)')}
      {chip('T2I', scene.t2iAttempts.some(a => a.status === 'done'), '#818cf8', 'rgba(99,102,241,0.15)')}
      {chip('I2V', scene.i2vAttempts.some(a => a.status === 'done'), '#a78bfa', 'rgba(167,139,250,0.15)')}
      {chip('립싱크', scene.lipsyncAttempts.some(a => a.status === 'done'), '#f472b6', 'rgba(244,114,182,0.15)')}
    </div>
  )
}

// ── 씬 파이프라인 내용 ────────────────────────────────────────────

function ScenePipelineContent({ scene }: { scene: SceneData }) {
  const [activeTab, setActiveTab] = useState<'overview' | 'detail'>('overview')

  const mpContent = (() => {
    const mp = scene.master_prompt
    return Array.isArray(mp)
      ? (mp as any[]).sort((a, b) => b.version - a.version)[0]?.content ?? ''
      : (mp as any)?.content ?? ''
  })()

  return (
    <div className="border-t" style={{ borderColor: 'var(--border)', background: 'var(--background)' }}>
      {/* 탭 바 */}
      <div className="flex gap-1 px-4 pt-2" style={{ borderBottom: '1px solid var(--border)' }}>
        {(['overview', 'detail'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="px-3 py-1.5 text-xs font-medium transition-all"
            style={{
              color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-1px',
            }}
          >
            {tab === 'overview' ? '개요' : '상세'}
          </button>
        ))}
      </div>

      {/* 개요: 6컬럼 파이프라인 */}
      {activeTab === 'overview' && (
        <div className="p-4 grid grid-cols-6 gap-3">
          {/* 대본 */}
          <div className="p-3 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <SectionHeader icon={FileText} label="대본" color="var(--text-secondary)" />
            <pre className="text-[9px] leading-relaxed whitespace-pre-wrap line-clamp-8" style={{ color: 'var(--text-muted)' }}>
              {scene.content || '내용 없음'}
            </pre>
          </div>
          {/* 프롬프트 */}
          <div className="p-3 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <SectionHeader icon={Wand2} label="프롬프트" color="var(--accent)" />
            {mpContent
              ? <p className="text-[9px] leading-relaxed line-clamp-8" style={{ color: 'var(--text-muted)' }}>{mpContent}</p>
              : <EmptyState label="미생성" />
            }
          </div>
          {/* 레퍼런스 */}
          <div className="p-3 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <SectionHeader icon={FolderOpen} label="레퍼런스" count={scene.referenceAssets.length} color="#fb923c" />
            {scene.referenceAssets.length > 0 ? (
              <div className="grid grid-cols-2 gap-1">
                {scene.referenceAssets.slice(0, 4).map(a => (
                  <div key={a.id} className="aspect-square rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                    <img src={a.url} alt={a.name} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            ) : <EmptyState label="없음" />}
          </div>
          {/* T2I */}
          <div className="p-3 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <SectionHeader icon={Image} label="T2I" count={scene.t2iAttempts.length} color="var(--accent)" />
            <ImageGrid attempts={scene.t2iAttempts} />
          </div>
          {/* I2V / T2V */}
          <div className="p-3 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <SectionHeader icon={Video} label="I2V / T2V" count={scene.i2vAttempts.length + scene.t2vAttempts.length} color="#a78bfa" />
            <VideoGrid attempts={[...scene.i2vAttempts, ...scene.t2vAttempts]} />
          </div>
          {/* 립싱크 */}
          <div className="p-3 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <SectionHeader icon={Mic} label="립싱크" count={scene.lipsyncAttempts.length} color="#f472b6" />
            <VideoGrid attempts={scene.lipsyncAttempts} />
          </div>
        </div>
      )}

      {/* 상세: 풀사이즈 */}
      {activeTab === 'detail' && (
        <div className="p-4 space-y-5">
          {/* 대본 + 프롬프트 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <SectionHeader icon={FileText} label="대본 원문" color="var(--text-secondary)" />
              <pre className="text-xs leading-relaxed whitespace-pre-wrap p-3 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                {scene.content || '내용 없음'}
              </pre>
            </div>
            <div>
              <SectionHeader icon={Wand2} label="마스터 프롬프트" color="var(--accent)" />
              {mpContent
                ? <p className="text-xs leading-relaxed p-3 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{mpContent}</p>
                : <div className="p-3 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}><EmptyState label="마스터 프롬프트 미생성" /></div>
              }
            </div>
          </div>

          {/* 레퍼런스 에셋 */}
          {scene.referenceAssets.length > 0 && (
            <div>
              <SectionHeader icon={FolderOpen} label="레퍼런스 에셋" count={scene.referenceAssets.length} color="#fb923c" />
              <div className="grid grid-cols-8 gap-2">
                {scene.referenceAssets.map(a => (
                  <div key={a.id} className="aspect-square rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                    <img src={a.url} alt={a.name} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* T2I */}
          {scene.t2iAttempts.length > 0 && (
            <div>
              <SectionHeader icon={Image} label="T2I 생성 이력" count={scene.t2iAttempts.length} color="var(--accent)" />
              <div className="space-y-2">
                {scene.t2iAttempts.map(attempt => (
                  <div key={attempt.id} className="p-3 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <StatusIcon status={attempt.status} />
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {attempt.engine} · {attempt.depth > 0 ? `재시도 #${attempt.depth}` : '루트 시도'}
                      </span>
                      <Badge variant={
                        attempt.status === 'done' ? 'success' :
                        attempt.status === 'generating' ? 'warning' :
                        attempt.status === 'failed' ? 'danger' : 'muted'
                      }>{
                        attempt.status === 'done' ? '완료' :
                        attempt.status === 'generating' ? '생성중' :
                        attempt.status === 'failed' ? '실패' : '대기'
                      }</Badge>
                    </div>
                    {attempt.outputs.length > 0 && (
                      <div className="grid grid-cols-6 gap-1.5">
                        {attempt.outputs.map(o => (
                          <div key={o.id} className="aspect-video rounded overflow-hidden relative" style={{ border: '1px solid var(--border)' }}>
                            {o.url
                              ? <img src={o.url} alt="" className="w-full h-full object-cover" />
                              : <div className="w-full h-full animate-pulse" style={{ background: 'var(--surface-3)' }} />
                            }
                            {o.archived && <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)' }} />}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* I2V / T2V */}
          {(scene.i2vAttempts.length + scene.t2vAttempts.length) > 0 && (
            <div>
              <SectionHeader icon={Video} label="영상 생성 이력 (I2V / T2V)" count={scene.i2vAttempts.length + scene.t2vAttempts.length} color="#a78bfa" />
              <div className="space-y-2">
                {[...scene.i2vAttempts, ...scene.t2vAttempts].map(attempt => (
                  <div key={attempt.id} className="p-3 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <StatusIcon status={attempt.status} />
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {attempt.engine}
                        {attempt.metadata?.duration ? ` · ${attempt.metadata.duration}초` : ''}
                      </span>
                    </div>
                    {attempt.outputs.map(o => o.url ? (
                      <video key={o.id} src={o.url} className="w-full rounded mt-1" style={{ maxHeight: 140, border: '1px solid var(--border)' }} controls muted />
                    ) : attempt.status === 'generating' ? (
                      <div key={o.id} className="h-20 rounded animate-pulse mt-1" style={{ background: 'var(--surface-3)' }} />
                    ) : null)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 립싱크 */}
          {scene.lipsyncAttempts.length > 0 && (
            <div>
              <SectionHeader icon={Mic} label="립싱크 이력" count={scene.lipsyncAttempts.length} color="#f472b6" />
              <div className="space-y-2">
                {scene.lipsyncAttempts.map(attempt => (
                  <div key={attempt.id} className="p-3 rounded" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <StatusIcon status={attempt.status} />
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{attempt.engine}</span>
                    </div>
                    {attempt.outputs.map(o => o.url ? (
                      <video key={o.id} src={o.url} className="w-full rounded mt-1" style={{ maxHeight: 140, border: '1px solid var(--border)' }} controls />
                    ) : null)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────

export default function TotalTreePage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [scenes, setScenes]       = useState<SceneData[]>([])
  const [loading, setLoading]     = useState(true)
  const [expandedScene, setExpandedScene] = useLocalState<string | null>(`expanded-totaltree-${projectId}`, null)
  const [completedScenes, setCompletedScenes] = useState<Set<string>>(new Set())
  const supabase = createClient()

  useEffect(() => { fetchAll() }, [projectId])

  async function fetchAll() {
    const { data: scenesData } = await supabase
      .from('scenes')
      .select('*, master_prompt:master_prompts(content, negative_prompt, version), settings:scene_settings(*)')
      .eq('project_id', projectId)
      .order('order_index')

    if (!scenesData || scenesData.length === 0) {
      setScenes([])
      setLoading(false)
      return
    }

    const sceneIds = scenesData.map((s: any) => s.id)

    const [{ data: refAssets }, { data: allAttempts }] = await Promise.all([
      supabase.from('assets').select('id, scene_id, url, name').eq('project_id', projectId).eq('type', 'reference'),
      supabase.from('prompt_attempts')
        .select('*, outputs:attempt_outputs(id, url, archived, satisfaction_score, asset:assets(url))')
        .in('scene_id', sceneIds).order('created_at'),
    ])

    const normalizeOutputs = (attempt: any) => ({
      ...attempt,
      outputs: (attempt.outputs ?? []).map((o: any) => ({
        id: o.id, url: o.url ?? o.asset?.url ?? null,
        archived: o.archived ?? false, satisfaction_score: o.satisfaction_score ?? null,
      })),
    })

    const composed: SceneData[] = scenesData.map((scene: any) => {
      const sid = scene.id
      const sceneAttempts = (allAttempts ?? []).filter((a: any) => a.scene_id === sid)
      return {
        ...scene,
        referenceAssets: (refAssets ?? []).filter((a: any) => a.scene_id === sid),
        t2iAttempts:     sceneAttempts.filter((a: any) => a.type === 't2i').map(normalizeOutputs),
        i2vAttempts:     sceneAttempts.filter((a: any) => a.type === 'i2v' && a.engine !== 'seedance-t2v').map(normalizeOutputs),
        t2vAttempts:     sceneAttempts.filter((a: any) => a.type === 'i2v' && a.engine === 'seedance-t2v').map(normalizeOutputs),
        lipsyncAttempts: sceneAttempts.filter((a: any) => a.type === 'lipsync').map(normalizeOutputs),
      }
    })

    setScenes(composed)
    setLoading(false)
  }

  function handleToggleComplete(sceneId: string) {
    setCompletedScenes(prev => {
      const next = new Set(prev)
      if (next.has(sceneId)) { next.delete(sceneId) } else { next.add(sceneId) }
      return next
    })
  }

  // SceneTreeView의 renderScene — 씬 파이프라인 내용을 렌더
  function renderSceneContent(scene: Scene) {
    const sceneData = scenes.find(s => s.id === scene.id)
    if (!sceneData) return null
    return (
      <div>
        {/* 파이프라인 칩 요약 (헤더 옆에 붙는 인라인 아이콘 대신 collapsed 시 보임) */}
        <ScenePipelineContent scene={sceneData} />
      </div>
    )
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
    </div>
  )

  // SceneTreeView에 전달할 scenes (SceneData extends Scene이므로 직접 사용 가능)
  const baseScenes = scenes as unknown as Scene[]

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Layers size={16} style={{ color: 'var(--accent)' }} />
            토탈트리
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            씬별 전체 제작 파이프라인 · {scenes.length}개 씬
          </p>
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs hover-surface transition-all"
          style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      {/* 씬 트리 */}
      <div className="flex-1 overflow-auto p-6">
        {scenes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Layers size={28} className="mb-3" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>씬이 없습니다</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>씬 �
