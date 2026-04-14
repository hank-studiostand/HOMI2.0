'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import {
  Upload, Loader2, User2, MapPin, Package, MoreHorizontal, Plus, X, Trash2, Edit2, Library,
} from 'lucide-react'
import type { RootAssetSeed, RootAssetCategory, Asset } from '@/types'
import { cn } from '@/lib/utils'

const CATEGORIES = [
  { key: 'character' as RootAssetCategory, label: '캐릭터', icon: User2 },
  { key: 'space' as RootAssetCategory, label: '공간', icon: MapPin },
  { key: 'object' as RootAssetCategory, label: '오브제', icon: Package },
  { key: 'misc' as RootAssetCategory, label: '기타', icon: MoreHorizontal },
] as const

function RootAssetCard({
  seed,
  onDelete,
  onUpdate,
  projectId,
}: {
  seed: RootAssetSeed
  onDelete: (id: string) => void
  onUpdate: (id: string, updates: Partial<RootAssetSeed>) => void
  projectId: string
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState(seed.name)
  const [desc, setDesc] = useState(seed.description ?? '')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [showLibraryPicker, setShowLibraryPicker] = useState(false)
  const [libraryAssets, setLibraryAssets] = useState<Asset[]>([])
  const [loadingLibrary, setLoadingLibrary] = useState(false)
  const supabase = createClient()

  async function handleUploadImage(file: File) {
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드할 수 있습니다.')
      return
    }

    setUploading(true)
    try {
      const projectId = useParams<{ id: string }>().id
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${file.name.split('.').pop()}`
      const path = `root-assets/${projectId}/${seed.id}/${filename}`

      const { error: uploadErr, data } = await supabase.storage
        .from('assets')
        .upload(path, file, { upsert: false })

      if (uploadErr) {
        alert(`업로드 실패: ${uploadErr.message}`)
        return
      }

      const { data: { publicUrl } } = supabase.storage
        .from('assets')
        .getPublicUrl(data.path)

      const newUrls = [...(seed.reference_image_urls ?? []), publicUrl]
      await onUpdate(seed.id, { reference_image_urls: newUrls })
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    await onUpdate(seed.id, { name, description: desc })
    setIsEditing(false)
  }

  function handleRemoveImage(url: string) {
    const newUrls = seed.reference_image_urls.filter(u => u !== url)
    onUpdate(seed.id, { reference_image_urls: newUrls })
  }

  async function openLibraryPicker() {
    setLoadingLibrary(true)
    try {
      const { data } = await supabase
        .from('assets')
        .select('*')
        .eq('project_id', projectId)
        .eq('type', 'reference')
        .contains('tags', [seed.category])
      setLibraryAssets(data ?? [])
    } catch (e) {
      console.error('Failed to load library assets:', e)
    } finally {
      setLoadingLibrary(false)
      setShowLibraryPicker(true)
    }
  }

  function handleSelectFromLibrary(asset: Asset) {
    const newUrls = [...(seed.reference_image_urls ?? []), asset.url]
    onUpdate(seed.id, { reference_image_urls: newUrls })
    setShowLibraryPicker(false)
  }

  return (
    <div
      className="rounded-lg border p-3 bg-opacity-50 transition-all"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* 이미지 갤러리 */}
      <div className="mb-2 grid grid-cols-4 gap-1">
        {seed.reference_image_urls.map((url, idx) => (
          <div key={idx} className="relative aspect-square rounded overflow-hidden group">
            <img src={url} alt={`ref-${idx}`} className="w-full h-full object-cover" />
            <button
              onClick={() => handleRemoveImage(url)}
              className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={14} className="text-white" />
            </button>
          </div>
        ))}
        <label className="relative aspect-square rounded border-2 border-dashed cursor-pointer flex items-center justify-center hover:bg-opacity-80 transition-all" style={{ borderColor: 'var(--border)', background: 'var(--surface-3)' }}>
          <Upload size={14} style={{ color: 'var(--text-muted)' }} />
          <input
            type="file"
            ref={fileInputRef}
            onChange={e => e.target.files?.[0] && handleUploadImage(e.target.files[0])}
            className="hidden"
            accept="image/*"
          />
        </label>
      </div>

      {/* 이름/설명 */}
      {isEditing ? (
        <div className="space-y-2 mb-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-2 py-1 rounded text-sm border"
            style={{ background: 'var(--background)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            placeholder="이름"
          />
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            className="w-full px-2 py-1 rounded text-xs border resize-none"
            style={{ background: 'var(--background)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            placeholder="설명"
            rows={2}
          />
          <div className="flex gap-1">
            <button
              onClick={handleSave}
              className="flex-1 px-2 py-1 rounded text-xs font-medium text-white"
              style={{ background: 'var(--accent)' }}
            >
              저장
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="flex-1 px-2 py-1 rounded text-xs border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-2">
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{name}</p>
          {desc && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{desc}</p>}
        </div>
      )}

      {/* 액션 */}
      {!isEditing && (
        <div className="space-y-1">
          <div className="flex gap-1">
            <button
              onClick={() => setIsEditing(true)}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs border hover:bg-opacity-70"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              <Edit2 size={12} /> 수정
            </button>
            <button
              onClick={() => onDelete(seed.id)}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs border border-red-500/30 text-red-500 hover:bg-red-500/10"
            >
              <Trash2 size={12} /> 삭제
            </button>
          </div>
          <button
            onClick={openLibraryPicker}
            className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded text-xs border hover:bg-opacity-70"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <Library size={12} /> 라이브러리에서 불러오기
          </button>
        </div>
      )}

      {/* 라이브러리 픽커 모달 */}
      {showLibraryPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-lg max-w-2xl w-full max-h-[80vh] flex flex-col" style={{ background: 'var(--background)' }}>
            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>라이브러리에서 선택</h3>
              <button onClick={() => setShowLibraryPicker(false)}><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {loadingLibrary ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                </div>
              ) : libraryAssets.length === 0 ? (
                <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>이 카테고리의 레퍼런스가 없습니다</p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {libraryAssets.map(asset => (
                    <button
                      key={asset.id}
                      onClick={() => handleSelectFromLibrary(asset)}
                      className="relative aspect-square rounded overflow-hidden hover:opacity-80 transition-opacity"
                    >
                      <img src={asset.thumbnail_url ?? asset.url} alt={asset.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                        <Plus size={18} className="text-white" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function RootAssetsPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [activeTab, setActiveTab] = useState<RootAssetCategory | 'all'>('all')
  const [seeds, setSeeds] = useState<RootAssetSeed[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  // localStorage에 탭 저장
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`root-assets-tab:${projectId}`)
      if (saved && ['all', 'character', 'space', 'object', 'misc'].includes(saved)) {
        setActiveTab(saved as RootAssetCategory | 'all')
      }
    } catch {}
  }, [projectId])

  useEffect(() => {
    try {
      localStorage.setItem(`root-assets-tab:${projectId}`, activeTab)
    } catch {}
  }, [activeTab, projectId])

  useEffect(() => {
    fetchSeeds()
    const channel = supabase.channel('root-assets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'root_asset_seeds', filter: `project_id=eq.${projectId}` }, () => fetchSeeds())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [projectId])

  async function fetchSeeds() {
    const { data } = await supabase
      .from('root_asset_seeds')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    setSeeds(data ?? [])
    setLoading(false)
  }

  async function addSeed(category: RootAssetCategory) {
    const { data, error } = await supabase
      .from('root_asset_seeds')
      .insert({ project_id: projectId, category, name: '새 에셋', description: '' })
      .select()
      .single()
    if (!error) {
      setSeeds(prev => [data, ...prev])
    }
  }

  async function deleteSeed(id: string) {
    if (!confirm('정말 삭제하시겠습니까?')) return
    await supabase.from('root_asset_seeds').delete().eq('id', id)
    setSeeds(prev => prev.filter(s => s.id !== id))
  }

  async function updateSeed(id: string, updates: Partial<RootAssetSeed>) {
    await supabase.from('root_asset_seeds').update(updates).eq('id', id)
    setSeeds(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
  }

  const filtered = activeTab === 'all'
    ? seeds
    : seeds.filter(s => s.category === activeTab)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={22} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>루트 에셋 시드</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>프로젝트의 기본 에셋 라이브러리</p>
      </div>

      {/* 탭 */}
      <div className="px-6 py-3 border-b flex gap-2" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => setActiveTab('all')}
          className={cn(
            'px-3 py-1.5 rounded text-sm transition-all',
            activeTab === 'all'
              ? 'font-medium text-white'
              : 'hover:bg-opacity-50'
          )}
          style={activeTab === 'all' ? { background: 'var(--accent)' } : { color: 'var(--text-secondary)' }}
        >
          전체
        </button>
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => setActiveTab(cat.key)}
            className={cn(
              'px-3 py-1.5 rounded text-sm transition-all flex items-center gap-1',
              activeTab === cat.key
                ? 'font-medium text-white'
                : 'hover:bg-opacity-50'
            )}
            style={activeTab === cat.key ? { background: 'var(--accent)' } : { color: 'var(--text-secondary)' }}
          >
            <cat.icon size={13} />
            {cat.label}
          </button>
        ))}
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
              {activeTab === 'all' ? '에셋이 없습니다' : `${CATEGORIES.find(c => c.key === activeTab)?.label} 에셋이 없습니다`}
            </p>
            <button
              onClick={() => {
                const catToAdd = activeTab === 'all' ? 'character' : (activeTab as RootAssetCategory)
                addSeed(catToAdd)
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-sm font-medium text-white"
              style={{ background: 'var(--accent)' }}
            >
              <Plus size={13} /> 추가
            </button>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
              {filtered.map(seed => (
                <RootAssetCard
                  key={seed.id}
                  seed={seed}
                  onDelete={deleteSeed}
                  onUpdate={updateSeed}
                  projectId={projectId}
                />
              ))}
            </div>

            {/* 추가 버튼 */}
            {CATEGORIES.map(cat => (
              activeTab === 'all' || activeTab === cat.key ? (
                <button
                  key={`add-${cat.key}`}
                  onClick={() => addSeed(cat.key)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed text-sm font-medium transition-all hover:opacity-70"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  <Plus size={14} />
                  {cat.label} 추가
                </button>
              ) : null
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
