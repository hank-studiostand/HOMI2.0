'use client'

import { useState, useRef } from 'react'
import { ChevronDown, ChevronRight, Edit2, Check, X, Wand2, Copy, CheckCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Scene } from '@/types'
import Badge from '@/components/ui/Badge'
import AssigneePicker from './AssigneePicker'

interface SceneCardProps {
  scene: Scene
  onUpdate: (id: string, updates: Partial<Scene>) => void
  onGeneratePrompt: (sceneId: string) => void
  isGenerating?: boolean
  onExpand?: (expanded: boolean) => void   // 토글 열림 여부 부모에 알림
  originalContent?: string                 // 씬 경계 편집 원본 텍스트
}

export default function SceneCard({ scene, onUpdate, onGeneratePrompt, isGenerating, onExpand, originalContent }: SceneCardProps) {
  const [expanded, setExpanded] = useState(false)

  function handleToggleExpand() {
    const next = !expanded
    setExpanded(next)
    onExpand?.(next)
  }
  const [editing, setEditing] = useState<'number' | 'title' | 'content' | null>(null)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const composing = useRef(false)

  function copyPrompt(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function startEdit(field: 'number' | 'title' | 'content') {
    setEditing(field)
    setDraft(field === 'number' ? scene.scene_number : field === 'title' ? scene.title : scene.content)
  }

  function saveEdit() {
    if (!editing) return
    const updates: Partial<Scene> = {}
    if (editing === 'number') updates.scene_number = draft
    if (editing === 'title') updates.title = draft
    if (editing === 'content') updates.content = draft
    onUpdate(scene.id, updates)
    setEditing(null)
  }

  // Supabase는 master_prompts를 배열로 반환 — 가장 최신 버전 추출
  const masterPrompt = Array.isArray(scene.master_prompt)
    ? scene.master_prompt.sort((a: any, b: any) => b.version - a.version)[0]
    : scene.master_prompt
  const hasMasterPrompt = !!masterPrompt?.content

  return (
    <div
      className="rounded-xl border prompt-card overflow-hidden"
      style={{
        background: 'var(--surface)',
        borderColor: expanded ? 'var(--accent)' : 'var(--border)',
        borderLeft: '4px solid var(--accent)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 p-4"
        style={{ background: expanded ? 'var(--accent-subtle)' : 'transparent' }}
      >
        <button onClick={handleToggleExpand}
          className="transition-colors" style={{ color: 'var(--accent)' }}>
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>

        {/* Scene Number */}
        {editing === 'number' ? (
          <div className="flex items-center gap-1">
            <input value={draft} onChange={e => setDraft(e.target.value)}
              className="w-20 px-2 py-0.5 rounded text-sm font-mono"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--accent)', color: 'var(--text-primary)' }}
              autoFocus onKeyDown={e => { if(e.key === 'Enter') saveEdit(); if(e.key === 'Escape') setEditing(null) }} />
            <button onClick={saveEdit}><Check size={14} className="text-emerald-400" /></button>
            <button onClick={() => setEditing(null)}><X size={14} className="text-red-400" /></button>
          </div>
        ) : (
          <button onClick={() => startEdit('number')}
            className="flex items-center gap-1 group">
            <Badge variant="accent" className="font-mono">S{scene.scene_number}</Badge>
            <Edit2 size={11} className="text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}

        {/* Title */}
        <div className="flex-1 flex items-center gap-2">
          {editing === 'title' ? (
            <div className="flex items-center gap-1 flex-1">
              <input value={draft}
                onChange={e => setDraft(e.target.value)}
                onCompositionStart={() => { composing.current = true }}
                onCompositionEnd={e => { composing.current = false; setDraft((e.target as HTMLInputElement).value) }}
                className="flex-1 px-2 py-0.5 rounded text-sm"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--accent)', color: 'var(--text-primary)' }}
                autoFocus onKeyDown={e => { if(e.key === 'Enter' && !composing.current) saveEdit(); if(e.key === 'Escape') setEditing(null) }} />
              <button onClick={saveEdit}><Check size={14} className="text-emerald-400" /></button>
              <button onClick={() => setEditing(null)}><X size={14} className="text-red-400" /></button>
            </div>
          ) : (
            <button onClick={() => startEdit('title')}
              className="flex items-center gap-1 group text-left">
              <span className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {scene.title || '제목 없음'}
              </span>
              <Edit2 size={11} className="text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <AssigneePicker
            projectId={scene.project_id}
            sceneId={scene.id}
            assignedTo={scene.assigned_to}
            onAssigned={(uid) => onUpdate(scene.id, { assigned_to: uid })}
          />
          {hasMasterPrompt && <Badge variant="success">프롬프트 완성</Badge>}
          <button
            onClick={() => onGeneratePrompt(scene.id)}
            disabled={isGenerating}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'
            )}
            style={{ background: 'var(--accent)', color: 'white' }}>
            <Wand2 size={13} className={isGenerating ? 'animate-spin' : ''} />
            {isGenerating ? '생성중...' : '마스터 프롬프트'}
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: 'var(--border)' }}>
          {/* 씬 경계 편집 원본 */}
          {originalContent && (
            <div className="pt-4">
              <label className="text-[10px] font-semibold mb-1.5 block uppercase tracking-wide"
                style={{ color: 'var(--text-muted)' }}>대본 원문 (씬 경계 편집)</label>
              <div className="p-3 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed"
                  style={{ color: 'var(--text-muted)' }}>{originalContent}</pre>
              </div>
            </div>
          )}

          {/* Scene Content */}
          <div className="pt-4">
            <label className="text-xs font-medium mb-2 block" style={{ color: 'var(--text-secondary)' }}>씬 내용</label>
            {editing === 'content' ? (
              <div className="space-y-2">
                <textarea value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onCompositionStart={() => { composing.current = true }}
                  onCompositionEnd={e => { composing.current = false; setDraft((e.target as HTMLTextAreaElement).value) }}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg text-sm resize-none"
                  style={{ background: 'var(--surface-3)', border: '1px solid var(--accent)', color: 'var(--text-primary)' }}
                  autoFocus />
                <div className="flex gap-2">
                  <button onClick={saveEdit} className="flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-emerald-600 text-white">
                    <Check size={12} /> 저장
                  </button>
                  <button onClick={() => setEditing(null)} className="flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-zinc-700 text-zinc-300">
                    <X size={12} /> 취소
                  </button>
                </div>
              </div>
            ) : (
              <div onClick={() => startEdit('content')}
                className="p-3 rounded-lg text-sm cursor-pointer hover:border-indigo-500/50 transition-colors"
                style={{ background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{scene.content}</pre>
              </div>
            )}
          </div>

          {/* Master Prompt Preview */}
          {hasMasterPrompt && (
            <div className="p-3 rounded-lg" style={{ background: 'var(--surface-3)', border: '1px solid rgba(99,102,241,0.3)' }}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-indigo-400">마스터 프롬프트</label>
                <div className="flex items-center gap-2">
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>v{masterPrompt?.version}</span>
                  <button
                    onClick={() => copyPrompt(masterPrompt?.content ?? '')}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-all hover:opacity-80"
                    style={{
                      background: copied ? 'rgba(52,211,153,0.15)' : 'rgba(99,102,241,0.15)',
                      color: copied ? '#34d399' : '#818cf8',
                      border: `1px solid ${copied ? 'rgba(52,211,153,0.3)' : 'rgba(99,102,241,0.3)'}`,
                    }}
                  >
                    {copied
                      ? <><CheckCheck size={10} /> 복사됨</>
                      : <><Copy size={10} /> 복사</>}
                  </button>
                </div>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {masterPrompt?.content}
              </p>
              {masterPrompt?.negative_prompt && (
                <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] text-red-400/70">Negative</span>
                    <button
                      onClick={() => copyPrompt(masterPrompt?.negative_prompt ?? '')}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-all hover:opacity-80"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
                    >
                      <Copy size={9} /> 복사
                    </button>
                  </div>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{masterPrompt.negative_prompt}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
