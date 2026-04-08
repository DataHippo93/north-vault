'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { Person } from '@/types'

export default function PeopleClient() {
  const [persons, setPersons] = useState<(Person & { crop_url?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const loadPersons = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/faces/persons')
      if (res.ok) {
        const data = await res.json()
        setPersons(data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPersons()
  }, [loadPersons])

  async function handleSaveName(personId: string) {
    await fetch(`/api/faces/persons/${personId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim() || null }),
    })
    setEditingId(null)
    void loadPersons()
  }

  const filtered = persons.filter((p) => {
    if (!search) return true
    const q = search.toLowerCase()
    return p.name?.toLowerCase().includes(q) || (!p.name && 'unknown'.includes(q))
  })

  const named = filtered.filter((p) => p.name)
  const unnamed = filtered.filter((p) => !p.name)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">People</h1>
          <p className="mt-1 text-sm text-stone-500">
            {persons.length} {persons.length === 1 ? 'person' : 'people'} detected
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <svg
          className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people..."
          className="w-full rounded-lg border border-stone-300 py-2 pr-3 pl-10 text-sm focus:ring-2 focus:ring-[#6b7f5e] focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="py-20 text-center text-stone-400">Loading...</div>
      ) : persons.length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-stone-100">
            <svg className="h-8 w-8 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-stone-700">No faces detected yet</h3>
          <p className="mt-2 text-sm text-stone-500">
            Go to the Library, select some images, and click &quot;Scan faces&quot; to get started.
          </p>
          <Link
            href="/library"
            className="mt-4 inline-block rounded-lg bg-[#4a5a3f] px-5 py-2 text-sm font-medium text-white hover:bg-[#3d4b34]"
          >
            Go to Library
          </Link>
        </div>
      ) : (
        <>
          {/* Named people */}
          {named.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium tracking-wide text-stone-400 uppercase">Named</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {named.map((p) => (
                  <PersonCard
                    key={p.id}
                    person={p}
                    isEditing={editingId === p.id}
                    editName={editName}
                    onStartEdit={() => {
                      setEditingId(p.id)
                      setEditName(p.name ?? '')
                    }}
                    onEditChange={setEditName}
                    onSave={() => handleSaveName(p.id)}
                    onCancel={() => setEditingId(null)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Unnamed people */}
          {unnamed.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium tracking-wide text-stone-400 uppercase">
                Unnamed ({unnamed.length})
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {unnamed.map((p) => (
                  <PersonCard
                    key={p.id}
                    person={p}
                    isEditing={editingId === p.id}
                    editName={editName}
                    onStartEdit={() => {
                      setEditingId(p.id)
                      setEditName('')
                    }}
                    onEditChange={setEditName}
                    onSave={() => handleSaveName(p.id)}
                    onCancel={() => setEditingId(null)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function PersonCard({
  person,
  isEditing,
  editName,
  onStartEdit,
  onEditChange,
  onSave,
  onCancel,
}: {
  person: Person & { crop_url?: string }
  isEditing: boolean
  editName: string
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="group rounded-xl border border-stone-200 bg-white p-4 text-center transition-shadow hover:shadow-md">
      {/* Face circle */}
      <Link href={`/people/${person.id}`}>
        <div className="mx-auto mb-3 h-24 w-24 overflow-hidden rounded-full bg-stone-100">
          {person.crop_url ? (
            <Image
              src={person.crop_url}
              alt={person.name ?? 'Unknown person'}
              width={96}
              height={96}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <svg className="h-10 w-10 text-stone-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
          )}
        </div>
      </Link>

      {/* Name */}
      {isEditing ? (
        <div className="space-y-2">
          <input
            type="text"
            value={editName}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave()
              if (e.key === 'Escape') onCancel()
            }}
            placeholder="Enter name..."
            className="w-full rounded border border-stone-300 px-2 py-1 text-center text-sm focus:ring-2 focus:ring-[#6b7f5e] focus:outline-none"
            autoFocus
          />
          <div className="flex justify-center gap-1">
            <button onClick={onSave} className="rounded bg-[#4a5a3f] px-2 py-0.5 text-xs text-white hover:bg-[#3d4b34]">
              Save
            </button>
            <button
              onClick={onCancel}
              className="rounded bg-stone-200 px-2 py-0.5 text-xs text-stone-600 hover:bg-stone-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            onClick={onStartEdit}
            className="text-sm font-medium text-stone-800 hover:text-[#4a5a3f] hover:underline"
          >
            {person.name ?? 'Add name'}
          </button>
          <p className="mt-0.5 text-xs text-stone-400">
            {person.face_count} {person.face_count === 1 ? 'photo' : 'photos'}
          </p>
        </div>
      )}
    </div>
  )
}
