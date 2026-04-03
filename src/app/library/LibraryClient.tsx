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
        <h1 className="text-2xl font-bold text-slate-900">Asset Library</h1>
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
            className={`p-2 rounded-md border text-sm ${view === 'grid' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
            title="Grid view"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-2 rounded-md border text-sm ${view === 'list' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
            title="List view"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by name, notes..."
              value={filters.query}
              onChange={(e) => setFilters(f => ({ ...f, query: e.target.value }))}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <select
            value={filters.businessEntity}
            onChange={(e) => setFilters(f => ({ ...f, businessEntity: e.target.value as BusinessEntity | 'all' }))}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
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
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
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
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
          {(filters.contentTypes.length > 0 || filters.query || filters.businessEntity !== 'all') && (
            <button
              onClick={() => setFilters(defaultFilters)}
              className="px-3 py-1 rounded-full text-xs font-medium text-slate-500 hover:text-slate-900 border border-slate-200 hover:border-slate-300"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-blue-800">{selectedIds.size} selected</span>
          <button
            onClick={handleBulkDownload}
            className="text-sm bg-blue-700 text-white px-3 py-1.5 rounded-md hover:bg-blue-800"
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
              className="px-2 py-1.5 border border-blue-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
            <button
              onClick={() => handleBulkTag(tagInput)}
              className="text-sm bg-white text-blue-700 border border-blue-300 px-3 py-1.5 rounded-md hover:bg-blue-50"
            >
              Tag
            </button>
          </div>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-blue-600 hover:text-blue-800 ml-auto"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Asset count */}
      <div className="text-sm text-slate-500">
        {loading ? 'Loading...' : `${assets.length} asset${assets.length !== 1 ? 's' : ''}`}
      </div>

      {/* Grid/List view */}
      {!loading && assets.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <svg className="w-12 h-12 mx-auto mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
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
              onSelect={(id) => setSelectedIds(prev => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id); else next.add(id)
                return next
              })}
              onClick={() => setSelectedAsset(asset)}
            />
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 font-medium text-slate-600 w-8">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      if (e.target.checked) setSelectedIds(new Set(assets.map(a => a.id)))
                      else setSelectedIds(new Set())
                    }}
                    checked={selectedIds.size === assets.length && assets.length > 0}
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 hidden sm:table-cell">Type</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 hidden md:table-cell">Business</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 hidden md:table-cell">Size</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 hidden lg:table-cell">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {assets.map(asset => (
                <tr
                  key={asset.id}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => setSelectedAsset(asset)}
                >
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(asset.id)}
                      onChange={() => setSelectedIds(prev => {
                        const next = new Set(prev)
                        if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id)
                        return next
                      })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <FileTypeIcon type={asset.content_type as ContentType} />
                      <span className="font-medium text-slate-900 truncate max-w-[200px]">{asset.file_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell text-slate-500 capitalize">{asset.content_type}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-slate-500">
                    {asset.business === 'natures' ? "Nature's" : asset.business === 'adk' ? 'ADK' : 'Both'}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-slate-500">{formatFileSize(asset.file_size)}</td>
                  <td className="px-4 py-3 hidden lg:table-cell text-slate-500">
                    {new Date(asset.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Asset detail panel */}
      {selectedAsset && (
        <AssetDetail
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onDelete={handleDeleteAsset}
          onUpdateTags={handleUpdateTags}
          onUpdateNotes={handleUpdateNotes}
          onUpdateBusiness={handleUpdateBusiness}
          userRole={userRole}
        />
      )}
    </div>
  )
}

function FileTypeIcon({ type }: { type: ContentType }) {
  const colors: Record<ContentType, string> = {
    image: 'text-blue-500',
    video: 'text-purple-500',
    pdf: 'text-red-500',
    document: 'text-green-500',
    adobe: 'text-orange-500',
    other: 'text-slate-400',
  }
  return (
    <span className={`text-lg ${colors[type] ?? 'text-slate-400'}`}>
      {type === 'image' ? '🖼' : type === 'video' ? '🎥' : type === 'pdf' ? '📄' : type === 'document' ? '📝' : type === 'adobe' ? '🎨' : '📁'}
    </span>
  )
}
