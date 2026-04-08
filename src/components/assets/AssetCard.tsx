'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import type { Asset, ContentType } from '@/types'
import { formatFileSize } from '@/lib/utils/fileType'

interface Props {
  asset: Asset
  selected: boolean
  onSelect: (id: string, shiftKey: boolean) => void
  onClick: () => void
}

export default function AssetCard({ asset, selected, onSelect, onClick }: Props) {
  const supabase = createClient()
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)

  useEffect(() => {
    if (asset.content_type !== 'image' && asset.content_type !== 'pdf' && asset.content_type !== 'document') return

    async function loadThumb() {
      // If a thumbnail already exists in the DB, sign and use it directly
      if (asset.thumbnail_path) {
        const { data } = await supabase.storage.from('northvault-assets').createSignedUrl(asset.thumbnail_path, 3600)
        if (data?.signedUrl) {
          setThumbUrl(data.signedUrl)
          return
        }
      }

      // No thumbnail yet — ask the API to generate one, then display it
      try {
        const res = await fetch('/api/assets/thumbnail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetId: asset.id }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.signedUrl) {
            setThumbUrl(data.signedUrl)
            return
          }
        }
      } catch {
        // network error — fall through to fallback
      }

      // Fallback: show full image for images, nothing for other types
      if (asset.content_type === 'image') {
        const path = asset.storage_path || asset.file_path
        if (!path) return
        const { data } = await supabase.storage.from('northvault-assets').createSignedUrl(path, 3600)
        if (data?.signedUrl) setThumbUrl(data.signedUrl)
      }
    }

    void loadThumb()
  }, [asset.id, asset.thumbnail_path, asset.storage_path, asset.file_path, asset.content_type])

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-white transition-all hover:shadow-md ${
        selected ? 'border-vault-500 ring-vault-200 ring-2' : 'border-sage-200 hover:border-sage-300'
      }`}
      onClick={onClick}
    >
      {/* Thumbnail area */}
      <div className="bg-sage-50 relative flex aspect-square items-center justify-center overflow-hidden">
        {thumbUrl ? (
          <Image
            src={thumbUrl}
            alt={asset.file_name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        ) : (
          <TypeIcon type={asset.content_type as ContentType} />
        )}

        {/* Checkbox overlay */}
        <div
          className={`absolute top-2 left-2 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(asset.id, e.shiftKey)
          }}
        >
          <div
            className={`flex h-5 w-5 items-center justify-center rounded border-2 ${
              selected ? 'bg-vault-600 border-vault-600' : 'border-sage-300 bg-white'
            }`}
          >
            {selected && (
              <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>

        {/* Business badge */}
        <div className="absolute right-2 bottom-2">
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
              asset.business === 'natures'
                ? 'bg-vault-100 text-vault-800'
                : asset.business === 'adk'
                  ? 'bg-wood-100 text-wood-800'
                  : 'bg-sage-100 text-sage-600'
            }`}
          >
            {asset.business === 'natures' ? 'NS' : asset.business === 'adk' ? 'ADK' : 'Both'}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-sage-900 truncate text-sm font-medium" title={asset.file_name}>
          {asset.file_name}
        </p>
        <p className="text-sage-400 mt-0.5 text-xs">{formatFileSize(asset.file_size)}</p>
        {asset.tags && asset.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="bg-sage-100 text-sage-600 rounded px-1.5 py-0.5 text-xs">
                {tag}
              </span>
            ))}
            {asset.tags.length > 3 && <span className="text-sage-400 text-xs">+{asset.tags.length - 3}</span>}
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
    <div className={`h-14 w-14 rounded-xl ${bg} flex items-center justify-center`}>
      <span className={`text-xs font-bold ${text}`}>{label}</span>
    </div>
  )
}
