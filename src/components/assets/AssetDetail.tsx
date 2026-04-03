'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Asset } from '@/types'
import { formatFileSize } from '@/lib/utils/fileType'

interface Props {
  asset: Asset
  onClose: () => void
  onDelete: (asset: Asset) => void
  onUpdateTags: (asset: Asset, tags: string[]) => void
  onUpdateNotes: (asset: Asset, notes: string) => void
  onUpdateBusiness: (asset: Asset, business: string) => void
  userRole: string
}

export default function AssetDetail({ asset, onClose, onDelete, onUpdateTags, onUpdateNotes, onUpdateBusiness, userRole }: Props) {
  const supabase = createClient()
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [notes, setNotes] = useState(asset.notes ?? '')
  const [notesChanged, setNotesChanged] = useState(false)

  useEffect(() => {
    setNotes(asset.notes ?? '')
    setNotesChanged(false)

    const path = asset.storage_path || asset.file_path
    if (path) {
      supabase.storage
        .from('northvault-assets')
        .createSignedUrl(path, 3600)
        .then(({ data }) => {
          if (data?.signedUrl) setSignedUrl(data.signedUrl)
        })
    }
  }, [asset.id])

  async function handleDownload() {
    if (signedUrl) {
      const a = document.createElement('a')
      a.href = signedUrl
      a.download = asset.original_filename
      a.click()
    }
  }

  function addTag() {
    const t = tagInput.trim().toLowerCase()
    if (!t || (asset.tags ?? []).includes(t)) { setTagInput(''); return }
    onUpdateTags(asset, [...(asset.tags ?? []), t])
    setTagInput('')
  }

  function removeTag(tag: string) {
    onUpdateTags(asset, (asset.tags ?? []).filter(t => t !== tag))
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-md h-full bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900 truncate pr-4">{asset.file_name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Preview */}
          <div className="bg-slate-100 rounded-xl overflow-hidden flex items-center justify-center" style={{minHeight: 200}}>
            {asset.content_type === 'image' && signedUrl ? (
              <img src={signedUrl} alt={asset.file_name} className="max-w-full max-h-64 object-contain" />
            ) : asset.content_type === 'video' && signedUrl ? (
              <video src={signedUrl} controls className="max-w-full max-h-64" />
            ) : asset.content_type === 'pdf' && signedUrl ? (
              <iframe src={signedUrl} className="w-full h-64" title={asset.file_name} />
            ) : (
              <div className="text-center py-12">
                <span className="text-6xl">
                  {asset.content_type === 'document' ? '📝' : asset.content_type === 'adobe' ? '🎨' : '📁'}
                </span>
                <p className="text-sm text-slate-500 mt-2">{asset.mime_type}</p>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Details</h3>
            <dl className="space-y-2">
              <Row label="Original name" value={asset.original_filename} />
              <Row label="Size" value={formatFileSize(asset.file_size)} />
              <Row label="Type" value={asset.content_type} />
              <Row label="MIME" value={asset.mime_type} />
              <Row label="Uploaded" value={new Date(asset.created_at).toLocaleString()} />
              {asset.original_created_at && (
                <Row label="Original date" value={new Date(asset.original_created_at).toLocaleDateString()} />
              )}
            </dl>
          </div>

          {/* Business */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Business</h3>
            <select
              value={asset.business}
              onChange={(e) => onUpdateBusiness(asset, e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
            >
              <option value="both">Both</option>
              <option value="natures">{"Nature's Storehouse"}</option>
              <option value="adk">ADK Fragrance</option>
            </select>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tags</h3>
            <div className="flex flex-wrap gap-2 mb-2">
              {(asset.tags ?? []).map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-700 rounded-md text-sm">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="text-slate-400 hover:text-slate-700">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                placeholder="Add tag..."
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
              <button onClick={addTag} className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800">
                Add
              </button>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setNotesChanged(true) }}
              placeholder="Add notes about this asset..."
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none"
            />
            {notesChanged && (
              <button
                onClick={() => { onUpdateNotes(asset, notes); setNotesChanged(false) }}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Save notes
              </button>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
          <button
            onClick={handleDownload}
            className="flex-1 bg-slate-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            Download
          </button>
          {userRole === 'admin' && (
            <button
              onClick={() => onDelete(asset)}
              className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-xs text-slate-500 w-28 flex-shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm text-slate-900 break-all">{value}</dd>
    </div>
  )
}
