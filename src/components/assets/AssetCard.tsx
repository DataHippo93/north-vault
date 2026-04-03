'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Asset, ContentType } from '@/types'
import { formatFileSize } from '@/lib/utils/fileType'

interface Props {
  asset: Asset
  selected: boolean
  onSelect: (id: string) => void
  onClick: () => void
}

export default function AssetCard({ asset, selected, onSelect, onClick }: Props) {
  const supabase = createClient()
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)

  useEffect(() => {
    if (asset.content_type === 'image') {
      const path = asset.storage_path || asset.file_path
      if (!path) return
      supabase.storage
        .from('northvault-assets')
        .createSignedUrl(path, 3600)
        .then(({ data }) => {
          if (data?.signedUrl) setThumbUrl(data.signedUrl)
        })
    }
  }, [asset.id, asset.storage_path, asset.file_path, asset.content_type])

  return (
    <div
      className={`group relative bg-white rounded-xl border overflow-hidden cursor-pointer transition-all hover:shadow-md ${
        selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'
      }`}
      onClick={onClick}
    >
      {/* Thumbnail area */}
      <div className="aspect-square bg-slate-100 flex items-center justify-center relative overflow-hidden">
        {asset.content_type === 'image' && thumbUrl ? (
          <img
            src={thumbUrl}
            alt={asset.file_name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <TypeIcon type={asset.content_type as ContentType} />
        )}

        {/* Checkbox overlay */}
        <div
          className={`absolute top-2 left-2 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={e => { e.stopPropagation(); onSelect(asset.id) }}
        >
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
            selected ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300'
          }`}>
            {selected && (
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>

        {/* Business badge */}
        <div className="absolute bottom-2 right-2">
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
            asset.business === 'natures' ? 'bg-green-100 text-green-800' :
            asset.business === 'adk' ? 'bg-blue-100 text-blue-800' :
            'bg-slate-100 text-slate-600'
          }`}>
            {asset.business === 'natures' ? "NS" : asset.business === 'adk' ? 'ADK' : 'Both'}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-sm font-medium text-slate-900 truncate" title={asset.file_name}>
          {asset.file_name}
        </p>
        <p className="text-xs text-slate-400 mt-0.5">{formatFileSize(asset.file_size)}</p>
        {asset.tags && asset.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map(tag => (
              <span key={tag} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">
                {tag}
              </span>
            ))}
            {asset.tags.length > 3 && (
              <span className="text-xs text-slate-400">+{asset.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TypeIcon({ type }: { type: ContentType }) {
  const map: Record<ContentType, string> = {
    image: '🖼',
    video: '🎥',
    pdf: '📄',
    document: '📝',
    adobe: '🎨',
    other: '📁',
  }
  return <span className="text-5xl">{map[type] ?? '📁'}</span>
}
