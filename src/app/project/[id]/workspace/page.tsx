'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  ChevronLeft, Sparkles, Check, RotateCcw, Trash2, X,
  Image as ImageIcon, Film, MessageCircle, Send, Loader2, Plus,
} from 'lucide-react'
import type { Scene, SatisfactionScore } from '@/types'
import Pill, { type PillVariant } from '@/components/ui/Pill'

interface PromptVersion {
  id: string
  version_label: string
  content: string
  is_current: boolean
  created_at: string
}

interface MasterPrompt {
  id: string
  content: string
  version: number
  created_at: string
}

interface OutputItem {
  id: string
  attempt_id: string
  url: string | null
  archived: boolean
  satisfaction_score: SatisfactionScore | null
  feedback: string
  type: 't2i' | 'i2v' | 'lipsync'
  engine: string
  created_at: string
}

interface CommentRow {
  id: string
  user_id: string
  content: string
  created_at: string
  output_id: string | null
}

const REASON_TAGS = [
  '색감', '카메라 각도', '구도', '분위기', '표정', '움직임', '공간감', '레퍼런스 불일치',
]

export default function WorkspacePage() {
  const { id: projectId } = useParams<{ id: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const supabase = createClient()

  const [scenes, setScenes] = useState<Scene[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [masterPrompts, setMasterPrompts] = useState<MasterPrompt[]>([])
  const [outputs, setOutputs] = useState<OutputItem[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [compareMode, setCompareMode] = useState(false)
  const [comments, setComments] = useState<CommentRow[]>([])
  const [draft, setDraft] = useState('')
  const [meId, setMeId] = useState<string | null>(null)
  const [decisionFor, setDecisionFor] = useState<string | null>(null)
  const [decisionReasons, setDecisionReasons] = useState<string[]>([])
  const [decisionNote, setDecisionNote] = useState('')

  // 씬 목록 + 활성 씬 결정
  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setMeId(user?.id ?? null)

      const { data } = await supabase
        .from('scenes')
        .select('*')
        .eq('project_id', projectId)
        .order('order_index')
      const list = (data ?? []) as Scene[]
      setScenes(list)
      const want = search.get('scene')
      if (want && list.find(s => s.id === want)) setActiveId(want)
      else if (list.length > 0) setActiveId(list[0].id)
    })()
  }, [projectId, supabase, search])

  // 씬 변경 시 데이터 로드
  const loadSceneData = useCallback(async (sceneId: string) => {
    // master prompts (fallback when prompt_versions empty)
    const { data: mp } = await supabase
      .from('master_prompts')
      .select('id, content, version, created_at')
      .eq('scene_id', sceneId)
      .order('version', { ascending: false })
    setMasterPrompts((mp ?? []) as MasterPrompt[])

    // prompt_versions (새 스키마, 있으면 우선)
    const { data: pv } = await supabase
      .from('prompt_versions')
      .select('id, version_label, content, is_current, created_at')
      .eq('scene_id', sceneId)
      .order('created_at', { ascending: false })
    setVersions((pv ?? []) as PromptVersion[])

    // attempts + outputs
    const { data: attempts } = await supabase
      .from('prompt_attempts')
      .select('id, type, engine, status, created_at, outputs:attempt_outputs(*, asset:assets(url))')
      .eq('scene_id', sceneId)
      .order('created_at', { ascending: false })

    const flat: OutputItem[] = []
    for (const a of (attempts ?? []) as any[]) {
      for (const o of (a.outputs ?? [])) {
        flat.push({
          id: o.id,
          attempt_id: a.id,
          url: o.url ?? o.asset?.url ?? null,
          archived: o.archived ?? false,
          satisfaction_score: o.satisfaction_score,
          feedback: o.feedback ?? '',
          type: a.type,
          engine: a.engine,
          created_at: o.created_at ?? a.created_at,
        })
      }
    }
    setOutputs(flat)
    setSelectedIds(flat.length > 0 ? [flat[0].id] : [])

    // shot_comments (새 스키마)
    const { data: cm } = await supabase
      .from('shot_comments')
      .select('id, user_id, content, created_at, output_id')
      .eq('scene_id', sceneId)
      .order('created_at', { ascending: true })
    setComments((cm ?? []) as CommentRow[])
  }, [supabase])

  useEffect(() => {
    if (!activeId) return
    void loadSceneData(activeId)
  }, [activeId, loadSceneData])

  // Realtime 코멘트
  useEffect(() => {
    if (!activeId) return
    const ch = supabase
      .channel(`shot-comments-${activeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'shot_comments', filter: `scene_id=eq.${activeId}` },
        (payload) => {
          const row = payload.new as any
          setComments(prev => prev.some(c => c.id === row.id) ? prev : [...prev, row])
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [activeId, supabase])

  const active = scenes.find(s => s.id === activeId) || null
  const candidates = outputs
  const focused = outputs.find(o => o.id === selectedIds[0]) || candidates[0] || null
  const currentPrompt = versions.find(v => v.is_current) ?? versions[0] ?? null
  const currentMP = masterPrompts[0] ?? null

  function toggleSelect(id: string) {
    if (compareMode) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= 4 ? prev : [...prev, id])
    } else {
      setSelectedIds([id])
    }
  }

  async function postComment() {
    if (!draft.trim() || !meId || !activeId) return
    const content = draft.trim()
    setDraft('')
    const { data, error } = await supabase
      .from('shot_comments')
      .insert({
        scene_id: activeId, user_id: meId, content,
        output_id: selectedIds[0] ?? null,
      })
      .select()
      .single()
    if (error) { alert('코멘트 저장 실패: ' + error.message); setDraft(content); return }
    if (data) setComments(prev => [...prev, data as any])
  }

  async function submitDecision(decision: 'approved' | 'revise_requested' | 'removed') {
    if (!decisionFor || !meId || !activeId) return
    const { error } = await supabase
      .from('shot_decisions')
      .insert({
        output_id: decisionFor,
        scene_id: activeId,
        decision_type: decision,
        reason_tags: decisionReasons,
        comment: decisionNote,
        decided_by: meId,
      })
    if (error) { alert('결정 저장 실패: ' + error.message); return }
    // archived 필드도 같이 갱신
    if (decision === 'approved') {
      await supabase.from('attempt_outputs').update({ archived: true, satisfaction_score: 5 }).eq('id', decisionFor)
    } else if (decision === 'removed') {
      await supabase.from('attempt_outputs').update({ archived: false, satisfaction_score: 1 }).eq('id', decisionFor)
    }
    setDecisionFor(null); setDecisionReasons([]); setDecisionNote('')
    void loadSceneData(activeId)
  }

  if (!active) {
    return (
      <div className="h-full flex items-center justify-center" style={{ color: 'var(--ink-4)' }}>
        씬이 없습니다. 씬 분류에서 씬을 만든 뒤 다시 들어와주세요.
      </div>
    )
  }

  return (
    <div className="h-full grid overflow-hidden" style={{ gridTemplateColumns: '320px 1fr 340px' }}>
      {/* LEFT — Shot Brief */}
      <aside style={{ borderRight: '1px solid var(--line)', overflow: 'auto', background: 'var(--bg-1)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <button
              onClick={() => router.push(`/project/${projectId}/scenes`)}
              style={{ padding: '2px 6px', color: 'var(--ink-3)' }}
              title="씬 분류로"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="mono" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{active.scene_number}</span>
            <Pill variant="review" showDot>검토 필요</Pill>
          </div>
          <h2 style={{ margin: '4px 0', fontSize: 16, fontWeight: 600, lineHeight: 1.3, color: 'var(--ink)' }}>
            {active.title || '제목 없음'}
          </h2>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {active.content || '내용 없음'}
          </div>
        </div>

        {/* Scene navigator */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div className="field-label">씬 이동</div>
          <div className="flex flex-col" style={{ gap: 4 }}>
            {scenes.map(s => (
              <button
                key={s.id}
                onClick={() => { setActiveId(s.id); router.replace(`/project/${projectId}/workspace?scene=${s.id}`) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', borderRadius: 'var(--r-sm)',
                  background: activeId === s.id ? 'var(--bg-3)' : 'transparent',
                  color: activeId === s.id ? 'var(--ink)' : 'var(--ink-3)',
                  fontSize: 12, textAlign: 'left',
                }}
              >
                <span className="mono" style={{ minWidth: 36, color: 'var(--accent)' }}>{s.scene_number}</span>
                <span className="truncate flex-1">{s.title || '(제목 없음)'}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Prompt versions */}
        <div style={{ padding: '14px 16px' }}>
          <div className="flex items-center" style={{ marginBottom: 8 }}>
            <span className="field-label" style={{ margin: 0 }}>PROMPT</span>
            <span style={{ flex: 1 }} />
            <Link
              href={`/project/${projectId}/scenes`}
              style={{
                padding: '4px 8px',
                fontSize: 11,
                color: 'var(--ink-3)',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--line)',
              }}
            >
              <Sparkles size={11} style={{ display: 'inline', marginRight: 4 }} />
              씬 분류로
            </Link>
          </div>
          <div className="flex flex-col" style={{ gap: 6, marginBottom: 12 }}>
            {versions.length > 0 ? versions.map(pv => (
              <div
                key={pv.id}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 'var(--r-sm)',
                  border: `1px solid ${pv.is_current ? 'var(--accent-line)' : 'var(--line)'}`,
                  background: pv.is_current ? 'var(--accent-soft)' : 'var(--bg-2)',
                }}
              >
                <div className="flex items-center" style={{ marginBottom: 3, gap: 6 }}>
                  <span className="mono" style={{ fontSize: 11, color: pv.is_current ? 'var(--accent-2)' : 'var(--ink-3)', fontWeight: 600 }}>
                    {pv.version_label}
                  </span>
                  {pv.is_current && <Pill variant="ready">current</Pill>}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                    {new Date(pv.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {pv.content}
                </div>
              </div>
            )) : currentMP ? (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--r-sm)',
                  border: '1px solid var(--accent-line)',
                  background: 'var(--accent-soft)',
                }}
              >
                <div className="flex items-center" style={{ marginBottom: 3, gap: 6 }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--accent-2)', fontWeight: 600 }}>
                    v{currentMP.version}
                  </span>
                  <Pill variant="ready">current</Pill>
                </div>
                <div
                  style={{
                    fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {currentMP.content}
                </div>
              </div>
            ) : (
              <div className="empty" style={{ padding: '16px 12px' }}>아직 프롬프트가 없어요</div>
            )}
          </div>

          <Link
            href={`/project/${projectId}/t2i?scene=${active.id}`}
            className="flex items-center justify-center gap-2"
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--r-md)',
              fontSize: 12, fontWeight: 500,
              background: 'transparent',
              border: '1px solid var(--line-strong)',
              color: 'var(--ink-2)',
            }}
          >
            <Sparkles size={13} /> 새 시도 — Generation
          </Link>
        </div>
      </aside>

      {/* CENTER — Results */}
      <main style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Toolbar */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--line)',
            position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg)',
          }}
        >
          <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Results</h3>
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              · {candidates.length} candidates
            </span>
            <span style={{ flex: 1 }} />
            <button
              onClick={() => setCompareMode(v => !v)}
              style={{
                padding: '4px 10px',
                borderRadius: 'var(--r-md)',
                fontSize: 11, fontWeight: 500,
                background: compareMode ? 'var(--accent)' : 'transparent',
                color: compareMode ? '#fff' : 'var(--ink-2)',
                border: '1px solid var(--line-strong)',
              }}
            >
              Compare {compareMode && `(${selectedIds.length})`}
            </button>
          </div>
        </div>

        {/* 본문 */}
        {compareMode ? (
          <div style={{ padding: '18px 20px' }}>
            <div
              style={{
                padding: '10px 12px', background: 'var(--accent-soft)',
                border: '1px solid var(--accent-line)',
                borderRadius: 'var(--r-md)', marginBottom: 14, fontSize: 12, color: 'var(--ink-2)',
              }}
            >
              <strong>비교 모드</strong> — 결과를 클릭해 최대 4개까지 선택. Shot Intent 기준으로 평가하세요.
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(2, selectedIds.length)}, 1fr)`,
                gap: 12,
              }}
            >
              {selectedIds.map(rid => {
                const r = candidates.find(x => x.id === rid)
                if (!r) return null
                return <CompareCell key={rid} item={r} onRemove={() => toggleSelect(rid)} onDecide={(d) => setDecisionFor(rid)} />
              })}
              {selectedIds.length < 4 && (
                <div
                  style={{
                    aspectRatio: '1', border: '1px dashed var(--line-strong)',
                    borderRadius: 'var(--r-md)',
                    display: 'grid', placeItems: 'center',
                    color: 'var(--ink-4)', fontSize: 11,
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <Plus size={18} />
                    <div style={{ marginTop: 6 }}>아래에서 선택</div>
                  </div>
                </div>
              )}
            </div>

            <div className="divider" />
            <div className="field-label">선택 가능한 후보</div>
            <CandidateStrip items={candidates} selected={selectedIds} onToggle={toggleSelect} />
          </div>
        ) : (
          /* Single hero + strip */
          <div style={{ padding: '18px 20px' }}>
            {focused ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18, marginBottom: 24 }}>
                <div className="card overflow-hidden" style={{ padding: 0 }}>
                  <div style={{ aspectRatio: '16/9', background: 'var(--bg-3)', position: 'relative' }}>
                    {focused.url
                      ? (focused.type === 't2i'
                        ? <img src={focused.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <video src={focused.url} controls style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
                      : <div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin" /></div>}
                  </div>
                </div>
                <div className="card-pad" style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-lg)' }}>
                  <div className="flex items-center" style={{ gap: 8, marginBottom: 12 }}>
                    <Pill variant="gen">{focused.type.toUpperCase()}</Pill>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{focused.engine}</span>
                  </div>
                  <div className="field-label">결정</div>
                  <div className="flex flex-col" style={{ gap: 6, marginBottom: 12 }}>
                    <DecisionButton
                      type="approved" label="승인 — Approved"
                      onClick={() => setDecisionFor(focused.id)}
                    />
                    <DecisionButton
                      type="revise_requested" label="수정 요청 — Revise"
                      onClick={() => setDecisionFor(focused.id)}
                    />
                    <DecisionButton
                      type="removed" label="제거 — Remove"
                      onClick={() => setDecisionFor(focused.id)}
                    />
                  </div>
                  {focused.feedback && (
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', padding: 8, background: 'var(--bg-1)', borderRadius: 'var(--r-sm)' }}>
                      <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>피드백</div>
                      {focused.feedback}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="empty" style={{ marginBottom: 18 }}>
                생성된 결과가 없어요. T2I 페이지에서 시도를 만들어주세요.
              </div>
            )}

            <div className="field-label">후보 ({candidates.length})</div>
            <CandidateStrip items={candidates} selected={selectedIds} onToggle={toggleSelect} />
          </div>
        )}
      </main>

      {/* RIGHT — Comments */}
      <aside style={{ borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', background: 'var(--bg-1)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }} className="flex items-center gap-2">
          <MessageCircle size={13} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>코멘트</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{comments.length}</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {comments.length === 0 ? (
            <div className="empty" style={{ padding: 16, fontSize: 12 }}>아직 코멘트가 없어요</div>
          ) : (
            <div className="flex flex-col" style={{ gap: 10 }}>
              {comments.map(c => (
                <div key={c.id} style={{ background: 'var(--bg-2)', padding: 10, borderRadius: 'var(--r-md)', border: '1px solid var(--line)' }}>
                  <div className="flex items-center" style={{ gap: 6, marginBottom: 4, fontSize: 10, color: 'var(--ink-4)' }}>
                    <span>{c.user_id === meId ? '나' : '멤버'}</span>
                    <span>·</span>
                    <span>{new Date(c.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {c.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: 10 }} className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void postComment() } }}
            rows={2}
            placeholder="이 결과에 코멘트... (Enter로 전송)"
            style={{
              flex: 1,
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)',
              padding: '6px 10px',
              color: 'var(--ink)',
              fontSize: 12,
              outline: 'none',
              resize: 'none',
            }}
          />
          <button
            onClick={() => void postComment()}
            disabled={!draft.trim()}
            style={{
              padding: 8,
              borderRadius: 'var(--r-md)',
              background: 'var(--accent)',
              color: '#fff',
              border: '1px solid var(--accent)',
              opacity: draft.trim() ? 1 : 0.4,
            }}
          >
            <Send size={13} />
          </button>
        </div>
      </aside>

      {/* Decision modal */}
      {decisionFor && (
        <DecisionModal
          onClose={() => { setDecisionFor(null); setDecisionReasons([]); setDecisionNote('') }}
          reasons={decisionReasons}
          note={decisionNote}
          onReasonsChange={setDecisionReasons}
          onNoteChange={setDecisionNote}
          onSubmit={submitDecision}
        />
      )}
    </div>
  )
}

// ─── 후보 strip ─────────────────────────────────────────────────
function CandidateStrip({
  items, selected, onToggle,
}: { items: OutputItem[]; selected: string[]; onToggle: (id: string) => void }) {
  if (items.length === 0) return <div className="empty" style={{ padding: 16, fontSize: 12 }}>후보 없음</div>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
      {items.map(r => {
        const sel = selected.includes(r.id)
        return (
          <button
            key={r.id}
            onClick={() => onToggle(r.id)}
            style={{
              aspectRatio: '16/9', borderRadius: 'var(--r-sm)', overflow: 'hidden',
              border: `2px solid ${sel ? 'var(--accent)' : 'var(--line)'}`,
              background: 'var(--bg-3)', cursor: 'pointer', position: 'relative', padding: 0,
            }}
          >
            {r.url
              ? (r.type === 't2i'
                ? <img src={r.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <video src={r.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
              : <div style={{ width: '100%', height: '100%', background: 'var(--bg-3)' }} />}
            <div style={{ position: 'absolute', inset: 0, background: sel ? 'rgba(249,115,22,0.15)' : 'transparent' }} />
            {r.archived && (
              <div style={{ position: 'absolute', top: 4, right: 4 }}>
                <Pill variant="approved">승인</Pill>
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── 비교 모드 셀 ───────────────────────────────────────────────
function CompareCell({
  item, onRemove, onDecide,
}: { item: OutputItem; onRemove: () => void; onDecide: (d: 'approved' | 'revise_requested') => void }) {
  return (
    <div className="card" style={{ padding: 0, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
      <div style={{ aspectRatio: '16/9', background: 'var(--bg-3)', position: 'relative' }}>
        {item.url
          ? (item.type === 't2i'
            ? <img src={item.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <video src={item.url} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
          : <div style={{ width: '100%', height: '100%' }} />}
        <div style={{ position: 'absolute', top: 6, left: 6 }}>
          <Pill variant="gen">{item.type.toUpperCase()}</Pill>
        </div>
      </div>
      <div style={{ padding: 10, fontSize: 11 }}>
        <div className="flex items-center" style={{ marginBottom: 8 }}>
          <span className="mono" style={{ color: 'var(--ink-3)' }}>{item.engine}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onRemove} style={{ padding: 4, color: 'var(--ink-4)' }}><X size={11} /></button>
        </div>
        <div className="flex flex-col" style={{ gap: 6 }}>
          <button
            onClick={() => onDecide('approved')}
            style={{
              padding: '5px 10px', borderRadius: 'var(--r-sm)', fontSize: 11,
              background: 'var(--ok-soft)', color: 'var(--ok)', border: '1px solid var(--ok-soft)',
            }}
          >Approve</button>
          <button
            onClick={() => onDecide('revise_requested')}
            style={{
              padding: '5px 10px', borderRadius: 'var(--r-sm)', fontSize: 11,
              background: 'var(--accent-soft)', color: 'var(--accent-2)', border: '1px solid var(--accent-line)',
            }}
          >Revise</button>
        </div>
      </div>
    </div>
  )
}

// ─── 결정 버튼 ──────────────────────────────────────────────────
function DecisionButton({
  type, label, onClick,
}: { type: 'approved' | 'revise_requested' | 'removed'; label: string; onClick: () => void }) {
  const palette = {
    approved: { bg: 'var(--ok-soft)', color: 'var(--ok)', icon: <Check size={13} /> },
    revise_requested: { bg: 'var(--accent-soft)', color: 'var(--accent-2)', icon: <RotateCcw size={13} /> },
    removed: { bg: 'var(--danger-soft)', color: 'var(--danger)', icon: <Trash2 size={13} /> },
  }[type]
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-2"
      style={{
        padding: '8px 12px',
        borderRadius: 'var(--r-md)',
        fontSize: 12, fontWeight: 500,
        background: palette.bg, color: palette.color,
        border: `1px solid ${palette.bg}`,
      }}
    >
      {palette.icon} {label}
    </button>
  )
}

// ─── 결정 모달 ──────────────────────────────────────────────────
function DecisionModal({
  onClose, reasons, note, onReasonsChange, onNoteChange, onSubmit,
}: {
  onClose: () => void
  reasons: string[]
  note: string
  onReasonsChange: (next: string[]) => void
  onNoteChange: (next: string) => void
  onSubmit: (d: 'approved' | 'revise_requested' | 'removed') => void
}) {
  function toggle(tag: string) {
    onReasonsChange(reasons.includes(tag) ? reasons.filter(r => r !== tag) : [...reasons, tag])
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 fade-in"
      style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md shadow-lg"
        style={{
          background: 'var(--bg-2)', border: '1px solid var(--line)',
          borderRadius: 'var(--r-xl)', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', background: 'var(--bg-1)' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>이 결과 결정</h2>
          <p style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-3)' }}>이유 태그와 짧은 코멘트를 남겨주세요.</p>
        </div>
        <div style={{ padding: 16 }}>
          <div className="field-label">이유 태그 (선택)</div>
          <div className="flex flex-wrap" style={{ gap: 6, marginBottom: 14 }}>
            {REASON_TAGS.map(tag => {
              const sel = reasons.includes(tag)
              return (
                <button
                  key={tag}
                  onClick={() => toggle(tag)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    fontSize: 11,
                    background: sel ? 'var(--accent-soft)' : 'var(--bg-3)',
                    color: sel ? 'var(--accent)' : 'var(--ink-3)',
                    border: `1px solid ${sel ? 'var(--accent-line)' : 'var(--line)'}`,
                  }}
                >
                  {tag}
                </button>
              )
            })}
          </div>

          <div className="field-label">코멘트 (선택)</div>
          <textarea
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            rows={3}
            placeholder="추가 메모..."
            style={{
              width: '100%',
              background: 'var(--bg-1)', border: '1px solid var(--line)',
              borderRadius: 'var(--r-md)', padding: 10, fontSize: 12,
              color: 'var(--ink)', outline: 'none', resize: 'none',
              marginBottom: 14,
            }}
          />

          <div className="flex flex-col" style={{ gap: 6 }}>
            <DecisionButton type="approved" label="승인 — Approved" onClick={() => onSubmit('approved')} />
            <DecisionButton type="revise_requested" label="수정 요청 — Revise" onClick={() => onSubmit('revise_requested')} />
            <DecisionButton type="removed" label="제거 — Remove" onClick={() => onSubmit('removed')} />
            <button
              onClick={onClose}
              style={{
                marginTop: 4, padding: '8px 12px', borderRadius: 'var(--r-md)',
                fontSize: 12, color: 'var(--ink-4)', background: 'transparent',
                border: '1px solid transparent',
              }}
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
