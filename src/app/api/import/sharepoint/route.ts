import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import { parseSharePointUrl, enumerateFiles, downloadFile } from '@/lib/graph/sharepoint'
import { computeSHA256Server } from '@/lib/utils/serverHash'
import { getContentType } from '@/lib/utils/fileType'
import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import JSZip from 'jszip'
import * as tus from 'tus-js-client'
import { Readable } from 'stream'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 min max on Vercel Pro

// Zips must be fully buffered for extraction — skip zips above this
const MAX_ZIP_BYTES = 500 * 1024 * 1024
// Images above this skip AI tagging (too large / too slow for vision API)
const MAX_VISION_BYTES = 50 * 1024 * 1024

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function analyzeImageWithClaude(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  folderPath: string,
): Promise<{ tags: string[]; extractedText: string[]; barcodes: string[] }> {
  let imageBuffer = buffer
  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg'

  try {
    const metadata = await sharp(imageBuffer).metadata()
    const maxDim = Math.max(metadata.width ?? 0, metadata.height ?? 0)
    if (maxDim > 4000) {
      imageBuffer = await sharp(imageBuffer)
        .resize({ width: 4000, height: 4000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()
      mediaType = 'image/jpeg'
    } else {
      const mt = mimeType.toLowerCase()
      if (mt.includes('png')) mediaType = 'image/png'
      else if (mt.includes('gif')) mediaType = 'image/gif'
      else if (mt.includes('webp')) mediaType = 'image/webp'
      else mediaType = 'image/jpeg'
    }
  } catch {
    return { tags: [], extractedText: [], barcodes: [] }
  }

  const imageBase64 = imageBuffer.toString('base64')
  const folderContext = folderPath ? `\nSharePoint folder path: ${folderPath}` : ''

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          {
            type: 'text',
            text: `Analyze this image and return a JSON object with these fields:

- "tags": array of 10-20 lowercase descriptive tags covering ALL of the following categories where applicable:
  • SUBJECT: what the product/object/scene is (e.g. "soap", "candle", "essential oil", "tincture")
  • BACKGROUND: background style (e.g. "white background", "lifestyle", "outdoor", "studio", "rustic wood", "natural setting", "flat lay", "on-model")
  • COLORS: dominant colors (e.g. "green", "purple", "earth tones", "neutral")
  • MOOD/AESTHETIC: visual feel (e.g. "minimalist", "cozy", "natural", "artisan", "luxury", "organic")
  • COMPOSITION: shot type (e.g. "close-up", "macro", "overhead", "group shot", "single product", "hero shot")
  • SOCIAL MEDIA USE: inferred use case (e.g. "instagram-ready", "product launch", "story format", "banner", "square crop friendly")
  • BRAND CONTEXT: if identifiable as Nature's Storehouse grocery store or ADK Fragrance Farm, include that; also include "cbd", "hemp", "fragrance", "food", "grocery", etc. as relevant
  • SEASON/OCCASION: if applicable (e.g. "holiday", "summer", "fall", "gift")

- "extracted_text": array of all readable text in the image
- "barcodes": array of any barcode or QR code values visible

File name: "${fileName}"${folderContext}

Return ONLY valid JSON, nothing else.`,
          },
        ],
      },
    ],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
  try {
    const parsed = JSON.parse(responseText.replace(/```json\n?|\n?```/g, '').trim())
    return {
      tags: Array.isArray(parsed.tags)
        ? parsed.tags
            .map((t: string) =>
              t
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, ''),
            )
            .filter(Boolean)
        : [],
      extractedText: Array.isArray(parsed.extracted_text) ? parsed.extracted_text.filter(Boolean) : [],
      barcodes: Array.isArray(parsed.barcodes) ? parsed.barcodes.filter(Boolean) : [],
    }
  } catch {
    return {
      tags: responseText
        .split(',')
        .map((t) =>
          t
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, ''),
        )
        .filter(Boolean),
      extractedText: [],
      barcodes: [],
    }
  }
}

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

/** Generate a 400px JPEG thumbnail and upload it to thumbs/ prefix. Returns the path or null. */
async function generateThumbnail(
  buffer: Buffer,
  storagePath: string,
  serviceClient: Awaited<ReturnType<typeof createServiceClient>>,
): Promise<string | null> {
  try {
    const thumb = await sharp(buffer)
      .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    const thumbPath = `thumbs/${storagePath}.jpg`
    const { error } = await serviceClient.storage
      .from('northvault-assets')
      .upload(thumbPath, thumb, { contentType: 'image/jpeg', upsert: true })
    return error ? null : thumbPath
  } catch {
    return null
  }
}

/** Upload a file to Supabase Storage via TUS resumable protocol.
 *  Works for any file size and automatically resumes on transient failures. */
