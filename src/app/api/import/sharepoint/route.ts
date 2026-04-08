import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import { parseSharePointUrl, enumerateFiles, downloadFile } from '@/lib/graph/sharepoint'
import { computeSHA256Server } from '@/lib/utils/serverHash'
import { getContentType } from '@/lib/utils/fileType'
import { analyzeImageWithClaude, generateThumbnail, tusUpload, guessMimeType } from '@/lib/import/shared'
import JSZip from 'jszip'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 min — Vercel Hobby maximum

// Zips must be fully buffered for extraction — skip zips above this
const MAX_ZIP_BYTES = 500 * 1024 * 1024
// Files above this skip SHA-256 dedup (use name+size instead) to avoid holding huge buffers
const LARGE_FILE_BYTES = 100 * 1024 * 1024

/** Convert a SharePoint folder path to slug tags: "Content Marketing/Spring 2024" → ["content-marketing", "spring-2024"] */
function pathToTags(path: string): string[] {
  return path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, ''),
    )
    .filter((t) => t.length > 1 && t.length < 60)
}

/** Convert a SharePoint folder path to a human-readable note */
function pathToNote(path: string): string {
  const segments = path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  return segments.length ? `Source: SharePoint › ${segments.join(' › ')}` : 'Source: SharePoint'
}

interface FileToProcess {
  name: string
  /** Buffer for small files / zip entries. null means stream from downloadUrl instead. */
  buffer: Buffer | null
  downloadUrl?: string
  mimeType: string
  size: number
  folderPath: string
  lastModified: string | null
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const body = await request.json()
  const {
    sharePointUrl,
    business = 'both',
    enableAiTagging = true,
    dryRun = false,
    skipFiles = [],
  } = body as {
    sharePointUrl: string
    business?: string
    enableAiTagging?: boolean
    dryRun?: boolean
    /** File names already processed in a prior connection — skip these on resume */
    skipFiles?: string[]
  }

  const skipSet = new Set(skipFiles)

  if (!sharePointUrl) return NextResponse.json({ error: 'sharePointUrl is required' }, { status: 400 })

  let parsed
  try {
    parsed = parseSharePointUrl(sharePointUrl)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }

  const serviceClient = await createServiceClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const results = { total: 0, uploaded: 0, duplicates: 0, errors: 0, skipped: 0, retried: 0 }
      const failedFiles: { file: FileToProcess; error: string }[] = []

