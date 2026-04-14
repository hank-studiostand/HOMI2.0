'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useParams } from 'next/navigation'
import {
  Upload, Search, ChevronRight, Loader2, User2,
  MapPin, Package, Image as ImageIcon, Tag, Download,
  Archive, Trash2, X, Check, FolderOpen, MoreHorizontal, Clipboard,
} from 'lucide-react'
import type { Asset } from '@/types'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import SatisfactionRating from '@/components/ui/SatisfactionRating'

// ─── 카테고리 정의 ────────────────────────────────────────────────────────────

export type RefCategory = 'all' | 'character' | 'space' | 'object' | 'misc'

export const REF_CATEGORIES = [
  {
    key:      'all'       as RefCategory,
    label:    '전체',
    icon:     FolderOpen,
    color:    'var(--text-secondary)',
    bg:       'var(--surface-3)',
    border:   'var(--border)',
    tag:      null,
    desc:     '모든 레퍼런스',
  },
  {
    key:      'character' as RefCategory,
    label:    '캐릭터',
    icon:     User2,
    color:    '#818cf8',
    bg:       'rgba(99,102,241,0.1)',
    border:   'rgba(99,102,241,0.35)',
    tag:      'character',
    desc:     '인물·캐릭터 레퍼런스',
  },
  {
    key:      'space'     as RefCategory,
    label:    '공간',
    icon:     MapPin,
    color:    '#34d399',
    bg:       'rgba(52,211,153,0.1)',
    border:   'rgba(52,211,153,0.35)',
    tag:      'space',
    desc:     '배경·공간·로케이션 레퍼런스',
  },
  {
    key:      'object'    as RefCategory,
    label:    '오브제',
    icon:     Package,
    color:    '#fb923c',
    bg:       'rgba(251,146,60,0.1)',
    border:   'rgba(251,146,60,0.35)',
    tag:      'object',
    desc:     '소품·오브제·아이템 레퍼런스',
  },
  {
    key:      'misc'      as RefCategory,
    label:    '기타',
    icon:     MoreHorizontal,
    color:    '#a78bfa',
    bg:       'rgba(167,139,250,0.1)',
    border:   'rgba(167,139,250,0.35)',
    tag:      'misc',
    desc:     '분류되지 않은 기타 레퍼런스',
  },
] as const

// ─── 카테고리 헬퍼 ────────────────────────────────────────────────────────────

export function getAssetCategory(asset: Asset): RefCategory {
  if (asset.tags.includes('character')) return 'character'
  if (asset.tags.includes('space'))     return 'space'
  if (asset.tags.includes('object'))    return 'object'
  return 'misc'
}

export function getCategoryMeta(cat: RefCategory) {
  return REF_CATEGORIES.find(c => c.key === cat) ?? REF_CATEGORIES[0]
}

// ─── RefCategoryBadge ─────────────────────────────────────────────────────────

export function RefCategoryBadge({ category }: { category: RefCategory }) {
  if (category === 'all') return null
  const meta = getCategoryMeta(category)
  const Icon = meta.icon
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}
    >
      <Icon size={9} />
      {meta.label}
    </span>
  )
}

// ─── AssetCard ────────────────────────────────────────────────────────────────

