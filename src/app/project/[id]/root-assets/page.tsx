'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import {
  Upload, Loader2, User2, MapPin, Package, MoreHorizontal, Plus, X, Trash2, Edit2, Library,
  Check, Film, Sparkles, Wand2,
} from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { sortScenesByNumber } from '@/lib/sceneSort'
import type { RootAssetSeed, RootAssetCategory, Asset, Scene } from '@/types'

const CATEGORIES: { key: RootAssetCategory; label: string; icon: any; color: string }[] = [
  { key: 'character', label: '캐릭터', icon: User2,           color: 'var(--accent)' },
  { key: 'space',     label: '공간',   icon: MapPin,          color: 'var(--info)' },
  { key: 'object',    label: '오브제', icon: Package,         color: 'var(--violet)' },
  { key: 'misc',      label: '기타',   icon: MoreHorizontal,  color: 'var(--ink-3)' },
]

function RootAssetCard({
  seed, scenes, onDelete, onUpdate, projectId,
}: {
  seed: RootAssetSeed
  scenes: Scene[]
  onDelete: (id: string) => void
  onUpdate: (id: string, updates: Partial<RootAssetSeed>) => void
  projectId: string
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState(seed.name)
  const [desc, setDesc] = useState(seed.description ?? '')
  const [uploading, setUploading] = useState(false)
  const [showLibraryPicker, setShowLibraryPicker] = useState(false)
  const [libraryAssets, setLibraryAssets] = useState<Asset[]>([])
  const [loadingLibrary, setLoadingLibrary] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const supabase = createClient()

  const catMeta = CATEGORIES.find(c => c.key === seed.category) ?? CATEGORIES[3]
  const CatIcon = catMeta.icon

  async function handleUploadImage(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드할 수 있습니다.')
      return
    }
    setUploading(true)
    try {
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${file.name.split('.').pop()}`
      const path = `root-assets/${projectId}/${seed.id}/${filename}`
      const { error: uploadErr, data } = await supabase.storage
        .from('assets').upload(path, file, { upsert: false })
      if (uploadErr) { toast.error('업로드 실패', uploadErr.message); return }
      const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(data.path)
      const newUrls = [...(seed.reference_image_urls ?? []), publicUrl]
      await onUpdate(seed.id, { reference_image_urls: newUrls })
    } finally { setUploading(false) }
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
      const { data } = await supabase.from('assets').select('*')
        .eq('project_id', projectId).eq('type', 'reference')
      setLibraryAssets((data ?? []) as Asset[])
    } finally {
      setLoadingLibrary(false); setShowLibraryPicker(true)
    }
  }

  function handleSelectFromLibrary(asset: Asset) {
    const newUrls = [...(seed.reference_image_urls ?? []), asset.url]
    onUpdate(seed.id, { reference_image_urls: newUrls })
    setShowLibraryPicker(false)
    toast.success('이미지 추가됨')
  }

  const heroUrl = seed.reference_image_urls?.[0] ?? null
  const restUrls = seed.reference_image_urls?.slice(1, 5) ?? []

  return (
    <>
      <div
        className="card overflow-hidden"
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          borderTop: `3px solid ${catMeta.color}`,
          padding: 0,
        }}
      >
        <div style={{ position: 'relative', aspectRatio: '16/10', background: 'var(--bg-3)' }}>
          {heroUrl ? (
            <img src={heroUrl} alt={seed.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <label
              style={{
                width: '100%', height: '100%',
                display: 'grid', placeItems: 'center', cursor: 'pointer',
                background: 'var(--bg-3)', color: 'var(--ink-4)', fontSize: 12,
              }}
            >
              {uploading ? <Loader2 size={20} className="animate-spin" /> : (
                <div className="flex flex-col items-center" style={{ gap: 6 }}>
                  <Upload size={20} />
                  <span>이미지 업로드</span>
                </div>
              )}
              <input type="file" onChange={e => e.target.files?.[0] && handleUploadImage(e.target.files[0])} accept="image/*" style={{ display: 'none' }} />
            </label>
          )}
          <div style={{ position: 'absolute', top: 8, left: 8 }}>
            <span
              className="flex items-center"
              style={{
                gap: 4, padding: '3px 8px', borderRadius: 'var(--r-sm)',
                background: catMeta.color, color: '#fff',
                fontSize: 10, fontWeight: 700,
              }}
            >
              <CatIcon size={10} /> {catMeta.label}
            </span>
          </div>
          {seed.reference_image_urls && seed.reference_image_urls.length > 0 && (
            <div style={{ position: 'absolute', top: 8, right: 8 }}>
              <span className="mono" style={{ padding: '2px 7px', borderRadius: 'var(--r-sm)', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10 }}>
                {seed.reference_image_urls.length}장
              </span>
            </div>
          )}
        </div>

        {restUrls.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, padding: 2, background: 'var(--bg-1)' }}>
            {restUrls.map((url, idx) => (
              <div key={idx} style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden' }}>
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button
                  onClick={() => handleRemoveImage(url)}
                  className="opacity-0 hover:opacity-100"
                  style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.55)', transition: 'opacity 0.15s' }}
                  title="이미지 제거"
                >
                  <X size={12} style={{ color: '#fff' }} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ padding: 12 }}>
          {isEditing ? (
            <div className="flex flex-col" style={{ gap: 6, marginBottom: 8 }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="이름"
                style={{ padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', fontSize: 13, color: 'var(--ink)', outline: 'none' }} />
              <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="설명" rows={2}
                style={{ padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', fontSize: 11, color: 'var(--ink)', outline: 'none', resize: 'none' }} />
              <div className="flex" style={{ gap: 4 }}>
                <button onClick={handleSave} className="flex-1" style={{ padding: '5px 8px', fontSize: 11, fontWeight: 500, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)' }}>저장</button>
                <button onClick={() => { setIsEditing(false); setName(seed.name); setDesc(seed.description ?? '') }} className="flex-1" style={{ padding: '5px 8px', fontSize: 11, background: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)' }}>취소</button>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{seed.name || '(이름 없음)'}</p>
              {seed.description && (
                <p style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {seed.description}
                </p>
              )}
            </div>
          )}

          {!isEditing && (
            <div className="flex flex-col" style={{ gap: 6 }}>
              <div className="flex" style={{ gap: 4 }}>
                <label className="flex-1 flex items-center justify-center"
                  style={{ padding: '5px 0', gap: 4, fontSize: 11, background: 'var(--bg-3)', color: 'var(--ink-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}>
                  <Upload size={11} /> 업로드
                  <input type="file" onChange={e => e.target.files?.[0] && handleUploadImage(e.target.files[0])} accept="image/*" style={{ display: 'none' }} />
                </label>
                <button onClick={openLibraryPicker} className="flex-1 flex items-center justify-center"
                  style={{ padding: '5px 0', gap: 4, fontSize: 11, background: 'var(--bg-3)', color: 'var(--ink-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)' }}>
                  <Library size={11} /> 라이브러리
                </button>
              </div>
              <div className="flex" style={{ gap: 4 }}>
                <button onClick={() => setShowAssign(true)} className="flex-1 flex items-center justify-center"
                  style={{ padding: '5px 0', gap: 4, fontSize: 11, fontWeight: 500, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-line)', borderRadius: 'var(--r-sm)' }}>
                  <Film size={11} /> 씬 할당
                </button>
                <button onClick={() => setIsEditing(true)} title="이름/설명 수정"
                  style={{ padding: '5px 9px', fontSize: 11, background: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)' }}>
                  <Edit2 size={11} />
                </button>
                <button onClick={() => onDelete(seed.id)} title="삭제"
                  style={{ padding: '5px 9px', fontSize: 11, background: 'transparent', color: 'var(--danger)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)' }}>
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showAssign && <SceneAssignModal seed={seed} scenes={scenes} onClose={() => setShowAssign(false)} />}
      {showLibraryPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowLibraryPicker(false)}>
          <div className="w-full max-w-2xl flex flex-col"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-xl)', maxHeight: '80vh' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>라이브러리에서 선택</h3>
              <button onClick={() => setShowLibraryPicker(false)} style={{ color: 'var(--ink-4)' }}><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-auto" style={{ padding: 16 }}>
              {loadingLibrary ? (
                <div className="flex items-center justify-center" style={{ height: 120 }}><Loader2 size={20} className="animate-spin" style={{ color: 'var(--ink-4)' }} /></div>
              ) : libraryAssets.length === 0 ? (
                <p className="empty" style={{ padding: 32, textAlign: 'center', fontSize: 12 }}>레퍼런스 라이브러리가 비어있어요.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {libraryAssets.map(asset => (
                    <button key={asset.id} onClick={() => handleSelectFromLibrary(asset)}
                      style={{ position: 'relative', aspectRatio: '1', borderRadius: 'var(--r-sm)', overflow: 'hidden', border: '1px solid var(--line)', cursor: 'pointer' }}>
                      <img src={asset.thumbnail_url ?? asset.url} alt={asset.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div className="opacity-0 hover:opacity-100" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', transition: 'opacity 0.15s' }}>
                        <Plus size={20} style={{ color: '#fff' }} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function SceneAssignModal({
  seed, scenes, onClose,
}: { seed: RootAssetSeed; scenes: Scene[]; onClose: () => void }) {
  const supabase = createClient()
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const pre = new Set<string>()
    for (const sc of scenes) {
      const cat = (sc as any).selected_root_asset_image_ids?.[seed.category] ?? []
      if (Array.isArray(cat) && cat.some((url: string) => seed.reference_image_urls?.includes(url))) {
        pre.add(sc.id)
      }
    }
    setSelectedSceneIds(pre)
  }, [scenes, seed])

  function toggle(sceneId: string) {
    setSelectedSceneIds(prev => {
      const next = new Set(prev)
      if (next.has(sceneId)) next.delete(sceneId)
      else next.add(sceneId)
      return next
    })
  }

  async function applyAssignment() {
    setSaving(true)
    try {
      const seedUrls = seed.reference_image_urls ?? []
      for (const sc of scenes) {
        const current = ((sc as any).selected_root_asset_image_ids ?? {}) as Record<string, string[]>
        const catList = current[seed.category] ?? []
        const isSelected = selectedSceneIds.has(sc.id)
        let nextList: string[]
        if (isSelected) {
          const set = new Set(catList)
          for (const u of seedUrls) set.add(u)
          nextList = Array.from(set)
        } else {
          nextList = catList.filter(u => !seedUrls.includes(u))
        }
        if (nextList.length === catList.length && nextList.every((u, i) => u === catList[i])) continue
        const nextSelection = { ...current, [seed.category]: nextList }
        await supabase.from('scenes').update({ selected_root_asset_image_ids: nextSelection }).eq('id', sc.id)
      }
      toast.success('씬 할당 적용됨', `${selectedSceneIds.size}개 씬에 ${seedUrls.length}장 적용`)
      onClose()
    } catch (e: any) {
      toast.error('할당 실패', e?.message ?? String(e))
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div className="w-full max-w-md flex flex-col"
        style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-xl)', maxHeight: '80vh', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', background: 'var(--bg-1)' }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <Film size={14} style={{ color: 'var(--accent)' }} />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>씬에 할당</h3>
          </div>
          <p style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)' }}>
            <strong>{seed.name}</strong> ({seed.reference_image_urls?.length ?? 0}장) 적용할 씬 선택.
          </p>
        </div>

        <div className="flex items-center" style={{ padding: '8px 16px', borderBottom: '1px solid var(--line)', gap: 6 }}>
          <button onClick={() => setSelectedSceneIds(new Set(scenes.map(s => s.id)))} style={{ padding: '3px 9px', fontSize: 11, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-line)', borderRadius: 'var(--r-sm)' }}>전체 선택</button>
          <button onClick={() => setSelectedSceneIds(new Set())} disabled={selectedSceneIds.size === 0}
            style={{ padding: '3px 9px', fontSize: 11, background: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', opacity: selectedSceneIds.size === 0 ? 0.4 : 1 }}>전체 해제</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{selectedSceneIds.size} / {scenes.length}</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {scenes.length === 0 ? (
            <div className="empty" style={{ padding: 24, fontSize: 12 }}>씬이 없어요</div>
          ) : (
            <div className="flex flex-col" style={{ gap: 2 }}>
              {scenes.map(sc => {
                const checked = selectedSceneIds.has(sc.id)
                const marks = (sc as any).root_asset_marks ?? {}
                const markChips: { key: RootAssetCategory; label: string; color: string; value: string }[] = [
                  { key: 'character', label: '인물',   color: 'var(--accent)', value: (marks.character ?? '').trim() },
                  { key: 'space',     label: '공간',   color: 'var(--info)',   value: (marks.space     ?? '').trim() },
                  { key: 'object',    label: '오브제', color: 'var(--violet)', value: (marks.object    ?? '').trim() },
                  { key: 'misc',      label: '기타',   color: 'var(--ink-3)',  value: (marks.misc      ?? '').trim() },
                ]
                const hasAnyMark = markChips.some(c => c.value)
                return (
                  <button key={sc.id} onClick={() => toggle(sc.id)} className="flex items-start w-full text-left"
                    style={{ padding: '8px 10px', gap: 8, borderRadius: 'var(--r-sm)', background: checked ? 'var(--accent-soft)' : 'transparent', border: `1px solid ${checked ? 'var(--accent-line)' : 'var(--line)'}` }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: checked ? 'var(--accent)' : 'transparent', border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--line-strong)'}`, display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 2 }}>
                      {checked && <Check size={11} style={{ color: '#fff' }} />}
                    </span>
                    <div className="flex-1" style={{ minWidth: 0 }}>
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', minWidth: 50, flexShrink: 0 }}>{sc.scene_number}</span>
                        <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1 }} className="truncate">{sc.title || '(제목 없음)'}</span>
                      </div>
                      {hasAnyMark && (
                        <div className="flex flex-wrap" style={{ gap: 4, marginTop: 5, paddingLeft: 58 }}>
                          {markChips.filter(c => c.value).map(c => {
                            const isCurrentCategory = c.key === seed.category
                            return (
                              <span
                                key={c.key}
                                title={`${c.label}: ${c.value}`}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 3,
                                  padding: '1px 6px', borderRadius: 999,
                                  fontSize: 10, lineHeight: 1.4,
                                  background: isCurrentCategory ? c.color : 'var(--bg-3)',
                                  color: isCurrentCategory ? '#fff' : 'var(--ink-2)',
                                  border: `1px solid ${isCurrentCategory ? c.color : 'var(--line)'}`,
                                  fontWeight: isCurrentCategory ? 600 : 500,
                                  maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}
                              >
                                <span style={{ fontSize: 9, opacity: isCurrentCategory ? 0.85 : 0.65 }}>{c.label}</span>
                                <span>{c.value}</span>
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center" style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', gap: 8 }}>
          <button onClick={onClose} className="flex-1" style={{ padding: '8px', fontSize: 13, background: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>취소</button>
          <button onClick={applyAssignment} disabled={saving} className="flex-1 flex items-center justify-center gap-2"
            style={{ padding: '8px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', borderRadius: 'var(--r-md)', opacity: saving ? 0.6 : 1 }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {selectedSceneIds.size}개 씬에 적용
          </button>
        </div>
      </div>
    </div>
  )
}

export default function RootAssetsPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [activeTab, setActiveTab] = useState<RootAssetCategory | 'all'>('all')
  const [seeds, setSeeds] = useState<RootAssetSeed[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [loading, setLoading] = useState(true)
  const [autoMatching, setAutoMatching] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`root-assets-tab:${projectId}`)
      if (saved && ['all', 'character', 'space', 'object', 'misc'].includes(saved)) {
        setActiveTab(saved as RootAssetCategory | 'all')
      }
    } catch {}
  }, [projectId])

  useEffect(() => {
    try { localStorage.setItem(`root-assets-tab:${projectId}`, activeTab) } catch {}
  }, [activeTab, projectId])

  useEffect(() => {
    fetchAll()
    const channel = supabase
      .channel(`root-assets-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'root_asset_seeds', filter: `project_id=eq.${projectId}` },
        () => fetchSeeds())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [projectId])

  async function fetchAll() {
    await Promise.all([fetchSeeds(), fetchScenes()])
    setLoading(false)
  }
  async function fetchSeeds() {
    const { data } = await supabase.from('root_asset_seeds').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
    setSeeds((data ?? []) as RootAssetSeed[])
  }
  async function fetchScenes() {
    const { data } = await supabase.from('scenes').select('*').eq('project_id', projectId).order('order_index')
    setScenes(sortScenesByNumber((data ?? []) as Scene[]))
  }
  async function addSeed(category: RootAssetCategory) {
    const { data, error } = await supabase.from('root_asset_seeds')
      .insert({ project_id: projectId, category, name: '새 에셋', description: '' })
      .select().single()
    if (!error && data) setSeeds(prev => [data as RootAssetSeed, ...prev])
  }
  async function deleteSeed(id: string) {
    if (!confirm('정말 삭제하시겠습니까?')) return
    const { error } = await supabase.from('root_asset_seeds').delete().eq('id', id)
    if (error) { toast.error('삭제 실패', error.message); return }
    setSeeds(prev => prev.filter(s => s.id !== id))
    toast.success('삭제됨')
  }
  async function updateSeed(id: string, updates: Partial<RootAssetSeed>) {
    const { error } = await supabase.from('root_asset_seeds').update(updates).eq('id', id)
    if (error) { toast.error('업데이트 실패', error.message); return }
    setSeeds(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
  }

  // 씬 마크 텍스트(예: '진오', '카페') ↔ 시드 이름 매칭하여 자동 할당
  async function autoMatchByMarks() {
    if (seeds.length === 0 || scenes.length === 0) {
      toast.warning('매칭 불가', '씬 또는 루트 에셋이 없어요')
      return
    }
    setAutoMatching(true)
    try {
      type Match = { sceneId: string; category: RootAssetCategory; seedId: string; sceneLabel: string; seedName: string; markText: string }
      const matches: Match[] = []
      for (const sc of scenes) {
        const marks = ((sc as any).root_asset_marks ?? {}) as Record<string, string | undefined>
        for (const cat of ['character', 'space', 'object', 'misc'] as const) {
          const markText = (marks[cat] ?? '').trim()
          if (!markText) continue
          // 마크 텍스트 안에 들어있는 키워드들 (콤마/슬래시/공백으로 구분)
          const tokens = markText.split(/[,\/·、,\s]+/).map(t => t.trim()).filter(Boolean)
          if (tokens.length === 0) continue
          for (const seed of seeds) {
            if (seed.category !== cat) continue
            const seedName = (seed.name ?? '').trim().toLowerCase()
            if (!seedName) continue
            // 토큰 중 하나라도 시드 이름에 포함되거나 그 반대면 매칭
            const hit = tokens.some(t => {
              const tt = t.toLowerCase()
              return tt === seedName || tt.includes(seedName) || seedName.includes(tt)
            })
            if (hit) {
              matches.push({
                sceneId: sc.id, category: cat, seedId: seed.id,
                sceneLabel: `${sc.scene_number} ${sc.title || ''}`.trim(),
                seedName: seed.name, markText,
              })
            }
          }
        }
      }
      if (matches.length === 0) {
        toast.info('매칭 없음', '시드 이름과 일치하는 씬 마크가 없어요. 시드 이름을 마크 텍스트와 같게 (예: "진오") 만들어보세요.')
        return
      }
      // 사용자 확인
      const ok = confirm(
        `${matches.length}개 매칭 발견:\n\n` +
        matches.slice(0, 8).map(m => `· ${m.sceneLabel} [${m.category}] "${m.markText}" → ${m.seedName}`).join('\n') +
        (matches.length > 8 ? `\n... 외 ${matches.length - 8}개` : '') +
        '\n\n각 씬에 시드 이미지를 자동 할당할까요?',
      )
      if (!ok) return
      // 적용 — 씬별로 selected_root_asset_image_ids 갱신 (dedup)
      const sceneUpdate = new Map<string, Record<string, string[]>>()
      for (const sc of scenes) {
        sceneUpdate.set(sc.id, JSON.parse(JSON.stringify((sc as any).selected_root_asset_image_ids ?? {})))
      }
      for (const m of matches) {
        const seed = seeds.find(s => s.id === m.seedId)
        if (!seed) continue
        const cur = sceneUpdate.get(m.sceneId)!
        const list = cur[m.category] ?? []
        const set = new Set(list)
        for (const u of (seed.reference_image_urls ?? [])) set.add(u)
        cur[m.category] = Array.from(set)
      }
      let succeeded = 0, failed = 0
      for (const [sceneId, sel] of sceneUpdate) {
        // 변경 안 된 씬은 스킵
        const orig = scenes.find(s => s.id === sceneId)
        const origSel = ((orig as any)?.selected_root_asset_image_ids ?? {}) as Record<string, string[]>
        const same = Object.keys({...origSel, ...sel}).every(k => {
          const a = origSel[k] ?? []
          const b = sel[k] ?? []
          return a.length === b.length && a.every((u, i) => u === b[i])
        })
        if (same) continue
        const { error } = await supabase.from('scenes').update({ selected_root_asset_image_ids: sel }).eq('id', sceneId)
        if (error) failed++
        else succeeded++
      }
      toast.success(
        '자동 매칭 적용됨',
        `${succeeded}개 씬에 적용${failed > 0 ? ` · ${failed}개 실패` : ''}`,
      )
      await fetchScenes()
    } catch (e: any) {
      toast.error('자동 매칭 실패', e?.message ?? String(e))
    } finally {
      setAutoMatching(false)
    }
  }

  const filtered = activeTab === 'all' ? seeds : seeds.filter(s => s.category === activeTab)
  const counts = useMemo(() => {
    const c = { all: seeds.length, character: 0, space: 0, object: 0, misc: 0 }
    for (const s of seeds) {
      if (s.category === 'character') c.character++
      else if (s.category === 'space') c.space++
      else if (s.category === 'object') c.object++
      else c.misc++
    }
    return c
  }, [seeds])

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--ink-4)' }} /></div>

  return (
    <div className="h-full flex flex-col">
      <div style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--line)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 3 }}>
        <div className="flex items-end justify-between" style={{ gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ink)' }}>루트 에셋</h1>
            <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>프로젝트의 인물 / 공간 / 오브제 라이브러리 · {seeds.length}개</p>
          </div>
          <div className="flex items-center" style={{ gap: 8 }}>
            <button
              onClick={autoMatchByMarks}
              disabled={autoMatching || seeds.length === 0 || scenes.length === 0}
              className="flex items-center"
              style={{
                padding: '6px 12px', gap: 5, fontSize: 12, fontWeight: 500,
                background: 'var(--accent-soft)', color: 'var(--accent)',
                border: '1px solid var(--accent-line)',
                borderRadius: 'var(--r-md)',
                opacity: (autoMatching || seeds.length === 0 || scenes.length === 0) ? 0.5 : 1,
              }}
              title="각 씬의 인물/공간/오브제 마크 텍스트와 시드 이름을 비교해 자동 할당"
            >
              {autoMatching ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
              AI 자동 매칭
            </button>
            {CATEGORIES.map(cat => (
              <button key={`add-${cat.key}`} onClick={() => addSeed(cat.key)} className="flex items-center"
                style={{ padding: '6px 12px', gap: 5, fontSize: 12, fontWeight: 500, background: 'transparent', color: 'var(--ink-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = cat.color)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--line)')}
                title={`${cat.label} 추가`}>
                <Plus size={12} />
                <cat.icon size={12} style={{ color: cat.color }} />
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex" style={{ padding: '10px 28px', gap: 6, borderBottom: '1px solid var(--line)' }}>
        <button onClick={() => setActiveTab('all')} className="flex items-center gap-1"
          style={{ padding: '5px 12px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, background: activeTab === 'all' ? 'var(--bg-3)' : 'transparent', color: activeTab === 'all' ? 'var(--ink)' : 'var(--ink-3)', border: `1px solid ${activeTab === 'all' ? 'var(--line-strong)' : 'var(--line)'}` }}>
          전체 <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{counts.all}</span>
        </button>
        {CATEGORIES.map(cat => {
          const active = activeTab === cat.key
          const Icon = cat.icon
          const cnt = counts[cat.key]
          return (
            <button key={cat.key} onClick={() => setActiveTab(cat.key)} className="flex items-center gap-1"
              style={{ padding: '5px 12px', borderRadius: 'var(--r-md)', fontSize: 12, fontWeight: 500, background: active ? 'var(--bg-3)' : 'transparent', color: active ? 'var(--ink)' : 'var(--ink-3)', border: `1px solid ${active ? cat.color : 'var(--line)'}` }}>
              <Icon size={12} style={{ color: cat.color }} />
              {cat.label}
              <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{cnt}</span>
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-auto" style={{ padding: '16px 28px 28px' }}>
        {filtered.length === 0 ? (
          <div className="empty flex flex-col items-center" style={{ maxWidth: 480, margin: '64px auto', textAlign: 'center' }}>
            <Package size={32} style={{ color: 'var(--ink-4)', marginBottom: 12 }} />
            <p style={{ fontSize: 14, color: 'var(--ink-3)', marginBottom: 6 }}>
              {activeTab === 'all' ? '루트 에셋이 없어요' : `${CATEGORIES.find(c => c.key === activeTab)?.label} 에셋이 없어요`}
            </p>
            <p style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 14 }}>
              상단의 카테고리 버튼으로 추가하거나, 에셋 라이브러리에서 보낼 수 있어요.
            </p>
            <button onClick={() => addSeed(activeTab === 'all' ? 'character' : (activeTab as RootAssetCategory))} className="flex items-center gap-1"
              style={{ padding: '7px 14px', borderRadius: 'var(--r-md)', fontSize: 13, fontWeight: 500, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }}>
              <Plus size={13} /> 추가
            </button>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {filtered.map(seed => (
              <RootAssetCard key={seed.id} seed={seed} scenes={scenes} onDelete={deleteSeed} onUpdate={updateSeed} projectId={projectId} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
