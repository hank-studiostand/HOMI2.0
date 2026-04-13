'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import { Download, Loader2, Package, ChevronDown, ChevronRight } from 'lucide-react'
import type { Asset } from '@/types'
import AssetCard from '@/components/asset/AssetCard'
import Badge from '@/components/ui/Badge'

interface SceneGroup {
  sceneId: string | null
  sceneNumber: string
  title: string
  assets: Asset[]
}

export default function ArchivePage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [assets, setAssets] = useState<Asset[]>([])
  const [sceneGroups, setSceneGroups] = useState<SceneGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState(false)
  // 씬 그룹 접기/펼치기
  const [collapsedScenes, setCollapsedScenes] = useState<Set<string>>(new Set())
  const supabase = createClient()

  useEffect(() => { fetchData() }, [projectId])

  async function fetchData() {
    // 아카이브된 에셋 (레퍼런스 제외)
    const { data: assetsData } = await supabase
      .from('assets').select('*').eq('project_id', projectId)
      .eq('archived', true).neq('type', 'reference')
      .order('satisfaction_score', { ascending: false })

    // 씬 목록
    const { data: scenesData } = await supabase
      .from('scenes').select('id, scene_number, title')
      .eq('project_id', projectId).order('order_index')

    const allAssets = assetsData ?? []
    setAssets(allAssets)

    // 씬별로 그룹핑
    const groups: SceneGroup[] = []

    for (const scene of (scenesData ?? [])) {
      const sceneAssets = allAssets.filter(a => a.scene_id === scene.id)
      if (sceneAssets.length > 0) {
        groups.push({
          sceneId: scene.id,
          sceneNumber: scene.scene_number,
          title: scene.title,
          assets: sceneAssets,
        })
      }
    }

    // scene_id가 없는 에셋 (씬 미지정)
    const unassigned = allAssets.filter(a => !a.scene_id || !(scenesData ?? []).find(s => s.id === a.scene_id))
    if (unassigned.length > 0) {
      groups.push({ sceneId: null, sceneNumber: '-', title: '씬 미지정', assets: unassigned })
    }

    setSceneGroups(groups)
    setLoading(false)
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function toggleCollapseScene(key: string) {
    setCollapsedScenes(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function downloadAsset(url: string, name: string) {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = name
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(blobUrl)
    } catch (e) {
      console.error('다운로드 실패:', e)
    }
  }

  async function downloadSelected() {
    setDownloading(true)
    const toDownload = assets.filter(a => selected.size === 0 || selected.has(a.id))
    for (const asset of toDownload) {
      await downloadAsset(asset.url, asset.name)
      await new Promise(r => setTimeout(r, 200))
    }
    setDownloading(false)
  }

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 size={24} className="animate-spin text-zinc-600" /></div>

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>아카이브</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {assets.length}개 에셋 · {sceneGroups.length}개 씬
            {selected.size > 0 && ` · ${selected.size}개 선택됨`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={downloadSelected} disabled={downloading || assets.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-all hover:opacity-90"
            style={{ background: 'var(--accent)' }}>
            {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {selected.size > 0 ? `${selected.size}개 다운로드` : '전체 다운로드'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Package size={40} className="text-zinc-700 mb-3" />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>아카이빙된 에셋이 없습니다</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              T2I·I2V·립싱크 단계에서 결과물을 아카이빙하면 여기에 모입니다
            </p>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto space-y-4">
            {sceneGroups.map(group => {
              const groupKey = group.sceneId ?? 'unassigned'
              const isCollapsed = collapsedScenes.has(groupKey)
              const selectedInGroup = group.assets.filter(a => selected.has(a.id)).length

              return (
                <div key={groupKey} className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                  {/* 씬 헤더 */}
                  <button
                    onClick={() => toggleCollapseScene(groupKey)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                    style={{ background: 'var(--surface)' }}>
                    {isCollapsed ? <ChevronRight size={15} className="text-zinc-500" /> : <ChevronDown size={15} className="text-zinc-500" />}
                    <Badge variant="accent" className="font-mono text-xs">S{group.sceneNumber}</Badge>
                    <span className="text-sm font-medium flex-1" style={{ color: 'var(--text-primary)' }}>
                      {group.title}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {group.assets.length}개
                      {selectedInGroup > 0 && <span className="ml-2 text-indigo-400">{selectedInGroup}개 선택</span>}
                    </span>
                  </button>

                  {/* 씬 에셋 그리드 */}
                  {!isCollapsed && (
                    <div className="p-4 border-t" style={{ borderColor: 'var(--border)', background: 'var(--background)' }}>
                      <div className="asset-grid">
                        {group.assets.map(asset => (
                          <AssetCard key={asset.id} asset={asset}
                            selectable selected={selected.has(asset.id)} onSelect={toggleSelect}
                            onDownload={id => { const a = assets.find(x => x.id === id); if(a) downloadAsset(a.url, a.name) }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