function AssetCard({
  asset, onScore, onToggleArchive, onDownload, onDelete,
  selectable, selected, onSelect,
}: {
  asset: Asset
  onScore?: (id: string, score: number) => void
  onToggleArchive?: (id: string) => void
  onDownload?: (id: string) => void
  onDelete?: (id: string) => void
  selectable?: boolean
  selected?: boolean
  onSelect?: (id: string) => void
}) {
  const category = getAssetCategory(asset)
  const catMeta  = getCategoryMeta(category)

  return (
    <div
      className={cn(
        'rounded-xl overflow-hidden border transition-all cursor-pointer group',
        selected ? 'ring-2' : 'hover:border-opacity-70',
      )}
      style={{
        background:   'var(--surface)',
        borderColor:  selected ? catMeta.color : 'var(--border)',
        boxShadow:    selected ? `0 0 0 2px ${catMeta.color}40` : 'none',
      }}
      onClick={() => selectable && onSelect?.(asset.id)}
    >
      {/* Preview */}
      <div className="relative aspect-video" style={{ background: 'var(--surface-3)' }}>
        {asset.url ? (
          <img
            src={asset.thumbnail_url ?? asset.url}
            alt={asset.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <ImageIcon size={28} style={{ color: 'var(--text-muted)' }} />
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {onDownload && (
            <button onClick={e => { e.stopPropagation(); onDownload(asset.id) }}
              className="p-2 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-all">
              <Download size={14} />
            </button>
          )}
          {onToggleArchive && (
            <button onClick={e => { e.stopPropagation(); onToggleArchive(asset.id) }}
              className={cn('p-2 rounded-lg transition-all',
                asset.archived ? 'bg-emerald-500/30 text-emerald-300' : 'bg-white/15 hover:bg-white/25 text-white')}>
              <Archive size={14} />
            </button>
          )}
          {onDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete(asset.id) }}
              className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/35 text-red-300 transition-all">
              <Trash2 size={14} />
            </button>
          )}
        </div>

        {/* Category badge */}
        {category !== 'all' && (
          <div className="absolute top-2 left-2">
            <RefCategoryBadge category={category} />
          </div>
        )}

        {/* Archive dot */}
        {asset.archived && (
          <div className="absolute top-2 right-2 w-2 h-2 rounded-full"
            style={{ background: 'var(--success)' }} />
        )}

        {/* Select checkbox */}
        {selectable && (
          <div
            className="absolute bottom-2 right-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-all"
            style={{
              background:   selected ? catMeta.color : 'rgba(0,0,0,0.4)',
              borderColor:  selected ? catMeta.color : 'rgba(255,255,255,0.5)',
            }}
          >
            {selected && <Check size={11} className="text-white" />}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {asset.name}
        </p>
        <SatisfactionRating
          value={asset.satisfaction_score}
          size="sm"
          onChange={score => onScore?.(asset.id, score)}
        />
        {asset.tags.filter(t => !['character', 'space', 'object', 'misc'].includes(t)).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {asset.tags
              .filter(t => !['character', 'space', 'object', 'misc'].includes(t))
              .map(tag => (
                <span key={tag} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px]"
                  style={{ background: 'var(--surface-3)', color: 'var(--text-muted)' }}>
                  <Tag size={9} /> {tag}
                </span>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Category Tab ─────────────────────────────────────────────────────────────

function CategoryTab({
  cat, isActive, count, onClick,
}: {
  cat: typeof REF_CATEGORIES[number]
  isActive: boolean
  count: number
  onClick: () => void
}) {
  const Icon = cat.icon
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all relative border-b-2 shrink-0"
      style={{
        color:       isActive ? cat.color : 'var(--text-secondary)',
        borderColor: isActive ? cat.color : 'transparent',
        background:  'transparent',
      }}
    >
      <Icon size={14} />
      {cat.label}
      <span
        className="text-[10px] px-1.5 py-0.5 rounded-full font-mono"
        style={{
          background: isActive ? cat.bg : 'var(--surface-3)',
          color:      isActive ? cat.color : 'var(--text-muted)',
          border:     isActive ? `1px solid ${cat.border}` : '1px solid transparent',
        }}
      >
        {count}
      </span>
    </button>
  )
}

// ─── Upload Zone ──────────────────────────────────────────────────────────────

function UploadZone({
  category, onFiles, uploading,
}: {
  category: RefCategory
  onFiles: (files: FileList | File[], category: RefCategory) => void
  uploading: boolean
}) {
  const inputRef  = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const meta = getCategoryMeta(category)
  const Icon = meta.icon

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed transition-all cursor-pointer"
      style={{
        borderColor: drag ? meta.color : 'var(--border)',
        background:  drag ? meta.bg : 'transparent',
      }}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => {
        e.preventDefault(); setDrag(false)
        if (e.dataTransfer.files) onFiles(e.dataTransfer.files, category)
      }}
    >
      <input ref={inputRef} type="file" multiple accept="image/*" className="hidden"
        onChange={e => e.target.files && onFiles(e.target.files, category)} />

      {uploading ? (
        <Loader2 size={28} className="animate-spin" style={{ color: meta.color }} />
      ) : (
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ background: meta.bg, border: `1px solid ${meta.border}` }}
        >
          <Icon size={22} style={{ color: meta.color }} />
        </div>
      )}
      <div className="text-center">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {uploading ? '업로드 중...' : `${meta.label} 레퍼런스 업로드`}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {meta.desc} · 클릭 또는 드래그
        </p>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AssetsPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const [assets, setAssets]       = useState<Asset[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
  const [activeTab, setActiveTab] = useState<RefCategory>('all')
  const supabase = createClient()

  useEffect(() => { fetchAssets() }, [projectId])

  // 클립보드 붙여넣기 → 현재 활성 탭 카테고리로 업로드
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return

      const files: File[] = []
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile()
          if (f) {
            const ext = f.type.split('/')[1] ?? 'png'
            const renamed = new File([f], f.name && f.name !== 'image.png' ? f.name : `clipboard_${Date.now()}.${ext}`, { type: f.type })
            files.push(renamed)
          }
        }
      }
      if (files.length > 0) {
        e.preventDefault()
        const targetCat: RefCategory = activeTab === 'all' ? 'misc' : activeTab
        uploadFiles(files, targetCat)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [activeTab, projectId])

  async function fetchAssets() {
    const { data } = await supabase
      .from('assets')
      .select('*')
      .eq('project_id', projectId)
      .eq('type', 'reference')
      .order('created_at', { ascending: false })
    setAssets(data ?? [])
    setLoading(false)
  }

  // 카테고리별 count
  const countByCategory = {
    all:       assets.length,
    character: assets.filter(a => a.tags.includes('character')).length,
    space:     assets.filter(a => a.tags.includes('space')).length,
    object:    assets.filter(a => a.tags.includes('object')).length,
    misc:      assets.filter(a => a.tags.includes('misc') || (!a.tags.includes('character') && !a.tags.includes('space') && !a.tags.includes('object'))).length,
  }

  // 필터링
  const filtered = assets.filter(a => {
    const matchSearch = !search
      || a.name.toLowerCase().includes(search.toLowerCase())
      || a.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))

    const matchCat = activeTab === 'all'
      ? true
      : activeTab === 'misc'
        ? (a.tags.includes('misc') || (!a.tags.includes('character') && !a.tags.includes('space') && !a.tags.includes('object')))
        : a.tags.includes(activeTab)

    return matchSearch && matchCat
  })

async function uploadFiles(files: FileList | File[], category: RefCategory) {
  setUploading(true)
  const categoryTag: string[] = category === 'all' ? [] : [category]

  try {
    for (const file of Array.from(files)) {
      const ext  = file.name.split('.').pop() || 'png'
      const path = `${projectId}/ref_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const { data: uploaded, error: storageErr } = await supabase.storage.from('assets').upload(path, file)
      if (storageErr) {
        console.error('[asset upload] storage error:', storageErr)
        alert(`스토리지 업로드 실패: ${storageErr.message}`)
        continue
      }
      if (!uploaded) continue
      const { data: { publicUrl } } = supabase.storage.from('assets').getPublicUrl(path)
      const { error: insertErr } = await supabase.from('assets').insert({
        project_id: projectId,
        type:       'reference',
        name:       file.name,
        url:        publicUrl,
        tags:       categoryTag,
        metadata:   { file_size: file.size, mime_type: file.type },
      })
      if (insertErr) {
        console.error('[asset upload] DB insert error:', insertErr)
        alert(`DB 저장 실패: ${insertErr.message}`)
      }
    }
  } catch (e: any) {
    console.error('[asset upload] exception:', e)
    alert(`업로드 중 예외 발생: ${e?.message ?? e}`)
  } finally {
    setUploading(false)
    fetchAssets()
  }
}
  async function scoreAsset(id: string, score: number) {
    await supabase.from('assets').update({ satisfaction_score: score }).eq('id', id)
    setAssets(prev => prev.map(a => a.id === id ? { ...a, satisfaction_score: score as any } : a))
  }

  async function toggleArchive(id: string) {
    const asset = assets.find(a => a.id === id)
    if (!asset) return
    await supabase.from('assets').update({ archived: !asset.archived }).eq('id', id)
    setAssets(prev => prev.map(a => a.id === id ? { ...a, archived: !a.archived } : a))
  }

  async function deleteAsset(id: string) {
    if (!confirm('이 레퍼런스를 삭제할까요?')) return
    await supabase.from('assets').delete().eq('id', id)
    setAssets(prev => prev.filter(a => a.id !== id))
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const activeMeta = getCategoryMeta(activeTab)

  return (
    <div className="h-full flex flex-col">
      {/* ── 헤더 ── */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            레퍼런스 라이브러리
          </h1>
          <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            <span>캐릭터 · 공간 · 오브제 · 기타별로 레퍼런스를 관리하세요</span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
              style={{ background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
              <Clipboard size={9} /> Ctrl+V로 붙여넣기
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* 카테고리 업로드 버튼 */}
          <label
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer transition-all"
            style={{
              color:      activeMeta.key === 'all' ? 'var(--text-secondary)' : activeMeta.color,
              border:     `1px solid ${activeMeta.key === 'all' ? 'var(--border)' : activeMeta.border}`,
              background: activeMeta.key === 'all' ? 'transparent' : activeMeta.bg,
            }}
          >
            {uploading
              ? <Loader2 size={13} className="animate-spin" />
              : <Upload size={13} />
            }
            {activeMeta.key === 'all' ? '업로드' : `${activeMeta.label} 업로드`}
            <input
              type="file" multiple accept="image/*" className="hidden"
              onChange={e => e.target.files && uploadFiles(e.target.files, activeTab)}
            />
          </label>
          <Link
            href={`/project/${projectId}/t2i`}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium text-white"
            style={{ background: 'var(--accent)' }}
          >
            T2I로 이동 <ChevronRight size={14} />
          </Link>
        </div>
      </div>

      {/* ── 카테고리 탭 ── */}
      <div
        className="flex items-center border-b shrink-0 px-2"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        {REF_CATEGORIES.map(cat => (
          <CategoryTab
            key={cat.key}
            cat={cat}
            isActive={activeTab === cat.key}
            count={countByCategory[cat.key]}
            onClick={() => setActiveTab(cat.key)}
          />
        ))}

        {/* 검색 (탭 오른쪽) */}
        <div className="ml-auto flex items-center gap-2 py-2 pr-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="검색..."
              className="pl-7 pr-3 py-1.5 rounded-lg text-xs"
              style={{
                background: 'var(--surface-3)',
                border:     '1px solid var(--border)',
                color:      'var(--text-primary)',
                width:      '160px',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── 선택 액션 바 ── */}
      {selected.size > 0 && (
        <div
          className="flex items-center gap-3 px-6 py-2.5 border-b text-xs shrink-0"
          style={{ borderColor: 'var(--border)', background: 'var(--accent-subtle)' }}
        >
          <span style={{ color: 'var(--accent)' }}>{selected.size}개 선택됨</span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs hover:underline"
            style={{ color: 'var(--text-muted)' }}
          >
            선택 해제
          </button>
        </div>
      )}

      {/* ── 컨텐츠 ── */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>

        ) : filtered.length === 0 && activeTab !== 'all' ? (
          /* 카테고리 비어있음 → 업로드 존 */
          <UploadZone
            category={activeTab}
            onFiles={uploadFiles}
            uploading={uploading}
          />

        ) : filtered.length === 0 ? (
          /* 전체 비어있음 */
          <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
            {REF_CATEGORIES.slice(1).map(cat => {
              const Icon = cat.icon
              return (
                <div key={cat.key} className="flex items-center gap-2 text-sm"
                  style={{ color: 'var(--text-muted)' }}>
                  <Icon size={14} style={{ color: cat.color }} />
                  <span>캐릭터 · 공간 · 오브제 탭에서 레퍼런스를 업로드하세요</span>
                </div>
              )
            })}
          </div>

        ) : (
          <div>
            {/* 전체 탭에서 카테고리별 섹션으로 그룹 표시 */}
            {activeTab === 'all' ? (
              <div className="space-y-8">
                {REF_CATEGORIES.slice(1).map(cat => {
                  const catAssets = cat.key === 'misc'
                    ? filtered.filter(a => a.tags.includes('misc') || (!a.tags.includes('character') && !a.tags.includes('space') && !a.tags.includes('object')))
                    : filtered.filter(a => a.tags.includes(cat.key as string))
                  const uncatAssets: typeof filtered = []

                  const toShow = catAssets

                  if (toShow.length === 0) return null

                  const Icon = cat.icon
                  return (
                    <div key={cat.key}>
                      <div className="flex items-center gap-2 mb-3">
                        <Icon size={14} style={{ color: cat.color }} />
                        <h3 className="text-xs font-semibold uppercase tracking-wider"
                          style={{ color: cat.color }}>
                          {cat.label} 레퍼런스
                        </h3>
                        <span className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: cat.bg, color: cat.color, border: `1px solid ${cat.border}` }}>
                          {toShow.length}
                        </span>
                        <div className="flex-1 h-px" style={{ background: cat.border }} />
                        <label
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] cursor-pointer transition-all hover:opacity-80"
                          style={{ color: cat.color, background: cat.bg, border: `1px solid ${cat.border}` }}>
                          <Upload size={9} />
                          추가
                          <input type="file" multiple accept="image/*" className="hidden"
                            onChange={e => e.target.files && uploadFiles(e.target.files, cat.key as RefCategory)} />
                        </label>
                      </div>

                      {toShow.length === 0 ? (
                        <p className="text-xs py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                          아직 없음 — 위 추가 버튼으로 업로드하세요
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                          {toShow.map(asset => (
                            <AssetCard
                              key={asset.id}
                              asset={asset}
                              onScore={scoreAsset}
                              onToggleArchive={toggleArchive}
                              onDelete={deleteAsset}
                              onDownload={id => {
                                const a = assets.find(x => x.id === id)
                                if (a) { const link = document.createElement('a'); link.href = a.url; link.download = a.name; link.click() }
                              }}
                              selectable
                              selected={selected.has(asset.id)}
                              onSelect={toggleSelect}
                            />
                          ))}
                        </div>
                      )}

                      {/* 분류 안된 레퍼런스 (legacy) */}
                      {false && cat.key === 'character' && uncatAssets.length > 0 && (
                        <div className="mt-6">
                          <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
                            분류 안 된 레퍼런스 ({uncatAssets.length})
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {uncatAssets.map(asset => (
                              <AssetCard
                                key={asset.id}
                                asset={asset}
                                onScore={scoreAsset}
                                onToggleArchive={toggleArchive}
                                onDelete={deleteAsset}
                                onDownload={id => {
                                  const a = assets.find(x => x.id === id)
                                  if (a) { const link = document.createElement('a'); link.href = a.url; link.download = a.name; link.click() }
                                }}
                                selectable
                                selected={selected.has(asset.id)}
                                onSelect={toggleSelect}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              /* 단일 카테고리 탭 */
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {filtered.map(asset => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    onScore={scoreAsset}
                    onToggleArchive={toggleArchive}
                    onDelete={deleteAsset}
                    onDownload={id => {
                      const a = assets.find(x => x.id === id)
                      if (a) { const link = document.createElement('a'); link.href = a.url; link.download = a.name; link.click() }
                    }}
                    selectable
                    selected={selected.has(asset.id)}
                    onSelect={toggleSelect}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
