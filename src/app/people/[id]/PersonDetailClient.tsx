'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'

interface AssetWithThumb {
  id: string
  file_name: string
  thumbnail_path: string | null
  thumb_url: string | null
  content_type: string
  tags: string[] | null
  business: string
  created_at: string
}

export default function PersonDetailClient({ personId }: { personId: string }) {
  const [person, setPerson] = useState<{ name: string | null; face_count: number } | null>(null)
  const [assets, setAssets] = useState<AssetWithThumb[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Load person info
      const personsRes = await fetch('/api/faces/persons')
      if (personsRes.ok) {
        const all = await personsRes.json()
        const p = all.find((x: { id: string }) => x.id === personId)
        if (p) setPerson({ name: p.name, face_count: p.face_count })
      }

      // Load assets
      const assetsRes = await fetch(`/api/faces/persons/${personId}/assets`)
      if (assetsRes.ok) {
        const data = await assetsRes.json()
        setAssets(data.assets ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [personId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSaveName() {
    await fetch(`/api/faces/persons/${personId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim() || null }),
    })
    setEditing(false)
    void load()
  }

  if (loading) {
    return <div className="py-20 text-center text-stone-400">Loading...</div>
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/people" className="text-stone-400 transition-colors hover:text-stone-600">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>

        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName()
                if (e.key === 'Escape') setEditing(false)
              }}
              placeholder="Enter name..."
              className="rounded-lg border border-stone-300 px-3 py-1 text-lg font-bold focus:ring-2 focus:ring-[#6b7f5e] focus:outline-none"
              autoFocus
            />
            <button
              onClick={handleSaveName}
              className="rounded-lg bg-[#4a5a3f] px-3 py-1 text-sm text-white hover:bg-[#3d4b34]"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg bg-stone-200 px-3 py-1 text-sm text-stone-600 hover:bg-stone-300"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-stone-800">{person?.name ?? 'Unknown Person'}</h1>
            <button
              onClick={() => {
                setEditing(true)
                setEditName(person?.name ?? '')
              }}
              className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
              title="Edit name"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            </button>
          </div>
        )}

        <span className="text-sm text-stone-400">
          {assets.length} {assets.length === 1 ? 'photo' : 'photos'}
        </span>
      </div>

      {/* Asset grid */}
      {assets.length === 0 ? (
        <p className="py-10 text-center text-stone-400">No photos found for this person.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {assets.map((a) => (
            <div
              key={a.id}
              className="group overflow-hidden rounded-xl border border-stone-200 bg-white transition-shadow hover:shadow-md"
            >
              <div className="relative aspect-square bg-stone-50">
                {a.thumb_url ? (
                  <Image
                    src={a.thumb_url}
                    alt={a.file_name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-stone-300">
                    <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="truncate text-xs font-medium text-stone-700" title={a.file_name}>
                  {a.file_name}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
