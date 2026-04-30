'use client'

import { useState } from 'react'
import { Plus, ChevronDown, ChevronRight, Loader2, GitBranch, BookImage, Edit3, ImagePlus, X } from 'lucide-react'
import type { PromptAttempt, SatisfactionScore, AttemptType } from '@/types'
import SatisfactionRating from '@/components/ui/SatisfactionRating'
import Badge from '@/components/ui/Badge'
import { cn } from '@/lib/utils'

// 레퍼런스 이미지 선택 UI (작은 썸네일 그리드)
interface RefImage { id: string; url: string; name: string }

function ReferenceImagePicker({
  available,
  selected,
  onToggle,
}: {
  available: RefImage[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  const [open, setOpen] = useState(false)

  if (available.length === 0) return null

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-all hover-surface"
        style={{
          color: selected.size > 0 ? 'var(--accent)' : 'var(--text-muted)',
          border: `1px solid ${selected.size > 0 ? 'var(--accent-soft)' : 'var(--border)'}`,
        }}>
        <ImagePlus size={12} />
        {selected.size > 0 ? `레퍼런스 ${selected.size}장 선택됨` : '레퍼런스 이미지 추가'}
      </button>

      {open && (
        <div className="mt-2 p-3 rounded-xl border" style={{ background: 'var(--surface-3)', borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              레퍼런스 이미지 선택 (최대 3장)
            </p>
            <button onClick={() => setOpen(false)}>
              <X size={12} style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {available.map(img => {
              const isSel = selected.has(img.id)
              const isDisabled = !isSel && selected.size >= 3
              return (
                <button
                  key={img.id}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onToggle(img.id)}
                  className={cn(
                    'relative rounded-lg overflow-hidden aspect-square transition-all',
                    isDisabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:opacity-90',
                  )}
                  style={{
                    outline: isSel ? '2px solid var(--accent)' : '2px solid transparent',
                    outlineOffset: '2px',
                  }}>
                  <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                  {isSel && (
                    <div className="absolute inset-0 flex items-center justify-center"
                      style={{ background: 'var(--accent-soft)' }}>
                      <span className="text-white text-xs font-bold">✓</span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────

interface AttemptNodeProps {
  attempt: PromptAttempt
  type: AttemptType
  onRetry: (parentId: string, prompt: string, referenceUrls?: string[]) => void
  onScore: (outputId: string, score: SatisfactionScore) => void
  onArchive: (outputId: string) => void
  onSendToReference: (outputId: string) => void
  referenceAssets: RefImage[]
  depth?: number
}

function AttemptNode({
  attempt, type, onRetry, onScore, onArchive, onSendToReference,
  referenceAssets, depth = 0
}: AttemptNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const [retryPrompt, setRetryPrompt] = useState(attempt.prompt)
  const [showRetry, setShowRetry] = useState(false)
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set())

  function toggleRef(id: string) {
    setSelectedRefs(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const statusBadge = {
    pending:    <Badge variant="muted">대기</Badge>,
    generating: <Badge variant="warning">생성중</Badge>,
    done:       <Badge variant="success">완료</Badge>,
    failed:     <Badge variant="danger">실패</Badge>,
  }[attempt.status]

  function handleRetry() {
    const refUrls = referenceAssets.filter(r => selectedRefs.has(r.id)).map(r => r.url)
    onRetry(attempt.id, retryPrompt, refUrls.length > 0 ? refUrls : undefined)
    setShowRetry(false)
    setSelectedRefs(new Set())
    // 재시도 실행 시 현재 노드 자동 접기
    setExpanded(false)
  }

  return (
    <div className={cn(depth > 0 ? 'attempt-tree-line' : '')}>
      <div className="rounded-xl border prompt-card mb-3"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>

        {/* Attempt Header */}
        <div className="flex items-center gap-3 p-4">
          <button onClick={() => setExpanded(!expanded)} >
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <GitBranch size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            {depth > 0 ? `↳ 재시도 #${depth}` : '루트 시도'}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{attempt.engine}</span>
          {statusBadge}
          {/* 레퍼런스 첨부 표시 */}
          {(attempt as any).metadata?.reference_count > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              레퍼런스 {(attempt as any).metadata.reference_count}장
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setShowRetry(!showRetry)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all hover-surface"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            <Plus size={12} /> 재시도
          </button>
        </div>

        {/* Prompt */}
        {expanded && (
          <div className="px-4 pb-3 space-y-3">
            <div className="p-3 rounded-lg text-xs leading-relaxed"
              style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
              {attempt.prompt}
            </div>

            {/* Outputs Grid */}
            {attempt.outputs && attempt.outputs.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {attempt.outputs.map(output => (
                  <div key={output.id} className="rounded-lg overflow-hidden"
                    style={{ border: '1px solid var(--border)' }}>
                    <div className="aspect-video bg-[var(--bg-3)] relative">
                      {output.url ? (
                        <img src={output.url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <Loader2 size={20} className="animate-spin" />
                        </div>
                      )}
                      {output.archived && (
                        <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400" />
                      )}
                    </div>
                    <div className="p-2 space-y-1.5">
                      <SatisfactionRating
                        value={output.satisfaction_score}
                        onChange={score => onScore(output.id, score)}
                        size="sm"
                      />
                      <button
                        onClick={() => onArchive(output.id)}
                        className={cn(
                          'w-full text-[11px] py-0.5 rounded transition-all',
                          output.archived
                            ? 'bg-[var(--ok-soft)] '
                            : 'bg-[var(--bg-3)]  hover:bg-[var(--bg-4)]'
                        )}>
                        {output.archived ? '✓ 아카이브됨' : '아카이브'}
                      </button>
                      {/* 레퍼런스로 보내기 */}
                      {output.url && (
                        <button
                          onClick={() => onSendToReference(output.id)}
                          className="w-full flex items-center justify-center gap-1 text-[11px] py-0.5 rounded transition-all bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)]">
                          <BookImage size={10} /> 레퍼런스로
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Generating Skeleton */}
            {attempt.status === 'generating' && (
              <div className="grid grid-cols-2 gap-2">
                {[1, 2, 3].map(n => (
                  <div key={n} className="aspect-video rounded-lg bg-[var(--bg-3)] animate-pulse" />
                ))}
              </div>
            )}

            {/* Retry Form */}
            {showRetry && (
              <div className="space-y-2.5 p-3 rounded-lg" style={{ background: 'var(--surface-3)' }}>
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  수정된 프롬프트
                </label>
                <textarea value={retryPrompt} onChange={e => setRetryPrompt(e.target.value)}
                  rows={3} className="w-full px-2.5 py-2 rounded-lg text-xs resize-none"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                <ReferenceImagePicker
                  available={referenceAssets}
                  selected={selectedRefs}
                  onToggle={toggleRef}
                />
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleRetry}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                    style={{ background: 'var(--accent)' }}>
                    재시도 실행
                  </button>
                  <button onClick={() => setShowRetry(false)}
                    className="px-3 py-1.5 rounded-lg text-xs"
                    style={{ color: 'var(--text-secondary)' }}>
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Children */}
      {attempt.children?.map(child => (
        <AttemptNode key={child.id} attempt={child} type={type}
          onRetry={onRetry} onScore={onScore} onArchive={onArchive}
          onSendToReference={onSendToReference}
          referenceAssets={referenceAssets}
          depth={depth + 1} />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────

interface AttemptTreeProps {
  sceneId: string
  attempts: PromptAttempt[]
  type: AttemptType
  onNewAttempt: (sceneId: string, prompt: string, parentId?: string, referenceUrls?: string[]) => void
  onScore: (outputId: string, score: SatisfactionScore) => void
  onArchive: (outputId: string) => void
  onSendToReference?: (outputId: string) => void
  masterPrompt?: string
  referenceAssets?: RefImage[]
}

export default function AttemptTree({
  sceneId, attempts, type, onNewAttempt, onScore, onArchive,
  onSendToReference = () => {},
  masterPrompt,
  referenceAssets = [],
}: AttemptTreeProps) {
  const [prompt, setPrompt] = useState(masterPrompt ?? '')
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set())

  // 새 시도 추가 폼
  const [showNewForm, setShowNewForm] = useState(false)
  const [newPrompt, setNewPrompt] = useState(masterPrompt ?? '')
  const [newSelectedRefs, setNewSelectedRefs] = useState<Set<string>>(new Set())

  const rootAttempts = attempts.filter(a => !a.parent_id)

  function toggleRef(id: string) {
    setSelectedRefs(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }
  function toggleNewRef(id: string) {
    setNewSelectedRefs(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function handleFirstAttempt() {
    const refUrls = referenceAssets.filter(r => selectedRefs.has(r.id)).map(r => r.url)
    onNewAttempt(sceneId, prompt, undefined, refUrls.length > 0 ? refUrls : undefined)
  }

  function handleNewAttempt() {
    const refUrls = referenceAssets.filter(r => newSelectedRefs.has(r.id)).map(r => r.url)
    onNewAttempt(sceneId, newPrompt, undefined, refUrls.length > 0 ? refUrls : undefined)
    setShowNewForm(false)
    setNewSelectedRefs(new Set())
  }

  return (
    <div className="space-y-4">
      {/* ── 첫 번째 시도 ── */}
      {rootAttempts.length === 0 && (
        <div className="space-y-3 p-4 rounded-xl border"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            프롬프트 입력
          </label>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
            rows={4} placeholder="마스터 프롬프트를 기반으로 수정하거나 직접 입력하세요..."
            className="w-full px-3 py-2.5 rounded-lg text-sm resize-none"
            style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          <ReferenceImagePicker
            available={referenceAssets}
            selected={selectedRefs}
            onToggle={toggleRef}
          />
          <button
            onClick={handleFirstAttempt}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--accent)' }}>
            <Plus size={15} /> 생성 시작
          </button>
        </div>
      )}

      {/* ── Attempt Tree ── */}
      {rootAttempts.map(attempt => (
        <AttemptNode key={attempt.id} attempt={attempt} type={type}
          onRetry={(parentId, p, refUrls) => onNewAttempt(sceneId, p, parentId, refUrls)}
          onScore={onScore} onArchive={onArchive}
          onSendToReference={onSendToReference}
          referenceAssets={referenceAssets} />
      ))}

      {/* ── 새 시도 추가 ── */}
      {rootAttempts.length > 0 && (
        <div>
          {!showNewForm ? (
            <button
              onClick={() => { setNewPrompt(masterPrompt ?? ''); setNewSelectedRefs(new Set()); setShowNewForm(true) }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed text-sm transition-all hover:border-indigo-500/50 hover:"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
              <Edit3 size={14} /> 새 시도 추가 (프롬프트 수정)
            </button>
          ) : (
            <div className="space-y-3 p-4 rounded-xl border"
              style={{ background: 'var(--surface)', borderColor: 'var(--accent-soft)' }}>
              <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                새 시도 — 프롬프트 수정
              </label>
              <textarea
                value={newPrompt}
                onChange={e => setNewPrompt(e.target.value)}
                rows={4}
                placeholder="프롬프트를 수정하거나 그대로 사용하세요..."
                className="w-full px-3 py-2.5 rounded-lg text-sm resize-none"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
              <ReferenceImagePicker
                available={referenceAssets}
                selected={newSelectedRefs}
                onToggle={toggleNewRef}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleNewAttempt}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                  style={{ background: 'var(--accent)' }}>
                  <Plus size={14} /> 생성 시작
                </button>
                <button
                  onClick={() => setShowNewForm(false)}
                  className="px-4 py-2 rounded-lg text-sm"
                  style={{ color: 'var(--text-secondary)' }}>
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