      /** Upload one file to storage and insert the DB record.
       *  Returns true on success/duplicate, false on error (eligible for retry). */
      async function processFile(f: FileToProcess, isRetry = false): Promise<boolean> {
        if (!isRetry) results.total++
        const displayName = f.folderPath ? `${f.folderPath}/${f.name}` : f.name
        const ext = f.name.split('.').pop() ?? ''
        const tempPath = `import/${Date.now()}-${Math.random().toString(36).slice(2)}${ext ? `.${ext}` : ''}`

        let hash: string
        let fileBuffer: Buffer
        const storagePath = tempPath

        // --- Get the file into memory (either already buffered or download) ---
        if (f.buffer) {
          fileBuffer = f.buffer
        } else {
          if (!f.downloadUrl) {
            if (!isRetry) results.errors++
            send('file', { name: displayName, status: 'error', error: 'No download URL' })
            return false
          }

          const sizeMB = Math.round(f.size / 1024 / 1024)
          send('progress', { current: displayName, phase: `downloading${sizeMB > 50 ? ` (${sizeMB} MB)` : ''}` })

          try {
            // Stream download with progress heartbeats to keep SSE alive
            fileBuffer = await downloadFile(f.downloadUrl, (bytesRead, totalBytes) => {
              const pct = totalBytes ? Math.round((bytesRead / totalBytes) * 100) : null
              const dlMB = Math.round(bytesRead / 1024 / 1024)
              send('heartbeat', {
                file: displayName,
                phase: 'downloading',
                progress: pct ? `${dlMB} MB (${pct}%)` : `${dlMB} MB`,
              })
            })
          } catch (err) {
            const errMsg = `Download failed: ${(err as Error).message}`
            if (!isRetry) {
              results.errors++
              failedFiles.push({ file: f, error: errMsg })
            }
            send('file', { name: displayName, status: 'error', error: errMsg })
            return false
          }
        }

        // --- Dedup check ---
        const isLargeFile = fileBuffer.length > LARGE_FILE_BYTES
        if (isLargeFile) {
          // For large files: dedup by original filename + file size (fast, avoids hashing 500MB)
          const { data: existing } = await serviceClient
            .schema('northvault')
            .from('assets')
            .select('id, file_name')
            .eq('original_filename', f.name)
            .eq('file_size', fileBuffer.length)
            .maybeSingle()

          if (existing) {
            if (!isRetry) results.duplicates++
            send('file', { name: displayName, status: 'duplicate', duplicateOf: existing.file_name })
            return true
          }
          // Use a placeholder hash — large files skip SHA-256 for performance
          hash = `size:${fileBuffer.length}:name:${f.name}`
        } else {
          hash = computeSHA256Server(fileBuffer)

          const { data: existing } = await serviceClient
            .schema('northvault')
            .from('assets')
            .select('id, file_name')
            .eq('sha256_hash', hash)
            .maybeSingle()

          if (existing) {
            if (!isRetry) results.duplicates++
            send('file', { name: displayName, status: 'duplicate', duplicateOf: existing.file_name })
            return true
          }
        }

        // --- Upload via TUS ---
        send('progress', { current: displayName, phase: isRetry ? 'retrying' : 'uploading' })

        // Send heartbeats during upload to keep SSE alive for large files
        let uploadHeartbeat: ReturnType<typeof setInterval> | null = null
        if (isLargeFile) {
          uploadHeartbeat = setInterval(() => {
            send('heartbeat', { file: displayName, phase: 'uploading' })
          }, 10_000)
        }

        const { error: tusErr } = await tusUpload(
          'northvault-assets',
          tempPath,
          fileBuffer,
          fileBuffer.length,
          f.mimeType,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
        )

        if (uploadHeartbeat) clearInterval(uploadHeartbeat)

        if (tusErr) {
          if (!isRetry) {
            results.errors++
            failedFiles.push({ file: f, error: tusErr })
          }
          send('file', { name: displayName, status: 'error', error: tusErr })
          return false
        }

        const { data: urlData } = await serviceClient.storage
          .from('northvault-assets')
          .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

        const contentType = getContentType(f.mimeType, f.name)
        let tags = pathToTags(f.folderPath)
        let extractedText: string[] = []
        let barcodes: string[] = []
        let thumbnailPath: string | null = null

        if (contentType === 'image') {
          // Generate thumbnail
          thumbnailPath = await generateThumbnail(fileBuffer, storagePath, serviceClient)

          // AI vision tagging
          if (enableAiTagging) {
            send('progress', { current: displayName, phase: 'tagging' })
            try {
              const folderContext = f.folderPath ? `SharePoint folder path: ${f.folderPath}` : ''
              const result = await analyzeImageWithClaude(fileBuffer, f.mimeType, f.name, folderContext)
              tags = Array.from(new Set([...tags, ...result.tags]))
              extractedText = result.extractedText
              barcodes = result.barcodes
            } catch {
              // non-fatal
            }
          }
        }

        const { error: dbError } = await serviceClient
          .schema('northvault')
          .from('assets')
          .insert({
            file_name: f.name,
            original_filename: f.name,
            sha256_hash: hash,
            file_size: fileBuffer.length,
            mime_type: f.mimeType,
            content_type: contentType,
            storage_path: storagePath,
            storage_url: urlData?.signedUrl ?? null,
            thumbnail_path: thumbnailPath,
            business,
            tags,
            notes: pathToNote(f.folderPath),
            extracted_text: extractedText.length > 0 ? extractedText : null,
            barcodes: barcodes.length > 0 ? barcodes : null,
            uploaded_by: user!.id,
            original_created_at: f.lastModified,
          })

        if (dbError) {
          if (!isRetry) {
            results.errors++
            failedFiles.push({ file: f, error: dbError.message })
          }
          send('file', { name: displayName, status: 'error', error: dbError.message })
          return false
        }

        results.uploaded++
        if (isRetry) {
          results.retried++
          results.errors-- // was counted as error on first pass
        }
        send('file', { name: displayName, status: 'uploaded', tags })
        return true
      }

      const DEFAULT_CONCURRENCY = 4
      const LARGE_FILE_CONCURRENCY = 1 // process large files one at a time to limit memory
      let processed = 0
      let enumerated = 0

      // Concurrent upload pool — files start uploading as soon as enumerated
      const activePool = new Set<Promise<void>>()
      let currentConcurrency = DEFAULT_CONCURRENCY

      function enqueue(item: FileToProcess) {
        const task = processFile(item)
          .then(() => {
            processed++
            send('counts', { processed, total: enumerated })
          })
          .finally(() => {
            activePool.delete(task)
          })
        activePool.add(task)
      }

