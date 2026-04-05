'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatFileSize, getContentType } from '@/lib/utils/fileType'
import type { Asset, SearchFilters, ContentType, BusinessEntity } from '@/types'
import Link from 'next/link'
import AssetCard from '@/components/assets/AssetCard'
import AssetDetail from '@/components/assets/AssetDetail'

interface Props {
  userId: string
  userRole: string
}

const defaultFilters: SearchFilters = {
  query: '',
  contentTypes: [],
  businessEntity: 'all',
  tags: [],
}

export default function LibraryClient({ userId, userRole }: Props) {
  const supabase = createClient()
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [filters, setFilters] = useState<SearchFilters>(defaultFilters)
  const [sortBy, setSortBy] = useState<'created_at' | 'file_name' | 'file_size'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [tagInput, setTagInput] = useState('')
  const [sharePointFolderUrl, setSharePointFolderUrl] = useState('')
  const [sharePointItemsJson, setSharePointItemsJson] = useState('')
  const [bulkImportStatus, setBulkImportStatus] = useState<string | null>(null)
  const [bulkImporting, setBulkImporting] = useState(false)
  const [spBrowseFiles, setSpBrowseFiles] = useState<Array<{ name: string; size: number; mimeType: string; downloadUrl: string; webUrl: string; isFolder: boolean }>>([])
  const [spBrowseLoading, setSpBrowseLoading] = useState(false)
  const [spBrowseError, setSpBrowseError] = useState<string | null>(null)
  const [spSelectedFiles, setSpSelectedFiles] = useState<Set<number>>(new Set())
  const [spMode, setSpMode] = useState<'browse' | 'json'>('browse')
  const [spFolderPath, setSpFolderPath] = useState<string>('')

  const loadAssets = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .schema('northvault')
      .from('assets')
      .select('*')

    if (filters.query) {
      query = query.or(`file_name.ilike.%${filters.query}%,original_filename.ilike.%${filters.query}%,notes.ilike.%${filters.query}%`)
    }

    if (filters.contentTypes.length > 0) {
      query = query.in('content_type', filters.contentTypes)
    }

    if (filters.businessEntity !== 'all') {
      query = query.or(`business.eq.${filters.businessEntity},business.eq.both`)
    }

    if (filters.dateFrom) {
      query = query.gte('created_at', filters.dateFrom)
    }

    if (filters.dateTo) {
      query = query.lte('created_at', filters.dateTo + 'T23:59:59Z')
    }

    if (filters.tags.length > 0) {
      query = query.overlaps('tags', filters.tags)
    }

    query = query.order(sortBy, { ascending: sortDir === 'asc' })

    const { data, error } = await query
    if (!error && data) {
      setAssets(data as Asset[])
    }
    setLoading(false)
  }, [filters, sortBy, sortDir])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  async function handleDeleteAsset(asset: Asset) {
    if (!confirm(`Delete "${asset.file_name}"? This cannot be undone.`)) return

    // Delete from storage
    const storagePath = asset.storage_path || asset.file_path
    if (storagePath) {
      await supabase.storage.from('northvault-assets').remove([storagePath])
    }

    // Delete from DB
    await supabase.schema('northvault').from('assets').delete().eq('id', asset.id)

    setSelectedAsset(null)
    loadAssets()
  }

  async function handleUpdateTags(asset: Asset, newTags: string[]) {
    await supabase
      .schema('northvault')
      .from('assets')
      .update({ tags: newTags })
      .eq('id', asset.id)
    loadAssets()
  }

  async function handleUpdateNotes(asset: Asset, notes: string) {
    await supabase
      .schema('northvault')
      .from('assets')
      .update({ notes })
      .eq('id', asset.id)
    loadAssets()
  }

  async function handleUpdateBusiness(asset: Asset, business: string) {
    await supabase
      .schema('northvault')
      .from('assets')
      .update({ business })
      .eq('id', asset.id)
    loadAssets()
  }

  async function handleRename(asset: Asset, newName: string) {
    const res = await fetch('/api/assets/rename', {
      method: 'POST',
      body: JSON.stringify({ assetId: asset.id, fileName: newName }),
      headers: { 'Content-Type': 'application/json' }
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    loadAssets()
    if (selectedAsset?.id === asset.id) {
      setSelectedAsset({ ...asset, file_name: data.newFileName, storage_path: data.newPath })
    }
  }

  async function handleBulkDownload() {
    const selected = assets.filter(a => selectedIds.has(a.id))
    for (const asset of selected) {
      const path = asset.storage_path || asset.file_path
      if (!path) continue
      const { data } = await supabase.storage.from('northvault-assets').createSignedUrl(path, 60)
      if (data?.signedUrl) {
        const a = document.createElement('a')
        a.href = data.signedUrl
        a.download = asset.original_filename
        a.click()
      }
    }
  }

  async function handleBulkTag(tag: string) {
    if (!tag.trim()) return
    const selected = assets.filter(a => selectedIds.has(a.id))
    for (const asset of selected) {
      const currentTags = asset.tags ?? []
      if (!currentTags.includes(tag)) {
        await supabase
          .schema('northvault')
          .from('assets')
          .update({ tags: [...currentTags, tag] })
          .eq('id', asset.id)
      }
    }
    setTagInput('')
    loadAssets()
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
        body: JSON.stringify({
          folderUrl: sharePointFolderUrl || undefined,
          items,
          autoTag: true,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'SharePoint import failed')
      }

      const counts = data.results.reduce((acc: { done: number; duplicate: number; error: number }, item: any) => {
        acc[item.status as keyof typeof acc] = (acc[item.status as keyof typeof acc] || 0) + 1
        return acc
      }, { done: 0, duplicate: 0, error: 0 })

      setBulkImportStatus(`Imported ${counts.done}, skipped ${counts.duplicate} duplicates, ${counts.error} errors.`)
      setSharePointItemsJson('')
      loadAssets()
    } catch (err) {
      setBulkImportStatus(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBulkImporting(false)
    }
  }

  async function handleSharePointBrowse() {
    if (!sharePointFolderUrl.trim()) {
      setSpBrowseError('Enter a SharePoint folder URL first.')
      return
    }
    setSpBrowseLoading(true)
    setSpBrowseError(null)
    setSpBrowseFiles([])
    setSpSelectedFiles(new Set())

    try {
      const res = await fetch('/api/sharepoint/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderUrl: sharePointFolderUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Browse failed')
      setSpBrowseFiles(data.files || [])
      setSpFolderPath(data.folderPath || '')
    } catch (err) {
      setSpBrowseError(err instanceof Error ? err.message : 'Browse failed')
    } finally {
      setSpBrowseLoading(false)
    }
  }

  async function handleImportSelectedSharePointFiles() {
    const filesToImport = spBrowseFiles.filter((_, i) => spSelectedFiles.has(i)).filter(f => !f.isFolder)
    if (!filesToImport.length) {
      setBulkImportStatus('Select at least one file to import.')
      return
    }

    setBulkImporting(true)
    setBulkImportStatus('Starting import...')

    try {
      const items = filesToImport.map(f => ({
        name: f.name,
        url: f.downloadUrl,
        size: f.size,
        mimeType: f.mimeType,
      }))

      const res = await fetch('/api/assets/import-sharepoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderUrl: sharePointFolderUrl || undefined,
          items,
          autoTag: true,
        }),
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
      loadAssets()
    } catch (err) {
      setBulkImportStatus(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBulkImporting(false)
    }
  }

  const contentTypeOptions: ContentType[] = ['image', 'video', 'pdf', 'document', 'adobe', 'other']
  const businessOptions = [
    { value: 'all', label: 'All businesses' },
    { value: 'natures', label: "Nature's Storehouse" },
    { value: 'adk', label: 'ADK Fragrance' },
    { value: 'both', label: 'Both' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-sage-950">Asset Library</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/upload"
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Upload Assets
          </Link>
          <button
            onClick={() => setView('grid')}
            className={`p-2 rounded-md border text-sm transition-colors ${view === 'grid' ? 'bg-sage-950 text-white border-sage-950' : 'border-sage-300 text-sage-600 hover:bg-sage-100'}`}
            title="Grid view"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-2 rounded-md border text-sm transition-colors ${view === 'list' ? 'bg-sage-950 text-white border-sage-950' : 'border-sage-300 text-sage-600 hover:bg-sage-100'}`}
            title="List view"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* SharePoint bulk import */}
      <div className="bg-white rounded-xl border border-sage-200 p-4 space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-sage-900">Bulk import from SharePoint</h2>
            <p className="text-sm text-sage-500">Browse a SharePoint folder or paste a pre-enumerated item list. Dedup runs first, then AI tagging.</p>
          </div>
          <div className="flex rounded-lg border border-sage-300 overflow-hidden text-xs">
            <button
              onClick={() => setSpMode('browse')}
              className={`px-3 py-1.5 font-medium transition-colors ${spMode === 'browse' ? 'bg-sage-950 text-white' : 'text-sage-600 hover:bg-sage-100'}`}
            >
              Browse
            </button>
            <button
              onClick={() => setSpMode('json')}
              className={`px-3 py-1.5 font-medium transition-colors ${spMode === 'json' ? 'bg-sage-950 text-white' : 'text-sage-600 hover:bg-sage-100'}`}
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
          className="w-full px-3 py-2 border border-sage-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vault-500"
        />

        {spMode === 'browse' ? (
          <>
            <button
              onClick={handleSharePointBrowse}
              disabled={spBrowseLoading}
              className="px-4 py-2 bg-sage-950 text-white rounded-lg text-sm font-medium hover:bg-sage-800 disabled:opacity-50"
            >
              {spBrowseLoading ? 'Loading...' : 'Browse Folder'}
            </button>

            {spBrowseError && <p className="text-sm text-red-600">{spBrowseError}</p>}

            {spBrowseFiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-sm text-sage-600">
                  <span>{spBrowseFiles.length} items found</span>
                  <button
                    onClick={() => {
                      const allFileIndexes = spBrowseFiles
                        .map((f, i) => (!f.isFolder ? i : -1))
                        .filter((i) => i >= 0)
                      setSpSelectedFiles(new Set(allFileIndexes))
                    }}
                    className="text-vault-700 hover:text-vault-900 underline"
                  >
                    Select all files
                  </button>
                  {spSelectedFiles.size > 0 && (
                    <button
                      onClick={() => setSpSelectedFiles(new Set())}
                      className="text-sage-500 hover:text-sage-700 underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto border border-sage-200 rounded-lg divide-y divide-sage-100">
                  {spBrowseFiles.map((file, idx) => (
                    <label
                      key={idx}
                      className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-sage-50 ${
                        file.isFolder ? 'opacity-60' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={file.isFolder}
                        checked={spSelectedFiles.has(idx)}
                        onChange={() => {
                          setSpSelectedFiles((prev) => {
                            const next = new Set(prev)
                            if (next.has(idx)) next.delete(idx)
                            else next.add(idx)
                            return next
                          })
                        }}
                        className="rounded border-sage-300 text-vault-600 focus:ring-vault-500"
                      />
                      <span className="truncate flex-1 text-sage-900">
                        {file.isFolder ? '\uD83D\uDCC1 ' : ''}{file.name}
                      </span>
                      <span className="text-sage-400 text-xs whitespace-nowrap">
                        {file.isFolder ? `${file.size} items` : formatFileSize(file.size)}
                      </span>
                      <span className="text-sage-400 text-xs truncate max-w-[140px]">{file.mimeType}</span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleImportSelectedSharePointFiles}
                    disabled={bulkImporting || spSelectedFiles.size === 0}
                    className="px-4 py-2 bg-vault-600 text-white rounded-lg text-sm font-medium hover:bg-vault-700 disabled:opacity-50"
                  >
                    {bulkImporting ? 'Importing...' : `Import ${spSelectedFiles.size} selected`}
                  </button>
                  {bulkImportStatus && <span className="text-sm text-sage-600">{bulkImportStatus}</span>}
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
              className="w-full min-h-32 px-3 py-2 border border-sage-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vault-500 font-mono"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={handleBulkImportFromSharePoint}
                disabled={bulkImporting}
                className="px-4 py-2 bg-vault-600 text-white rounded-lg text-sm font-medium hover:bg-vault-700 disabled:opacity-50"
              >
                {bulkImporting ? 'Importing...' : 'Import from JSON'}
              </button>
              {bulkImportStatus && <span className="text-sm text-sage-600">{bulkImportStatus}</span>}
            </div>
          </>
        )}
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-xl border border-sage-200 p-4 space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by name, notes..."
              value={filters.query}
              onChange={(e) => setFilters(f => ({ ...f, query: e.target.value }))}
              className="w-full px-3 py-2 border border-sage-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vault-500"
            />
          </div>
          <select
            value={filters.businessEntity}
            onChange={(e) => setFilters(f => ({ ...f, businessEntity: e.target.value as BusinessEntity | 'all' }))}
            className="px-3 py-2 border border-sage-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vault-500 bg-white"
          >
            {businessOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={`${sortBy}:${sortDir}`}
            onChange={(e) => {
              const [s, d] = e.target.value.split(':')
              setSortBy(s as typeof sortBy)
              setSortDir(d as typeof sortDir)
            }}
            className="px-3 py-2 border border-sage-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-vault-500 bg-white"
          >
            <option value="created_at:desc">Newest first</option>
            <option value="created_at:asc">Oldest first</option>
            <option value="file_name:asc">Name A-Z</option>
            <option value="file_name:desc">Name Z-A</option>
            <option value="file_size:desc">Largest first</option>
            <option value="file_size:asc">Smallest first</option>
          </select>
        </div>

        {/* Content type filters */}
        <div className="flex flex-wrap gap-2">
          {contentTypeOptions.map(type => (
            <button
              key={type}
              onClick={() => {
                setFilters(f => ({
                  ...f,
                  contentTypes: f.contentTypes.includes(type)
                    ? f.contentTypes.filter(t => t !== type)
                    : [...f.contentTypes, type]
                }))
              }}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                filters.contentTypes.includes(type)
                  ? 'bg-vault-600 text-white border-vault-600'
                  : 'border-sage-300 text-sage-600 hover:bg-sage-100'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
          {(filters.contentTypes.length > 0 || filters.query || filters.businessEntity !== 'all') && (
            <button
              onClick={() => setFilters(defaultFilters)}
              className="px-3 py-1 rounded-full text-xs font-medium text-sage-500 hover:text-sage-900 border border-sage-200 hover:border-sage-300"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="bg-vault-50 border border-vault-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-vault-800">{selectedIds.size} selected</span>
          <button
            onClick={handleBulkDownload}
            className="text-sm bg-vault-600 text-white px-3 py-1.5 rounded-md hover:bg-vault-700"
          >
            Download all
          </button>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Add tag to selected..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleBulkTag(tagInput)}
              className="px-2 py-1.5 border border-vault-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-vault-500"
            />
            <button
              onClick={() => handleBulkTag(tagInput)}
              className="text-sm bg-white text-vault-700 border border-vault-300 px-3 py-1.5 rounded-md hover:bg-vault-50"
            >
              Tag
            </button>
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-vault-600 hover:text-vault-800 ml-auto"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Asset count */}
      <div className="text-sm text-sage-500">
        {loading ? 'Loading...' : `${assets.length} asset${assets.length !== 1 ? 's' : ''}`}
      </div>

      {/* Grid/List view */}
      {!loading && assets.length === 0 ? (
        <div className="text-center py-20 text-sage-500">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-sage-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-sage-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-lg font-medium mb-1">No assets found</p>
          <p className="text-sm">Upload some files to get started.</p>
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {assets.map(asset => (
            <AssetCard
              key={asset.id}
              asset={asset}
              selected={selectedIds.has(asset.id)}
              onClick={() => setSelectedAsset(asset)}
              onSelect={(id) => {
                setSelectedIds(prev => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {assets.map(asset => (
            <div key={asset.id} className="border border-sage-200 rounded-lg p-3 bg-white flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-medium text-sage-900 truncate">{asset.file_name}</div>
                <div className="text-xs text-sage-500">{formatFileSize(asset.file_size)} · {asset.content_type}</div>
              </div>
              <button
                onClick={() => setSelectedAsset(asset)}
                className="text-sm text-vault-700 hover:text-vault-900"
              >
                View
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedAsset && (
        <AssetDetail
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onDelete={handleDeleteAsset}
          onUpdateTags={handleUpdateTags}
          onUpdateNotes={handleUpdateNotes}
          onUpdateBusiness={handleUpdateBusiness}
          onRename={handleRename}
          userRole={userRole}
        />
      )}
    </div>
  )
}
