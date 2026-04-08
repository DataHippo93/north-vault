'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { SocialConnection, SocialPlatform } from '@/types'

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  meta: 'Meta (Facebook & Instagram)',
  instagram: 'Instagram',
  tiktok: 'TikTok',
}

const PLATFORM_COLORS: Record<SocialPlatform, string> = {
  meta: 'bg-blue-100 text-blue-700',
  instagram: 'bg-pink-100 text-pink-700',
  tiktok: 'bg-gray-100 text-gray-700',
}

export default function SocialClient() {
  const [connections, setConnections] = useState<SocialConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [business, setBusiness] = useState('both')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const fetchConnections = useCallback(async () => {
    const res = await fetch('/api/social/connections')
    if (res.ok) {
      const data = await res.json()
      setConnections(data.connections)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchConnections()

    // Check URL params for OAuth result
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected')) {
      setMessage({ type: 'success', text: `Successfully connected ${params.get('connected')}` })
      window.history.replaceState({}, '', '/admin/social')
    }
    if (params.get('error')) {
      setMessage({ type: 'error', text: `Connection failed: ${params.get('error')}` })
      window.history.replaceState({}, '', '/admin/social')
    }
  }, [fetchConnections])

  async function handleDisconnect(connectionId: string) {
    if (!confirm('Disconnect this account? Imported assets and metrics will be kept.')) return
    setDisconnecting(connectionId)
    try {
      const res = await fetch('/api/social/connections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      })
      if (res.ok) {
        setConnections((prev) => prev.filter((c) => c.id !== connectionId))
      } else {
        const data = await res.json()
        alert(data.error ?? 'Failed to disconnect')
      }
    } finally {
      setDisconnecting(null)
    }
  }

  async function handleSyncMetrics(connectionId: string) {
    setSyncing(connectionId)
    setMessage(null)
    try {
      const res = await fetch('/api/social/metrics/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      })

      if (!res.ok || !res.body) {
        setMessage({ type: 'error', text: 'Failed to start metrics sync' })
        setSyncing(null)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim()
          else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6))
              if (eventType === 'complete') {
                setMessage({
                  type: 'success',
                  text: `Synced ${data.totalMetrics} metric snapshots for ${data.creativesProcessed} creatives`,
                })
              } else if (eventType === 'error') {
                setMessage({ type: 'error', text: data.message })
              }
            } catch {
              // skip
            }
            eventType = ''
          }
        }
      }
    } catch (err) {
      setMessage({ type: 'error', text: (err as Error).message })
    }
    setSyncing(null)
  }

  function isExpired(conn: SocialConnection): boolean {
    if (!conn.token_expires_at) return false
    return new Date(conn.token_expires_at) < new Date()
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sage-950 text-2xl font-bold">Social Media</h1>
          <p className="text-sage-500 mt-1 text-sm">Connect ad accounts to import creatives and track performance.</p>
        </div>
        <Link href="/admin" className="text-sage-500 hover:text-sage-700 text-sm transition-colors">
          Back to Admin
        </Link>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-vault-200 bg-vault-50 text-vault-700'
              : 'border-red-200 bg-red-50 text-red-600'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Connect new account */}
      <div className="border-sage-200 rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-sage-900 mb-4 text-base font-semibold">Connect an account</h2>
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sage-600 text-sm">Business:</label>
          <select
            value={business}
            onChange={(e) => setBusiness(e.target.value)}
            className="border-sage-300 focus:ring-vault-500 rounded-lg border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          >
            <option value="both">Both</option>
            <option value="natures">Nature&apos;s Storehouse</option>
            <option value="adk">ADK Fragrance Farm</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href={`/api/social/connect/meta?business=${business}`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            Connect Meta
          </a>
          <button
            disabled
            className="inline-flex items-center gap-2 rounded-lg bg-gray-300 px-5 py-2.5 text-sm font-medium text-gray-500 shadow-sm"
            title="Coming soon"
          >
            TikTok (coming soon)
          </button>
        </div>
      </div>

      {/* Connected accounts */}
      <div className="border-sage-200 overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="border-sage-200 bg-wood-50 border-b px-6 py-4">
          <h2 className="text-sage-900 text-base font-semibold">Connected accounts ({connections.length})</h2>
        </div>

        {loading ? (
          <div className="text-sage-400 px-6 py-8 text-center text-sm">Loading...</div>
        ) : connections.length === 0 ? (
          <div className="text-sage-400 px-6 py-8 text-center text-sm">
            No accounts connected yet. Connect a Meta ad account to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-sage-200 bg-sage-50 border-b">
                <th className="text-sage-600 px-6 py-3 text-left font-medium">Platform</th>
                <th className="text-sage-600 px-6 py-3 text-left font-medium">Account</th>
                <th className="text-sage-600 hidden px-6 py-3 text-left font-medium sm:table-cell">Business</th>
                <th className="text-sage-600 hidden px-6 py-3 text-left font-medium sm:table-cell">Status</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {connections.map((conn) => (
                <tr key={conn.id} className="border-sage-100 border-b last:border-0">
                  <td className="px-6 py-4">
                    <span className={`rounded px-2 py-1 text-xs font-medium ${PLATFORM_COLORS[conn.platform]}`}>
                      {PLATFORM_LABELS[conn.platform]}
                    </span>
                  </td>
                  <td className="text-sage-900 px-6 py-4 font-medium">{conn.account_name || conn.account_id}</td>
                  <td className="text-sage-500 hidden px-6 py-4 capitalize sm:table-cell">{conn.business}</td>
                  <td className="hidden px-6 py-4 sm:table-cell">
                    {isExpired(conn) ? (
                      <span className="rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-600">
                        Token expired
                      </span>
                    ) : (
                      <span className="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-700">Active</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/admin/social/import?connection=${conn.id}`}
                        className="text-vault-600 hover:text-vault-800 text-xs font-medium transition-colors"
                      >
                        Import
                      </Link>
                      <button
                        onClick={() => handleSyncMetrics(conn.id)}
                        disabled={syncing === conn.id}
                        className="text-vault-600 hover:text-vault-800 text-xs font-medium transition-colors disabled:opacity-40"
                      >
                        {syncing === conn.id ? 'Syncing...' : 'Sync metrics'}
                      </button>
                      <button
                        onClick={() => handleDisconnect(conn.id)}
                        disabled={disconnecting === conn.id}
                        className="text-xs text-red-400 transition-colors hover:text-red-600 disabled:opacity-40"
                      >
                        {disconnecting === conn.id ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