      async function waitForSlot() {
        while (activePool.size >= currentConcurrency) {
          await Promise.race(activePool)
        }
      }

      async function drainPool() {
        while (activePool.size > 0) {
          await Promise.race(activePool)
        }
      }

      try {
        send('status', { message: 'Enumerating SharePoint files...' })

        for await (const spFile of enumerateFiles(
          parsed.hostname,
          parsed.sitePath,
          parsed.folderPath,
          process.env.SHAREPOINT_ADK_DRIVE_ID,
        )) {
          send('progress', { current: spFile.name, phase: 'enumerate' })

          // Skip files already processed in a prior connection (resume support)
          const spDisplayName = spFile.path ? `${spFile.path}/${spFile.name}` : spFile.name
          if (skipSet.has(spDisplayName) || skipSet.has(spFile.name)) {
            enumerated++
            processed++
            results.total++
            results.duplicates++
            send('file', { name: spDisplayName, status: 'duplicate', duplicateOf: '(already processed)' })
            send('counts', { processed, total: enumerated })
            continue
          }

          if (dryRun) {
            results.total++
            enumerated++
            send('file', {
              name: spFile.path ? `${spFile.path}/${spFile.name}` : spFile.name,
              status: 'dry-run',
            })
            send('counts', { processed: ++processed, total: enumerated })
            continue
          }

          const isZip =
            spFile.name.toLowerCase().endsWith('.zip') ||
            spFile.mimeType === 'application/zip' ||
            spFile.mimeType === 'application/x-zip-compressed'

          if (isZip) {
            // Zips need sequential handling: download, extract, then process entries concurrently
            let buffer: Buffer
            try {
              send('progress', { current: spFile.name, phase: 'downloading' })
              buffer = await downloadFile(spFile.downloadUrl)
            } catch (err) {
              results.errors++
              results.total++
              enumerated++
              const errMsg = (err as Error).message
              send('file', { name: spFile.name, status: 'error', error: errMsg })
              failedFiles.push({
                file: {
                  name: spFile.name,
                  buffer: null,
                  downloadUrl: spFile.downloadUrl,
                  mimeType: spFile.mimeType,
                  size: spFile.size,
                  folderPath: spFile.path,
                  lastModified: spFile.lastModified,
                },
                error: errMsg,
              })
              continue
            }

            send('status', { message: `Extracting ${spFile.name}...` })
            let zip: JSZip
            try {
              zip = await JSZip.loadAsync(buffer)
            } catch (err) {
              results.errors++
              results.total++
              enumerated++
              send('file', {
                name: spFile.name,
                status: 'error',
                error: `Failed to extract zip: ${(err as Error).message}`,
              })
              continue
            }

            const zipBase = spFile.name.replace(/\.zip$/i, '')
            const zipFolderPath = [spFile.path, zipBase].filter(Boolean).join('/')
            const zipItems: FileToProcess[] = []

            for (const [entryRelPath, entry] of Object.entries(zip.files)) {
              if (entry.dir) continue
              const entryName = entryRelPath.split('/').pop() ?? entryRelPath
              if (entryName.startsWith('.') || entryRelPath.includes('__MACOSX')) continue

              const entryDir = entryRelPath.includes('/') ? entryRelPath.slice(0, entryRelPath.lastIndexOf('/')) : ''
              const entryFolderPath = [zipFolderPath, entryDir].filter(Boolean).join('/')

              let entryBuffer: Buffer
              try {
                entryBuffer = await entry.async('nodebuffer')
              } catch {
                results.errors++
                results.total++
                enumerated++
                send('file', { name: `${zipFolderPath}/${entryRelPath}`, status: 'error', error: 'Extraction failed' })
                continue
              }

              if (entryBuffer.byteLength > MAX_ZIP_BYTES) {
                results.skipped++
                results.total++
                enumerated++
                send('file', {
                  name: `${zipFolderPath}/${entryRelPath}`,
                  status: 'error',
                  error: `Skipped: entry too large (${Math.round(entryBuffer.byteLength / 1024 / 1024)} MB)`,
                })
                continue
              }

              enumerated++
              zipItems.push({
                name: entryName,
                buffer: entryBuffer,
                mimeType: guessMimeType(entryName),
                size: entryBuffer.byteLength,
                folderPath: entryFolderPath,
                lastModified: null,
              })
            }

            send('counts', { processed, total: enumerated })
            for (const item of zipItems) {
              await waitForSlot()
              enqueue(item)
            }
          } else {
            // Non-zip file: download with progress heartbeats, then queue for upload
            const isLarge = spFile.size > LARGE_FILE_BYTES

            // Lower concurrency when hitting large files so we don't OOM
            if (isLarge) {
              currentConcurrency = LARGE_FILE_CONCURRENCY
              // Drain existing pool before starting the large download
              await drainPool()
            }

            let buffer: Buffer
            try {
              const sizeMB = Math.round(spFile.size / 1024 / 1024)
              send('progress', {
                current: spFile.name,
                phase: `downloading${sizeMB > 50 ? ` (${sizeMB} MB)` : ''}`,
              })
              buffer = await downloadFile(spFile.downloadUrl, (bytesRead, totalBytes) => {
                const pct = totalBytes ? Math.round((bytesRead / totalBytes) * 100) : null
                const dlMB = Math.round(bytesRead / 1024 / 1024)
                send('heartbeat', {
                  file: spFile.name,
                  phase: 'downloading',
                  progress: pct ? `${dlMB} MB (${pct}%)` : `${dlMB} MB`,
                })
              })
            } catch (err) {
              results.errors++
              results.total++
              enumerated++
              const errMsg = (err as Error).message
              send('file', { name: spFile.name, status: 'error', error: errMsg })
              failedFiles.push({
                file: {
                  name: spFile.name,
                  buffer: null,
                  downloadUrl: spFile.downloadUrl,
                  mimeType: spFile.mimeType,
                  size: spFile.size,
                  folderPath: spFile.path,
                  lastModified: spFile.lastModified,
                },
                error: errMsg,
              })
              if (isLarge) currentConcurrency = DEFAULT_CONCURRENCY
              continue
            }

            enumerated++
            send('counts', { processed, total: enumerated })
            await waitForSlot()
            enqueue({
              name: spFile.name,
              buffer,
              downloadUrl: undefined,
              mimeType: spFile.mimeType,
              size: spFile.size,
              folderPath: spFile.path,
              lastModified: spFile.lastModified,
            })

            // Restore concurrency after large file is enqueued
            if (isLarge) currentConcurrency = DEFAULT_CONCURRENCY
          }
        }

        // Wait for all in-flight uploads to finish
        await drainPool()

        // --- Retry failed files (up to 2 attempts with backoff) ---
        const MAX_RETRIES = 2
        let retryQueue = [...failedFiles]

        for (let attempt = 1; attempt <= MAX_RETRIES && retryQueue.length > 0; attempt++) {
          const delayMs = attempt * 3000 // 3s, 6s
          send('retry', {
            attempt,
            maxAttempts: MAX_RETRIES,
            count: retryQueue.length,
            files: retryQueue.map((r) => r.file.name),
            delayMs,
          })

          // Wait before retrying
          await new Promise((r) => setTimeout(r, delayMs))

          const stillFailing: typeof retryQueue = []

          for (const { file } of retryQueue) {
            const displayName = file.folderPath ? `${file.folderPath}/${file.name}` : file.name
            send('progress', { current: displayName, phase: `retry ${attempt}/${MAX_RETRIES}` })

            // For files that failed during download (buffer is null, have downloadUrl),
            // re-download first
            let fileToProcess = file
            if (!file.buffer && file.downloadUrl) {
              try {
                const buf = await downloadFile(file.downloadUrl, (bytesRead, totalBytes) => {
                  const pct = totalBytes ? Math.round((bytesRead / totalBytes) * 100) : null
                  const dlMB = Math.round(bytesRead / 1024 / 1024)
                  send('heartbeat', {
                    file: displayName,
                    phase: 'retry downloading',
                    progress: pct ? `${dlMB} MB (${pct}%)` : `${dlMB} MB`,
                  })
                })
                fileToProcess = { ...file, buffer: buf }
              } catch (err) {
                send('file', {
                  name: displayName,
                  status: 'error',
                  error: `Retry download failed: ${(err as Error).message}`,
                })
                stillFailing.push({ file, error: (err as Error).message })
                continue
              }
            }

            const success = await processFile(fileToProcess, true)
            if (!success) {
              stillFailing.push({ file, error: 'Retry failed' })
            }
          }

          retryQueue = stillFailing
        }

        // Report permanently failed files
        if (retryQueue.length > 0) {
          send('retry', {
            attempt: MAX_RETRIES,
            maxAttempts: MAX_RETRIES,
            count: retryQueue.length,
            files: retryQueue.map((r) => r.file.name),
            permanent: true,
          })
        }

        send('complete', results)
      } catch (err) {
        send('error', { message: (err as Error).message })
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
