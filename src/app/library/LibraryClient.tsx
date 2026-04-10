'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatFileSize } from '@/lib/utils/fileType'
import type { Asset, SearchFilters, ContentType, BusinessEntity } from '@/types'
import Link from 'next/link'
import AssetCard from '@/components/assets/AssetCard'
import AssetDetail from '@/components/assets/AssetDetail'

interface Props {
  userId: string
  userRole: string
  defaultBusiness: string | null
}

// Columns needed for the card grid — avoids fetching large text fields
const GRID_COLUMNS =
  'id, file_name, original_filename, file_path, file_size, mime_type, content_type, sha256_hash, business, uploaded_by, created_at, original_created_at, storage_path, storage_url, tags, notes, thumbnail_path, faces_scanned'

// How many items to render at a time before "Load more"
const PAGE_RENDER_SIZE = 100

export default function LibraryClient({ userId: _userId, userRole, defaultBusiness }: Props) {
  const supabase = createClient()
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [filters, setFilters] = useState<SearchFilters>({
    query: '',
    contentTypes: [],
    businessEntity: (defaultBusiness as BusinessEntity) ?? 'all',
    tags: [],
  })
  const [sortBy, setSortBy] = useState<'created_at' | 'file_name' | 'file_size'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [bulkTagging, setBulkTagging] = useState(false)
  const [bulkTagProgress, setBulkTagProgress] = useState<{ done: number; total: number } | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [thumbUrls, setThumbUrls] = useState<Record<string, string | null>>({})
  const [renderLimit, setRenderLimit] = useState(PAGE_RENDER_SIZE)

  const loadAssets = useCallback(async () => {
    setLoading(true)
    setQueryError(null)

    // Use the search_assets RPC when a text query is present — it supports
    // partial matching inside the tags array (e.g. "loon" matches "black loon").
    if (filters.query) {
      const { data, error } = await supabase.schema('northvault').rpc('search_assets', {
        search_term: filters.query,
        p_business: filters.businessEntity !== 'all' ? filters.businessEntity : null,
        p_content_types: filters.contentTypes.length > 0 ? filters.contentTypes : null,
        p_tags: filters.tags.length > 0 ? filters.tags : null,
        p_date_from: filters.dateFrom || null,
        p_date_to: filters.dateTo ? filters.dateTo + 'T23:59:59Z' : null,
      })
      if (error) {
        console.error('Search RPC error:', error)
        setQueryError(error.message)
      } else if (data) {
        const sorted = [...(data as Asset[])].sort((a, b) => {
          const av = a[sortBy as keyof Asset] as string | number | null
          const bv = b[sortBy as keyof Asset] as string | number | null
          if (av === null || av === undefined) return 1
          if (bv === null || bv === undefined) return -1
          return sortDir === 'asc' ? (av < bv ? -1 : 1) : av > bv ? -1 : 1
        })
        setAssets(sorted)
      }
      setLoading(false)
      return
    }

    // No text search — use direct table query with filters
    let query = supabase.schema('northvault').from('assets').select(GRID_COLUMNS)

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

    // Paginate to bypass Supabase's 1000-row default limit
    const PAGE_SIZE = 1000
    let allData: Asset[] = []
    let from = 0
    let keepGoing = true

    while (keepGoing) {
      const { data: page, error: pageError } = await query.range(from, from + PAGE_SIZE - 1)
      if (pageError) {
        console.error('Asset query error:', pageError)
        setQueryError(pageError.message)
        setLoading(false)
        return
      }
      if (page) allData = allData.concat(page as Asset[])
      if (!page || page.length < PAGE_SIZE) keepGoing = false
      else from += PAGE_SIZE
    }

    setAssets(allData)
    setRenderLimit(PAGE_RENDER_SIZE)
    setLoading(false)
  }, [filters, sortBy, sortDir])

  // Fetch total asset count (unfiltered)
  useEffect(() => {
    async function fetchTotalCount() {
      const { count } = await supabase.schema('northvault').from('assets').select('id', { count: 'exact', head: true })
      setTotalCount(count)
    }
    fetchTotalCount()
  }, [])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  // Batch-load thumbnail URLs for currently visible assets
  useEffect(() => {
    if (assets.length === 0) return
    const visible = assets.slice(0, renderLimit)
    const needThumbs = visible.filter((a) => !(a.id in thumbUrls)).map((a) => a.id)
    if (needThumbs.length === 0) return

    async function loadThumbs() {
      try {
        const res = await fetch('/api/assets/batch-thumbnails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetIds: needThumbs }),
        })
        if (res.ok) {
          const data = await res.json()
          setThumbUrls((prev) => ({ ...prev, ...data.urls }))
        }
      } catch {
        // Non-fatal — cards will show type icons
      }
    }
    loadThumbs()
  }, [assets, renderLimit])

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
    await supabase.schema('northvault').from('assets').update({ tags: newTags }).eq('id', asset.id)
    setSelectedAsset((prev) => (prev?.id === asset.id ? { ...prev, tags: newTags } : prev))
    loadAssets()
  }

  async function handleUpdateNotes(asset: Asset, notes: string) {
    await supabase.schema('northvault').from('assets').update({ notes }).eq('id', asset.id)
    loadAssets()
  }

  async function handleUpdateBusiness(asset: Asset, business: string) {
    await supabase.schema('northvault').from('assets').update({ business }).eq('id', asset.id)
    loadAssets()
  }

  async function handleRename(asset: Asset, newName: string) {
    const res = await fetch('/api/assets/rename', {
      method: 'POST',
      body: JSON.stringify({ assetId: asset.id, fileName: newName }),
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    loadAssets()
    if (selectedAsset?.id === asset.id) {
      setSelectedAsset({ ...asset, file_name: data.newFileName, storage_path: data.newPath })
    }
  }

  async function handleBulkDownload() {
    const selected = assets.filter((a) => selectedIds.has(a.id))
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

  async function handleTagAllUntagged() {
    const untagged = assets.filter((a) => a.content_type === 'image' && (!a.tags || a.tags.length === 0))
    if (untagged.length === 0) return
    if (
      !confirm(`AI-tag ${untagged.length} untagged image${untagged.length !== 1 ? 's' : ''}? This may take a minute.`)
    )
      return

    setBulkTagging(true)
    setBulkTagProgress({ done: 0, total: untagged.length })

    let tagged = 0
    let failed = 0

    for (let i = 0; i < untagged.length; i++) {
      const asset = untagged[i]
      try {
        const res = await fetch('/api/assets/ai-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetId: asset.id }),
        })
        const data = await res.json()
        if (res.ok && data.tags?.length) {
          const merged = Array.from(new Set([...(asset.tags ?? []), ...data.tags]))
          const { error: updateError } = await supabase
            .schema('northvault')
            .from('assets')
            .update({ tags: merged })
            .eq('id', asset.id)
          if (updateError) {
            console.error('Tag save failed for', asset.id, updateError)
            failed++
          } else {
            tagged++
          }
        } else {
          console.error('AI tag failed for', asset.id, data.error ?? '(no tags returned)')
          failed++
        }
      } catch (err) {
        console.error('Tagging error for', asset.id, err)
        failed++
      }
      if (i < untagged.length - 1) await new Promise((resolve) => setTimeout(resolve, 6200))
      setBulkTagProgress({ done: i + 1, total: untagged.length })
    }

    setBulkTagging(false)
    setBulkTagProgress(null)
    loadAssets()
    if (failed > 0) {
      alert(
        `Tagged ${tagged} image${tagged !== 1 ? 's' : ''}. ${failed} failed — check the browser console for details.`,
      )
    }
  }

  async function handleBulkAiTag() {
    const selected = assets.filter((a) => selectedIds.has(a.id) && a.content_type === 'image')
    if (selected.length === 0) {
      alert('No images in your selection to AI-tag.')
      return
    }
    if (!confirm(`AI-tag ${selected.length} image${selected.length !== 1 ? 's' : ''}? This may take a moment.`)) return
    setBulkTagging(true)
    setBulkTagProgress({ done: 0, total: selected.length })
    let tagged = 0,
      failed = 0
    for (let i = 0; i < selected.length; i++) {
      const asset = selected[i]
      try {
        const res = await fetch('/api/assets/ai-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetId: asset.id }),
        })
        const data = await res.json()
        if (res.ok && data.tags?.length) {
          const merged = Array.from(new Set([...(asset.tags ?? []), ...data.tags]))
          const { error: updateError } = await supabase
            .schema('northvault')
            .from('assets')
            .update({ tags: merged })
            .eq('id', asset.id)
          if (updateError) {
            console.error('Tag save failed', asset.id, updateError)
            failed++
          } else tagged++
        } else {
          console.error('AI tag failed', asset.id, data.error)
          failed++
        }
      } catch (err) {
        console.error('Tagging error', asset.id, err)
        failed++
      }
      setBulkTagProgress({ done: i + 1, total: selected.length })
    }
    setBulkTagging(false)
    setBulkTagProgress(null)
    loadAssets()
    if (failed > 0) alert(`Tagged ${tagged}. ${failed} failed — check browser console.`)
  }

  async function handleBulkThumbnail() {
    const selected = assets.filter(
      (a) => selectedIds.has(a.id) && (a.content_type === 'image' || a.content_type === 'pdf'),
    )
    if (selected.length === 0) {
      alert('No images or PDFs in your selection.')
      return
    }
    let done = 0,
      failed = 0
    for (const asset of selected) {
      try {
        const res = await fetch('/api/assets/thumbnail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetId: asset.id }),
        })
        if (res.ok) done++
        else failed++
      } catch {
        failed++
      }
    }
    loadAssets()
    alert(`Generated ${done} thumbnail${done !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}.`)
  }

  const [scanningFaces, setScanningFaces] = useState(false)
  const [faceScanProgress, setFaceScanProgress] = useState<{ done: number; total: number; faces: number } | null>(null)

  async function handleBulkScanFaces() {
    const selected = assets.filter((a) => selectedIds.has(a.id) && a.content_type === 'image')
    if (selected.length === 0) {
      alert('No images in your selection.')
      return
    }

    setScanningFaces(true)
    setFaceScanProgress({ done: 0, total: selected.length, faces: 0 })

    try {
      const res = await fetch('/api/faces/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetIds: selected.map((a) => a.id) }),
      })

      if (!res.ok) {
        alert('Face scan failed')
        setScanningFaces(false)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        setScanningFaces(false)
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let totalFaces = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6))
              if (eventType === 'progress') {
                setFaceScanProgress((p) =>
                  p ? { ...p, done: (data.current as number) - 1, total: data.total as number } : p,
                )
              } else if (eventType === 'file') {
                totalFaces += (data.facesFound as number) ?? 0
                setFaceScanProgress((p) => (p ? { ...p, done: p.done + 1, faces: totalFaces } : p))
              }
            } catch {
              /* skip */
            }
            eventType = ''
          }
        }
      }

      loadAssets()
      alert(`Scanned ${selected.length} images. Found ${totalFaces} face${totalFaces !== 1 ? 's' : ''}.`)
    } catch {
      alert('Face scan failed')
    } finally {
      setScanningFaces(false)
      setFaceScanProgress(null)
    }
  }

  async function handleGroupFacesAndTag() {
    const faceAssets = assets.filter((a) => a.content_type === 'image')
    if (faceAssets.length === 0) return
    if (!confirm(`Analyze ${faceAssets.length} image${faceAssets.length !== 1 ? 's' : ''} for face groups and tags?`)) return

    setBulkTagging(true)
    setBulkTagProgress({ done: 0, total: faceAssets.length })

    for (let i = 0; i < faceAssets.length; i++) {
      const asset = faceAssets[i]
      try {
        const res = await fetch('/api/ai-tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assetId: asset.id,
            fileName: asset.file_name,
            mimeType: asset.mime_type,
            contentType: asset.content_type,
          }),
        })
        const data = await res.json()
        const merged = Array.from(new Set([...(asset.tags ?? []), ...(data.tags ?? []), ...(data.faceGroup ? [data.faceGroup] : [])]))
        await supabase
          .schema('northvault')
          .from('assets')
          .update({ tags: merged, face_group: data.faceGroup ?? null })
          .eq('id', asset.id)
      } catch {
        // continue
      }
      if (i < faceAssets.length - 1) await new Promise((resolve) => setTimeout(resolve, 6200))
      setBulkTagProgress({ done: i + 1, total: faceAssets.length })
    }

    setBulkTagging(false)
    setBulkTagProgress(null)
    loadAssets()
  }

  async function handleBulkTag(tag: string) {
    if (!tag.trim()) return
    const selected = assets.filter((a) => selectedIds.has(a.id))
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

  async function handleBulkDelete() {
    const selected = assets.filter((a) => selectedIds.has(a.id))
    if (
      !confirm(`Permanently delete ${selected.length} asset${selected.length !== 1 ? 's' : ''}? This cannot be undone.`)
    )
      return
    setBulkDeleting(true)
    for (const asset of selected) {
      const path = asset.storage_path || asset.file_path
      if (path) await supabase.storage.from('northvault-assets').remove([path])
      await supabase.schema('northvault').from('assets').delete().eq('id', asset.id)
    }
    setSelectedIds(new Set())
    setLastSelectedId(null)
    setBulkDeleting(false)
    loadAssets()
  }

  function handleSelect(id: string, shiftKey: boolean) {
    const idx = assets.findIndex((a) => a.id === id)
    if (shiftKey && lastSelectedId !== null) {
      const lastIdx = assets.findIndex((a) => a.id === lastSelectedId)
      const [from, to] = lastIdx < idx ? [lastIdx, idx] : [idx, lastIdx]
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (let i = from; i <= to; i++) next.add(assets[i].id)
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      setLastSelectedId(id)
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
        <h1 className="text-sage-950 text-2xl font-bold">Asset Library</h1>
        <div className="flex items-center gap-2">
          {/* Tag all untagged */}
          {(() => {
            const untaggedCount = assets.filter(
              (a) => a.content_type === 'image' && (!a.tags || a.tags.length === 0),
            ).length
            if (untaggedCount === 0) return null
            return (
              <button
                onClick={handleTagAllUntagged}
                disabled={bulkTagging}
                className="border-vault-300 bg-vault-50 text-vault-700 hover:bg-vault-100 hidden items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 sm:inline-flex"
              >
                {bulkTagging && bulkTagProgress ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    {bulkTagProgress.done}/{bulkTagProgress.total}
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                      />
                    </svg>
                    Tag {untaggedCount} untagged
                  </>
                )}
              </button>
            )
          })()}
          <button
            onClick={handleGroupFacesAndTag}
            disabled={bulkTagging}
            className="border-vault-300 bg-vault-50 text-vault-700 hover:bg-vault-100 hidden items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 sm:inline-flex"
          >
            Group faces + tag
          </button>
          <Link
            href="/upload"
            className="hidden items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 sm:inline-flex"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            Upload Assets
          </Link>
          <button
            onClick={() => setView('grid')}
            className={`rounded-md border p-2 text-sm transition-colors ${view === 'grid' ? 'bg-sage-950 border-sage-950 text-white' : 'border-sage-300 text-sage-600 hover:bg-sage-100'}`}
            title="Grid view"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
              />
            </svg>
          </button>
          <button
            onClick={() => setView('list')}
            className={`rounded-md border p-2 text-sm transition-colors ${view === 'list' ? 'bg-sage-950 border-sage-950 text-white' : 'border-sage-300 text-sage-600 hover:bg-sage-100'}`}
            title="List view"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="border-sage-200 space-y-3 rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by name, notes..."
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              className="border-sage-300 focus:ring-vault-500 w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>
          <select
            value={filters.businessEntity}
            onChange={(e) => setFilters((f) => ({ ...f, businessEntity: e.target.value as BusinessEntity | 'all' }))}
            className="border-sage-300 focus:ring-vault-500 rounded-lg border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          >
            {businessOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={`${sortBy}:${sortDir}`}
            onChange={(e) => {
              const [s, d] = e.target.value.split(':')
              setSortBy(s as typeof sortBy)
              setSortDir(d as typeof sortDir)
            }}
            className="border-sage-300 focus:ring-vault-500 rounded-lg border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          >
            <option value="created_at:desc">Newest first</option>
            <option value="created_at:asc">Oldest first</option>
            <option value="file_name:asc">Name A-Z</option>
            <option value="file_name:desc">Name Z-A</option>
            <option value="file_size:desc">Largest first</option>
            <option value="file_size:asc">Smallest first</option>
          </select>
        </div>

        {/* Date range filters */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex items-center gap-2">
            <label className="text-xs whitespace-nowrap text-slate-500">From</label>
            <input
              type="date"
              value={filters.dateFrom ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value || undefined }))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs whitespace-nowrap text-slate-500">To</label>
            <input
              type="date"
              value={filters.dateTo ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value || undefined }))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-none"
            />
          </div>
        </div>

        {/* Content type filters */}
        <div className="flex flex-wrap gap-2">
          {contentTypeOptions.map((type) => (
            <button
              key={type}
              onClick={() => {
                setFilters((f) => ({
                  ...f,
                  contentTypes: f.contentTypes.includes(type)
                    ? f.contentTypes.filter((t) => t !== type)
                    : [...f.contentTypes, type],
                }))
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filters.contentTypes.includes(type)
                  ? 'bg-vault-600 border-vault-600 text-white'
                  : 'border-sage-300 text-sage-600 hover:bg-sage-100'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
          {(filters.contentTypes.length > 0 ||
            filters.query ||
            filters.businessEntity !== 'all' ||
            filters.dateFrom ||
            filters.dateTo ||
            filters.tags.length > 0) && (
            <button
              onClick={() =>
                setFilters({
                  query: '',
                  contentTypes: [],
                  businessEntity: (defaultBusiness as BusinessEntity) ?? 'all',
                  tags: [],
                })
              }
              className="text-sage-500 hover:text-sage-900 border-sage-200 hover:border-sage-300 rounded-full border px-3 py-1 text-xs font-medium"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="bg-vault-50 border-vault-200 flex flex-wrap items-center gap-3 rounded-xl border p-3">
          <span className="text-vault-800 text-sm font-medium">{selectedIds.size} selected</span>
          <button
            onClick={handleBulkDownload}
            className="bg-vault-600 hover:bg-vault-700 rounded-md px-3 py-1.5 text-sm text-white"
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
              className="border-vault-300 focus:ring-vault-500 rounded-md border px-2 py-1.5 text-sm focus:ring-1 focus:outline-none"
            />
            <button
              onClick={() => handleBulkTag(tagInput)}
              className="text-vault-700 border-vault-300 hover:bg-vault-50 rounded-md border bg-white px-3 py-1.5 text-sm"
            >
              Tag
            </button>
          </div>
          <button
            onClick={handleBulkAiTag}
            disabled={bulkTagging}
            className="rounded-md border border-[#6b7f5e] bg-[#f0f4ec] px-3 py-1.5 text-sm text-[#4a5a3f] hover:bg-[#e4ecda] disabled:opacity-50"
          >
            {bulkTagging && bulkTagProgress
              ? `AI tagging… ${bulkTagProgress.done}/${bulkTagProgress.total}`
              : 'AI tag selected'}
          </button>
          <button
            onClick={handleBulkThumbnail}
            className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
          >
            Generate thumbnails
          </button>
          <button
            onClick={handleBulkScanFaces}
            disabled={scanningFaces}
            className="rounded-md border border-purple-300 bg-purple-50 px-3 py-1.5 text-sm text-purple-700 hover:bg-purple-100 disabled:opacity-50"
          >
            {scanningFaces && faceScanProgress
              ? `Scanning faces… ${faceScanProgress.done}/${faceScanProgress.total} (${faceScanProgress.faces} found)`
              : 'Scan faces'}
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
          </button>
          <button
            onClick={() => {
              setSelectedIds(new Set())
              setLastSelectedId(null)
            }}
            className="text-vault-600 hover:text-vault-800 ml-auto text-sm"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Query error */}
      {queryError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Search error: {queryError}
        </div>
      )}

      {/* Asset count */}
      <div className="text-sage-500 text-sm">
        {loading
          ? 'Loading...'
          : totalCount !== null && totalCount !== assets.length
            ? `${assets.length} shown of ${totalCount.toLocaleString()} total`
            : `${assets.length.toLocaleString()} asset${assets.length !== 1 ? 's' : ''}`}
      </div>

      {/* Grid/List view */}
      {!loading && assets.length === 0 ? (
        <div className="text-sage-500 py-20 text-center">
          <div className="bg-sage-100 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl">
            <svg className="text-sage-300 h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p className="mb-1 text-lg font-medium">No assets found</p>
          <p className="text-sm">Upload some files to get started.</p>
        </div>
      ) : view === 'grid' ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {assets.slice(0, renderLimit).map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                thumbUrl={thumbUrls[asset.id] ?? null}
                selected={selectedIds.has(asset.id)}
                onClick={() => setSelectedAsset(asset)}
                onSelect={handleSelect}
              />
            ))}
          </div>
          {renderLimit < assets.length && (
            <div className="flex justify-center pt-4">
              <button
                onClick={() => setRenderLimit((l) => l + PAGE_RENDER_SIZE)}
                className="border-sage-300 text-sage-700 hover:bg-sage-100 rounded-lg border bg-white px-6 py-2.5 text-sm font-medium transition-colors"
              >
                Load more ({Math.min(PAGE_RENDER_SIZE, assets.length - renderLimit)} of{' '}
                {(assets.length - renderLimit).toLocaleString()} remaining)
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="space-y-2">
            {assets.slice(0, renderLimit).map((asset) => (
              <div
                key={asset.id}
                className="border-sage-200 flex items-center justify-between rounded-lg border bg-white p-3"
              >
                <div className="min-w-0">
                  <div className="text-sage-900 truncate font-medium">{asset.file_name}</div>
                  <div className="text-sage-500 text-xs">
                    {formatFileSize(asset.file_size)} · {asset.content_type}
                  </div>
                </div>
                <button onClick={() => setSelectedAsset(asset)} className="text-vault-700 hover:text-vault-900 text-sm">
                  View
                </button>
              </div>
            ))}
          </div>
          {renderLimit < assets.length && (
            <div className="flex justify-center pt-4">
              <button
                onClick={() => setRenderLimit((l) => l + PAGE_RENDER_SIZE)}
                className="border-sage-300 text-sage-700 hover:bg-sage-100 rounded-lg border bg-white px-6 py-2.5 text-sm font-medium transition-colors"
              >
                Load more ({(assets.length - renderLimit).toLocaleString()} remaining)
              </button>
            </div>
          )}
        </>
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
