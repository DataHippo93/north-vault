'use client'

import { useState, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
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
  const searchParams = useSearchParams()
  const [sharePointUrl, setSharePointUrl] = useState(searchParams.get('url') ?? '')
  const [business, setBusiness] = useState<BusinessEntity>('both')
  const [aiTagging, setAiTagging] = useState(true)
  const [dryRun, setDryRun] = useState(false)

  const [phase, setPhase] = useState<ImportPhase>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [currentFile, setCurrentFile] = useState('')
  const [currentPhaseLabel, setCurrentPhaseLabel] = useState('')
  const [files, setFiles] = useState<FileResult[]>([])
  const [summary, setSummary] = useState<{
    total: number
    uploaded: number
    duplicates: number
    errors: number
  } | null>(null)
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
              switch (eventType) {
                case 'status':
                  setStatusMessage(data.message as string)
                  break
                case 'progress':
                  setCurrentFile(data.current as string)
                  setCurrentPhaseLabel(data.phase as string)
                  break
                case 'file':
                  setFiles((prev) => [
                    ...prev,
                    {
                      name: data.name as string,
                      status: data.status as FileResult['status'],
                      tags: data.tags as string[] | undefined,
                      duplicateOf: data.duplicateOf as string | undefined,
                      error: data.error as string | undefined,
                    },
                  ])
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

  function handleCancel() {
    abortRef.current?.abort()
  }

  const isRunning = phase === 'running'

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin" className="text-stone-400 transition-colors hover:text-stone-600">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-stone-800">SharePoint Import</h1>
      </div>

      {/* Settings card */}
      <div className="space-y-5 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        {/* SharePoint URL */}
        <div>
          <label className="mb-1 block text-sm font-medium text-stone-600">SharePoint folder URL</label>
          <input
            type="url"
            value={sharePointUrl}
            onChange={(e) => setSharePointUrl(e.target.value)}
            disabled={isRunning}
            placeholder="https://yourtenant.sharepoint.com/sites/Brand/Shared Documents/Assets"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:ring-2 focus:ring-[#6b7f5e] focus:outline-none disabled:bg-stone-50 disabled:text-stone-400"
          />
        </div>

        {/* Business + toggles */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-stone-600">Business entity</label>
            <select
              value={business}
              onChange={(e) => setBusiness(e.target.value as BusinessEntity)}
              disabled={isRunning}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-[#6b7f5e] focus:outline-none disabled:bg-stone-50"
            >
              <option value="both">Both</option>
              <option value="natures">{"Nature's Storehouse"}</option>
              <option value="adk">ADK Fragrance</option>
            </select>
          </div>
          <div className="flex flex-col justify-end gap-3">
            <label className="inline-flex cursor-pointer items-center gap-3">
              <span className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  checked={aiTagging}
                  onChange={(e) => setAiTagging(e.target.checked)}
                  disabled={isRunning}
                  className="peer sr-only"
                />
                <div className="peer h-5 w-9 rounded-full bg-stone-300 peer-checked:bg-[#6b7f5e] peer-focus:ring-2 peer-focus:ring-[#6b7f5e] peer-focus:outline-none after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
              </span>
              <span className="text-sm text-stone-600">AI auto-tagging</span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-3">
              <span className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  disabled={isRunning}
                  className="peer sr-only"
                />
                <div className="peer h-5 w-9 rounded-full bg-stone-300 peer-checked:bg-[#6b7f5e] peer-focus:ring-2 peer-focus:ring-[#6b7f5e] peer-focus:outline-none after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white" />
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
              className="rounded-lg bg-[#4a5a3f] px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3d4b34] disabled:opacity-50"
            >
              {dryRun ? 'Start dry run' : 'Start import'}
            </button>
          ) : (
            <button
              onClick={handleCancel}
              className="rounded-lg bg-stone-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700"
            >
              Cancel
            </button>
          )}
          {isRunning && (
            <span className="flex items-center gap-2 text-sm text-stone-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#6b7f5e]" />
              {currentPhaseLabel ? `${currentPhaseLabel}: ${currentFile}` : statusMessage}
            </span>
          )}
        </div>
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-4">
          <p className="text-sm font-medium text-red-700">Import failed</p>
          <p className="mt-1 text-sm text-red-600">{errorMessage}</p>
        </div>
      )}

      {/* Summary card */}
      {summary && (
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-stone-800">Import complete</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryStat label="Total files" value={summary.total} color="text-stone-800" />
            <SummaryStat label="Uploaded" value={summary.uploaded} color="text-[#4a5a3f]" />
            <SummaryStat label="Duplicates" value={summary.duplicates} color="text-amber-600" />
            <SummaryStat label="Errors" value={summary.errors} color="text-red-600" />
          </div>
        </div>
      )}

      {/* File results */}
      {files.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 px-6 py-4">
            <h2 className="text-base font-semibold text-stone-800">Files ({files.length})</h2>
          </div>
          <ul className="max-h-[500px] divide-y divide-stone-100 overflow-y-auto">
            {files.map((f, i) => (
              <li key={i} className="px-6 py-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-stone-800">{f.name}</span>
                  <FileStatusBadge status={f.status} />
                </div>
                {f.status === 'duplicate' && f.duplicateOf && (
                  <p className="text-xs text-amber-600">Duplicate of: {f.duplicateOf}</p>
                )}
                {f.status === 'error' && f.error && <p className="text-xs text-red-600">{f.error}</p>}
                {f.tags && f.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {f.tags.map((tag) => (
                      <span key={tag} className="rounded bg-[#f0f4ec] px-1.5 py-0.5 text-xs text-[#4a5a3f]">
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
      <div className="mt-1 text-xs text-stone-500">{label}</div>
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
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${className}`}>{label}</span>
}
