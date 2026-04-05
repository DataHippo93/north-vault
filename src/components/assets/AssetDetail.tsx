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
  onRename?: (asset: Asset, newName: string) => void
  userRole: string
}

export default function AssetDetail({ asset, onClose, onDelete, onUpdateTags, onUpdateNotes, onUpdateBusiness, onRename, userRole }: Props) {
  const supabase = createClient()
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [notes, setNotes] = useState(asset.notes ?? '')
  const [notesChanged, setNotesChanged] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(asset.file_name)
  const [renaming, setRenaming] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [aiTagging, setAiTagging] = useState(false)
  const [aiTagError, setAiTagError] = useState<string | null>(null)

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    setNotes(asset.notes ?? '')
    setNotesChanged(false)
    setNameInput(asset.file_name)
    setEditingName(false)

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

  async function handleRename() {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === asset.file_name) {
      setEditingName(false)
      return
    }
    setRenaming(true)
    try {
      const res = await fetch('/api/assets/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id, newName: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Rename failed', 'error')
      } else {
        showToast('Asset renamed successfully', 'success')
        setEditingName(false)
        if (onRename) onRename(asset, trimmed)
      }
    } catch {
      showToast('Rename failed', 'error')
    } finally {
      setRenaming(false)
    }
  }

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

  async function handleGetAiTags() {
    if (asset.content_type !== 'image') {
      setAiTagError('AI tagging is only supported for images.')
      return
    }
    setAiTagging(true)
    setAiTagError(null)
    try {
      const res = await fetch('/api/assets/ai-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAiTagError(data.error ?? 'AI tagging failed')
      } else {
        const existing = asset.tags ?? []
        const merged = Array.from(new Set([...existing, ...data.tags]))
        onUpdateTags(asset, merged)
      }
    } catch {
      setAiTagError('Network error — please try again.')
    } finally {
      setAiTagging(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-sage-950/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-md h-full bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Toast */}
        {toast && (
          <div className={`absolute top-4 left-4 right-4 z-10 px-4 py-3 rounded-lg text-sm font-medium shadow-lg transition-all ${
            toast.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
            {toast.message}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          {editingName ? (
            <div className="flex items-center gap-2 flex-1 pr-2">
              <input
                autoFocus
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') { setEditingName(false); setNameInput(asset.file_name) }
                }}
                className="flex-1 px-2 py-1 border border-slate-300 rounded text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
              <button
                onClick={handleRename}
                disabled={renaming}
                className="text-xs px-2 py-1 bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50"
              >
                {renaming ? '...' : 'Save'}
              </button>
              <button
                onClick={() => { setEditingName(false); setNameInput(asset.file_name) }}
                className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1 pr-2 min-w-0">
              <h2 className="text-base font-semibold text-slate-900 truncate">{asset.file_name}</h2>
              <button
                onClick={() => setEditingName(true)}
                title="Rename"
                className="text-slate-400 hover:text-slate-600 flex-shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            </div>
          )}
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Preview */}
          <div className="bg-sage-50 rounded-xl overflow-hidden flex items-center justify-center" style={{minHeight: 200}}>
            {asset.content_type === 'image' && signedUrl ? (
              <img src={signedUrl} alt={asset.file_name} className="max-w-full max-h-64 object-contain" />
            ) : asset.content_type === 'video' && signedUrl ? (
              <video src={signedUrl} controls className="max-w-full max-h-64" />
            ) : asset.content_type === 'pdf' && signedUrl ? (
              <iframe src={signedUrl} className="w-full h-64" title={asset.file_name} />
            ) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-sage-100 flex items-center justify-center mb-3">
                  <span className="text-sm font-bold text-sage-500">
                    {asset.content_type === 'document' ? 'DOC' : asset.content_type === 'adobe' ? 'AI' : 'FILE'}
                  </span>
                </div>
                <p className="text-sm text-sage-500">{asset.mime_type}</p>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-sage-500 uppercase tracking-wider">Details</h3>
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
            <h3 className="text-xs font-semibold text-sage-500 uppercase tracking-wider">Business</h3>
            <select
              value={asset.business}
              onChange={(e) => onUpdateBusiness(asset, e.target.value)}
              className="w-full px-3 py-2 border border-sage-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vault-500 bg-white"
            >
              <option value="both">Both</option>
              <option value="natures">{"Nature's Storehouse"}</option>
              <option value="adk">ADK Fragrance</option>
            </select>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-sage-500 uppercase tracking-wider">Tags</h3>
              {asset.content_type === 'image' && (
                <button
                  onClick={handleGetAiTags}
                  disabled={aiTagging}
                  className="flex items-center gap-1 text-xs text-vault-600 hover:text-vault-800 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {aiTagging ? (
                    <span>Analyzing...</span>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      AI Tags
                    </>
                  )}
                </button>
              )}
            </div>
            {aiTagError && <p className="text-xs text-red-500">{aiTagError}</p>}
            <div className="flex flex-wrap gap-2 mb-2">
              {(asset.tags ?? []).map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-1 bg-sage-100 text-sage-700 rounded-md text-sm">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="text-sage-400 hover:text-sage-700">
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
                className="flex-1 px-3 py-2 border border-sage-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vault-500"
              />
              <button onClick={addTag} className="px-3 py-2 bg-vault-600 text-white rounded-lg text-sm hover:bg-vault-700 transition-colors">
                Add
              </button>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-sage-500 uppercase tracking-wider">Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setNotesChanged(true) }}
              placeholder="Add notes about this asset..."
              rows={3}
              className="w-full px-3 py-2 border border-sage-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vault-500 resize-none"
            />
            {notesChanged && (
              <button
                onClick={() => { onUpdateNotes(asset, notes); setNotesChanged(false) }}
                className="text-sm text-vault-600 hover:text-vault-800 font-medium"
              >
                Save notes
              </button>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-sage-200 bg-wood-50 flex gap-3">
          <button
            onClick={handleDownload}
            className="flex-1 bg-vault-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-vault-700 transition-colors shadow-sm"
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
      <dt className="text-xs text-sage-500 w-28 flex-shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm text-sage-900 break-all">{value}</dd>
    </div>
  )
}
