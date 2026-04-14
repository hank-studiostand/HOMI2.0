'use client'

import { useState } from 'react'
import { X, Check, ChevronDown, ChevronUp, Images } from 'lucide-react'
import type { Asset } from '@/types'
import {
  REF_CATEGORIES, RefCategory, getAssetCategory, getCategoryMeta,
} from '@/app/project/[id]/assets/page'
import { cn } from '@/lib/utils'

// ─── 선택 상태 타입 (카테고리별 Set) ─────────────────────────────────────────

export interface RefSelection {
  character: Set<string>
  space:     Set<string>
  object:    Set<string>
  misc:      Set<string>
}

export function emptyRefSelection(): RefSelection {
  return { character: new Set(), space: new Set(), object: new Set(), misc: new Set() }
}

export function totalRefCount(sel: RefSelection): number {
  return sel.character.size + sel.space.size + sel.object.size + sel.misc.size
}

export function allSelectedUrls(sel: RefSelection, assets: Asset[]): string[] {
  const allIds = [
    ...Array.from(sel.character),
    ...Array.from(sel.space),
    ...Array.from(sel.object),
    ...Array.from(sel.misc),
  ]
  return assets.filter(a => allIds.includes(a.id)).map(a => a.url)
}
// ─── 카테고리별 이미지 그리드 ─────────────────────────────────────────────────

