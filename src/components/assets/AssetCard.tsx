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
        selected ? 'border-vault-500 ring-2 ring-vault-200' : 'border-sage-200 hover:border-sage-300'
      }`}
      onClick={onClick}
    >
      {/* Thumbnail area */}
      <div className="aspect-square bg-sage-50 flex items-center justify-center relative overflow-hidden">
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
            selected ? 'bg-vault-600 border-vault-600' : 'bg-white border-sage-300'
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
            asset.business === 'natures' ? 'bg-vault-100 text-vault-800' :
            asset.business === 'adk' ? 'bg-wood-100 text-wood-800' :
            'bg-sage-100 text-sage-600'
          }`}>
            {asset.business === 'natures' ? "NS" : asset.business === 'adk' ? 'ADK' : 'Both'}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-sm font-medium text-sage-900 truncate" title={asset.file_name}>
          {asset.file_name}
        </p>
        <p className="text-xs text-sage-400 mt-0.5">{formatFileSize(asset.file_size)}</p>
        {asset.tags && asset.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map(tag => (
              <span key={tag} className="px-1.5 py-0.5 bg-sage-100 text-sage-600 rounded text-xs">
                {tag}
              </span>
            ))}
            {asset.tags.length > 3 && (
              <span className="text-xs text-sage-400">+{asset.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TypeIcon({ type }: { type: ContentType }) {
  const icons: Record<ContentType, { bg: string; text: string; label: string }> = {
    image: { bg: 'bg-vault-100', text: 'text-vault-600', label: 'IMG' },
    video: { bg: 'bg-wood-100', text: 'text-wood-600', label: 'VID' },
    pdf: { bg: 'bg-red-50', text: 'text-red-500', label: 'PDF' },
    document: { bg: 'bg-sage-100', text: 'text-sage-600', label: 'DOC' },
    adobe: { bg: 'bg-wood-100', text: 'text-wood-600', label: 'AI' },
    other: { bg: 'bg-sage-100', text: 'text-sage-500', label: 'FILE' },
  }
  const { bg, text, label } = icons[type] ?? icons.other
  return (
    <div className={`w-14 h-14 rounded-xl ${bg} flex items-center justify-center`}>
      <span className={`text-xs font-bold ${text}`}>{label}</span>
    </div>
  )
}
