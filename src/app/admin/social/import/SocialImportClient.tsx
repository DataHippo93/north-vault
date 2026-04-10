'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { SocialConnection } from '@/types'

interface FileResult {
  name: string
  status: 'uploaded' | 'duplicate' | 'error' | 'pending'
  duplicateOf?: string
  error?: string
  tags?: string[]
}

export default function SocialImportClient() {
  const [connections, setConnections] = useState<SocialConnection[]>([])
  const [selectedConnection, setSelectedConnection] = useState('')
  const [business, setBusiness] = useState('both')
  const [enableAiTagging, setEnableAiTagging] = useState(true)
  const [importing, setImporting] = useState(false)
  const [files, setFiles] = useState<FileResult[]>([])
  const [counts, setCounts] = useState<{ processed: number; total: number }>({ processed: 0, total: 0 })
  const [statusMessage, setStatusMessage] = useState('')
  const [summary, setSummary] = useState<Record<string, number> | null>(null)

  const fetchConnections = useCallback(async () => {
    const res = await fetch('/api/social/connections')
    if (res.ok) {
      const data = await res.json()
      setConnections(data.connections)
      // Auto-select from URL param
      const params = new URLSearchParams(window.location.search)
      const connId = params.get('connection')
      if (connId && data.connections.some((c: SocialConnection) => c.id === connId)) {
        setSelectedConnection(connId)
      } else if (data.connections.length === 1) {
        setSelectedConnection(data.connections[0].id)
      }
    }
  }, [])

  useEffect(() => {
    fetchConnections()
  }, [fetchConnections])

  async function handleImport() {
    if (!selectedConnection) return
    setImporting(true)
    setFiles([])
    setCounts({ processed: 0, total: 0 })
    setSummary(null)
    setStatusMessage('Starting import...')

    try {
      const res = await fetch('/api/import/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: selectedConnection, business, enableAiTagging }),
      })

      if (!res.ok || !res.body) {
        setStatusMessage('Failed to start import')
        setImporting(false)
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
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6))
              handleEvent(eventType, data)
            } catch {
              // skip malformed
            }
            eventType = ''
          }
        }
      }
    } catch (err) {
      setStatusMessage(`Error: ${(err as Error).message}`)
    }

    setImporting(false)
  }

  function handleEvent(event: string, data: Record<string, unknown>) {
    switch (event) {
      case 'status':
        setStatusMessage(data.message as string)
        break
      case 'counts':
        setCounts({ processed: data.processed as number, total: data.total as number })
        break
      case 'file':
        setFiles((prev) => [
          ...prev,
          {
            name: data.name as string,
            status: data.status as FileResult['status'],
            duplicateOf: data.duplicateOf as string | undefined,
            error: data.error as string | undefined,
            tags: data.tags as string[] | undefined,
          },
        ])
        break
      case 'complete':
        setSummary(data as unknown as Record<string, number>)
        setStatusMessage('Import complete')
        break
      case 'error':
        setStatusMessage(`Error: ${data.message}`)
        break
    }
  }

  const percentage = counts.total > 0 ? Math.round((counts.processed / counts.total) * 100) : 0

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sage-950 text-2xl font-bold">Import Social Creatives</h1>
          <p className="text-sage-500 mt-1 text-sm">
            Pull ad creatives from connected social media accounts into the vault.
          </p>
        </div>
        <Link href="/admin/social" className="text-sage-500 hover:text-sage-700 text-sm transition-colors">
          Back to Social
        </Link>
      </div>

      {/* Config */}
      <div className="border-sage-200 rounded-xl border bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="text-sage-700 mb-1 block text-sm font-medium">Account</label>
            <select
              value={selectedConnection}
              onChange={(e) => setSelectedConnection(e.target.value)}
              disabled={importing}
              className="border-sage-300 focus:ring-vault-500 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none disabled:opacity-50"
            >
              <option value="">Select account...</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.account_name || c.account_id} ({c.platform})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sage-700 mb-1 block text-sm font-medium">Business</label>
            <select
              value={business}
              onChange={(e) => setBusiness(e.target.value)}
              disabled={importing}
              className="border-sage-300 focus:ring-vault-500 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none disabled:opacity-50"
            >
              <option value="both">Both</option>
              <option value="natures">Nature&apos;s Storehouse</option>
              <option value="adk">ADK Fragrance Farm</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enableAiTagging}
                onChange={(e) => setEnableAiTagging(e.target.checked)}
                disabled={importing}
                className="text-vault-600 focus:ring-vault-500 rounded"
              />
              <span className="text-sage-700">AI tagging</span>
            </label>
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={handleImport}
            disabled={importing || !selectedConnection}
            className="bg-vault-600 hover:bg-vault-700 rounded-lg px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-colors disabled:opacity-50"
          >
            {importing ? 'Importing...' : 'Start import'}
          </button>
        </div>
      </div>

      {/* Progress */}
      {(importing || summary) && (
        <div className="border-sage-200 rounded-xl border bg-white p-6 shadow-sm">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-sage-600">{statusMessage}</span>
            <span className="text-sage-500 font-mono">
              {counts.processed} / {counts.total}
            </span>
          </div>
          <div className="bg-sage-200 h-2 overflow-hidden rounded-full">
            <div
              className="bg-vault-600 h-full rounded-full transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <div className="border-sage-200 rounded-xl border bg-white p-4 text-center shadow-sm">
            <div className="text-vault-600 text-2xl font-bold">{summary.uploaded ?? 0}</div>
            <div className="text-sage-500 text-xs">Uploaded</div>
          </div>
          <div className="border-sage-200 rounded-xl border bg-white p-4 text-center shadow-sm">
            <div className="text-2xl font-bold text-amber-600">{summary.duplicates ?? 0}</div>
            <div className="text-sage-500 text-xs">Duplicates</div>
          </div>
          <div className="border-sage-200 rounded-xl border bg-white p-4 text-center shadow-sm">
            <div className="text-2xl font-bold text-red-600">{summary.errors ?? 0}</div>
            <div className="text-sage-500 text-xs">Errors</div>
          </div>
        </div>
      )}

      {/* File results */}
      {files.length > 0 && (
        <div className="border-sage-200 max-h-96 overflow-y-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-sage-200 bg-sage-50 sticky top-0 border-b">
                <th className="text-sage-600 px-4 py-2 text-left font-medium">File</th>
                <th className="text-sage-600 px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f, i) => (
                <tr key={i} className="border-sage-100 border-b last:border-0">
                  <td className="text-sage-900 max-w-xs truncate px-4 py-2">{f.name}</td>
                  <td className="px-4 py-2">
                    {f.status === 'uploaded' && (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">Uploaded</span>
                    )}
                    {f.status === 'duplicate' && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                        Duplicate of {f.duplicateOf}
                      </span>
                    )}
                    {f.status === 'error' && (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-600">{f.error}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
