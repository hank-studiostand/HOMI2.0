'use client'

import { useState, useEffect } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import { createClient } from '@/lib/supabase/client'
import { sortScenesByNumber } from '@/lib/sceneSort'
import { useParams } from 'next/navigation'
import { Plus, Loader2, ChevronRight, ChevronDown, Wand2, X, Image as ImageIcon, LayoutGrid, Columns3, Timer } from 'lucide-react'
import Pill from '@/components/ui/Pill'
import SceneCard from '@/components/scene/SceneCard'
import SceneBoardCard from '@/components/scene/SceneBoardCard'
import SceneSettings from '@/components/scene/SceneSettings'
import SceneTreeView from '@/components/scene/SceneTreeView'
import type { Scene, SceneSettings as SceneSettingsType, RootAssetSeed, Asset } from '@/types'
import Link from 'next/link'

const lsKey = (pid: string) => `scene-editor-${pid}`

function getLocalSceneContent(
  sceneNumber: string,
  localScenes: { id: string; content: string }[],
): string {
  if (localScenes.length === 0) return ''
  const mainIdx = parseInt(sceneNumber.split('-')[0], 10) - 1
  if (isNaN(mainIdx) || mainIdx < 0) return ''
  return localScenes[mainIdx]?.content ?? ''
}

