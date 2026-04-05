'use client'

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import type { BusinessEntity } from '@/types'

interface FileResult {
  name: string
  status: 'uploaded' | 'duplicate' | 'error' | 'dry-run'
  tags?: string[]
  duplicateOf?: string
  error?: string
}

type ImportPhase = 'idle' | 'running' | 'complete' | 'error'

export default function ImportClient() {
  const [sharePointUrl, setSharePointUrl] = useState('')
  const [business, setBusiness] = useState<BusinessEntity>('both')
  const [aiTagging, setAiTagging] = useState(true)
  const [dryRun, setDryRun] = useState(false)

  const [phase, setPhase] = useState<ImportPhase>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [currentFile, setCurrentFile] = useState('')
  const [currentPhaseLabel, setCurrentPhaseLabel] = useState('')
  const [files, setFiles] = useState<FileResult[]>([])
  const [summary, setSummary] = useState<{ total: number; uploaded: number; duplicates: number; errors: number } | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const abortRef = useRef<AbortController | null>(null)

  const startImport = useCallback(async () => {
    if (!sharePointUrl.trim()) return

    setPhase('running')
    setFiles([])
    setSummary(null)
    setErrorMessage('')
    setStatusMessage('Connecting...')
    setCurrentFile('')
    setCurrentPhaseLabel('')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/import/sharepoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sharePointUrl: sharePointUrl.trim(),
          business,
          enableAiTagging: aiTagging,
          dryRun,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const data = await res.json()
        setErrorMessage(data.error || `Server error ${res.status}`)
        setPhase('error')
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        setErrorMessage('No response stream')
        setPhase('error')
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

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
              handleSSEEvent(eventType, data)
            } catch {
              // skip malformed data
            }
            eventType = ''
          }
        }
      }

      if (phase !== 'error') {
        setPhase('complete')
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatusMessage('Import cancelled')
        setPhase('idle')
      } else {
        setErrorMessage((err as Error).message)
        setPhase('error')
      }
    }
  }, [sharePointUrl, business, aiTagging, dryRun])

  function handleSSEEvent(event: string, data: Record<string, unknown>) {
    switch (event) {
      case 'status':
        setStatusMessage(data.message as string)
        break
      case 'progress':
        setCurrentFile(data.current as string)
        setCurrentPhaseLabel(data.phase as string)
        break
      case 'file':
        setFiles(prev => [...prev, {
          name: data.name as string,
          status: data.status as FileResult['status'],
          tags: data.tags as string[] | undefined,
          duplicateOf: data.duplicateOf as string | undefined,
          error: data.error as string | undefined,
        }])
        break
      case 'complete':
        setSummary({
          total: data.total as number,
          uploaded: data.uploaded as number,
          duplicates: data.duplicates as number,
          errors: data.errors as number,
        })
        setPhase('complete')
        break
      case 'error':
        setErrorMessage(data.message as string)
        setPhase('error')
        break
    }
  }

  function handleCancel() {
    abortRef.current?.abort()
  }

  const isRunning = phase === 'running'

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin"
          className="text-stone-400 hover:text-stone-600 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-stone-800">SharePoint Import</h1>
      </div>

      {/* Settings card */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 space-y-5 shadow-sm">
        {/* SharePoint URL */}
        <div>
          <label className="block text-sm font-medium text-stone-600 mb-1">SharePoint folder URL</label>
          <input
            type="url"
            value={sharePointUrl}
            onChange={(e) => setSharePointUrl(e.target.value)}
            disabled={isRunning}
            placeholder="https://yourtenant.sharepoint.com/sites/Brand/Shared Documents/Assets"
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6b7f5e] disabled:bg-stone-50 disabled:text-stone-400"
          />
        </div>

        {/* Business + toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1">Business entity</label>
            <select
              value={business}
              onChange={(e) => setBusiness(e.target.value as BusinessEntity)}
              disabled={isRunning}
              className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6b7f5e] bg-white disabled:bg-stone-50"
            >
              <option value="both">Both</option>
              <option value="natures">{"Nature's Storehouse"}</option>
              <option value="adk">ADK Fragrance</option>
            </select>
          </div>
          <div className="flex flex-col justify-end gap-3">
            <label className="inline-flex items-center gap-3 cursor-pointer">
              <span className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  checked={aiTagging}
                  onChange={(e) => setAiTagging(e.target.checked)}
                  disabled={isRunning}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#6b7f5e] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#6b7f5e]" />
              </span>
              <span className="text-sm text-stone-600">AI auto-tagging</span>
            </label>
            <label className="inline-flex items-center gap-3 cursor-pointer">
              <span className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  disabled={isRunning}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#6b7f5e] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#6b7f5e]" />
              </span>
              <span className="text-sm text-stone-600">Dry run (enumerate only, no uploads)</span>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          {!isRunning ? (
            <button
              onClick={startImport}
              disabled={!sharePointUrl.trim()}
              className="px-6 py-2 bg-[#4a5a3f] text-white rounded-lg text-sm font-medium hover:bg-[#3d4b34] disabled:opacity-50 transition-colors"
            >
              {dryRun ? 'Start dry run' : 'Start import'}
            </button>
          ) : (
            <button
              onClick={handleCancel}
              className="px-6 py-2 bg-stone-600 text-white rounded-lg text-sm font-medium hover:bg-stone-700 transition-colors"
            >
              Cancel
            </button>
          )}
          {isRunning && (
            <span className="text-sm text-stone-500 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#6b7f5e] animate-pulse" />
              {currentPhaseLabel ? `${currentPhaseLabel}: ${currentFile}` : statusMessage}
            </span>
          )}
        </div>
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-6 py-4">
          <p className="text-sm text-red-700 font-medium">Import failed</p>
          <p className="text-sm text-red-600 mt-1">{errorMessage}</p>
        </div>
      )}

      {/* Summary card */}
      {summary && (
        <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-stone-800 mb-4">Import complete</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryStat label="Total files" value={summary.total} color="text-stone-800" />
            <SummaryStat label="Uploaded" value={summary.uploaded} color="text-[#4a5a3f]" />
            <SummaryStat label="Duplicates" value={summary.duplicates} color="text-amber-600" />
            <SummaryStat label="Errors" value={summary.errors} color="text-red-600" />
          </div>
        </div>
      )}

      {/* File results */}
      {files.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-stone-200">
            <h2 className="text-base font-semibold text-stone-800">
              Files ({files.length})
            </h2>
          </div>
          <ul className="divide-y divide-stone-100 max-h-[500px] overflow-y-auto">
            {files.map((f, i) => (
              <li key={i} className="px-6 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-stone-800 truncate">{f.name}</span>
                  <FileStatusBadge status={f.status} />
                </div>
                {f.status === 'duplicate' && f.duplicateOf && (
                  <p className="text-xs text-amber-600">Duplicate of: {f.duplicateOf}</p>
                )}
                {f.status === 'error' && f.error && (
                  <p className="text-xs text-red-600">{f.error}</p>
                )}
                {f.tags && f.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {f.tags.map(tag => (
                      <span key={tag} className="px-1.5 py-0.5 bg-[#f0f4ec] text-[#4a5a3f] rounded text-xs">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SummaryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-stone-500 mt-1">{label}</div>
    </div>
  )
}

function FileStatusBadge({ status }: { status: FileResult['status'] }) {
  const map: Record<FileResult['status'], { label: string; className: string }> = {
    uploaded: { label: 'Uploaded', className: 'bg-[#e8f0e0] text-[#4a5a3f]' },
    duplicate: { label: 'Duplicate', className: 'bg-amber-100 text-amber-700' },
    error: { label: 'Error', className: 'bg-red-100 text-red-700' },
    'dry-run': { label: 'Dry run', className: 'bg-blue-50 text-blue-700' },
  }
  const { label, className } = map[status]
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${className}`}>{label}</span>
  )
}
