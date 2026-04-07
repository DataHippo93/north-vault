'use client'

import { useEffect, useState, useCallback } from 'react'

interface PRItem {
  id: string
  url: string
  title: string | null
  publication: string | null
  published_date: string | null
  media_type: string | null
  business: string | null
  person: string | null
  summary: string | null
  archived: boolean
  found_at: string
}

const BUSINESS_LABELS: Record<string, string> = {
  adk_fragrance: 'ADK Fragrance',
  natures_storehouse: "Nature's Storehouse",
}

interface Props {
  defaultBusiness: string | null
}

export default function PRClient({ defaultBusiness }: Props) {
  const [items, setItems] = useState<PRItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [businessFilter, setBusinessFilter] = useState<string>(defaultBusiness ?? '')
  const [showArchived, setShowArchived] = useState(false)
  const [archiving, setArchiving] = useState<string | null>(null)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (businessFilter) params.set('business', businessFilter)
      if (showArchived) params.set('archived', 'true')
      const res = await fetch(`/api/pr?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setItems(data.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load PR items')
    } finally {
      setLoading(false)
    }
  }, [businessFilter, showArchived])

  useEffect(() => {
    void load()
  }, [load])

  async function handleArchive(item: PRItem) {
    setArchiving(item.id)
    try {
      const res = await fetch('/api/pr', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, archived: !item.archived }),
      })
      if (!res.ok) throw new Error('Failed')
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, archived: !item.archived } : i)))
    } finally {
      setArchiving(null)
    }
  }

  async function handleImportImages(item: PRItem) {
    setImportingId(item.id)
    setImportSuccess(null)
    try {
      const res = await fetch('/api/pr/import-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, url: item.url, business: item.business }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setImportSuccess(`${data.imported} image${data.imported !== 1 ? 's' : ''} imported`)
      setTimeout(() => setImportSuccess(null), 4000)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImportingId(null)
    }
  }

  const businesses = Array.from(new Set(items.map((i) => i.business).filter(Boolean))) as string[]

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-sage-900 text-2xl font-bold">PR &amp; Media Coverage</h1>
          <p className="text-sage-500 mt-1 text-sm">Articles gathered by Openclaw · {items.length} results</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Business filter */}
          <select
            value={businessFilter}
            onChange={(e) => setBusinessFilter(e.target.value)}
            className="border-sage-200 text-sage-800 focus:ring-vault-500/40 rounded-lg border bg-white px-3 py-2 text-sm shadow-sm focus:ring-2 focus:outline-none"
          >
            <option value="">All businesses</option>
            {businesses.map((b) => (
              <option key={b} value={b}>
                {BUSINESS_LABELS[b] ?? b}
              </option>
            ))}
          </select>
          {/* Archived toggle */}
          <label className="text-sage-600 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-vault-600"
            />
            Show archived
          </label>
        </div>
      </div>

      {/* Import success toast */}
      {importSuccess && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {importSuccess} — check the Library to view and tag them.
        </div>
      )}

      {/* Content */}
      {loading && <div className="text-sage-400 flex items-center justify-center py-20">Loading…</div>}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="border-sage-100 text-sage-400 rounded-xl border bg-white py-16 text-center">
          No PR items found.
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className={`rounded-xl border bg-white shadow-sm transition-opacity ${
                item.archived ? 'border-sage-100 opacity-50' : 'border-sage-200'
              }`}
            >
              <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                  {/* Left: content */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {item.business && (
                        <span className="bg-vault-100 text-vault-700 rounded-full px-2 py-0.5 text-xs font-medium">
                          {BUSINESS_LABELS[item.business] ?? item.business}
                        </span>
                      )}
                      {item.media_type && (
                        <span className="bg-sage-100 text-sage-600 rounded-full px-2 py-0.5 text-xs capitalize">
                          {item.media_type}
                        </span>
                      )}
                      {item.archived && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">Archived</span>
                      )}
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sage-900 hover:text-vault-600 text-sm font-semibold hover:underline"
                    >
                      {item.title ?? item.url}
                    </a>
                    <div className="text-sage-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {item.publication && <span>{item.publication}</span>}
                      {item.published_date && <span>{new Date(item.published_date).toLocaleDateString()}</span>}
                      {item.person && <span>👤 {item.person}</span>}
                      <span className="text-sage-300">Found {new Date(item.found_at).toLocaleDateString()}</span>
                    </div>
                    {item.summary && <p className="text-sage-500 mt-2 line-clamp-2 text-xs">{item.summary}</p>}
                  </div>

                  {/* Right: actions */}
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <button
                      onClick={() => handleImportImages(item)}
                      disabled={importingId === item.id}
                      title="Import photos from this article into the vault"
                      className="border-vault-200 bg-vault-50 text-vault-700 hover:bg-vault-100 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      {importingId === item.id ? (
                        <>
                          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Importing…
                        </>
                      ) : (
                        <>
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                            />
                          </svg>
                          Import Photos
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleArchive(item)}
                      disabled={archiving === item.id}
                      className="text-sage-400 text-xs transition-colors hover:text-red-500 disabled:opacity-50"
                    >
                      {archiving === item.id ? '…' : item.archived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
