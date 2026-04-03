'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { createClient } from '@/lib/supabase/client'
import { computeSHA256, checkDuplicate } from '@/lib/utils/fileHash'
import { getContentType } from '@/lib/utils/fileType'
import type { UploadFile, BusinessEntity } from '@/types'

interface Props {
  userId: string
}

export default function UploadClient({ userId }: Props) {
  const supabase = createClient()
  const [files, setFiles] = useState<UploadFile[]>([])
  const [business, setBusiness] = useState<BusinessEntity>('both')
  const [tags, setTags] = useState('')
  const [uploading, setUploading] = useState(false)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: UploadFile[] = acceptedFiles.map(file => ({
      file,
      status: 'pending',
      progress: 0,
    }))
    setFiles(prev => [...prev, ...newFiles])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  })

  function updateFile(index: number, updates: Partial<UploadFile>) {
    setFiles(prev => prev.map((f, i) => i === index ? { ...f, ...updates } : f))
  }

  async function uploadFile(uploadFile: UploadFile, index: number) {
    const { file } = uploadFile
    const tagList = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)

    // 1. Hash the file
    updateFile(index, { status: 'hashing', progress: 5 })
    let hash: string
    try {
      hash = await computeSHA256(file)
    } catch {
      updateFile(index, { status: 'error', error: 'Failed to hash file' })
      return
    }

    // 2. Check for duplicate
    updateFile(index, { status: 'checking', progress: 10, hash })
    const duplicate = await checkDuplicate(supabase, hash)
    if (duplicate) {
      updateFile(index, { status: 'duplicate', progress: 100, duplicateOf: duplicate })
      return
    }

    // 3. Upload to storage
    updateFile(index, { status: 'uploading', progress: 20 })
    const ext = file.name.split('.').pop() || ''
    const storagePath = `${userId}/${Date.now()}-${hash.slice(0, 8)}.${ext}`

    const { error: storageError } = await supabase.storage
      .from('northvault-assets')
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      })

    if (storageError) {
      updateFile(index, { status: 'error', error: storageError.message })
      return
    }

    updateFile(index, { progress: 80 })

    // 4. Get signed URL
    const { data: urlData } = await supabase.storage
      .from('northvault-assets')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365) // 1 year

    // 5. Insert asset record
    const contentType = getContentType(file.type, file.name)
    const { data: asset, error: dbError } = await supabase
      .schema('northvault')
      .from('assets')
      .insert({
        file_name: file.name,
        original_filename: file.name,
        sha256_hash: hash,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
        content_type: contentType,
        storage_path: storagePath,
        storage_url: urlData?.signedUrl ?? null,
        business,
        tags: tagList,
        uploaded_by: userId,
        original_created_at: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      })
      .select()
      .single()

    if (dbError) {
      updateFile(index, { status: 'error', error: dbError.message })
      return
    }

    updateFile(index, { status: 'done', progress: 100, assetId: asset.id })

    // 6. Trigger AI Auto-Tagging
    if (contentType === 'image') {
      try {
        fetch('/api/assets/analyze', {
          method: 'POST',
          body: JSON.stringify({
            assetId: asset.id,
            storageUrl: urlData?.signedUrl,
            contentType
          }),
          headers: { 'Content-Type': 'application/json' }
        })
      } catch (err) {
        console.error('Failed to trigger auto-tagging:', err)
      }
    }
  }

  async function handleUploadAll() {
    setUploading(true)
    const pending = files.map((f, i) => ({ f, i })).filter(({ f }) => f.status === 'pending')

    for (const { f, i } of pending) {
      await uploadFile(f, i)
    }
    setUploading(false)
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const pendingCount = files.filter(f => f.status === 'pending').length
  const doneCount = files.filter(f => f.status === 'done').length
  const errorCount = files.filter(f => f.status === 'error').length

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-sage-950">Upload Assets</h1>

      {/* Settings */}
      <div className="bg-white rounded-xl border border-sage-200 p-6 space-y-4 shadow-sm">
        <h2 className="text-base font-semibold text-sage-900">Upload settings</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-sage-700 mb-1">Business</label>
            <select
              value={business}
              onChange={(e) => setBusiness(e.target.value as BusinessEntity)}
              className="w-full px-3 py-2 border border-sage-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vault-500 bg-white"
            >
              <option value="both">Both</option>
              <option value="natures">{"Nature's Storehouse"}</option>
              <option value="adk">ADK Fragrance</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-sage-700 mb-1">Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. product, 2024, hero"
              className="w-full px-3 py-2 border border-sage-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vault-500"
            />
          </div>
        </div>
      </div>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
          isDragActive
            ? 'border-vault-500 bg-vault-50 shadow-inner'
            : 'border-sage-300 hover:border-vault-400 hover:bg-vault-50/50'
        }`}
      >
        <input {...getInputProps()} />
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-sage-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-sage-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <p className="text-sage-700 font-medium mb-1">
          {isDragActive ? 'Drop files here' : 'Drag and drop files here'}
        </p>
        <p className="text-sm text-sage-400">or click to browse -- any file type supported</p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="bg-white rounded-xl border border-sage-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-sage-200 flex items-center justify-between">
            <div className="text-sm text-sage-600">
              {files.length} file{files.length !== 1 ? 's' : ''}
              {doneCount > 0 && <span className="text-vault-600 ml-2">· {doneCount} done</span>}
              {errorCount > 0 && <span className="text-red-600 ml-2">· {errorCount} failed</span>}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setFiles([])}
                className="text-sm text-sage-500 hover:text-sage-700"
              >
                Clear all
              </button>
              {pendingCount > 0 && (
                <button
                  onClick={handleUploadAll}
                  disabled={uploading}
                  className="text-sm bg-vault-600 text-white px-4 py-2 rounded-lg hover:bg-vault-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {uploading ? 'Uploading...' : `Upload ${pendingCount} file${pendingCount !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          </div>

          <ul className="divide-y divide-sage-100">
            {files.map((f, i) => (
              <li key={i} className="px-6 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-sage-900 truncate">{f.file.name}</span>
                    <StatusBadge status={f.status} />
                  </div>
                  {f.status === 'uploading' && (
                    <div className="h-1.5 bg-sage-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-vault-500 rounded-full transition-all"
                        style={{ width: `${f.progress}%` }}
                      />
                    </div>
                  )}
                  {f.status === 'duplicate' && f.duplicateOf && (
                    <p className="text-xs text-wood-600">Duplicate of: {f.duplicateOf.file_name}</p>
                  )}
                  {f.status === 'error' && f.error && (
                    <p className="text-xs text-red-600">{f.error}</p>
                  )}
                  {f.status === 'done' && (
                    <p className="text-xs text-vault-600">Uploaded successfully</p>
                  )}
                </div>
                {f.status === 'pending' && (
                  <button onClick={() => removeFile(i)} className="text-sage-400 hover:text-sage-600 flex-shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: UploadFile['status'] }) {
  const map: Record<UploadFile['status'], { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-sage-100 text-sage-600' },
    hashing: { label: 'Hashing...', className: 'bg-vault-100 text-vault-700' },
    checking: { label: 'Checking...', className: 'bg-vault-100 text-vault-700' },
    uploading: { label: 'Uploading...', className: 'bg-vault-100 text-vault-700' },
    done: { label: 'Done', className: 'bg-vault-100 text-vault-700' },
    duplicate: { label: 'Duplicate', className: 'bg-wood-100 text-wood-700' },
    error: { label: 'Error', className: 'bg-red-100 text-red-700' },
  }
  const { label, className } = map[status]
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${className}`}>{label}</span>
  )
}
