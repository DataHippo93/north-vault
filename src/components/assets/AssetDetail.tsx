'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import type { Asset } from '@/types'
import { formatFileSize } from '@/lib/utils/fileType'
import SocialMetrics from './SocialMetrics'

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

export default function AssetDetail({
  asset,
  onClose,
  onDelete,
  onUpdateTags,
  onUpdateNotes,
  onUpdateBusiness,
  onRename,
  userRole,
}: Props) {
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
  const [aiRenaming, setAiRenaming] = useState(false)

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
    if (!t || (asset.tags ?? []).includes(t)) {
      setTagInput('')
      return
    }
    onUpdateTags(asset, [...(asset.tags ?? []), t])
    setTagInput('')
  }

  function removeTag(tag: string) {
    onUpdateTags(
      asset,
      (asset.tags ?? []).filter((t) => t !== tag),
    )
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

  async function handleAiRename() {
    setAiRenaming(true)
    try {
      const res = await fetch('/api/assets/ai-rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: asset.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNameInput(data.suggestedName)
      setEditingName(true)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'AI rename failed', 'error')
    } finally {
      setAiRenaming(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="bg-sage-950/60 absolute inset-0 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl">
        {/* Toast */}
        {toast && (
          <div
            className={`absolute top-4 right-4 left-4 z-10 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
              toast.type === 'success'
                ? 'border border-green-200 bg-green-100 text-green-800'
                : 'border border-red-200 bg-red-100 text-red-800'
            }`}
          >
            {toast.message}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          {editingName ? (
            <div className="flex flex-1 items-center gap-2 pr-2">
              <input
                autoFocus
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') {
                    setEditingName(false)
                    setNameInput(asset.file_name)
                  }
                }}
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm font-semibold text-slate-900 focus:ring-2 focus:ring-slate-900 focus:outline-none"
              />
              <button
                onClick={handleRename}
                disabled={renaming}
                className="rounded bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {renaming ? '...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setEditingName(false)
                  setNameInput(asset.file_name)
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
              <h2 className="truncate text-base font-semibold text-slate-900">{asset.file_name}</h2>
              <button
                onClick={() => setEditingName(true)}
                title="Rename"
                className="flex-shrink-0 text-slate-400 hover:text-slate-600"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
              </button>
              <button
                onClick={handleAiRename}
                disabled={aiRenaming}
                title="AI Rename — suggest a name from tags and content"
                className="text-vault-400 hover:text-vault-600 flex-shrink-0 disabled:opacity-40"
              >
                {aiRenaming ? (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
              </button>
            </div>
          )}
          <button onClick={onClose} className="flex-shrink-0 text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {/* Preview */}
          <div
            className="bg-sage-50 relative flex items-center justify-center overflow-hidden rounded-xl"
            style={{ minHeight: 200 }}
          >
            {asset.content_type === 'image' && signedUrl ? (
              <Image src={signedUrl} alt={asset.file_name} fill className="object-contain" sizes="448px" unoptimized />
            ) : asset.content_type === 'video' && signedUrl ? (
              <video src={signedUrl} controls className="max-h-64 max-w-full" />
            ) : asset.content_type === 'pdf' && signedUrl ? (
              <iframe src={signedUrl} className="h-64 w-full" title={asset.file_name} />
            ) : (
              <div className="py-12 text-center">
                <div className="bg-sage-100 mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl">
                  <span className="text-sage-500 text-sm font-bold">
                    {asset.content_type === 'document' ? 'DOC' : asset.content_type === 'adobe' ? 'AI' : 'FILE'}
                  </span>
                </div>
                <p className="text-sage-500 text-sm">{asset.mime_type}</p>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="space-y-2">
            <h3 className="text-sage-500 text-xs font-semibold tracking-wider uppercase">Details</h3>
            <dl className="space-y-2">
              <Row label="Original name" value={asset.original_filename} />
              <Row label="Size" value={formatFileSize(asset.file_size)} />
              <Row label="Type" value={asset.content_type} />
              <Row label="MIME" value={asset.mime_type} />
              <Row label="Uploaded" value={new Date(asset.created_at).toLocaleString()} />
              {asset.original_created_at && (
                <Row label="Date taken" value={new Date(asset.original_created_at).toLocaleString()} />
              )}
              {asset.exif_data && (
                <>
                  {(asset.exif_data.Make || asset.exif_data.Model) && (
                    <Row
                      label="Camera"
                      value={[asset.exif_data.Make, asset.exif_data.Model].filter(Boolean).join(' ') as string}
                    />
                  )}
                  {asset.exif_data.GPSLatitude !== null &&
                    asset.exif_data.GPSLatitude !== undefined &&
                    asset.exif_data.GPSLongitude !== null &&
                    asset.exif_data.GPSLongitude !== undefined && (
                      <Row
                        label="Location"
                        value={`${(asset.exif_data.GPSLatitude as number).toFixed(5)}, ${(asset.exif_data.GPSLongitude as number).toFixed(5)}`}
                      />
                    )}
                  {asset.exif_data.FNumber !== null && asset.exif_data.FNumber !== undefined && (
                    <Row label="Aperture" value={`f/${asset.exif_data.FNumber}`} />
                  )}
                  {asset.exif_data.ISO !== null && asset.exif_data.ISO !== undefined && (
                    <Row label="ISO" value={String(asset.exif_data.ISO)} />
                  )}
                </>
              )}
            </dl>
          </div>

          {/* People */}
          {(asset.face_label || asset.face_group) && (
            <div className="space-y-2">
              <h3 className="text-sage-500 text-xs font-semibold tracking-wider uppercase">People</h3>
              <div className="border-vault-100 bg-vault-50 text-vault-800 rounded-lg border px-3 py-2 text-sm">
                {asset.face_label || asset.face_group}
                {asset.face_confidence ? (
                  <span className="text-vault-600 ml-2 text-xs">
                    {Math.round(asset.face_confidence * 100)}% match
                  </span>
                ) : null}
              </div>
            </div>
          )}

          {/* Business */}
          <div className="space-y-2">
            <h3 className="text-sage-500 text-xs font-semibold tracking-wider uppercase">Business</h3>
            <select
              value={asset.business}
              onChange={(e) => onUpdateBusiness(asset, e.target.value)}
              className="border-sage-300 focus:ring-vault-500 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            >
              <option value="both">Both</option>
              <option value="natures">{"Nature's Storehouse"}</option>
              <option value="adk">ADK Fragrance</option>
            </select>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sage-500 text-xs font-semibold tracking-wider uppercase">Tags</h3>
              {asset.content_type === 'image' && (
                <button
                  onClick={handleGetAiTags}
                  disabled={aiTagging}
                  className="text-vault-600 hover:text-vault-800 flex items-center gap-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {aiTagging ? (
                    <span>Analyzing...</span>
                  ) : (
                    <>
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                      </svg>
                      AI Tags
                    </>
                  )}
                </button>
              )}
            </div>
            {aiTagError && <p className="text-xs text-red-500">{aiTagError}</p>}
            <div className="mb-2 flex flex-wrap gap-2">
              {(asset.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="bg-sage-100 text-sage-700 flex items-center gap-1 rounded-md px-2 py-1 text-sm"
                >
                  {tag}
                  <button onClick={() => removeTag(tag)} className="text-sage-400 hover:text-sage-700">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                className="border-sage-300 focus:ring-vault-500 flex-1 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
              <button
                onClick={addTag}
                className="bg-vault-600 hover:bg-vault-700 rounded-lg px-3 py-2 text-sm text-white transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          {/* Barcodes */}
          {asset.barcodes && asset.barcodes.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sage-500 text-xs font-semibold tracking-wider uppercase">Barcodes</h3>
              <div className="flex flex-wrap gap-2">
                {asset.barcodes.map((barcode) => (
                  <span
                    key={barcode}
                    className="border-sage-200 bg-sage-50 text-sage-700 flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs"
                  >
                    <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 6h1v12H4zm3 0h1v12H7zm2 0h2v12H9zm3 0h1v12h-1zm2 0h1v12h-1zm2 0h2v12h-2z"
                      />
                    </svg>
                    {barcode}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Extracted text */}
          {asset.extracted_text && asset.extracted_text.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sage-500 text-xs font-semibold tracking-wider uppercase">Extracted Text</h3>
              <div className="border-sage-100 bg-sage-50 max-h-32 overflow-y-auto rounded-lg border px-3 py-2">
                {asset.extracted_text.map((line, i) => (
                  <p key={i} className="text-sage-700 text-xs leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Social Media Performance */}
          <SocialMetrics assetId={asset.id} />

          {/* Notes */}
          <div className="space-y-2">
            <h3 className="text-sage-500 text-xs font-semibold tracking-wider uppercase">Notes</h3>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                setNotesChanged(true)
              }}
              placeholder="Add notes about this asset..."
              rows={3}
              className="border-sage-300 focus:ring-vault-500 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            {notesChanged && (
              <button
                onClick={() => {
                  onUpdateNotes(asset, notes)
                  setNotesChanged(false)
                }}
                className="text-vault-600 hover:text-vault-800 text-sm font-medium"
              >
                Save notes
              </button>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="border-sage-200 bg-wood-50 flex gap-3 border-t px-6 py-4">
          <button
            onClick={handleDownload}
            className="bg-vault-600 hover:bg-vault-700 flex-1 rounded-lg py-2 text-sm font-medium text-white shadow-sm transition-colors"
          >
            Download
          </button>
          {userRole === 'admin' && (
            <button
              onClick={() => onDelete(asset)}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
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
      <dt className="text-sage-500 w-28 flex-shrink-0 pt-0.5 text-xs">{label}</dt>
      <dd className="text-sage-900 text-sm break-all">{value}</dd>
    </div>
  )
}
