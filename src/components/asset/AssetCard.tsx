'use client'

import { useState } from 'react'
import { Download, Archive, Tag, Film, Image, Mic, FolderOpen } from 'lucide-react'
import type { Asset } from '@/types'
import SatisfactionRating from '@/components/ui/SatisfactionRating'
import FileNameEditor from '@/components/ui/FileNameEditor'
import Badge from '@/components/ui/Badge'
import { cn } from '@/lib/utils'

const TYPE_ICONS = {
  reference: FolderOpen,
  t2i: Image,
  i2v: Film,
  lipsync: Mic,
}

const TYPE_LABELS = {
  reference: '레퍼런스',
  t2i: 'T2I',
  i2v: 'I2V',
  lipsync: '립싱크',
}

interface AssetCardProps {
  asset: Asset
  onScore?: (id: string, score: number) => void
  onToggleArchive?: (id: string) => void
  onDownload?: (id: string) => void
  onRename?: (id: string, newName: string) => Promise<void> | void
  selectable?: boolean
  selected?: boolean
  onSelect?: (id: string) => void
}

export default function AssetCard({
  asset, onScore, onToggleArchive, onDownload, onRename,
  selectable, selected, onSelect
}: AssetCardProps) {
  const [showMeta, setShowMeta] = useState(false)
  const Icon = TYPE_ICONS[asset.type]
  const isVideo = asset.type === 'i2v' || asset.type === 'lipsync'

  return (
    <div
      className={cn(
        'rounded-xl overflow-hidden border transition-all cursor-pointer group',
        selected ? 'ring-2 ring-indigo-500' : 'hover:border-indigo-500/40'
      )}
      style={{ background: 'var(--surface)', borderColor: selected ? 'var(--accent)' : 'var(--border)' }}
      onClick={() => selectable && onSelect?.(asset.id)}
    >
      {/* Media Preview */}
      <div className="relative aspect-video bg-[var(--bg-3)]">
        {isVideo ? (
          <video src={asset.url} className="w-full h-full object-cover" muted loop
            onMouseEnter={e => (e.target as HTMLVideoElement).play()}
            onMouseLeave={e => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0 }} />
        ) : asset.url ? (
          <img src={asset.thumbnail_url ?? asset.url} alt={asset.name}
            className="w-full h-full object-cover" />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Icon size={32}  />
          </div>
        )}

        {/* Overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {onDownload && (
            <button onClick={e => { e.stopPropagation(); onDownload(asset.id) }}
              className="p-2 rounded-lg bg-white/10 hover-surface text-white transition-all">
              <Download size={16} />
            </button>
          )}
          {onToggleArchive && (
            <button onClick={e => { e.stopPropagation(); onToggleArchive(asset.id) }}
              className={cn('p-2 rounded-lg transition-all', asset.archived
                ? 'bg-[var(--ok-soft)] '
                : 'bg-white/10 hover-surface text-white')}>
              <Archive size={16} />
            </button>
          )}
        </div>

        {/* Type Badge */}
        <div className="absolute top-2 left-2">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-black/60 text-white">
            <Icon size={11} />
            {TYPE_LABELS[asset.type]}
          </div>
        </div>

        {/* Archive Dot */}
        {asset.archived && (
          <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400" />
        )}

        {/* Select Checkbox */}
        {selectable && (
          <div className={cn(
            'absolute top-2 right-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
            selected ? 'bg-indigo-500 border-indigo-500' : 'border-white/60 bg-black/30'
          )}>
            {selected && <span className="text-white text-[10px]">✓</span>}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          <FileNameEditor
            value={asset.name}
            onSave={async (newName) => { await onRename?.(asset.id, newName) }}
            disabled={!onRename}
          />
        </div>

        <SatisfactionRating value={asset.satisfaction_score} size="sm"
          onChange={score => onScore?.(asset.id, score)} />

        {/* Tags */}
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {asset.tags.map(tag => (
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
