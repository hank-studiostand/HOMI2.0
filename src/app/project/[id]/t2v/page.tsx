'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import {
  Loader2, ChevronRight, ChevronDown, Plus, Edit3, Zap,
} from 'lucide-react'
import type { Scene, PromptAttempt, SatisfactionScore } from '@/types'
import Link from 'next/link'
import Badge from '@/components/ui/Badge'
import SatisfactionRating from '@/components/ui/SatisfactionRating'
import { cn } from '@/lib/utils'

// ── 상수 ─────────────────────────────────────────────────────────
const ENGINES = [
  {
    id:    'kling3',
    label: 'Kling 3.0',
    desc:  'std / pro 모드 · 최대 10초',
    color: 'var(--warn)',
    bg:    'var(--warn-soft)',
  },
  {
    id:    'kling3-omni',
    label: 'Kling 3.0 Omni',
    desc:  '멀티샷 · 네이티브 오디오 지원',
    color: 'var(--violet)',
    bg:    'var(--violet-soft)',
  },
  {
    id:    'seedance-2',
    label: 'Seedance 2.0',
    desc:  'ByteDance · UI 스켈레톤 (API 키 필요)',
    color: '#06b6d4',
    bg:    'rgba(6,182,212,0.12)',
  },
]

const ASPECT_OPTIONS  = ['16:9', '9:16', '1:1', '4:3', '21:9']
const DURATION_OPTIONS = [5, 10]
const KLING_MODES = [
  { value: 'std', label: 'Standard', desc: '빠름' },
  { value: 'pro', label: 'Pro',      desc: '고품질' },
]

interface SceneOpts {
  prompt:      string
  negPrompt:   string
  engine:      'kling3' | 'kling3-omni' | 'seedance-2'
  duration:    number
  aspectRatio: string
  mode:        'std' | 'pro'
  cfgScale:    number
}

const DEFAULT_OPTS = (): SceneOpts => ({
  prompt:      '',
  negPrompt:   '',
  engine:      'kling3',
  duration:    5,
  aspectRatio: '16:9',
  mode:        'std',
  cfgScale:    0.5,
})

