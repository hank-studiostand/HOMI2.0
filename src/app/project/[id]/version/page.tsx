'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  GitBranch, Image as ImageIcon, Video, Loader2, Film,
  ChevronRight, CheckCircle2, RotateCcw, Trash2,
} from 'lucide-react'
import { sortScenesByNumber } from '@/lib/sceneSort'
import Pill from '@/components/ui/Pill'

interface SceneRow { id: string; scene_number: string; title: string }
interface VersionRow { id: string; version_label: string; content: string; is_current: boolean; created_at: string }
interface OutputBit { id: string; url: string | null; archived: boolean; satisfaction_score: number | null; decision: 'approved' | 'revise_requested' | 'removed' | null }
interface AttemptRow {
  id: string; scene_id: string; type: 't2i' | 'i2v' | 'lipsync'; engine: string;
  prompt: string; status: string; created_at: string;
  outputs: OutputBit[]; versionId: string | null;
}

const LANE_COLORS = ['var(--accent)', 'var(--violet)', 'var(--info)', 'var(--pink)', 'var(--ok)', 'var(--warn)']
const LANE_WIDTH = 280
const LANE_GAP = 32
const HEADER_HEIGHT = 64
const ATTEMPT_HEIGHT = 220
const ATTEMPT_GAP = 14
const TOP_PAD = 14

