'use client'

import { useState, useEffect } from 'react'
import { useLocalState } from '@/hooks/useLocalState'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import { Plus, Loader2, ChevronRight, ChevronDown, Wand2, X } from 'lucide-react'
import SceneCard from '@/components/scene/SceneCard'
import SceneSettings from '@/components/scene/SceneSettings'
import SceneTreeView from '@/components/scene/SceneTreeView'
import type { Scene, SceneSettings as SceneSettingsType, RootAssetSeed } from '@/types'
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
    setScenes(data ?? [])
    setLoading(false)
  }

  async function fetchRootAssets() {
    const { data } = await supabase
      .from('root_asset_seeds')
      .select('*')
      .eq('project_id', projectId)
    setRootAssets(data ?? [])
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
    } catch {
      setPromptError('네트워크 오류')
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

  return (
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
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>씬 분류</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{scenes.length}개 씬</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generateBulkMasterPrompts}
            disabled={bulkGenerating || scenes.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50 transition-all hover:opacity-90"
            style={{ background: 'var(--accent)' }}
          >
            {bulkGenerating
              ? <Loader2 size={13} className="animate-spin" />
              : <Wand2 size={13} />
            }
            {bulkGenerating ? '생성 중...' : '마스터 프롬프트 일괄 생성'}
          </button>
          <button
            onClick={addScene}
            className="flex items-center gap-1.5 px-4 py-2 rounded text-sm hover-surface transition-all"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            <Plus size={13} /> 씬 추가
          </button>
          <Link
            href={`/project/${projectId}/assets`}
            className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium text-white"
            style={{ background: 'var(--accent)' }}
          >
            에셋 <ChevronRight size={13} />
          </Link>
        </div>
      </div>

      {/* 씬 트리 */}
      <div className="flex-1 overflow-auto p-6">
        {scenes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>씬이 없습니다</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              대본 페이지에서 AI 자동 분류를 실행하거나 직접 추가하세요
            </p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            <SceneTreeView
              scenes={scenes}
              completedScenes={completedScenes}
              onToggleComplete={handleToggleComplete}
              renderScene={renderSceneContent}
              expandedSceneId={expandedScene}
              onExpandScene={setExpandedScene}
              storageKey={`scenes:${projectId}`}
            />
          </div>
        )}
      </div>
    </div>
  )
}
