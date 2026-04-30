'use client'

import { useState, useCallback, useEffect, ReactNode } from 'react'
import {
  ChevronRight, ChevronDown, CheckCircle2, Circle,
  Film, Layers, Scissors,
} from 'lucide-react'
import type { Scene } from '@/types'
import { cn } from '@/lib/utils'
import AssigneePicker from './AssigneePicker'

// ─── 파싱 유틸 ─────────────────────────────────────────────────────────

type Level = 1 | 2 | 3
interface ParsedNumber { seq: string; scene: string; cut: string; level: Level; raw: string }

function parseSceneNumber(num: string): ParsedNumber {
  const parts = num.split('-')
  return {
    seq:   parts[0] ?? '1',
    scene: parts[1] ?? '',
    cut:   parts[2] ?? '',
    level: Math.min(parts.length, 3) as Level,
    raw:   num,
  }
}

// ─── 트리 노드 타입 ─────────────────────────────────────────────────────

interface SeqNode { seq: string; label: string; scenes: SceneGroupNode[] }
interface SceneGroupNode { seq: string; sceneNum: string; label: string; cuts: Scene[] }

function buildTree(scenes: Scene[]): SeqNode[] {
  const seqMap = new Map<string, Map<string, Scene[]>>()

  for (const scene of scenes) {
    const p = parseSceneNumber(scene.scene_number)
    if (!seqMap.has(p.seq)) seqMap.set(p.seq, new Map())
    const sceneGroup = seqMap.get(p.seq)!
    const sceneKey = p.scene || '_root'
    if (!sceneGroup.has(sceneKey)) sceneGroup.set(sceneKey, [])
    sceneGroup.get(sceneKey)!.push(scene)
  }

  const tree: SeqNode[] = []
  const sortedSeqs = [...seqMap.keys()].sort((a, b) => Number(a) - Number(b))

  for (const seq of sortedSeqs) {
    const sceneMap = seqMap.get(seq)!
    const sceneNodes: SceneGroupNode[] = []
    const sortedSceneKeys = [...sceneMap.keys()].sort((a, b) =>
      a === '_root' ? -1 : b === '_root' ? 1 : Number(a) - Number(b)
    )

    for (const sceneKey of sortedSceneKeys) {
      const cuts = sceneMap.get(sceneKey)!.sort((a, b) => a.order_index - b.order_index)
      sceneNodes.push({
        seq,
        sceneNum: sceneKey === '_root' ? '' : sceneKey,
        label: sceneKey === '_root'
          ? (cuts[0]?.title || `씬 ${seq}`)
          : `씬 ${seq}-${sceneKey}`,
        cuts,
      })
    }

    tree.push({ seq, label: `시퀀스 ${seq}`, scenes: sceneNodes })
  }
  return tree
}

// ─── 완료 표시 버튼 ─────────────────────────────────────────────────────

function CompleteButton({ completed, onClick }: { completed: boolean; onClick: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      className="p-1 rounded transition-all hover-surface"
      title={completed ? '완료 해제' : '씬 완료로 표시'}
    >
      {completed
        ? <CheckCircle2 size={15} style={{ color: 'var(--success)' }} />
        : <Circle size={15} style={{ color: 'var(--text-muted)' }} />
      }
    </button>
  )
}

// ─── Notion-style 씬 넘버 태그 ──────────────────────────────────────────

function SceneTag({ num, level }: { num: string; level?: 'seq' | 'scene' | 'cut' }) {
  const colors = {
    seq:   { bg: 'var(--warn-soft)', color: 'var(--warning)' },
    scene: { bg: 'var(--accent-subtle)',  color: 'var(--accent)' },
    cut:   { bg: 'var(--surface-3)',      color: 'var(--text-secondary)' },
  }[level ?? 'cut']

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold"
      style={colors}
    >
      {num}
    </span>
  )
}

// ─── SceneTreeView 메인 컴포넌트 ───────────────────────────────────────