function RefImageGrid({
  assets,
  selected,
  onToggle,
  maxSelect,
  color,
}: {
  assets:    Asset[]
  selected:  Set<string>
  onToggle:  (id: string) => void
  maxSelect: number
  color:     string
}) {
  if (assets.length === 0) {
    return (
      <p className="text-center text-[11px] py-5" style={{ color: 'var(--text-muted)' }}>
        레퍼런스 라이브러리에서 먼저 이미지를 업로드하세요
      </p>
    )
  }

  return (
    <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto pr-0.5">
      {assets.map(asset => {
        const isSel = selected.has(asset.id)
        const isDisabled = !isSel && selected.size >= maxSelect

        return (
          <button
            key={asset.id}
            type="button"
            disabled={isDisabled}
            onClick={() => onToggle(asset.id)}
            className={cn(
              'relative aspect-square rounded-lg overflow-hidden transition-all',
              isDisabled
                ? 'opacity-25 cursor-not-allowed'
                : 'cursor-pointer hover:opacity-90',
            )}
            style={{
              outline:       isSel ? `2px solid ${color}` : '2px solid transparent',
              outlineOffset: '2px',
            }}
          >
            <img
              src={asset.thumbnail_url ?? asset.url}
              alt={asset.name}
              className="w-full h-full object-cover"
            />
            {isSel && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ background: `${color}50` }}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: color }}
                >
                  <Check size={11} className="text-white" />
                </div>
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Main SceneReferencePicker ────────────────────────────────────────────────

const MAX_PER_CATEGORY = 3

interface SceneReferencePickerProps {
  /** 프로젝트의 모든 reference assets */
  referenceAssets: Asset[]
  /** 현재 씬의 선택 상태 */
  selection: RefSelection
  /** 선택 변경 콜백 */
  onChange: (next: RefSelection) => void
}

export default function SceneReferencePicker({
  referenceAssets,
  selection,
  onChange,
}: SceneReferencePickerProps) {
  const [open, setOpen]           = useState(false)
  const [activeTab, setActiveTab] = useState<Exclude<RefCategory, 'all'>>('character')

  const total = totalRefCount(selection)

  // 카테고리별 assets 분류
  const byCategory: Record<Exclude<RefCategory, 'all'>, Asset[]> = {
    character: referenceAssets.filter(a => a.tags.includes('character')),
    space:     referenceAssets.filter(a => a.tags.includes('space')),
    object:    referenceAssets.filter(a => a.tags.includes('object')),
    misc:      referenceAssets.filter(a => a.tags.includes('misc') || (!a.tags.includes('character') && !a.tags.includes('space') && !a.tags.includes('object'))),
  }

  function toggle(category: Exclude<RefCategory, 'all'>, id: string) {
    const current = selection[category]
    const next = new Set(current)
    if (next.has(id)) {
      next.delete(id)
    } else if (next.size < MAX_PER_CATEGORY) {
      next.add(id)
    }
    onChange({ ...selection, [category]: next })
  }

  function clearCategory(category: Exclude<RefCategory, 'all'>) {
    onChange({ ...selection, [category]: new Set() })
  }

  // 활성 탭 메타
  const tabMeta = getCategoryMeta(activeTab)

  // 선택된 이미지 미리보기 (최대 6개)
  const previewAssets = [
    ...Array.from(selection.character).map(id => referenceAssets.find(a => a.id === id)).filter(Boolean),
    ...Array.from(selection.space).map(id => referenceAssets.find(a => a.id === id)).filter(Boolean),
    ...Array.from(selection.object).map(id => referenceAssets.find(a => a.id === id)).filter(Boolean),
  ] as Asset[]

  return (
    <div>
      {/* ── 트리거 버튼 ── */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all"
        style={{
          border:     `1px solid ${total > 0 ? 'rgba(129,140,248,0.5)' : 'var(--border)'}`,
          color:      total > 0 ? '#818cf8' : 'var(--text-muted)',
          background: total > 0 ? 'rgba(99,102,241,0.08)' : 'transparent',
        }}
      >
        <Images size={13} />
        {total > 0 ? (
          <span>레퍼런스 {total}장 선택됨</span>
        ) : (
          <span>레퍼런스 이미지 추가</span>
        )}

        {/* 카테고리별 미니 카운트 */}
        {total > 0 && (
          <div className="flex items-center gap-1 ml-1">
            {(['character', 'space', 'object', 'misc'] as const).map(cat => {
              const cnt = selection[cat].size
              if (!cnt) return null
              const meta = getCategoryMeta(cat)
              const Icon = meta.icon
              return (
                <span key={cat} className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px]"
                  style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
                  <Icon size={8} />{cnt}
                </span>
              )
            })}
          </div>
        )}

        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {/* ── 드롭다운 패널 ── */}
      {open && (
        <div
          className="mt-2 rounded-xl border overflow-hidden"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          {/* 패널 헤더 */}
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}>
              레퍼런스 이미지 선택
            </span>
            <button onClick={() => setOpen(false)} style={{ color: 'var(--text-muted)' }}>
              <X size={13} />
            </button>
          </div>

          {/* 카테고리 탭 */}
          <div
            className="flex border-b"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            {REF_CATEGORIES.slice(1).map(cat => {
              const isActive = activeTab === cat.key
              const cnt = selection[cat.key as Exclude<RefCategory, 'all'>].size
              const Icon = cat.icon

              return (
                <button
                  key={cat.key}
                  onClick={() => setActiveTab(cat.key as Exclude<RefCategory, 'all'>)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-all border-b-2"
                  style={{
                    borderColor: isActive ? cat.color : 'transparent',
                    color:       isActive ? cat.color : 'var(--text-secondary)',
                    background:  isActive ? cat.bg : 'transparent',
                  }}
                >
                  <Icon size={12} />
                  {cat.label}
                  {cnt > 0 && (
                    <span
                      className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                      style={{ background: cat.color, color: 'white' }}
                    >
                      {cnt}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* 현재 탭 내용 */}
          <div className="p-3">
            {/* 탭 헤더 */}
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                <tabMeta.icon size={12} style={{ color: tabMeta.color }} />
                <span className="text-[11px] font-medium" style={{ color: tabMeta.color }}>
                  {tabMeta.label} 레퍼런스
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  (최대 {MAX_PER_CATEGORY}장)
                </span>
              </div>
              {selection[activeTab].size > 0 && (
                <button
                  onClick={() => clearCategory(activeTab)}
                  className="text-[10px] hover:underline"
                  style={{ color: 'var(--text-muted)' }}
                >
                  선택 해제
                </button>
              )}
            </div>

            <RefImageGrid
              assets={byCategory[activeTab]}
              selected={selection[activeTab]}
              onToggle={id => toggle(activeTab, id)}
              maxSelect={MAX_PER_CATEGORY}
              color={tabMeta.color}
            />
          </div>

          {/* 선택된 이미지 전체 미리보기 */}
          {previewAssets.length > 0 && (
            <div
              className="px-3 pb-3 pt-1 border-t"
              style={{ borderColor: 'var(--border)' }}
            >
              <p className="text-[10px] mb-2" style={{ color: 'var(--text-muted)' }}>
                선택된 레퍼런스 ({previewAssets.length}장) — 생성 시 참조됩니다
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {previewAssets.map((asset, i) => {
                  const cat = getAssetCategory(asset)
                  const catMeta = getCategoryMeta(cat)
                  return (
                    <div
                      key={asset.id}
                      className="relative rounded overflow-hidden"
                      style={{
                        width: 40,
                        height: 40,
                        border: `1.5px solid ${catMeta.color}`,
                      }}
                      title={`${catMeta.label} · ${asset.name}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset.url}
                        alt={asset.name}
                        className="w-full h-full object-cover"
                      />
                      <span
                        className="absolute bottom-0 right-0 text-[8px] font-bold px-1 leading-tight"
                        style={{ background: catMeta.color, color: 'white' }}
                      >
                        {i + 1}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