export default function ScenesPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [scenes, setScenes]         = useState<Scene[]>([])
  const [loading, setLoading]       = useState(true)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [promptError, setPromptError]   = useState<string | null>(null)
  const [expanded, setExpanded]         = useState<Set<string>>(new Set())
  const [expandedScene, setExpandedScene] = useLocalState<string | null>(`expanded-scenes-${projectId}`, null)
  const [completedScenes, setCompletedScenes] = useState<Set<string>>(new Set())
  const [localScenes, setLocalScenes]   = useState<{ id: string; content: string }[]>([])
  const [bulkGenerating, setBulkGenerating] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null)
  const [bulkMessage, setBulkMessage] = useState<string | null>(null)
  const [rootAssets, setRootAssets] = useState<RootAssetSeed[]>([])
  const [libraryAssets, setLibraryAssets] = useState<Asset[]>([])
  const [pickerOpen, setPickerOpen] = useState<{ sceneId: string; category: string } | null>(null)
  const [viewMode, setViewMode] = useState<'cards' | 'kanban' | 'timeline'>('cards')
  const [sceneStats, setSceneStats] = useState<Map<string, { hasMP: boolean; t2iDone: number; i2vDone: number }>>(new Map())

  const supabase = createClient()

  useEffect(() => {
    try {
      const raw = localStorage.getItem(lsKey(projectId))
      if (raw) setLocalScenes(JSON.parse(raw))
    } catch {}
  }, [projectId])

  useEffect(() => {
    fetchScenes()
    fetchRootAssets()
    fetchLibraryAssets()
    const channel = supabase.channel('scenes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scenes', filter: `project_id=eq.${projectId}` },
        () => fetchScenes())
      .subscribe()
    const assetChannel = supabase.channel('root-assets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'root_asset_seeds', filter: `project_id=eq.${projectId}` },
        () => fetchRootAssets())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(assetChannel)
    }
  }, [projectId])

  async function fetchScenes() {
    const { data } = await supabase
      .from('scenes')
      .select('*, settings:scene_settings(*), master_prompt:master_prompts(content, negative_prompt, version)')
      .eq('project_id', projectId)
      .order('order_index')
    setScenes(sortScenesByNumber(data ?? []))
    setLoading(false)
  }

  async function fetchRootAssets() {
    const { data } = await supabase
      .from('root_asset_seeds')
      .select('*')
      .eq('project_id', projectId)
    setRootAssets(data ?? [])
  }

  async function fetchLibraryAssets() {
    const { data } = await supabase
      .from('assets')
      .select('*')
      .eq('project_id', projectId)
      .eq('type', 'reference')
    setLibraryAssets(data ?? [])
  }

  // 씬 stats — kanban / timeline 상태 분류용 (한 번의 쿼리로 batch)
  useEffect(() => {
    if (scenes.length === 0) return
    const ids = scenes.map(s => s.id)
    void (async () => {
      const [{ data: mps }, { data: atts }] = await Promise.all([
        supabase.from('master_prompts').select('scene_id').in('scene_id', ids),
        supabase.from('prompt_attempts').select('scene_id, type, status').in('scene_id', ids),
      ])
      const map = new Map<string, { hasMP: boolean; t2iDone: number; i2vDone: number }>()
      for (const id of ids) map.set(id, { hasMP: false, t2iDone: 0, i2vDone: 0 })
      for (const m of (mps ?? []) as any[]) {
        const e = map.get(m.scene_id); if (e) e.hasMP = true
      }
      for (const a of (atts ?? []) as any[]) {
        const e = map.get(a.scene_id); if (!e) continue
        if (a.status === 'done') {
          if (a.type === 't2i') e.t2iDone++
          else if (a.type === 'i2v') e.i2vDone++
        }
      }
      setSceneStats(map)
    })()
  }, [scenes, supabase])

  const sceneStatusOf = (sceneId: string): { key: 'draft' | 'gen' | 'review' | 'approved'; label: string } => {
    const s = sceneStats.get(sceneId)
    if (!s) return { key: 'draft', label: 'Draft' }
    if (s.i2vDone > 0) return { key: 'approved', label: '완료' }
    if (s.t2iDone > 0) return { key: 'review', label: '검토' }
    if (s.hasMP) return { key: 'gen', label: '생산중' }
    return { key: 'draft', label: 'Draft' }
  }

  async function updateScene(id: string, updates: Partial<Scene>) {
    await supabase.from('scenes').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
    setScenes(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
  }

  async function generateMasterPrompt(sceneId: string) {
    setGeneratingId(sceneId)
    setPromptError(null)
    try {
      const res = await fetch('/api/prompts/master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId }),
      })
      const data = await res.json()
      if (!res.ok) setPromptError(data.error ?? '마스터 프롬프트 생성 실패')
    } catch (err) {
      console.error('[scenes] 마스터 프롬프트 요청 실패:', err)
      setPromptError(err instanceof Error ? '네트워크 오류: ' + err.message : '네트워크 오류')
    } finally {
      setGeneratingId(null)
      fetchScenes()
    }
  }

  async function addScene() {
    const maxOrder = Math.max(0, ...scenes.map(s => s.order_index))
    const { data: script } = await supabase.from('scripts').select('id').eq('project_id', projectId).single()
    if (!script) return
    await supabase.from('scenes').insert({
      project_id: projectId, script_id: script.id,
      scene_number: String(scenes.length + 1),
      title: '새 씬', content: '', order_index: maxOrder + 1,
    })
    fetchScenes()
  }

  async function updateSettings(sceneId: string, updates: Partial<SceneSettingsType>) {
    await fetch('/api/scenes/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId, updates }),
    })
    fetchScenes()
  }

  async function updateRootAssetSelection(
    sceneId: string,
    category: string,
    assetId: string,
    selected: boolean,
  ) {
    const scene = scenes.find(s => s.id === sceneId)
    if (!scene) return

    const current = scene.selected_root_asset_ids ?? {}
    const categoryList = (current[category as keyof typeof current] ?? []) as string[]

    let updated: string[]
    if (selected) {
      updated = [...categoryList, assetId]
    } else {
      updated = categoryList.filter(id => id !== assetId)
    }

    const newSelection = { ...current, [category]: updated }
    await supabase
      .from('scenes')
      .update({ selected_root_asset_ids: newSelection, updated_at: new Date().toISOString() })
      .eq('id', sceneId)

    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, selected_root_asset_ids: newSelection } : s))
  }

  async function updateRootAssetImageSelection(
    sceneId: string,
    category: string,
    imageUrl: string,
    selected: boolean,
  ) {
    const scene = scenes.find(s => s.id === sceneId)
    if (!scene) return

    const current = (scene.selected_root_asset_image_ids ?? {}) as Record<string, string[]>
    const categoryList = (current[category] ?? []) as string[]

    let updated: string[]
    if (selected) {
      if (categoryList.length >= 3) return  // max 3 per category
      updated = [...categoryList, imageUrl]
    } else {
      updated = categoryList.filter(url => url !== imageUrl)
    }

    const newSelection = { ...current, [category]: updated }
    await supabase
      .from('scenes')
      .update({ selected_root_asset_image_ids: newSelection, updated_at: new Date().toISOString() })
      .eq('id', sceneId)

    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, selected_root_asset_image_ids: newSelection } : s))
  }

  async function generateBulkMasterPrompts() {
    setBulkGenerating(true)
    setBulkProgress(null)
    setBulkMessage(null)
    setPromptError(null)

    try {
      const sceneIds = scenes.map(s => s.id)
      const res = await fetch('/api/prompts/master/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneIds, projectId }),
      })
      const data = await res.json()

      if (!res.ok) {
        setPromptError(data.error ?? '일괄 생성 실패')
      } else {
        const results = data.results ?? []
        const succeeded = results.filter((r: any) => r.ok).length
        const failed = results.filter((r: any) => !r.ok).length
        setBulkMessage(
          `완료: ${succeeded}개 성공${failed > 0 ? `, ${failed}개 실패` : ''}`
        )
        fetchScenes()
      }
    } catch (err) {
      setPromptError('네트워크 오류')
    } finally {
      setBulkGenerating(false)
      setBulkProgress(null)
      setTimeout(() => setBulkMessage(null), 5000)
    }
  }

  function handleToggleComplete(sceneId: string) {
    setCompletedScenes(prev => {
      const next = new Set(prev)
      if (next.has(sceneId)) {
        next.delete(sceneId)
      } else {
        next.add(sceneId)
        if (expandedScene === sceneId) setExpandedScene(null)
      }
      return next
    })
  }

  function togglePromptPanel(sceneId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(sceneId) ? next.delete(sceneId) : next.add(sceneId)
      return next
    })
  }

  function renderSceneContent(scene: Scene) {
    const isGenerating = generatingId === scene.id
    const isOpen = expanded.has(scene.id)

    return (
      <div className="border-t" style={{ borderColor: 'var(--border)' }}>
        {/* SceneCard */}
        <div className="p-3" style={{ background: 'var(--background)' }}>
          <SceneCard
            scene={scene}
            onUpdate={updateScene}
            onGeneratePrompt={generateMasterPrompt}
            isGenerating={isGenerating}
            onExpand={() => {}}
            originalContent={getLocalSceneContent(scene.scene_number, localScenes) || undefined}
          />
        </div>

        {/* 프롬프트/설정 토글 */}
        <div
          className="mx-3 mb-3 rounded overflow-hidden"
          style={{ border: `1px solid ${isOpen ? 'var(--accent)' : 'var(--border)'}` }}
        >
          <button
            onClick={() => togglePromptPanel(scene.id)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs hover-surface transition-all"
            style={{
              color: isOpen ? 'var(--accent)' : 'var(--text-secondary)',
              background: isOpen ? 'var(--accent-subtle)' : 'var(--surface)',
            }}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="font-medium">프롬프트 설정</span>
            <span className="ml-1 opacity-60">엔진 · 앵글 · 렌즈 · 화면비</span>
          </button>

          {isOpen && (
            <div className="border-t px-3 py-3 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <SceneSettings
                settings={scene.settings ?? {}}
                onChange={updates => updateSettings(scene.id, updates)}
              />

              {/* 루트 에셋 선택 */}
              {rootAssets.length > 0 && (
                <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>루트 에셋 선택</p>
                  <div className="space-y-2">
                    {['character', 'space', 'object', 'misc'].map(category => {
                      const assets = rootAssets.filter(a => a.category === category)
                      const selected = (scene.selected_root_asset_ids?.[category as keyof typeof scene.selected_root_asset_ids] ?? []) as string[]
                      if (assets.length === 0) return null
                      return (
                        <div key={category}>
                          <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                            {category === 'character' ? '캐릭터' : category === 'space' ? '공간' : category === 'object' ? '오브제' : '기타'}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {assets.map(asset => (
                              <button
                                key={asset.id}
                                onClick={() => updateRootAssetSelection(scene.id, category, asset.id, !selected.includes(asset.id))}
                                className="px-2 py-1 rounded text-[10px] font-medium transition-all"
                                style={{
                                  background: selected.includes(asset.id) ? 'var(--accent)' : 'var(--surface-3)',
                                  color: selected.includes(asset.id) ? 'white' : 'var(--text-secondary)',
                                  border: `1px solid ${selected.includes(asset.id) ? 'var(--accent)' : 'var(--border)'}`,
                                }}
                              >
                                {asset.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 루트 에셋 이미지 선택 */}
              <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>루트 에셋 이미지</p>
                <div className="space-y-2">
                  {['character', 'space', 'object', 'misc'].map(category => {
                    const catLabel = category === 'character' ? '캐릭터' : category === 'space' ? '공간' : category === 'object' ? '오브제' : '기타'
                    const selectedImages = ((scene.selected_root_asset_image_ids ?? {}) as Record<string, string[]>)[category] ?? []
                    const allCatImages = libraryAssets.filter(a => a.tags?.includes(category)).map(a => a.url)
                    const rootSeedImages = rootAssets
                      .filter(a => a.category === category)
                      .flatMap(a => a.reference_image_urls ?? [])
                    const availableImages = [...new Set([...allCatImages, ...rootSeedImages])]

                    return (
                      <div key={category} className="rounded border p-2" style={{ background: 'var(--surface-3)', borderColor: 'var(--border)' }}>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>{catLabel}</p>
                          <button
                            onClick={() => setPickerOpen({ sceneId: scene.id, category })}
                            className="text-[10px] px-1.5 py-0.5 rounded transition-all hover:opacity-70"
                            style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
                          >
                            <Plus size={10} className="inline mr-0.5" /> 추가
                          </button>
                        </div>
                        {selectedImages.length > 0 ? (
                          <div className="grid grid-cols-3 gap-1">
                            {selectedImages.map((url, idx) => (
                              <button
                                key={idx}
                                onClick={() => updateRootAssetImageSelection(scene.id, category, url, false)}
                                className="relative aspect-square rounded overflow-hidden group"
                              >
                                <img src={url} alt={`ref-${idx}`} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <X size={12} className="text-white" />
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>이미지 없음</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={() => generateMasterPrompt(scene.id)}
                  disabled={isGenerating}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-all hover:opacity-90"
                  style={{ background: 'var(--accent)' }}
                >
                  {isGenerating
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Wand2 size={12} />
                  }
                  {isGenerating ? '생성 중...' : '마스터 프롬프트 수정'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
    </div>
  )

  // 이미지 픽커 모달
  const pickerModal = pickerOpen && (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col" style={{ background: 'var(--background)' }}>
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>이미지 선택</h3>
          <button onClick={() => setPickerOpen(null)}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-3 gap-3">
            {([
              ...libraryAssets
                .filter(a => a.tags?.includes(pickerOpen.category))
                .map(a => ({
                  id: a.id,
                  url: a.url,
                  name: a.name,
                  thumbnail_url: a.thumbnail_url ?? a.url,
                })),
              ...rootAssets
                .filter(a => a.category === pickerOpen.category)
                .flatMap(a => (a.reference_image_urls ?? []).map((url, idx) => ({
                  id: `root-${a.id}-${idx}`,
                  url,
                  name: `${a.name} #${idx + 1}`,
                  thumbnail_url: url,
                }))),
            ] as Array<{ id: string; url: string; name: string; thumbnail_url: string }>)
              .map(asset => (
                <button
                  key={asset.id}
                  onClick={() => {
                    updateRootAssetImageSelection(pickerOpen.sceneId, pickerOpen.category, asset.url, true)
                    setPickerOpen(null)
                  }}
                  className="relative aspect-square rounded overflow-hidden hover:opacity-80 transition-opacity"
                >
                  <img src={asset.thumbnail_url ?? asset.url} alt={asset.name} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <Plus size={18} className="text-white" />
                  </div>
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {pickerModal}
      <div className="h-full flex flex-col">
      {/* 에러 */}
      {promptError && (
        <div
          className="mx-6 mt-4 px-4 py-2.5 rounded text-sm flex items-center justify-between"
          style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
        >
          <span>{promptError}</span>
          <button onClick={() => setPromptError(null)} className="opacity-60 hover:opacity-100 ml-4">✕</button>
        </div>
      )}

      {/* 일괄 생성 메시지 */}
      {bulkMessage && (
        <div
          className="mx-6 mt-4 px-4 py-2.5 rounded text-sm flex items-center justify-between"
          style={{ background: 'var(--success-bg)', border: '1px solid var(--success)', color: 'var(--success)' }}
        >
          <span>{bulkMessage}</span>
          <button onClick={() => setBulkMessage(null)} className="opacity-60 hover:opacity-100 ml-4">✕</button>
        </div>
      )}

      {/* 헤더 */}
      <div className="flex items-center justify-between" style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--line)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 3 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>씬 분류</h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>{scenes.length}개 씬</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 뷰 토글 */}
          <div
            className="flex items-center"
            style={{
              padding: 2, gap: 0,
              border: '1px solid var(--line)', borderRadius: 'var(--r-md)',
              background: 'var(--bg-2)',
            }}
          >
            {([
              { v: 'cards' as const,    icon: LayoutGrid, label: '카드' },
              { v: 'kanban' as const,   icon: Columns3,   label: '칸반' },
              { v: 'timeline' as const, icon: Timer,      label: '타임라인' },
            ]).map(t => {
              const Icon = t.icon
              const active = viewMode === t.v
              return (
                <button
                  key={t.v}
                  onClick={() => setViewMode(t.v)}
                  className="flex items-center gap-1"
                  style={{
                    padding: '5px 10px',
                    borderRadius: 'var(--r-sm)',
                    fontSize: 12, fontWeight: 500,
                    background: active ? 'var(--bg)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--ink-3)',
                    boxShadow: active ? 'var(--shadow-sm)' : 'none',
                  }}
                >
                  <Icon size={11} /> {t.label}
                </button>
              )
            })}
          </div>
          <button
            onClick={generateBulkMasterPrompts}
            disabled={bulkGenerating || scenes.length === 0}
            className="flex items-center gap-1.5 disabled:opacity-50 transition-all"
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--r-md)',
              fontSize: 13, fontWeight: 500,
              background: 'var(--accent)', color: '#fff',
              border: '1px solid var(--accent)',
            }}
            onMouseEnter={e => { if (!bulkGenerating && scenes.length > 0) { (e.currentTarget as HTMLElement).style.background = 'var(--accent-2)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-2)' } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)' }}
          >
            {bulkGenerating
              ? <Loader2 size={13} className="animate-spin" />
              : <Wand2 size={13} />
            }
            {bulkGenerating ? '생성 중...' : '마스터 프롬프트 일괄 생성'}
          </button>
          <button
            onClick={addScene}
            className="flex items-center gap-1.5 transition-all"
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--r-md)',
              fontSize: 13, fontWeight: 500,
              background: 'transparent', color: 'var(--ink-2)',
              border: '1px solid var(--line-strong)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-3)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <Plus size={13} /> 씬 추가
          </button>
          <Link
            href={`/project/${projectId}/assets`}
            className="flex items-center gap-1.5 transition-all"
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
            에셋 <ChevronRight size={13} />
          </Link>
        </div>
      </div>

      {/* 씬 트리 */}
      <div className="flex-1 overflow-auto p-6">
        {scenes.length === 0 ? (
          <div className="empty" style={{ maxWidth: 480, margin: '64px auto' }}>
            <p style={{ fontSize: 14, color: 'var(--ink-3)', marginBottom: 6 }}>씬이 없어요</p>
            <p style={{ fontSize: 12, color: 'var(--ink-4)' }}>
              대본 페이지에서 AI 자동 분류를 실행하거나 직접 추가하세요
            </p>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="max-w-7xl mx-auto">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 14,
              }}
            >
              {scenes.map(scene => (
                <SceneBoardCard
                  key={scene.id}
                  scene={scene}
                  projectId={projectId}
                  onUpdate={(id, updates) => {
                    setScenes(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
                  }}
                  onGeneratePrompt={(id) => generateMasterPrompt(id)}
                  isGenerating={generatingId === scene.id}
                />
              ))}
            </div>
          </div>
        ) : viewMode === 'kanban' ? (
          <div className="max-w-7xl mx-auto" style={{ paddingBottom: 24 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 12,
                minWidth: 1100,
              }}
            >
              {([
                { key: 'draft' as const,    label: 'Draft',  variant: 'draft' as const },
                { key: 'gen' as const,      label: '생산중', variant: 'gen' as const },
                { key: 'review' as const,   label: '검토',   variant: 'review' as const },
                { key: 'approved' as const, label: '완료',   variant: 'approved' as const },
              ]).map(col => {
                const list = scenes.filter(s => sceneStatusOf(s.id).key === col.key)
                return (
                  <div
                    key={col.key}
                    style={{
                      background: 'var(--bg-1)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-md)',
                      display: 'flex', flexDirection: 'column',
                      minHeight: 200,
                    }}
                  >
                    <div
                      className="flex items-center"
                      style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', gap: 8 }}
                    >
                      <Pill variant={col.variant}>{col.label}</Pill>
                      <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{list.length}</span>
                    </div>
                    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {list.length === 0 && (
                        <div className="empty" style={{ fontSize: 11, padding: 16 }}>없음</div>
                      )}
                      {list.map(scene => (
                        <Link
                          key={scene.id}
                          href={`/project/${projectId}/workspace?scene=${scene.id}`}
                          style={{
                            padding: 10,
                            background: 'var(--bg-2)',
                            border: '1px solid var(--line)',
                            borderRadius: 'var(--r-sm)',
                            display: 'block',
                            transition: 'border-color 0.15s ease',
                          }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--line)'}
                        >
                          <div className="flex items-center" style={{ gap: 6, marginBottom: 4 }}>
                            <span className="mono" style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)' }}>
                              {scene.scene_number}
                            </span>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.35 }} className="truncate">
                            {scene.title || '(제목 없음)'}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          /* timeline */
          <div className="max-w-7xl mx-auto" style={{ paddingBottom: 24 }}>
            <div
              style={{
                position: 'relative',
                padding: '32px 12px 12px',
                overflowX: 'auto',
              }}
            >
              <div
                style={{
                  position: 'absolute', top: 56, left: 24, right: 24,
                  height: 2, background: 'var(--line-strong)', zIndex: 0,
                }}
              />
              <div className="flex items-stretch" style={{ gap: 12, position: 'relative', zIndex: 1 }}>
                {scenes.map(scene => {
                  const st = sceneStatusOf(scene.id)
                  const dotColor =
                    st.key === 'approved' ? 'var(--ok)'
                    : st.key === 'review' ? 'var(--info)'
                    : st.key === 'gen' ? 'var(--accent)'
                    : 'var(--ink-4)'
                  return (
                    <Link
                      key={scene.id}
                      href={`/project/${projectId}/workspace?scene=${scene.id}`}
                      style={{
                        flex: '0 0 200px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                        textDecoration: 'none',
                      }}
                    >
                      <div
                        style={{
                          width: 14, height: 14, borderRadius: '50%',
                          background: dotColor,
                          border: '3px solid var(--bg)',
                          boxShadow: `0 0 0 1px ${dotColor}`,
                        }}
                      />
                      <div
                        style={{
                          padding: 10, marginTop: 6,
                          background: 'var(--bg-2)',
                          border: '1px solid var(--line)',
                          borderRadius: 'var(--r-md)',
                          width: '100%',
                        }}
                      >
                        <div className="flex items-center" style={{ gap: 6, marginBottom: 4 }}>
                          <span className="mono" style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)' }}>
                            {scene.scene_number}
                          </span>
                          <Pill variant={st.key === 'approved' ? 'approved' : st.key === 'review' ? 'review' : st.key === 'gen' ? 'gen' : 'draft'}>{st.label}</Pill>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.35 }} className="truncate">
                          {scene.title || '(제목 없음)'}
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </>
  )
}