interface SceneTreeViewProps {
  scenes: Scene[]
  completedScenes?: Set<string>
  onToggleComplete?: (sceneId: string) => void
  renderScene: (scene: Scene) => ReactNode
  expandedSceneId?: string | null
  onExpandScene?: (sceneId: string | null) => void
  pipelineChips?: (scene: Scene) => ReactNode
  /** 지정되면 다중 펼침 + localStorage 자동 저장 (마지막 상태 기억). */
  storageKey?: string
}

// ── localStorage helpers ──
function loadSet(key: string): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set()
    const raw = window.localStorage.getItem(key)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch { return new Set() }
}
function saveSet(key: string, s: Set<string>) {
  try { window.localStorage.setItem(key, JSON.stringify(Array.from(s))) } catch {}
}

export default function SceneTreeView({
  scenes,
  completedScenes = new Set(),
  onToggleComplete,
  renderScene,
  expandedSceneId,
  onExpandScene,
  pipelineChips,
  storageKey,
}: SceneTreeViewProps) {
  const tree = buildTree(scenes)

  // storageKey 제공 시 내부 멀티 펼침 상태 + localStorage
  const [internalExpandedScenes, setInternalExpandedScenes] = useState<Set<string>>(new Set())
  const [expandedSeqs, setExpandedSeqs] = useState<Set<string>>(new Set(tree.map(t => t.seq)))
  const [expandedSceneGroups, setExpandedSceneGroups] = useState<Set<string>>(new Set())
  const [hydrated, setHydrated] = useState(false)

  // 마운트 시 localStorage에서 복원
  useEffect(() => {
    if (!storageKey) { setHydrated(true); return }
    setInternalExpandedScenes(loadSet(`${storageKey}:scenes`))
    const savedSeqs = loadSet(`${storageKey}:seqs`)
    if (savedSeqs.size > 0) setExpandedSeqs(savedSeqs)
    setExpandedSceneGroups(loadSet(`${storageKey}:groups`))
    setHydrated(true)
  }, [storageKey])

  // 변경 시 저장
  useEffect(() => {
    if (!storageKey || !hydrated) return
    saveSet(`${storageKey}:scenes`, internalExpandedScenes)
  }, [internalExpandedScenes, storageKey, hydrated])
  useEffect(() => {
    if (!storageKey || !hydrated) return
    saveSet(`${storageKey}:seqs`, expandedSeqs)
  }, [expandedSeqs, storageKey, hydrated])
  useEffect(() => {
    if (!storageKey || !hydrated) return
    saveSet(`${storageKey}:groups`, expandedSceneGroups)
  }, [expandedSceneGroups, storageKey, hydrated])

  const multiMode = !!storageKey
  const isSceneExpanded = (id: string) =>
    multiMode ? internalExpandedScenes.has(id) : expandedSceneId === id
  const toggleScene = (id: string) => {
    if (multiMode) {
      setInternalExpandedScenes(prev => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      })
    } else {
      onExpandScene?.(expandedSceneId === id ? null : id)
    }
  }

  const toggleSeq = useCallback((seq: string) => {
    setExpandedSeqs(prev => {
      const next = new Set(prev)
      next.has(seq) ? next.delete(seq) : next.add(seq)
      return next
    })
  }, [])

  const toggleSceneGroup = useCallback((key: string) => {
    setExpandedSceneGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])

  // 1단계만 있으면 플랫 리스트
  const isFlatList = tree.length === 1
    && tree[0].scenes.length === 1
    && tree[0].scenes[0].sceneNum === ''

  if (isFlatList) {
    return (
      <div className="space-y-1">
        {scenes.map(scene => {
          const isCompleted = completedScenes.has(scene.id)
          const isExpanded  = isSceneExpanded(scene.id)

          return (
            <div
              key={scene.id}
              className={cn('rounded border overflow-hidden transition-opacity', isCompleted && 'opacity-50')}
              style={{
                borderColor: isCompleted ? 'var(--success)' : 'var(--border)',
                background: 'var(--surface)',
              }}
            >
              <button
                onClick={() => toggleScene(scene.id)}
                className="w-full flex items-center gap-2.5 px-3 py-3 text-left hover-surface transition-colors"
              >
                {isExpanded
                  ? <ChevronDown size={15} style={{ color: 'var(--accent)' }} />
                  : <ChevronRight size={15} style={{ color: 'var(--accent)' }} />
                }
                <SceneTag num={`S${scene.scene_number}`} level="cut" />
                <span className="text-base flex-1 truncate font-medium" style={{ color: 'var(--text-primary)' }}>
                  {scene.title}
                </span>
                <AssigneePicker
                  projectId={scene.project_id}
                  sceneId={scene.id}
                  assignedTo={scene.assigned_to}
                />
                {pipelineChips?.(scene)}
                {onToggleComplete && (
                  <CompleteButton completed={isCompleted} onClick={() => onToggleComplete(scene.id)} />
                )}
              </button>
              {isExpanded && !isCompleted && renderScene(scene)}
            </div>
          )
        })}
      </div>
    )
  }

  // ── 3단계 트리 ──
  return (
    <div className="space-y-2">
      {tree.map(seqNode => {
        const isSeqExpanded = expandedSeqs.has(seqNode.seq)
        const seqSceneIds   = seqNode.scenes.flatMap(sg => sg.cuts.map(c => c.id))
        const completedCount = seqSceneIds.filter(id => completedScenes.has(id)).length
        const totalCount    = seqSceneIds.length

        return (
          <div
            key={seqNode.seq}
            className="rounded border overflow-hidden"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              borderLeft: '4px solid var(--warning)',
            }}
          >
            {/* ▶ 시퀀스 헤더 (1단계) — 가장 위계 */}
            <button
              onClick={() => toggleSeq(seqNode.seq)}
              className="w-full flex items-center gap-2.5 px-3 py-3 text-left hover-surface transition-colors"
              style={{ background: 'var(--warn-soft)' }}
            >
              {isSeqExpanded
                ? <ChevronDown size={16} style={{ color: 'var(--warning)' }} />
                : <ChevronRight size={16} style={{ color: 'var(--warning)' }} />
              }
              <Film size={15} style={{ color: 'var(--warning)' }} />
              <span className="text-base font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>
                {seqNode.label}
              </span>
              <span
                className="text-xs font-medium px-2 py-0.5 rounded tabular-nums"
                style={{
                  background: completedCount === totalCount && totalCount > 0
                    ? 'var(--success-bg)' : 'var(--surface-2)',
                  color: completedCount === totalCount && totalCount > 0
                    ? 'var(--success)' : 'var(--text-muted)',
                }}
              >
                {completedCount}/{totalCount}
              </span>
            </button>

            {isSeqExpanded && (
              <div className="border-t" style={{ borderColor: 'var(--border)' }}>
                {seqNode.scenes.map(sceneGroup => {
                  const groupKey = `${seqNode.seq}-${sceneGroup.sceneNum}`
                  const isGroupExpanded = expandedSceneGroups.has(groupKey)
                  const hasMulipleCuts  = sceneGroup.cuts.length > 1
                  const groupCompleted  = sceneGroup.cuts.every(c => completedScenes.has(c.id))

                  // 씬 그룹에 컷이 1개 → 바로 컷
                  if (!hasMulipleCuts) {
                    const scene = sceneGroup.cuts[0]
                    if (!scene) return null
                    const isCompleted = completedScenes.has(scene.id)
                    const isExpanded  = isSceneExpanded(scene.id)

                    return (
                      <div
                        key={scene.id}
                        className={cn('border-b last:border-b-0 transition-opacity', isCompleted && 'opacity-50')}
                        style={{ borderColor: 'var(--border-light)' }}
                      >
                        <button
                          onClick={() => toggleScene(scene.id)}
                          className="w-full flex items-center gap-2.5 py-2.5 text-left hover-surface transition-colors"
                          style={{
                            paddingLeft: '24px',
                            paddingRight: '12px',
                            borderLeft: '3px solid var(--accent)',
                            background: 'var(--accent-subtle)',
                          }}
                        >
                          {isExpanded
                            ? <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} />
                            : <ChevronRight size={13} style={{ color: 'var(--text-muted)' }} />
                          }
                          <Scissors size={13} style={{ color: 'var(--accent)' }} />
                          <SceneTag num={scene.scene_number} level="scene" />
                          <span className="text-base flex-1 truncate font-medium" style={{ color: 'var(--text-primary)' }}>
                            {scene.title}
                          </span>
                          <AssigneePicker
                            projectId={scene.project_id}
                            sceneId={scene.id}
                            assignedTo={scene.assigned_to}
                          />
                          {pipelineChips?.(scene)}
                          {onToggleComplete && (
                            <CompleteButton completed={isCompleted} onClick={() => onToggleComplete(scene.id)} />
                          )}
                        </button>
                        {isExpanded && !isCompleted && renderScene(scene)}
                      </div>
                    )
                  }

                  // 씬 그룹에 컷이 여러 개 (2단계 → 3단계)
                  return (
                    <div
                      key={groupKey}
                      className="border-b last:border-b-0"
                      style={{ borderColor: 'var(--border-light)' }}
                    >
                      {/* ▶ 씬 그룹 헤더 (2단계) — accent 컬러바 */}
                      <button
                        onClick={() => toggleSceneGroup(groupKey)}
                        className={cn(
                          'w-full flex items-center gap-2.5 py-2.5 text-left hover-surface transition-colors',
                          groupCompleted && 'opacity-50',
                        )}
                        style={{
                          paddingLeft: '24px', paddingRight: '12px',
                          background: 'var(--accent-subtle)',
                          borderLeft: '3px solid var(--accent)',
                        }}
                      >
                        {isGroupExpanded
                          ? <ChevronDown size={14} style={{ color: 'var(--accent)' }} />
                          : <ChevronRight size={14} style={{ color: 'var(--accent)' }} />
                        }
                        <Layers size={13} style={{ color: 'var(--accent)' }} />
                        <span className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>
                          {sceneGroup.label}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {sceneGroup.cuts.length}컷
                        </span>
                      </button>

                      {isGroupExpanded && sceneGroup.cuts.map(scene => {
                        const isCompleted = completedScenes.has(scene.id)
                        const isExpanded  = isSceneExpanded(scene.id)

                        return (
                          <div
                            key={scene.id}
                            className={cn('border-t transition-opacity', isCompleted && 'opacity-50')}
                            style={{ borderColor: 'var(--border-light)' }}
                          >
                            {/* ▶ 컷 헤더 (3단계) — secondary 톤 컬러바 */}
                            <button
                              onClick={() => toggleScene(scene.id)}
                              className="w-full flex items-center gap-2.5 py-2 text-left hover-surface transition-colors"
                              style={{
                                paddingLeft: '44px',
                                paddingRight: '12px',
                                borderLeft: '2px solid var(--text-muted)',
                              }}
                            >
                              {isExpanded
                                ? <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} />
                                : <ChevronRight size={13} style={{ color: 'var(--text-muted)' }} />
                              }
                              <SceneTag num={scene.scene_number} level="cut" />
                              <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                                {scene.title}
                              </span>
                              <AssigneePicker
                                projectId={scene.project_id}
                                sceneId={scene.id}
                                assignedTo={scene.assigned_to}
                              />
                              {pipelineChips?.(scene)}
                              {onToggleComplete && (
                                <CompleteButton completed={isCompleted} onClick={() => onToggleComplete(scene.id)} />
                              )}
                            </button>
                            {isExpanded && !isCompleted && renderScene(scene)}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