async function tusUpload(
  bucket: string,
  objectPath: string,
  fileBody: Buffer,
  fileSize: number,
  contentType: string,
  serviceRoleKey: string,
): Promise<{ error: string | null }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  return new Promise((resolve) => {
    const upload = new tus.Upload(Readable.from(fileBody) as unknown as tus.Upload['file'], {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [1000, 3000, 5000, 10000],
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        'x-upsert': 'false',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: objectPath,
        contentType,
        cacheControl: '3600',
      },
      chunkSize: 6 * 1024 * 1024, // 6 MB chunks
      uploadSize: fileSize,
      onError(err) {
        resolve({ error: err.message })
      },
      onSuccess() {
        resolve({ error: null })
      },
    })
    upload.start()
  })
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
  } = body as {
    sharePointUrl: string
    business?: string
    enableAiTagging?: boolean
    dryRun?: boolean
  }

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
       *  For files with a buffer (small/zip entries): hash first, skip if dup, then upload.
       *  For files with only a downloadUrl (large files): stream-upload with inline hashing,
       *  then check for dup and delete if found.
       *  Returns true on success/duplicate, false on error (eligible for retry). */
      async function processFile(f: FileToProcess, isRetry = false): Promise<boolean> {
        if (!isRetry) results.total++
        const displayName = f.folderPath ? `${f.folderPath}/${f.name}` : f.name
        const ext = f.name.split('.').pop() ?? ''
        const tempPath = `import/${Date.now()}-${Math.random().toString(36).slice(2)}${ext ? `.${ext}` : ''}`

        let hash: string
        let storagePath: string

        if (f.buffer) {
          // --- Buffered path (small file / zip entry) ---
          hash = computeSHA256Server(f.buffer)

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

          send('progress', { current: displayName, phase: isRetry ? 'retrying' : 'uploading' })
          const { error: tusErr } = await tusUpload(
            'northvault-assets',
            tempPath,
            f.buffer,
            f.buffer.length,
            f.mimeType,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
          )

          if (tusErr) {
            if (!isRetry) {
              results.errors++
              failedFiles.push({ file: f, error: tusErr })
            }
            send('file', { name: displayName, status: 'error', error: tusErr })
            return false
          }
          storagePath = tempPath
        } else {
          // --- Streaming path (large file, no buffer in memory) ---
          if (!f.downloadUrl) {
            if (!isRetry) results.errors++
            send('file', { name: displayName, status: 'error', error: 'No download URL' })
            return false
          }

          send('progress', { current: displayName, phase: isRetry ? 'retrying' : 'downloading' })

          // Download to buffer so we can hash before uploading + use TUS resumable
          let dlBuffer: Buffer
          try {
            const dlRes = await fetch(f.downloadUrl)
            if (!dlRes.ok) throw new Error(`HTTP ${dlRes.status}`)
            dlBuffer = Buffer.from(await dlRes.arrayBuffer())
          } catch (err) {
            const errMsg = `Download failed: ${(err as Error).message}`
            if (!isRetry) {
              results.errors++
              failedFiles.push({ file: f, error: errMsg })
            }
            send('file', { name: displayName, status: 'error', error: errMsg })
            return false
          }

          hash = computeSHA256Server(dlBuffer)

          // Check for duplicate before uploading
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

          send('progress', { current: displayName, phase: isRetry ? 'retrying' : 'uploading' })
          const { error: tusErr } = await tusUpload(
            'northvault-assets',
            tempPath,
            dlBuffer,
            dlBuffer.length,
            f.mimeType,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
          )

          if (tusErr) {
            if (!isRetry) {
              results.errors++
              failedFiles.push({ file: f, error: tusErr })
            }
            send('file', { name: displayName, status: 'error', error: tusErr })
            return false
          }

          storagePath = tempPath
        }

        const { data: urlData } = await serviceClient.storage
          .from('northvault-assets')
          .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

        const contentType = getContentType(f.mimeType, f.name)
        let tags = pathToTags(f.folderPath)
        let extractedText: string[] = []
        let barcodes: string[] = []
        let thumbnailPath: string | null = null

        if (f.buffer && contentType === 'image') {
          // Generate thumbnail from the buffered image
          thumbnailPath = await generateThumbnail(f.buffer, storagePath, serviceClient)

          // AI vision tagging — only for reasonably-sized images
          if (enableAiTagging && f.buffer.length <= MAX_VISION_BYTES) {
            send('progress', { current: displayName, phase: 'tagging' })
            try {
              const result = await analyzeImageWithClaude(f.buffer, f.mimeType, f.name, f.folderPath)
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
            file_size: f.size,
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
            uploaded_by: user.id,
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

      const CONCURRENCY = 4
      let processed = 0
      let enumerated = 0

      // Concurrent upload pool — files start uploading as soon as enumerated
      const activePool = new Set<Promise<void>>()

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
        while (activePool.size >= CONCURRENCY) {
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
            // Non-zip file: download and queue for concurrent processing
            let buffer: Buffer | null = null
            let downloadUrl: string | undefined

            if (spFile.size > MAX_ZIP_BYTES) {
              // Very large file — pass downloadUrl for TUS streaming
              downloadUrl = spFile.downloadUrl
            } else {
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
            }

            enumerated++
            send('counts', { processed, total: enumerated })
            await waitForSlot()
            enqueue({
              name: spFile.name,
              buffer,
              downloadUrl,
              mimeType: spFile.mimeType,
              size: spFile.size,
              folderPath: spFile.path,
              lastModified: spFile.lastModified,
            })
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
                const buf = await downloadFile(file.downloadUrl)
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

/** Best-effort MIME type from file extension */
function guessMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    psd: 'image/vnd.adobe.photoshop',
    ai: 'application/postscript',
    eps: 'application/postscript',
  }
  return map[ext] ?? 'application/octet-stream'
}
