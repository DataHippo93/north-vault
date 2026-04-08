'use client'

const BUILD_VERSION = '2026-04-08c'

import { useState, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { BusinessEntity } from '@/types'

interface LargeFileJob {
  name: string
  displayName: string
  downloadUrl: string
  mimeType: string
  size: number
  folderPath: string
  lastModified: string | null
}

interface FileResult {
  name: string
  status: 'uploaded' | 'duplicate' | 'error' | 'dry-run' | 'retrying'
  tags?: string[]
  duplicateOf?: string
  error?: string
}

interface RetryInfo {
  attempt: number
  maxAttempts: number
  count: number
  files: string[]
  permanent?: boolean
}

type ImportPhase = 'idle' | 'running' | 'complete' | 'error'

interface QueueSummary {
  url: string
  label: string
  total: number
  uploaded: number
  duplicates: number
  errors: number
}

export default function ImportClient() {
  const searchParams = useSearchParams()

  // Build a queue from all ?url= and ?folderPath= params
  const initialQueue: string[] = [...searchParams.getAll('url'), ...searchParams.getAll('folderPath')]
  const [sharePointUrl, setSharePointUrl] = useState(initialQueue[0] ?? '')
  const [urlQueue] = useState<string[]>(initialQueue.length > 1 ? initialQueue : [])
  const [queueIndex, setQueueIndex] = useState(0)
  const [queueSummaries, setQueueSummaries] = useState<QueueSummary[]>([])

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
    retried?: number
  } | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [retryInfo, setRetryInfo] = useState<RetryInfo | null>(null)
  const [counts, setCounts] = useState<{ processed: number; total: number }>({ processed: 0, total: 0 })

  const abortRef = useRef<AbortController | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  /** Request a Wake Lock to prevent the browser tab from sleeping during long imports */
  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
      }
    } catch {
      // Wake Lock not supported or denied — import will still work, just might be interrupted
    }
  }

  /** Queue of large files that need client-side download + upload */
  const largeFileQueueRef = useRef<LargeFileJob[]>([])

  /** Process a large file: download from SharePoint → upload to Supabase Storage → register in DB */
  async function processLargeFile(job: LargeFileJob, biz: string) {
    const supabase = createClient()
    const sizeMB = Math.round(job.size / 1024 / 1024)

    setCurrentFile(job.displayName)
    setCurrentPhaseLabel(`downloading locally (${sizeMB} MB)`)

    try {
      // Download from SharePoint (pre-authenticated URL, works from browser)
      const dlRes = await fetch(job.downloadUrl)
      if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`)
      const blob = await dlRes.blob()

      setCurrentPhaseLabel(`uploading to storage (${sizeMB} MB)`)

      // Upload to Supabase Storage
      const ext = job.name.split('.').pop() ?? ''
      const storagePath = `import/${Date.now()}-${Math.random().toString(36).slice(2)}${ext ? `.${ext}` : ''}`

      const { error: storageError } = await supabase.storage.from('northvault-assets').upload(storagePath, blob, {
        contentType: job.mimeType,
        upsert: false,
      })

      if (storageError) throw new Error(`Storage upload failed: ${storageError.message}`)

      setCurrentPhaseLabel('registering asset')

      // Register in DB via lightweight API
      const regRes = await fetch('/api/import/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: job.name,
          storagePath,
          fileSize: job.size,
          mimeType: job.mimeType,
          business: biz,
          folderPath: job.folderPath,
          lastModified: job.lastModified,
        }),
      })

      const result = await regRes.json()

      if (result.status === 'duplicate') {
        processedFilesRef.current.add(job.displayName)
        setFiles((prev) => [...prev, { name: job.displayName, status: 'duplicate', duplicateOf: result.duplicateOf }])
      } else if (result.status === 'uploaded') {
        processedFilesRef.current.add(job.displayName)
        setFiles((prev) => [...prev, { name: job.displayName, status: 'uploaded' }])
      } else {
        setFiles((prev) => [...prev, { name: job.displayName, status: 'error', error: result.error }])
      }
    } catch (err) {
      setFiles((prev) => [...prev, { name: job.displayName, status: 'error', error: (err as Error).message }])
    }
  }

  function releaseWakeLock() {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {})
      wakeLockRef.current = null
    }
  }

  /** Track all file names that completed (uploaded or duplicate) so we can skip them on reconnect */
  const processedFilesRef = useRef<Set<string>>(new Set())
  const reconnectCountRef = useRef(0)
  const MAX_RECONNECTS = 5

  const runImport = useCallback(
    async (
      url: string,
      controller: AbortController,
    ): Promise<
      | { status: 'complete'; total: number; uploaded: number; duplicates: number; errors: number; retried?: number }
      | { status: 'error' }
    > => {
      const res = await fetch('/api/import/sharepoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sharePointUrl: url.trim(),
          business,
          enableAiTagging: aiTagging,
          dryRun,
          skipFiles: Array.from(processedFilesRef.current),
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const data = await res.json()
        setErrorMessage(data.error || `Server error ${res.status}`)
        return { status: 'error' }
      }

      const reader = res.body?.getReader()
      if (!reader) {
        setErrorMessage('No response stream')
        return { status: 'error' }
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let outcome:
        | { status: 'complete'; total: number; uploaded: number; duplicates: number; errors: number }
        | { status: 'error' } = { status: 'error' }

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
                case 'heartbeat':
                  // Keep-alive during large file transfers — update progress display
                  if (data.progress) {
                    setCurrentPhaseLabel(`${data.phase as string} — ${data.progress as string}`)
                  }
                  break
                case 'counts':
                  setCounts({ processed: data.processed as number, total: data.total as number })
                  break
                case 'file': {
                  const fileName = data.name as string
                  const fileStatus = data.status as FileResult['status']
                  // Track completed files for resume
                  if (fileStatus === 'uploaded' || fileStatus === 'duplicate') {
                    processedFilesRef.current.add(fileName)
                  }
                  setFiles((prev) => [
                    ...prev,
                    {
                      name: fileName,
                      status: fileStatus,
                      tags: data.tags as string[] | undefined,
                      duplicateOf: data.duplicateOf as string | undefined,
                      error: data.error as string | undefined,
                    },
                  ])
                  break
                }
                case 'client-upload':
                  // Large file — queue for client-side download + upload after SSE completes
                  largeFileQueueRef.current.push(data as LargeFileJob)
                  setFiles((prev) => [
                    ...prev,
                    {
                      name: data.displayName as string,
                      status: 'retrying' as const,
                      error: `Large file (${Math.round((data.size as number) / 1024 / 1024)} MB) — queued for direct upload`,
                    },
                  ])
                  break
                case 'retry':
                  setRetryInfo(data as RetryInfo)
                  // Mark retrying files in the file list
                  if (!data.permanent) {
                    for (const name of (data as RetryInfo).files) {
                      setFiles((prev) =>
                        prev.map((f) =>
                          f.name.endsWith(name) && f.status === 'error' ? { ...f, status: 'retrying' as const } : f,
                        ),
                      )
                    }
                  }
                  break
                case 'complete': {
                  const s = {
                    status: 'complete' as const,
                    total: data.total as number,
                    uploaded: data.uploaded as number,
                    duplicates: data.duplicates as number,
                    errors: data.errors as number,
                    retried: (data.retried as number) ?? 0,
                  }
                  setSummary(s)
                  return s
                }
                case 'error':
                  setErrorMessage(data.message as string)
                  outcome = { status: 'error' }
                  break
              }
            } catch {
              // skip malformed data
            }
            eventType = ''
          }
        }
      }

      return outcome
    },
    [business, aiTagging, dryRun],
  )

  /** Run import with auto-reconnect on connection drops */
  const runImportWithReconnect = useCallback(
    async (
      url: string,
      controller: AbortController,
    ): Promise<
      | { status: 'complete'; total: number; uploaded: number; duplicates: number; errors: number; retried?: number }
      | { status: 'error' }
    > => {
      while (true) {
        try {
          const result = await runImport(url, controller)

          // If we got a proper 'complete' event, we're done
          if (result.status === 'complete') return result

          // If we got an explicit 'error' event from the server, that's a real error — don't retry
          if (result.status === 'error' && processedFilesRef.current.size === 0) {
            return result // Nothing was processed, likely an auth/config error
          }

          // Stream ended without 'complete' — connection was dropped
          // Fall through to reconnect logic below
        } catch (err) {
          if ((err as Error).name === 'AbortError') throw err // User cancelled
          // Network error — fall through to reconnect
        }

        // Check reconnect limit
        reconnectCountRef.current++
        if (reconnectCountRef.current > MAX_RECONNECTS) {
          setErrorMessage(
            `Connection lost after ${MAX_RECONNECTS} reconnect attempts. ` +
              `${processedFilesRef.current.size} files were processed successfully. ` +
              `Click "Start import" to resume from where it left off.`,
          )
          return { status: 'error' }
        }

        // Auto-reconnect with backoff
        const delaySec = Math.min(reconnectCountRef.current * 2, 10)
        setStatusMessage(
          `Connection lost — reconnecting in ${delaySec}s... ` +
            `(${processedFilesRef.current.size} files already processed)`,
        )
        setCurrentPhaseLabel('reconnecting')
        setErrorMessage('')

        await new Promise((r) => setTimeout(r, delaySec * 1000))

        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')

        setStatusMessage(
          `Reconnecting (attempt ${reconnectCountRef.current}/${MAX_RECONNECTS})... ` +
            `skipping ${processedFilesRef.current.size} already-processed files`,
        )
      }
    },
    [runImport],
  )

  const startImport = useCallback(async () => {
    const targetUrl = urlQueue.length > 0 ? urlQueue[0] : sharePointUrl
    if (!targetUrl.trim()) return

    const queue = urlQueue.length > 0 ? urlQueue : [sharePointUrl]

    // If resuming after an error, keep accumulated files; otherwise reset
    const isResume = phase === 'error' && processedFilesRef.current.size > 0
    if (!isResume) {
      processedFilesRef.current.clear()
      reconnectCountRef.current = 0
      largeFileQueueRef.current = []
      setFiles([])
      setCounts({ processed: 0, total: 0 })
      setQueueSummaries([])
    } else {
      // Reset reconnect counter for fresh attempts
      reconnectCountRef.current = 0
    }

    setPhase('running')
    setSummary(null)
    setErrorMessage('')
    setRetryInfo(null)
    setStatusMessage(isResume ? 'Resuming import...' : 'Connecting...')
    setCurrentFile('')
    setCurrentPhaseLabel('')

    const controller = new AbortController()
    abortRef.current = controller

    await acquireWakeLock()

    try {
      for (let i = 0; i < queue.length; i++) {
        setQueueIndex(i)
        if (queue.length > 1) {
          setStatusMessage(`Folder ${i + 1} of ${queue.length}: connecting...`)
          if (!isResume) {
            setFiles([])
            setSummary(null)
          }
        }

        const result = await runImportWithReconnect(queue[i], controller)

        if (result.status === 'error') {
          setPhase('error')
          return
        }

        // Capture per-folder summary before we reset for next folder
        if (queue.length > 1) {
          const label = queue[i].split('/').filter(Boolean).pop() ?? queue[i]
          setQueueSummaries((s) => [
            ...s,
            {
              url: queue[i],
              label,
              total: result.total,
              uploaded: result.uploaded,
              duplicates: result.duplicates,
              errors: result.errors,
            },
          ])
          // Small pause before next folder
          await new Promise((r) => setTimeout(r, 800))
        }
      }

      // Process any large files that were queued for client-side upload
      const largeFiles = largeFileQueueRef.current.splice(0)
      if (largeFiles.length > 0) {
        setStatusMessage(`Uploading ${largeFiles.length} large file${largeFiles.length > 1 ? 's' : ''} directly...`)
        for (let i = 0; i < largeFiles.length; i++) {
          if (controller.signal.aborted) break
          setStatusMessage(`Large file ${i + 1}/${largeFiles.length}: ${largeFiles[i].name}`)
          await processLargeFile(largeFiles[i], business)
        }
      }

      setPhase('complete')
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatusMessage('Import cancelled')
        setPhase('idle')
      } else {
        setErrorMessage((err as Error).message)
        setPhase('error')
      }
    } finally {
      releaseWakeLock()
    }
  }, [sharePointUrl, urlQueue, phase, aiTagging, dryRun, runImportWithReconnect])

  function handleCancel() {
    abortRef.current?.abort()
  }

  const isRunning = phase === 'running'
  const isQueue = urlQueue.length > 1

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
        <span className="text-xs text-stone-400">v{BUILD_VERSION}</span>
        {isQueue && (
          <span className="rounded-full bg-[#e8f0e0] px-2.5 py-0.5 text-xs font-medium text-[#4a5a3f]">
            {urlQueue.length} folders queued
          </span>
        )}
      </div>

      {/* Queue list */}
      {isQueue && (
        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs font-medium tracking-wide text-stone-400 uppercase">Import queue</p>
          <ol className="space-y-1">
            {urlQueue.map((u, i) => {
              const label = u.split('/').filter(Boolean).pop() ?? u
              const done = queueSummaries.find((s) => s.url === u)
              const isCurrent = isRunning && i === queueIndex
              return (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      done
                        ? 'bg-[#4a5a3f] text-white'
                        : isCurrent
                          ? 'animate-pulse bg-amber-400 text-white'
                          : 'bg-stone-200 text-stone-500'
                    }`}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <span className={`truncate ${isCurrent ? 'font-medium text-stone-800' : 'text-stone-600'}`}>
                    {label}
                  </span>
                  {done && (
                    <span className="ml-auto shrink-0 text-xs text-stone-400">
                      {done.uploaded} uploaded · {done.duplicates} dupes · {done.errors} errors
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {/* Settings card */}
      <div className="space-y-5 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        {/* SharePoint URL — only shown for single-folder mode */}
        {!isQueue && (
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
        )}

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
              disabled={!isQueue && !sharePointUrl.trim()}
              className="rounded-lg bg-[#4a5a3f] px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3d4b34] disabled:opacity-50"
            >
              {dryRun ? 'Start dry run' : phase === 'error' && files.length > 0 ? 'Resume import' : 'Start import'}
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
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-sm text-stone-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#6b7f5e]" />
                {currentPhaseLabel ? `${currentPhaseLabel}: ${currentFile}` : statusMessage}
              </span>
              <span className="text-xs text-stone-400">Keep this tab open until import completes</span>
              {counts.total > 0 && (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200">
                    <div
                      className="h-full rounded-full bg-[#6b7f5e] transition-all duration-300"
                      style={{ width: `${Math.round((counts.processed / counts.total) * 100)}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-xs font-medium text-stone-500">
                    {counts.processed} / {counts.total}
                  </span>
                </div>
              )}
            </div>
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

      {/* Retry banner */}
      {retryInfo && !retryInfo.permanent && phase === 'running' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            <p className="text-sm font-medium text-amber-700">
              Retrying {retryInfo.count} failed file{retryInfo.count !== 1 ? 's' : ''} (attempt {retryInfo.attempt}/
              {retryInfo.maxAttempts})
            </p>
          </div>
          <ul className="mt-2 space-y-0.5">
            {retryInfo.files.map((name) => (
              <li key={name} className="truncate text-xs text-amber-600">
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary card */}
      {summary && (
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-stone-800">Import complete</h2>
          <div className={`grid grid-cols-2 gap-4 ${summary.retried ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
            <SummaryStat label="Total files" value={summary.total} color="text-stone-800" />
            <SummaryStat label="Uploaded" value={summary.uploaded} color="text-[#4a5a3f]" />
            <SummaryStat label="Duplicates" value={summary.duplicates} color="text-amber-600" />
            <SummaryStat label="Errors" value={summary.errors} color="text-red-600" />
            {summary.retried ? <SummaryStat label="Recovered" value={summary.retried} color="text-blue-600" /> : null}
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
    retrying: { label: 'Retrying...', className: 'bg-amber-50 text-amber-600 animate-pulse' },
    'dry-run': { label: 'Dry run', className: 'bg-blue-50 text-blue-700' },
  }
  const { label, className } = map[status]
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${className}`}>{label}</span>
}