// ── VideoNode ─────────────────────────────────────────────────────
function VideoNode({
  attempt, onScore, onArchive,
}: {
  attempt:   PromptAttempt
  onScore:   (outputId: string, score: SatisfactionScore) => void
  onArchive: (outputId: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const meta = (attempt as any).metadata ?? {}

  const engineMeta = ENGINES.find(e => e.id === attempt.engine) ?? ENGINES[0]

  const statusBadge = {
    pending:    <Badge variant="muted">대기</Badge>,
    generating: <Badge variant="warning">생성중</Badge>,
    done:       <Badge variant="success">완료</Badge>,
    failed:     <Badge variant="danger">실패</Badge>,
  }[attempt.status]

  return (
    <div className="rounded-xl border mb-3"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2.5 p-3">
        <button onClick={() => setExpanded(v => !v)} >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: engineMeta.bg, color: engineMeta.color }}>
          {engineMeta.label}
        </span>

        <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
          시도 #{attempt.depth + 1}
        </span>
        {statusBadge}

        <div className="flex items-center gap-1 ml-1">
          {meta.duration    && <Chip>{meta.duration}초</Chip>}
          {meta.aspect_ratio && <Chip>{meta.aspect_ratio}</Chip>}
          {meta.mode         && <Chip>{meta.mode}</Chip>}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-[11px] leading-relaxed p-2.5 rounded-lg"
            style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>
            {attempt.prompt}
          </p>

          {attempt.status === 'generating' && (
            <div className="flex items-center gap-3 p-4 rounded-xl"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }}>
              <Loader2 size={16} className="animate-spin" style={{ color: engineMeta.color }} />
              <div>
                <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {engineMeta.label}가 영상을 생성하고 있습니다...
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  2~5분 소요됩니다
                </p>
              </div>
            </div>
          )}

          {attempt.outputs?.map(output => (
            <div key={output.id} className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
              {output.url
                ? <video src={output.url} className="w-full max-h-64 object-contain bg-black" controls muted />
                : <div className="h-36 flex items-center justify-center bg-[var(--bg-3)]">
                    <Loader2 size={22} className="animate-spin" />
                  </div>
              }
              <div className="p-3 flex items-center gap-4" style={{ background: 'var(--surface)' }}>
                <SatisfactionRating
                  value={output.satisfaction_score}
                  onChange={score => onScore(output.id, score)}
                  size="sm"
                />
                <button
                  onClick={() => onArchive(output.id)}
                  className={cn('text-[11px] px-2.5 py-1 rounded-lg transition-all',
                    output.archived
                      ? 'bg-[var(--ok-soft)] '
                      : 'bg-[var(--bg-3)]  hover:bg-[var(--bg-3)]')}>
                  {output.archived ? '✓ 아카이브됨' : '아카이브'}
                </button>
                {output.archived && (
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>립싱크에서 사용 가능</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded"
      style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
      {children}
    </span>
  )
}

// ── 생성 폼 ───────────────────────────────────────────────────────
function GenerateForm({
  opts, onChange, onGenerate, onCancel, hasAttempts,
}: {
  opts:        SceneOpts
  onChange:    <K extends keyof SceneOpts>(k: K, v: SceneOpts[K]) => void
  onGenerate:  () => void
  onCancel:    () => void
  hasAttempts: boolean
}) {
  const engineMeta = ENGINES.find(e => e.id === opts.engine) ?? ENGINES[0]

  return (
    <div className="p-4 rounded-xl border space-y-4"
      style={{ background: 'var(--surface)', borderColor: 'var(--accent-soft)' }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {hasAttempts ? '새 시도 추가' : 'T2V 영상 생성'}
      </p>

      {/* 엔진 선택 */}
      <div>
        <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>엔진</label>
        <div className="grid grid-cols-2 gap-2">
          {ENGINES.map(eng => (
            <button key={eng.id}
              onClick={() => onChange('engine', eng.id as SceneOpts['engine'])}
              className="flex items-center gap-3 p-3 rounded-xl border text-left transition-all"
              style={{
                background:  opts.engine === eng.id ? eng.bg : 'var(--surface-3)',
                borderColor: opts.engine === eng.id ? eng.color : 'var(--border)',
              }}>
              <Zap size={14} style={{ color: opts.engine === eng.id ? eng.color : 'var(--text-muted)' }} />
              <div>
                <p className="text-xs font-semibold"
                  style={{ color: opts.engine === eng.id ? eng.color : 'var(--text-primary)' }}>
                  {eng.label}
                </p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{eng.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 프롬프트 */}
      <div>
        <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>프롬프트</label>
        <textarea
          value={opts.prompt}
          onChange={e => onChange('prompt', e.target.value)}
          rows={4}
          placeholder="영상을 묘사하는 프롬프트..."
          className="w-full px-3 py-2.5 rounded-lg text-xs resize-none"
          style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        />
      </div>

      {/* 네거티브 프롬프트 */}
      <div>
        <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
          네거티브 프롬프트 <span style={{ color: 'var(--text-muted)' }}>(선택)</span>
        </label>
        <textarea
          value={opts.negPrompt}
          onChange={e => onChange('negPrompt', e.target.value)}
          rows={2}
          placeholder="제외할 요소..."
          className="w-full px-3 py-2 rounded-lg text-xs resize-none"
          style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        />
      </div>

      {/* 공통 옵션 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>영상 길이</label>
          <div className="flex gap-1.5">
            {DURATION_OPTIONS.map(d => (
              <button key={d}
                onClick={() => onChange('duration', d)}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: opts.duration === d ? 'var(--accent)' : 'var(--surface-3)',
                  color:      opts.duration === d ? 'white' : 'var(--text-secondary)',
                  border:     '1px solid var(--border)',
                }}>
                {d}초
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>화면비</label>
          <select
            value={opts.aspectRatio}
            onChange={e => onChange('aspectRatio', e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg text-xs"
            style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            {ASPECT_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {/* 모드 + CFG (Kling 공통) */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>모드</label>
          <div className="flex gap-1.5">
            {KLING_MODES.map(m => (
              <button key={m.value}
                onClick={() => onChange('mode', m.value as 'std' | 'pro')}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: opts.mode === m.value ? engineMeta.color : 'var(--surface-3)',
                  color:      opts.mode === m.value ? 'black' : 'var(--text-secondary)',
                  border:     '1px solid var(--border)',
                }}>
                {m.label}
                <span className="block text-[9px] opacity-70">{m.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium mb-1.5 flex justify-between" style={{ color: 'var(--text-secondary)' }}>
            <span>CFG Scale</span>
            <span className="font-mono" style={{ color: engineMeta.color }}>{opts.cfgScale.toFixed(1)}</span>
          </label>
          <input
            type="range" min="0" max="1" step="0.1"
            value={opts.cfgScale}
            onChange={e => onChange('cfgScale', parseFloat(e.target.value))}
            className="w-full"
            style={{ accentColor: engineMeta.color }}
          />
          <div className="flex justify-between text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            <span>창의적</span><span>프롬프트 충실</span>
          </div>
        </div>
      </div>

      {/* 버튼 */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onGenerate}
          disabled={!opts.prompt.trim()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-all hover:opacity-90"
          style={{ background: engineMeta.color, color: 'black' }}>
          <Plus size={13} /> 생성 시작
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm"
          style={{ color: 'var(--text-secondary)' }}>
          취소
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────

export default function T2VPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [scenes, setScenes]           = useState<Scene[]>([])
  const [attempts, setAttempts]       = useState<Record<string, PromptAttempt[]>>({})
  const [loading, setLoading]         = useState(true)
  const [genError, setGenError]       = useState<string | null>(null)
  const [sceneOpts, setSceneOpts]     = useState<Record<string, SceneOpts>>({})
  const [expandedScene, setExpandedScene] = useState<string | null>(null)
  const [showForm, setShowForm]       = useState<Record<string, boolean>>({})

  const supabase = createClient()

  useEffect(() => {
    fetchData()
    const attemptChannel = supabase
      .channel(`t2v-attempts-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prompt_attempts' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attempt_outputs' }, () => fetchData())
      .subscribe()
    const assetChannel = supabase
      .channel(`t2v-assets-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets', filter: `project_id=eq.${projectId}` }, () => fetchData())
      .subscribe()
    return () => {
      supabase.removeChannel(attemptChannel)
      supabase.removeChannel(assetChannel)
    }
  }, [projectId])

  async function fetchData() {
    const { data: scenesData } = await supabase
      .from('scenes')
      .select('*, master_prompt:master_prompts(content, negative_prompt, version)')
      .eq('project_id', projectId)
      .order('order_index')

    setScenes(scenesData ?? [])

    setSceneOpts(prev => {
      const next = { ...prev }
      for (const scene of (scenesData ?? [])) {
        if (next[scene.id]) continue
        const mp    = (scene as any).master_prompt
        const mpObj = Array.isArray(mp) ? mp.sort((a: any, b: any) => b.version - a.version)[0] : mp
        next[scene.id] = {
          ...DEFAULT_OPTS(),
          prompt:    mpObj?.content ?? '',
          negPrompt: mpObj?.negative_prompt ?? '',
        }
      }
      return next
    })

    const sceneIds = (scenesData ?? []).map((s: any) => s.id)
    if (sceneIds.length > 0) {
      const { data: attemptsData } = await supabase
        .from('prompt_attempts')
        .select('*, outputs:attempt_outputs(*, asset:assets(url, satisfaction_score, archived))')
        .in('scene_id', sceneIds)
        .in('engine', ['kling3', 'kling3-omni'])
        .order('created_at')

      const grouped: Record<string, PromptAttempt[]> = {}
      for (const scene of (scenesData ?? [])) grouped[scene.id] = []
      for (const attempt of (attemptsData ?? [])) {
        if (!grouped[attempt.scene_id]) grouped[attempt.scene_id] = []
        grouped[attempt.scene_id].push({
          ...attempt,
          outputs: (attempt.outputs ?? []).map((o: any) => ({
            ...o,
            url:                o.url ?? o.asset?.url ?? null,
            satisfaction_score: o.satisfaction_score ?? o.asset?.satisfaction_score ?? null,
            archived:           o.archived ?? o.asset?.archived ?? false,
          })),
        })
      }
      setAttempts(grouped)
    }
    setLoading(false)
  }

  function updateOpt<K extends keyof SceneOpts>(sceneId: string, key: K, val: SceneOpts[K]) {
    setSceneOpts(prev => ({ ...prev, [sceneId]: { ...prev[sceneId], [key]: val } }))
  }

  async function generate(sceneId: string) {
    const opts = sceneOpts[sceneId]
    if (!opts?.prompt.trim()) return

    const { data: attempt } = await supabase.from('prompt_attempts').insert({
      scene_id:  sceneId,
      parent_id: null,
      type:      'i2v',
      prompt:    opts.prompt,
      engine:    opts.engine,
      status:    'generating',
      depth:     (attempts[sceneId] ?? []).length,
      metadata: {
        duration:     opts.duration,
        aspect_ratio: opts.aspectRatio,
        mode:         opts.mode,
        cfg_scale:    opts.cfgScale,
        tags:         ['t2v'],
      },
    }).select().single()

    if (!attempt) return
    setShowForm(prev => ({ ...prev, [sceneId]: false }))
    fetchData()

    fetch('/api/t2v/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attemptId:      attempt.id,
        prompt:         opts.prompt,
        negativePrompt: opts.negPrompt,
        projectId,
        sceneId,
        engine:         opts.engine,
        duration:       opts.duration,
        aspectRatio:    opts.aspectRatio,
        mode:           opts.mode,
        cfgScale:       opts.cfgScale,
      }),
    }).then(async res => {
      if (!res.ok) {
        const d = await res.json()
        setGenError(d.error ?? '알 수 없는 오류')
      }
      fetchData()
    })
  }

  async function scoreOutput(outputId: string, score: SatisfactionScore) {
    await supabase.from('attempt_outputs').update({ satisfaction_score: score }).eq('id', outputId)
    if (score >= 4) {
      await supabase.from('attempt_outputs').update({ archived: true }).eq('id', outputId)
      const { data: out } = await supabase.from('attempt_outputs').select('asset_id').eq('id', outputId).single()
      if (out?.asset_id) {
        await supabase.from('assets').update({ satisfaction_score: score, archived: true }).eq('id', out.asset_id)
      }
    }
    fetchData()
  }

  async function archiveOutput(outputId: string) {
    const { data } = await supabase.from('attempt_outputs').select('archived, asset_id').eq('id', outputId).single()
    if (!data) return
    await supabase.from('attempt_outputs').update({ archived: !data.archived }).eq('id', outputId)
    await supabase.from('assets').update({ archived: !data.archived }).eq('id', data.asset_id)
    fetchData()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 size={24} className="animate-spin" />
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between" style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--line)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 3 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>T2V — 텍스트→영상</h1>
          <p className="text-[13px] mt-1 flex items-center gap-2" style={{ color: 'var(--ink-3)' }}>
            <span style={{ color: 'var(--warn)' }}>Kling 3.0</span>
            <span>·</span>
            <span style={{ color: 'var(--violet)' }}>Kling 3.0 Omni</span>
          </p>
        </div>
        <Link
          href={`/project/${projectId}/i2v`}
          className="flex items-center gap-2 transition-all"
          style={{
            padding: '7px 14px',
            borderRadius: 'var(--r-md)',
            fontSize: 13, fontWeight: 500,
            background: 'var(--accent)', color: '#fff',
            border: '1px solid var(--accent)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-2)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
        >
          I2V로 이동 <ChevronRight size={15} />
        </Link>
      </div>

      {genError && (
        <div className="mx-6 mt-3 px-4 py-3 rounded-xl text-xs flex items-start gap-2 flex-shrink-0"
          style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-soft)', color: 'var(--danger)' }}>
          <span className="flex-1 font-mono break-all">⚠️ {genError}</span>
          <button onClick={() => setGenError(null)} className="opacity-60 hover:opacity-100 shrink-0">✕</button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {scenes.map(scene => {
            const sceneAttempts = attempts[scene.id] ?? []
            const isExpanded    = expandedScene === scene.id
            const opts          = sceneOpts[scene.id] ?? DEFAULT_OPTS()
            const isShowingForm = !!(showForm[scene.id])

            return (
              <div
                key={scene.id}
                className="overflow-hidden"
                style={{ borderRadius: 'var(--r-lg)', border: '1px solid var(--line)', background: 'var(--bg-2)' }}
              >
                <button
                  onClick={() => setExpandedScene(isExpanded ? null : scene.id)}
                  className="w-full flex items-center gap-3 text-left transition-colors hover-surface"
                  style={{ padding: '14px 16px', background: 'var(--bg-1)' }}>
                  {isExpanded ? <ChevronDown size={16} style={{ color: 'var(--accent)' }} /> : <ChevronRight size={16} style={{ color: 'var(--ink-4)' }} />}
                  <Badge variant="accent" className="font-mono">S{scene.scene_number}</Badge>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', flex: 1 }}>
                    {scene.title}
                  </span>
                  {sceneAttempts.length > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {sceneAttempts.length}개 영상
                    </span>
                  )}
                </button>

                {isExpanded && (
                  <div className="space-y-3"
                    style={{ padding: 16, borderTop: '1px solid var(--line)', background: 'var(--bg-2)' }}>
                    {sceneAttempts.map(attempt => (
                      <VideoNode key={attempt.id} attempt={attempt}
                        onScore={scoreOutput} onArchive={archiveOutput} />
                    ))}

                    {!isShowingForm ? (
                      <button
                        onClick={() => setShowForm(prev => ({ ...prev, [scene.id]: true }))}
                        className="w-full flex items-center justify-center gap-2 transition-all"
                        style={{
                          padding: '12px',
                          borderRadius: 'var(--r-md)',
                          border: '1px dashed var(--line-2)',
                          fontSize: 13,
                          background: 'transparent',
                          color: 'var(--ink-4)',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-line)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--line-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink-4)' }}
                      >
                        <Edit3 size={14} />
                        {sceneAttempts.length === 0 ? '새 영상 생성' : '새 시도 추가'}
                      </button>
                    ) : (
                      <GenerateForm
                        opts={opts}
                        onChange={(k, v) => updateOpt(scene.id, k, v)}
                        onGenerate={() => generate(scene.id)}
                        onCancel={() => setShowForm(prev => ({ ...prev, [scene.id]: false }))}
                        hasAttempts={sceneAttempts.length > 0}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