export default function VersionPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [scenes, setScenes] = useState<SceneRow[]>([])
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [attempts, setAttempts] = useState<AttemptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingScene, setLoadingScene] = useState(false)

  // 씬별 attempt 카운트 — 사이드바에 점 표시하기 위함
  const [attemptCountByScene, setAttemptCountByScene] = useState<Record<string, number>>({})
  // 진단 정보 — 데이터가 안 나오는 경우 원인 파악용
  const [diag, setDiag] = useState<{ totalAttempts: number; totalScenes: number; queryError?: string }>({ totalAttempts: 0, totalScenes: 0 })
  const [sceneLoadError, setSceneLoadError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('scenes').select('id, scene_number, title').eq('project_id', projectId)
      const list = sortScenesByNumber((data ?? []) as any) as SceneRow[]
      setScenes(list)
      // attempt 카운트 가져오기 — 데이터 있는 씬을 우선 선택
      const sceneIds = list.map(s => s.id)
      let firstWithData: string | null = null
      const counts: Record<string, number> = {}
      let totalAttempts = 0
      let queryError: string | undefined
      if (sceneIds.length > 0) {
        const { data: counts0, error: cntErr } = await supabase
          .from('prompt_attempts')
          .select('scene_id')
          .in('scene_id', sceneIds)
        if (cntErr) {
          queryError = `prompt_attempts 조회 실패: ${cntErr.message}`
          console.error('[version] count query error:', cntErr)
        }
        for (const row of (counts0 ?? []) as any[]) {
          counts[row.scene_id] = (counts[row.scene_id] ?? 0) + 1
          totalAttempts++
        }
        // 자연 정렬 순서로 첫 데이터 있는 씬
        for (const s of list) {
          if ((counts[s.id] ?? 0) > 0) { firstWithData = s.id; break }
        }
      }
      setAttemptCountByScene(counts)
      setDiag({ totalAttempts, totalScenes: list.length, queryError })
      if (firstWithData) setActiveSceneId(firstWithData)
      else if (list.length > 0) setActiveSceneId(list[0].id)
      setLoading(false)
    })()
  }, [projectId, supabase])

  // 데이터 로드 — realtime 변경에서도 재호출. sceneId === '__ALL__'이면 프로젝트 전체.
  const reloadScene = async (sceneId: string) => {
    setLoadingScene(true)
    try {
      const isAll = sceneId === '__ALL__'
      const sceneIds = isAll ? scenes.map(s => s.id) : [sceneId]
      if (sceneIds.length === 0) {
        setVersions([]); setAttempts([])
        return
      }
      const [pvRes, attsRes, decRes] = await Promise.all([
        supabase.from('prompt_versions').select('id, version_label, content, is_current, created_at').in('scene_id', sceneIds).order('created_at', { ascending: true }),
        supabase.from('prompt_attempts').select('id, scene_id, type, engine, prompt, status, created_at, outputs:attempt_outputs(id, archived, satisfaction_score, asset:assets(url))').in('scene_id', sceneIds).order('created_at', { ascending: true }),
        supabase.from('shot_decisions').select('output_id, decision_type, created_at').in('scene_id', sceneIds).order('created_at', { ascending: false }),
      ])
      const errs: string[] = []
      if (pvRes.error) errs.push(`prompt_versions: ${pvRes.error.message}`)
      if (attsRes.error) errs.push(`prompt_attempts: ${attsRes.error.message}`)
      if (decRes.error) errs.push(`shot_decisions: ${decRes.error.message}`)
      if (errs.length > 0) {
        setSceneLoadError(errs.join(' | '))
        console.error('[version] reloadScene errors:', errs)
      } else {
        setSceneLoadError(null)
      }
      const pv = pvRes.data
      const atts = attsRes.data
      const decRows = decRes.data
      console.log('[version] reloadScene', { sceneId, isAll, sceneIds: sceneIds.length, attemptsRaw: atts?.length ?? 0, versionsRaw: pv?.length ?? 0 })
      const versionsList = (pv ?? []) as VersionRow[]
      setVersions(versionsList)
      const decisionByOutput = new Map<string, 'approved' | 'revise_requested' | 'removed'>()
      for (const d of (decRows ?? []) as any[]) {
        if (!decisionByOutput.has(d.output_id)) decisionByOutput.set(d.output_id, d.decision_type)
      }
      const attemptsList: AttemptRow[] = (atts ?? []).map((a: any) => {
        let matched: VersionRow | null = null
        for (const v of versionsList) {
          if ((a.prompt ?? '').startsWith(v.content)) { matched = v; break }
        }
        return {
          id: a.id, scene_id: a.scene_id, type: a.type, engine: a.engine,
          prompt: a.prompt ?? '', status: a.status, created_at: a.created_at,
          versionId: matched?.id ?? null,
          outputs: ((a.outputs ?? []) as any[]).map(o => ({
            id: o.id, url: o.asset?.url ?? null,
            archived: o.archived ?? false, satisfaction_score: o.satisfaction_score ?? null,
            decision: decisionByOutput.get(o.id) ?? null,
          })),
        }
      })
      setAttempts(attemptsList)
    } finally {
      setLoadingScene(false)
    }
  }

  useEffect(() => {
    if (!activeSceneId) return
    void reloadScene(activeSceneId)
    // Realtime — 워크스페이스/리뷰에서 변경되면 자동 새로고침
    const ch = supabase.channel(`version-page:${activeSceneId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prompt_attempts', filter: `scene_id=eq.${activeSceneId}` }, () => reloadScene(activeSceneId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attempt_outputs' }, () => reloadScene(activeSceneId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shot_decisions', filter: `scene_id=eq.${activeSceneId}` }, () => reloadScene(activeSceneId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'prompt_versions', filter: `scene_id=eq.${activeSceneId}` }, () => reloadScene(activeSceneId))
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId])

  const layout = useMemo(() => {
    if (versions.length === 0 && attempts.length === 0) return null
    const versionLane = new Map<string, number>()
    versions.forEach((v, i) => versionLane.set(v.id, i))
    const lanes: { id: string | null; label: string; color: string }[] = versions.map((v, i) => ({
      id: v.id, label: v.version_label, color: LANE_COLORS[i] ?? LANE_COLORS[LANE_COLORS.length - 1],
    }))
    const hasOrphans = attempts.some(a => !a.versionId)
    if (hasOrphans || lanes.length === 0) {
      lanes.push({ id: null, label: '기타', color: 'var(--ink-3)' })
    }
    const attemptsByLane: Record<number, AttemptRow[]> = {}
    for (const att of attempts) {
      const lane = att.versionId ? (versionLane.get(att.versionId) ?? lanes.length - 1) : lanes.length - 1
      if (!attemptsByLane[lane]) attemptsByLane[lane] = []
      attemptsByLane[lane].push(att)
    }
    const positions: Record<string, { x: number; y: number; lane: number }> = {}
    for (const [laneStr, list] of Object.entries(attemptsByLane)) {
      const lane = Number(laneStr)
      list.forEach((att, slot) => {
        positions[att.id] = {
          x: lane * (LANE_WIDTH + LANE_GAP),
          y: HEADER_HEIGHT + TOP_PAD + slot * (ATTEMPT_HEIGHT + ATTEMPT_GAP),
          lane,
        }
      })
    }
    const totalWidth = Math.max(LANE_WIDTH, lanes.length * LANE_WIDTH + (lanes.length - 1) * LANE_GAP)
    const maxSlot = Math.max(0, ...Object.values(attemptsByLane).map(l => l.length))
    const totalHeight = HEADER_HEIGHT + TOP_PAD + maxSlot * (ATTEMPT_HEIGHT + ATTEMPT_GAP) + 40

    type Edge = { from: { x: number; y: number }; to: { x: number; y: number }; color: string }
    const edges: Edge[] = []
    versions.forEach((v, idx) => {
      if (idx === 0) return
      const earlier = attempts.filter(a => a.versionId !== v.id && a.created_at < v.created_at)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      if (!earlier) return
      const fromPos = positions[earlier.id]
      const firstAttempt = attemptsByLane[idx]?.[0]
      const targetX = idx * (LANE_WIDTH + LANE_GAP) + LANE_WIDTH / 2
      const targetY = firstAttempt ? positions[firstAttempt.id].y : HEADER_HEIGHT + TOP_PAD
      if (!fromPos) return
      edges.push({
        from: { x: fromPos.x + LANE_WIDTH / 2, y: fromPos.y + ATTEMPT_HEIGHT },
        to:   { x: targetX, y: targetY },
        color: lanes[idx].color,
      })
    })
    return { lanes, attemptsByLane, positions, totalWidth, totalHeight, edges }
  }, [versions, attempts])

  const activeScene = scenes.find(s => s.id === activeSceneId) ?? null

  return (
    <div className="h-full grid" style={{ gridTemplateColumns: '240px 1fr', overflow: 'hidden' }}>
      <aside style={{ borderRight: '1px solid var(--line)', overflow: 'auto', background: 'var(--bg-1)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--bg-1)', zIndex: 1 }}>
          <div className="flex items-center" style={{ gap: 8, marginBottom: 4 }}>
            <GitBranch size={14} style={{ color: 'var(--accent)' }} />
            <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Provenance</h1>
          </div>
          <p style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.45 }}>
            씬별 또는 프로젝트 전체로 작업 계보를 봅니다.
          </p>
          {/* 전체 보기 토글 */}
          <button
            onClick={() => setActiveSceneId('__ALL__')}
            className="flex items-center w-full"
            style={{
              marginTop: 8,
              padding: '6px 10px',
              borderRadius: 'var(--r-sm)',
              fontSize: 12, fontWeight: 500,
              background: activeSceneId === '__ALL__' ? 'var(--accent)' : 'var(--bg-2)',
              color: activeSceneId === '__ALL__' ? '#fff' : 'var(--ink-2)',
              border: `1px solid ${activeSceneId === '__ALL__' ? 'var(--accent)' : 'var(--line)'}`,
              gap: 6,
            }}
          >
            <GitBranch size={11} />
            전체 보기
            {Object.values(attemptCountByScene).reduce((a, b) => a + b, 0) > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700 }}>
                {Object.values(attemptCountByScene).reduce((a, b) => a + b, 0)}
              </span>
            )}
          </button>
        </div>
        {loading ? (
          <div style={{ padding: 16 }}><Loader2 size={14} className="animate-spin" /></div>
        ) : scenes.length === 0 ? (
          <div className="empty" style={{ padding: 16, fontSize: 12 }}>씬 없음</div>
        ) : (
          <div className="flex flex-col" style={{ padding: 8, gap: 2 }}>
            {scenes.map(s => {
              const active = s.id === activeSceneId
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSceneId(s.id)}
                  className="flex items-center gap-2 w-full text-left"
                  style={{
                    padding: '7px 10px', borderRadius: 'var(--r-sm)',
                    background: active ? 'var(--bg-3)' : 'transparent',
                    color: active ? 'var(--ink)' : 'var(--ink-3)',
                    fontSize: 12,
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <span className="mono" style={{ minWidth: 36, color: 'var(--accent)', fontWeight: 600 }}>
                    {s.scene_number}
                  </span>
                  <span className="truncate flex-1">{s.title || '(제목 없음)'}</span>
                  {(attemptCountByScene[s.id] ?? 0) > 0 && (
                    <span
                      style={{
                        fontSize: 9, fontWeight: 700,
                        padding: '1px 6px', borderRadius: 999,
                        background: active ? 'var(--accent)' : 'var(--accent-soft)',
                        color: active ? '#fff' : 'var(--accent)',
                      }}
                    >
                      {attemptCountByScene[s.id]}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </aside>

      <main style={{ overflow: 'auto', background: 'var(--bg)' }}>
        <div className="flex items-end justify-between" style={{ padding: '16px 24px 12px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
              {activeSceneId === '__ALL__'
                ? <><GitBranch size={16} style={{ display: 'inline', verticalAlign: 'middle', color: 'var(--accent)', marginRight: 6 }} />프로젝트 전체</>
                : activeScene
                ? <>씬 <span className="mono" style={{ color: 'var(--accent)' }}>{activeScene.scene_number}</span> {activeScene.title}</>
                : '씬을 선택하세요'}
            </h2>
            {(activeScene || activeSceneId === '__ALL__') && (
              <p style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>
                {versions.length}개 버전 · {attempts.length}개 시도 · {attempts.reduce((n, a) => n + a.outputs.length, 0)}개 결과물
              </p>
            )}
          </div>
          {activeScene && activeSceneId !== '__ALL__' && (
            <button
              onClick={() => router.push(`/project/${projectId}/workspace?scene=${activeScene.id}`)}
              className="flex items-center gap-1"
              style={{
                padding: '5px 12px', borderRadius: 'var(--r-sm)',
                fontSize: 12, fontWeight: 500,
                background: 'var(--accent-soft)', color: 'var(--accent)',
                border: '1px solid var(--accent-line)',
              }}
            >
              워크스페이스에서 작업 <ChevronRight size={11} />
            </button>
          )}
        </div>

        {/* 진단 패널 — 데이터가 0이거나 쿼리 에러가 발생한 경우 */}
        {(diag.queryError || diag.totalAttempts === 0) && (
          <div
            style={{
              margin: '12px 24px 0',
              padding: '10px 14px',
              borderRadius: 'var(--r-md)',
              background: diag.queryError ? 'var(--danger-soft)' : 'var(--bg-2)',
              border: `1px solid ${diag.queryError ? 'var(--danger)' : 'var(--line)'}`,
              fontSize: 12,
              color: diag.queryError ? 'var(--danger)' : 'var(--ink-3)',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {diag.queryError ? '⚠️ 데이터 조회 실패' : '진단: 작업 로그가 비어있어요'}
            </div>
            {diag.queryError ? (
              <div>{diag.queryError}</div>
            ) : (
              <div style={{ lineHeight: 1.55 }}>
                · 프로젝트 씬 수: {diag.totalScenes}개<br/>
                · 전체 attempts: 0개<br/>
                <br/>
                작업 로그가 표시되려면 워크스페이스에서 한 번 이상 <strong>"Que"</strong>를 눌러 생성을 시도해야 합니다.
                생성을 했는데도 0이면 RLS(권한) 정책 문제일 수 있어요 — Supabase Dashboard → Authentication → Policies에서
                <code style={{ background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3, margin: '0 3px' }}>prompt_attempts</code>
                테이블에 SELECT 정책이 있는지 확인해주세요.
              </div>
            )}
          </div>
        )}

        <div style={{ padding: 24, position: 'relative' }}>
          {loadingScene ? (
            <div className="empty" style={{ padding: 64, textAlign: 'center' }}>
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
          ) : !layout ? (
            <div className="empty" style={{ padding: 64, textAlign: 'center' }}>
              <GitBranch size={28} style={{ color: 'var(--ink-4)' }} />
              <p style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-3)' }}>
                이 씬에는 아직 프롬프트 버전이나 시도가 없어요
              </p>
              <p style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>
                워크스페이스에서 생성을 시작하면 여기에 노드 그래프가 그려져요.
              </p>
              {sceneLoadError && (
                <div
                  style={{
                    marginTop: 16, padding: '8px 12px',
                    background: 'var(--danger-soft)',
                    color: 'var(--danger)',
                    border: '1px solid var(--danger)',
                    borderRadius: 'var(--r-md)',
                    fontSize: 11,
                    maxWidth: 520,
                    margin: '16px auto 0',
                    textAlign: 'left',
                  }}
                >
                  ⚠️ 쿼리 에러: {sceneLoadError}
                  <div style={{ marginTop: 6, color: 'var(--ink-3)' }}>
                    Supabase RLS(권한) 정책이 SELECT를 막고 있을 가능성이 높아요. 이전 안내했던 4개 정책 SQL을 실행해주세요.
                  </div>
                </div>
              )}
              {Object.values(attemptCountByScene).some(n => n > 0) && (
                <div style={{ marginTop: 16, fontSize: 11, color: 'var(--ink-3)' }}>
                  데이터가 있는 다른 씬:{' '}
                  {scenes.filter(s => (attemptCountByScene[s.id] ?? 0) > 0).slice(0, 5).map(s => (
                    <button
                      key={s.id}
                      onClick={() => setActiveSceneId(s.id)}
                      className="mono"
                      style={{
                        margin: '0 4px',
                        padding: '2px 8px',
                        borderRadius: 'var(--r-sm)',
                        background: 'var(--accent-soft)',
                        color: 'var(--accent)',
                        border: '1px solid var(--accent-line)',
                        fontWeight: 600,
                      }}
                    >
                      {s.scene_number} ({attemptCountByScene[s.id]})
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ position: 'relative', width: layout.totalWidth, minHeight: layout.totalHeight }}>
              <svg
                width={layout.totalWidth}
                height={layout.totalHeight}
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
              >
                {layout.edges.map((e, i) => {
                  const dx = e.to.x - e.from.x
                  const dy = e.to.y - e.from.y
                  const c1x = e.from.x + dx * 0.1
                  const c1y = e.from.y + Math.max(40, dy * 0.4)
                  const c2x = e.to.x - dx * 0.1
                  const c2y = e.to.y - Math.max(40, dy * 0.4)
                  return (
                    <g key={i}>
                      <path
                        d={`M ${e.from.x} ${e.from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${e.to.x} ${e.to.y}`}
                        stroke={e.color} strokeWidth={2.5} fill="none"
                        opacity={0.55} strokeDasharray="6 4"
                      />
                      <circle cx={e.to.x} cy={e.to.y} r={4} fill={e.color} opacity={0.8} />
                    </g>
                  )
                })}
              </svg>

              {layout.lanes.map((lane, i) => {
                const x = i * (LANE_WIDTH + LANE_GAP)
                const v = versions.find(vv => vv.id === lane.id)
                return (
                  <div
                    key={`lane-${i}`}
                    style={{
                      position: 'absolute', left: x, top: 0,
                      width: LANE_WIDTH, height: HEADER_HEIGHT,
                      padding: '8px 12px',
                      background: 'var(--bg-2)',
                      border: `2px solid ${lane.color}`,
                      borderRadius: 'var(--r-md)',
                      display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    }}
                  >
                    <div className="flex items-center" style={{ gap: 6, marginBottom: 2 }}>
                      <span
                        className="mono"
                        style={{
                          padding: '1px 8px', borderRadius: 'var(--r-sm)',
                          background: lane.color, color: '#fff',
                          fontSize: 11, fontWeight: 700,
                        }}
                      >
                        {lane.label}
                      </span>
                      {v?.is_current && <Pill variant="ready">current</Pill>}
                      <span style={{ flex: 1 }} />
                      {v && (
                        <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                          {new Date(v.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.35,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {v ? v.content : '버전과 매칭되지 않은 시도들'}
                    </div>
                  </div>
                )
              })}

              {Object.entries(layout.attemptsByLane).map(([_laneStr, list]) =>
                list.map(att => {
                  const pos = layout.positions[att.id]
                  if (!pos) return null
                  const lane = layout.lanes[pos.lane]
                  return (
                    <AttemptCard
                      key={att.id}
                      att={att}
                      x={pos.x}
                      y={pos.y}
                      laneColor={lane.color}
                      onOpen={() => activeSceneId && router.push(`/project/${projectId}/workspace?scene=${activeSceneId}`)}
                    />
                  )
                }),
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function AttemptCard({
  att, x, y, laneColor, onOpen,
}: {
  att: AttemptRow
  x: number; y: number
  laneColor: string
  onOpen: () => void
}) {
  const dt = new Date(att.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const TypeIcon = att.type === 't2i' ? ImageIcon : att.type === 'i2v' ? Video : Film
  const statusVariant: 'approved' | 'gen' | 'danger' | 'draft' =
    att.status === 'done' || att.status === 'completed' ? 'approved'
    : att.status === 'generating' ? 'gen'
    : att.status === 'failed' ? 'danger'
    : 'draft'
  const statusLabel =
    att.status === 'done' || att.status === 'completed' ? '완료'
    : att.status === 'generating' ? '생성중'
    : att.status === 'failed' ? '실패'
    : att.status

  return (
    <button
      onClick={onOpen}
      style={{
        position: 'absolute', left: x, top: y,
        width: LANE_WIDTH, height: ATTEMPT_HEIGHT,
        padding: 10,
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderLeft: `3px solid ${laneColor}`,
        borderRadius: 'var(--r-md)',
        textAlign: 'left',
        transition: 'border-color 0.12s, transform 0.12s',
        cursor: 'pointer',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = laneColor
        el.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = 'var(--line)'
        el.style.transform = 'translateY(0)'
      }}
    >
      <div className="flex items-center" style={{ gap: 6, marginBottom: 6 }}>
        <TypeIcon size={11} style={{ color: laneColor }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink)', textTransform: 'uppercase' }}>
          {att.type}
        </span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{att.engine}</span>
        <span style={{ flex: 1 }} />
        <Pill variant={statusVariant} showDot>{statusLabel}</Pill>
      </div>

      <div style={{ fontSize: 10, color: 'var(--ink-4)', marginBottom: 6 }}>{dt}</div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: att.outputs.length <= 2 ? `repeat(${Math.max(1, att.outputs.length)}, 1fr)` : 'repeat(2, 1fr)',
          gap: 4,
          minHeight: 80,
        }}
      >
        {att.outputs.length === 0 ? (
          <div
            style={{
              gridColumn: '1 / -1', minHeight: 80,
              borderRadius: 'var(--r-sm)',
              background: 'var(--bg-3)', border: '1px dashed var(--line)',
              display: 'grid', placeItems: 'center',
              fontSize: 10, color: 'var(--ink-4)',
            }}
          >
            {att.status === 'generating'
              ? <span className="flex items-center" style={{ gap: 4 }}><Loader2 size={11} className="animate-spin" /> 큐</span>
              : '결과 없음'}
          </div>
        ) : att.outputs.slice(0, 4).map(o => {
          const decBorder =
            o.decision === 'approved' ? 'var(--ok)'
            : o.decision === 'revise_requested' ? 'var(--accent)'
            : o.decision === 'removed' ? 'var(--danger)'
            : null
          return (
            <div
              key={o.id}
              style={{
                aspectRatio: '16/9',
                borderRadius: 'var(--r-sm)',
                overflow: 'hidden',
                background: 'var(--bg-3)',
                border: `2px solid ${decBorder ?? 'var(--line)'}`,
                position: 'relative',
                opacity: o.decision === 'removed' ? 0.5 : 1,
              }}
            >
              {o.url ? (
                att.type === 't2i'
                  ? <img src={o.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <video src={o.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
                  <Loader2 size={11} className="animate-spin" style={{ color: 'var(--accent)' }} />
                </div>
              )}
              {o.decision && (
                <div style={{ position: 'absolute', top: 2, right: 2 }}>
                  {o.decision === 'approved'         && <CheckCircle2 size={11} style={{ color: '#fff', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.6))' }} />}
                  {o.decision === 'revise_requested' && <RotateCcw    size={11} style={{ color: '#fff', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.6))' }} />}
                  {o.decision === 'removed'          && <Trash2       size={11} style={{ color: '#fff', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.6))' }} />}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </button>
  )
}
