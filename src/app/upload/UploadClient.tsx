'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'
import { createClient } from '@/lib/supabase/client'
import { computeSHA256, checkDuplicate } from '@/lib/utils/fileHash'
import { formatFileSize, getContentType } from '@/lib/utils/fileType'
import type { UploadFile, BusinessEntity } from '@/types'
import JSZip from 'jszip'
import exifr from 'exifr'

interface Props {
  userId: string
}

export default function UploadClient({ userId }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [files, setFiles] = useState<UploadFile[]>([])
  const [business, setBusiness] = useState<BusinessEntity>('both')
  const [tags, setTags] = useState('')
  const [uploading, setUploading] = useState(false)
  const [aiTagging, setAiTagging] = useState(true)

  // SharePoint import state
  const [spTab, setSpTab] = useState<'upload' | 'sharepoint'>('upload')
  const [sharePointFolderUrl, setSharePointFolderUrl] = useState('')
  const [sharePointItemsJson, setSharePointItemsJson] = useState('')
  const [bulkImportStatus, setBulkImportStatus] = useState<string | null>(null)
  const [bulkImporting, setBulkImporting] = useState(false)
  const [spBrowseFiles, setSpBrowseFiles] = useState<
    Array<{ name: string; size: number; mimeType: string; downloadUrl: string; webUrl: string; isFolder: boolean }>
  >([])
  const [spBrowseLoading, setSpBrowseLoading] = useState(false)
  const [spBrowseError, setSpBrowseError] = useState<string | null>(null)
  const [spSelectedFiles, setSpSelectedFiles] = useState<Set<number>>(new Set())
  const [spSelectedFolders, setSpSelectedFolders] = useState<Set<number>>(new Set())
  const [spMode, setSpMode] = useState<'browse' | 'json'>('browse')
  // Folder navigation stack: each entry is { name, folderPath }
  const [spFolderStack, setSpFolderStack] = useState<Array<{ name: string; folderPath: string }>>([])
  const [spCurrentPath, setSpCurrentPath] = useState<string>('')

  /** Expand ZIP files into individual UploadFile entries with folder-path tags */
  async function expandFiles(acceptedFiles: File[]): Promise<UploadFile[]> {
    const result: UploadFile[] = []
    for (const file of acceptedFiles) {
      if (
        file.name.toLowerCase().endsWith('.zip') ||
        file.type === 'application/zip' ||
        file.type === 'application/x-zip-compressed'
      ) {
        try {
          const zip = await JSZip.loadAsync(file)
          for (const [relativePath, entry] of Object.entries(zip.files)) {
            if (entry.dir) continue
            const name = relativePath.split('/').pop() ?? relativePath
            if (name.startsWith('.') || name.startsWith('__MACOSX')) continue
            const blob = await entry.async('blob')
            const innerFile = new File([blob], name, {
              type: getContentType(blob.type, name) === 'image' ? 'image/jpeg' : blob.type,
            })
            // Build folder-path tags from the zip entry's directory structure
            const parts = relativePath.split('/').slice(0, -1).filter(Boolean)
            const folderTags =
              parts.length > 0
                ? [
                    ...parts.map((p) =>
                      p
                        .toLowerCase()
                        .replace(/[^a-z0-9\s-]/g, '')
                        .trim(),
                    ),
                    `path:${parts.join('/')}`,
                  ]
                : []
            result.push({ file: innerFile, status: 'pending', progress: 0, folderTags })
          }
        } catch {
          result.push({ file, status: 'pending', progress: 0 })
        }
      } else {
        result.push({ file, status: 'pending', progress: 0 })
      }
    }
    return result
  }

  const onDrop = useCallback((acceptedFiles: File[]) => {
    expandFiles(acceptedFiles).then((expanded) => {
      setFiles((prev) => [...prev, ...expanded])
    })
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
  })

  function updateFile(index: number, updates: Partial<UploadFile>) {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...updates } : f)))
  }

  async function requestAiTags(file: File, contentType: string): Promise<string[]> {
    try {
      let imageDataUrl: string | undefined
      if (contentType === 'image' && file.size < 5 * 1024 * 1024) {
        imageDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })
      }

      const res = await fetch('/api/ai-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          contentType,
          imageDataUrl,
        }),
      })

      if (!res.ok) return []
      const data = await res.json()
      return Array.isArray(data.tags) ? data.tags : []
    } catch {
      return []
    }
  }

  async function uploadFile(uploadFile: UploadFile, index: number) {
    const { file, folderTags = [] } = uploadFile
    const manualTags = tags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)

    // 1. Extract EXIF (images only, best-effort)
    let exifData: Record<string, unknown> | null = null
    let exifDateTaken: string | null = null
    if (file.type.startsWith('image/')) {
      try {
        const exif = await exifr.parse(file, {
          pick: [
            'DateTimeOriginal',
            'CreateDate',
            'GPSLatitude',
            'GPSLongitude',
            'GPSAltitude',
            'Make',
            'Model',
            'LensModel',
            'ExposureTime',
            'FNumber',
            'ISO',
          ],
        })
        if (exif && Object.keys(exif).length > 0) {
          exifData = exif as Record<string, unknown>
          const dt = exif.DateTimeOriginal ?? exif.CreateDate
          if (dt instanceof Date) exifDateTaken = dt.toISOString()
          // Add GPS location as a tag if present
          if (
            exif.GPSLatitude !== null &&
            exif.GPSLatitude !== undefined &&
            exif.GPSLongitude !== null &&
            exif.GPSLongitude !== undefined
          ) {
            folderTags.push('geotagged')
          }
        }
      } catch {
        // EXIF not available — continue
      }
    }

    // Hash the file
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

    const { error: storageError } = await supabase.storage.from('northvault-assets').upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    })

    if (storageError) {
      updateFile(index, { status: 'error', error: storageError.message })
      return
    }

    updateFile(index, { progress: 60 })

    // 4. Get signed URL
    const { data: urlData } = await supabase.storage
      .from('northvault-assets')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365) // 1 year

    // 5. AI auto-tagging (parallel with DB insert prep)
    const contentType = getContentType(file.type, file.name)
    // eslint-disable-next-line prefer-const
    let allTags = [...new Set([...manualTags, ...folderTags])]

    if (aiTagging) {
      updateFile(index, { status: 'tagging', progress: 70 })
      const suggested = await requestAiTags(file, contentType)
      // Merge: manual tags first, then AI tags (no dupes)
      for (const t of suggested) {
        if (!allTags.includes(t)) allTags.push(t)
      }
      updateFile(index, { aiTags: suggested, progress: 85 })
    }

    // 6. Insert asset record
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
        tags: allTags,
        uploaded_by: userId,
        original_created_at: exifDateTaken ?? (file.lastModified ? new Date(file.lastModified).toISOString() : null),
        exif_data: exifData,
      })
      .select()
      .single()

    if (dbError) {
      updateFile(index, { status: 'error', error: dbError.message })
      return
    }

    updateFile(index, { status: 'done', progress: 100, assetId: asset.id })
  }

  async function handleBulkImportFromSharePoint() {
    if (!sharePointItemsJson.trim()) {
      setBulkImportStatus('Paste a JSON array of SharePoint items first.')
      return
    }
    setBulkImporting(true)
    setBulkImportStatus('Starting import...')
    try {
      const items = JSON.parse(sharePointItemsJson)
      const res = await fetch('/api/assets/import-sharepoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderUrl: sharePointFolderUrl || undefined, items, autoTag: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'SharePoint import failed')
      const counts = data.results.reduce(
        (acc: { done: number; duplicate: number; error: number }, item: { status: string }) => {
          acc[item.status as keyof typeof acc] = (acc[item.status as keyof typeof acc] || 0) + 1
          return acc
        },
        { done: 0, duplicate: 0, error: 0 },
      )
      setBulkImportStatus(`Imported ${counts.done}, skipped ${counts.duplicate} duplicates, ${counts.error} errors.`)
      setSharePointItemsJson('')
    } catch (err) {
      setBulkImportStatus(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBulkImporting(false)
    }
  }

  async function browseSharePointPath(folderPath: string, folderName?: string) {
    setSpBrowseLoading(true)
    setSpBrowseError(null)
    setSpBrowseFiles([])
    setSpSelectedFiles(new Set())
    try {
      // Subfolder navigation: always use folderPath with the configured drive ID —
      // this is reliable and avoids re-parsing the URL on every click.
      // Only use the URL for the initial root browse (folderPath is empty).
      const body: Record<string, string> = folderPath
        ? { folderPath }
        : sharePointFolderUrl.trim()
          ? { folderUrl: sharePointFolderUrl }
          : {}

      const res = await fetch('/api/sharepoint/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Browse failed')
      setSpBrowseFiles(data.files || [])
      setSpSelectedFiles(new Set())
      setSpSelectedFolders(new Set())
      const resolvedPath: string = data.folderPath ?? folderPath
      setSpCurrentPath(resolvedPath)
      if (folderName !== undefined) {
        setSpFolderStack((prev) => [...prev, { name: folderName, folderPath: resolvedPath }])
      }
    } catch (err) {
      setSpBrowseError(err instanceof Error ? err.message : 'Browse failed')
    } finally {
      setSpBrowseLoading(false)
    }
  }

  async function handleSharePointBrowse() {
    setSpFolderStack([])
    setSpCurrentPath('')
    await browseSharePointPath('')
  }

  function handleSpNavigateBack(targetIndex: number) {
    const newStack = spFolderStack.slice(0, targetIndex)
    // targetIndex 0 → go back to root (use URL or drive root)
    // otherwise → navigate to the stored folderPath of the target breadcrumb entry
    const targetPath = targetIndex === 0 ? '' : (newStack[newStack.length - 1]?.folderPath ?? '')
    setSpFolderStack(newStack)
    setSpCurrentPath(targetPath)
    void browseSharePointPath(targetPath)
  }

  async function handleSpEnterFolder(folderName: string) {
    const newPath = spCurrentPath ? `${spCurrentPath}/${folderName}` : folderName
    await browseSharePointPath(newPath, folderName)
  }

  async function handleImportSelectedSharePointFiles() {
    const filesToImport = spBrowseFiles.filter((_, i) => spSelectedFiles.has(i)).filter((f) => !f.isFolder)
    if (!filesToImport.length) {
      setBulkImportStatus('Select at least one file to import.')
      return
    }
    setBulkImporting(true)
    setBulkImportStatus('Starting import...')
    try {
      const items = filesToImport.map((f) => ({ name: f.name, url: f.downloadUrl, size: f.size, mimeType: f.mimeType }))
      const res = await fetch('/api/assets/import-sharepoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderUrl: sharePointFolderUrl || undefined, items, autoTag: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      const counts = data.results.reduce(
        (acc: { done: number; duplicate: number; error: number }, item: { status: string }) => {
          acc[item.status as keyof typeof acc] = (acc[item.status as keyof typeof acc] || 0) + 1
          return acc
        },
        { done: 0, duplicate: 0, error: 0 },
      )
      setBulkImportStatus(`Imported ${counts.done}, skipped ${counts.duplicate} duplicates, ${counts.error} errors.`)
      setSpSelectedFiles(new Set())
    } catch (err) {
      setBulkImportStatus(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBulkImporting(false)
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
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const pendingCount = files.filter((f) => f.status === 'pending').length
  const doneCount = files.filter((f) => f.status === 'done').length
  const errorCount = files.filter((f) => f.status === 'error').length

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-stone-800">Upload Assets</h1>
        <div className="flex overflow-hidden rounded-lg border border-stone-300 text-sm">
          <button
            onClick={() => setSpTab('upload')}
            className={`px-4 py-2 font-medium transition-colors ${spTab === 'upload' ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
          >
            Upload Files
          </button>
          <button
            onClick={() => setSpTab('sharepoint')}
            className={`px-4 py-2 font-medium transition-colors ${spTab === 'sharepoint' ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
          >
            SharePoint Import
          </button>
        </div>
      </div>

      {spTab === 'sharepoint' ? (
        <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-stone-800">Bulk import from SharePoint</h2>
              <p className="text-sm text-stone-500">
                Browse a SharePoint folder or paste a pre-enumerated item list. Dedup runs first, then AI tagging.
              </p>
            </div>
            <div className="flex overflow-hidden rounded-lg border border-stone-300 text-xs">
              <button
                onClick={() => setSpMode('browse')}
                className={`px-3 py-1.5 font-medium transition-colors ${spMode === 'browse' ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
              >
                Browse
              </button>
              <button
                onClick={() => setSpMode('json')}
                className={`px-3 py-1.5 font-medium transition-colors ${spMode === 'json' ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
              >
                Paste JSON
              </button>
            </div>
          </div>

          <input
            type="text"
            value={sharePointFolderUrl}
            onChange={(e) => setSharePointFolderUrl(e.target.value)}
            placeholder="SharePoint folder URL, e.g. https://tenant.sharepoint.com/sites/MySite/Shared Documents/Photos"
            className="focus:ring-sage-600 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />

          {spMode === 'browse' ? (
            <>
              <div className="flex gap-2">
                <button
                  onClick={handleSharePointBrowse}
                  disabled={spBrowseLoading}
                  className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
                >
                  {spBrowseLoading ? 'Loading…' : spBrowseFiles.length > 0 ? 'Refresh' : 'Browse'}
                </button>
              </div>

              {/* Breadcrumb */}
              {(spFolderStack.length > 0 || spBrowseFiles.length > 0) && (
                <div className="flex flex-wrap items-center gap-1 text-xs text-stone-500">
                  <button
                    onClick={() => handleSpNavigateBack(0)}
                    className="font-medium text-[#4a5a3f] hover:underline"
                  >
                    Root
                  </button>
                  {spFolderStack.map((entry, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <span>/</span>
                      <button
                        onClick={() => handleSpNavigateBack(i + 1)}
                        className="font-medium text-[#4a5a3f] hover:underline"
                      >
                        {entry.name}
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {spBrowseError && <p className="text-sm text-red-600">{spBrowseError}</p>}

              {spBrowseFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-stone-600">
                    <span>
                      {spBrowseFiles.filter((f) => f.isFolder).length} folders ·{' '}
                      {spBrowseFiles.filter((f) => !f.isFolder).length} files
                    </span>
                    <button
                      onClick={() => {
                        setSpSelectedFiles(
                          new Set(spBrowseFiles.map((f, i) => (!f.isFolder ? i : -1)).filter((i) => i >= 0)),
                        )
                        setSpSelectedFolders(
                          new Set(spBrowseFiles.map((f, i) => (f.isFolder ? i : -1)).filter((i) => i >= 0)),
                        )
                      }}
                      className="text-[#4a5a3f] underline hover:text-[#3d4b34]"
                    >
                      Select all
                    </button>
                    {(spSelectedFiles.size > 0 || spSelectedFolders.size > 0) && (
                      <button
                        onClick={() => {
                          setSpSelectedFiles(new Set())
                          setSpSelectedFolders(new Set())
                        }}
                        className="text-stone-500 underline hover:text-stone-700"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 divide-y divide-stone-100 overflow-y-auto rounded-lg border border-stone-200">
                    {spBrowseFiles.map((file, idx) =>
                      file.isFolder ? (
                        <div key={idx} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-stone-50">
                          <input
                            type="checkbox"
                            checked={spSelectedFolders.has(idx)}
                            onChange={() => {
                              setSpSelectedFolders((prev) => {
                                const next = new Set(prev)
                                if (next.has(idx)) next.delete(idx)
                                else next.add(idx)
                                return next
                              })
                            }}
                            className="cursor-pointer rounded border-stone-300 text-[#6b7f5e] focus:ring-[#6b7f5e]"
                          />
                          <button
                            onClick={() => handleSpEnterFolder(file.name)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <span className="text-base">📁</span>
                            <span className="flex-1 truncate font-medium text-stone-700">{file.name}</span>
                            <svg
                              className="h-4 w-4 shrink-0 text-stone-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <label
                          key={idx}
                          className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-stone-50"
                        >
                          <input
                            type="checkbox"
                            checked={spSelectedFiles.has(idx)}
                            onChange={() => {
                              setSpSelectedFiles((prev) => {
                                const next = new Set(prev)
                                if (next.has(idx)) next.delete(idx)
                                else next.add(idx)
                                return next
                              })
                            }}
                            className="rounded border-stone-300 text-[#6b7f5e] focus:ring-[#6b7f5e]"
                          />
                          <span className="flex-1 truncate text-stone-900">{file.name}</span>
                          <span className="text-xs whitespace-nowrap text-stone-400">{formatFileSize(file.size)}</span>
                          <span className="max-w-[120px] truncate text-xs text-stone-400">{file.mimeType}</span>
                        </label>
                      ),
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {spSelectedFiles.size > 0 && (
                      <button
                        onClick={handleImportSelectedSharePointFiles}
                        disabled={bulkImporting}
                        className="rounded-lg bg-[#4a5a3f] px-4 py-2 text-sm font-medium text-white hover:bg-[#3d4b34] disabled:opacity-50"
                      >
                        {bulkImporting
                          ? 'Importing…'
                          : `Import ${spSelectedFiles.size} file${spSelectedFiles.size !== 1 ? 's' : ''}`}
                      </button>
                    )}
                    {spSelectedFolders.size > 0 && (
                      <button
                        onClick={() => {
                          const selectedFolderItems = spBrowseFiles.filter((_, i) => spSelectedFolders.has(i))
                          const params = new URLSearchParams()
                          for (const folder of selectedFolderItems) {
                            if (folder.webUrl) {
                              params.append('url', folder.webUrl)
                            } else {
                              const folderPath = spCurrentPath ? `${spCurrentPath}/${folder.name}` : folder.name
                              params.append('folderPath', folderPath)
                            }
                          }
                          router.push(`/admin/import?${params.toString()}`)
                        }}
                        className="rounded-lg border border-[#4a5a3f] px-4 py-2 text-sm font-medium text-[#4a5a3f] hover:bg-[#f0f4ec]"
                      >
                        Import {spSelectedFolders.size} folder{spSelectedFolders.size !== 1 ? 's' : ''} (recursive)
                      </button>
                    )}
                    {bulkImportStatus && <span className="text-sm text-stone-600">{bulkImportStatus}</span>}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <textarea
                value={sharePointItemsJson}
                onChange={(e) => setSharePointItemsJson(e.target.value)}
                placeholder='Paste JSON array of items, e.g. [{"name":"photo.jpg","url":"https://...","mimeType":"image/jpeg","size":12345}]'
                className="focus:ring-sage-600 min-h-32 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBulkImportFromSharePoint}
                  disabled={bulkImporting}
                  className="rounded-lg bg-[#4a5a3f] px-4 py-2 text-sm font-medium text-white hover:bg-[#3d4b34] disabled:opacity-50"
                >
                  {bulkImporting ? 'Importing...' : 'Import from JSON'}
                </button>
                {bulkImportStatus && <span className="text-sm text-stone-600">{bulkImportStatus}</span>}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Settings */}
          <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-stone-800">Upload settings</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-stone-600">Business</label>
                <select
                  value={business}
                  onChange={(e) => setBusiness(e.target.value as BusinessEntity)}
                  className="focus:ring-sage-600 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                >
                  <option value="both">Both</option>
                  <option value="natures">{"Nature's Storehouse"}</option>
                  <option value="adk">ADK Fragrance</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-stone-600">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. product, 2024, hero"
                  className="focus:ring-sage-600 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={aiTagging}
                  onChange={(e) => setAiTagging(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer-focus:ring-sage-600 peer h-5 w-9 rounded-full bg-stone-300 peer-checked:bg-[#6b7f5e] peer-focus:ring-2 peer-focus:outline-none after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
              </label>
              <span className="text-sm text-stone-600">AI auto-tagging</span>
            </div>
          </div>

          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
              isDragActive ? 'border-[#6b7f5e] bg-[#f4f7f1]' : 'border-stone-300 hover:border-stone-400'
            }`}
          >
            <input {...getInputProps()} />
            <svg
              className="mx-auto mb-4 h-12 w-12 text-stone-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="mb-1 font-medium text-stone-600">
              {isDragActive ? 'Drop files here' : 'Drag and drop files here'}
            </p>
            <p className="text-sm text-stone-400">or click to browse — any file type supported</p>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
                <div className="text-sm text-stone-600">
                  {files.length} file{files.length !== 1 ? 's' : ''}
                  {doneCount > 0 && <span className="ml-2 text-[#6b7f5e]">· {doneCount} done</span>}
                  {errorCount > 0 && <span className="ml-2 text-red-600">· {errorCount} failed</span>}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setFiles([])} className="text-sm text-stone-500 hover:text-stone-700">
                    Clear all
                  </button>
                  {pendingCount > 0 && (
                    <button
                      onClick={handleUploadAll}
                      disabled={uploading}
                      className="rounded-lg bg-[#4a5a3f] px-4 py-2 text-sm text-white transition-colors hover:bg-[#3d4b34] disabled:opacity-50"
                    >
                      {uploading ? 'Uploading...' : `Upload ${pendingCount} file${pendingCount !== 1 ? 's' : ''}`}
                    </button>
                  )}
                </div>
              </div>

              <ul className="divide-y divide-stone-100">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-4 px-6 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-stone-800">{f.file.name}</span>
                        <StatusBadge status={f.status} />
                      </div>
                      {(f.status === 'uploading' || f.status === 'tagging') && (
                        <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
                          <div
                            className="h-full rounded-full bg-[#6b7f5e] transition-all"
                            style={{ width: `${f.progress}%` }}
                          />
                        </div>
                      )}
                      {f.status === 'duplicate' && f.duplicateOf && (
                        <p className="text-wood-600 text-xs">Duplicate of: {f.duplicateOf.file_name}</p>
                      )}
                      {f.status === 'error' && f.error && <p className="text-xs text-red-600">{f.error}</p>}
                      {f.status === 'done' && (
                        <div>
                          <p className="text-xs text-[#6b7f5e]">Uploaded successfully</p>
                          {f.aiTags && f.aiTags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              <span className="text-xs text-stone-400">AI tags:</span>
                              {f.aiTags.map((tag) => (
                                <span key={tag} className="rounded bg-[#f0f4ec] px-1.5 py-0.5 text-xs text-[#4a5a3f]">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {f.status === 'pending' && (
                      <button
                        onClick={() => removeFile(i)}
                        className="flex-shrink-0 text-stone-400 hover:text-stone-600"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: UploadFile['status'] }) {
  const map: Record<UploadFile['status'], { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-stone-100 text-stone-600' },
    hashing: { label: 'Hashing...', className: 'bg-blue-50 text-blue-700' },
    checking: { label: 'Checking...', className: 'bg-blue-50 text-blue-700' },
    uploading: { label: 'Uploading...', className: 'bg-blue-50 text-blue-700' },
    tagging: { label: 'AI Tagging...', className: 'bg-[#f0f4ec] text-[#4a5a3f]' },
    done: { label: 'Done', className: 'bg-[#e8f0e0] text-[#4a5a3f]' },
    duplicate: { label: 'Duplicate', className: 'bg-amber-100 text-amber-700' },
    error: { label: 'Error', className: 'bg-red-100 text-red-700' },
  }
  const { label, className } = map[status]
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${className}`}>{label}</span>
}
