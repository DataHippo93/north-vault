import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import { parseSharePointUrl, enumerateFiles, downloadFile } from '@/lib/graph/sharepoint'
import { computeSHA256Server } from '@/lib/utils/serverHash'
import { getContentType } from '@/lib/utils/fileType'
import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function analyzeImageWithClaude(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  folderPath: string,
): Promise<{ tags: string[]; extractedText: string[]; barcodes: string[] }> {
  // Resize if needed — Claude max is 8000px, we target 4000px for speed
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
    // Not a valid image — skip vision analysis
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
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
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

- "extracted_text": array of all readable text in the image (product names, labels, ingredients, signs, prices — exact text as written)
- "barcodes": array of any barcode or QR code values visible

File name: "${fileName}"${folderContext}

Return ONLY valid JSON, nothing else. Example: {"tags":["soap","cbd","white background","minimalist","close-up","hero shot","natural","green","instagram-ready","adk fragrance farm"],"extracted_text":["Healing Woods CBD Soap","4oz","$12.99"],"barcodes":[]}`,
          },
        ],
      },
    ],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

  try {
    const parsed = JSON.parse(responseText.replace(/```json\n?|\n?```/g, '').trim())
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
          .map((t: string) =>
            t
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, ''),
          )
          .filter(Boolean)
      : []
    const extractedText = Array.isArray(parsed.extracted_text) ? parsed.extracted_text.filter(Boolean) : []
    const barcodes = Array.isArray(parsed.barcodes) ? parsed.barcodes.filter(Boolean) : []
    return { tags, extractedText, barcodes }
  } catch {
    // Fallback: treat as comma-separated tags
    const tags = responseText
      .split(',')
      .map((t) =>
        t
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, ''),
      )
      .filter(Boolean)
    return { tags, extractedText: [], barcodes: [] }
  }
}

export async function POST(request: NextRequest) {
  // Verify authenticated + admin
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check admin role
  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

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

  if (!sharePointUrl) {
    return NextResponse.json({ error: 'sharePointUrl is required' }, { status: 400 })
  }

  // Parse the SharePoint URL
  let parsed
  try {
    parsed = parseSharePointUrl(sharePointUrl)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }

  // Use service client for storage operations
  const serviceClient = await createServiceClient()

  // Stream results using SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const results = {
        total: 0,
        uploaded: 0,
        duplicates: 0,
        errors: 0,
        skipped: 0,
        files: [] as Array<{ name: string; status: string; tags?: string[]; error?: string }>,
      }

      try {
        send('status', { message: 'Enumerating SharePoint files...' })

        for await (const spFile of enumerateFiles(parsed.hostname, parsed.sitePath, parsed.folderPath)) {
          results.total++
          send('progress', { total: results.total, current: spFile.name, phase: 'enumerate' })

          if (dryRun) {
            results.files.push({ name: spFile.name, status: 'dry-run' })
            continue
          }

          try {
            // 1. Download file
            send('progress', { total: results.total, current: spFile.name, phase: 'downloading' })
            const buffer = await downloadFile(spFile.downloadUrl)

            // 2. Compute hash
            const hash = computeSHA256Server(buffer)

            // 3. Check for duplicate
            const { data: existing } = await serviceClient
              .schema('northvault')
              .from('assets')
              .select('id, file_name')
              .eq('sha256_hash', hash)
              .maybeSingle()

            if (existing) {
              results.duplicates++
              results.files.push({ name: spFile.name, status: 'duplicate' })
              send('file', { name: spFile.name, status: 'duplicate', duplicateOf: existing.file_name })
              continue
            }

            // 4. Upload to Supabase Storage
            send('progress', { total: results.total, current: spFile.name, phase: 'uploading' })
            const ext = spFile.name.split('.').pop() || ''
            const storagePath = `import/${Date.now()}-${hash.slice(0, 8)}.${ext}`

            const { error: storageError } = await serviceClient.storage
              .from('northvault-assets')
              .upload(storagePath, buffer, {
                contentType: spFile.mimeType,
                upsert: false,
              })

            if (storageError) {
              results.errors++
              results.files.push({ name: spFile.name, status: 'error', error: storageError.message })
              send('file', { name: spFile.name, status: 'error', error: storageError.message })
              continue
            }

            // 5. Get signed URL
            const { data: urlData } = await serviceClient.storage
              .from('northvault-assets')
              .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

            // 6. AI tagging (vision-based for images)
            const contentType = getContentType(spFile.mimeType, spFile.name)
            let tags: string[] = []
            let extractedText: string[] = []
            let barcodes: string[] = []

            if (enableAiTagging && contentType === 'image') {
              send('progress', { total: results.total, current: spFile.name, phase: 'tagging' })
              try {
                const result = await analyzeImageWithClaude(buffer, spFile.mimeType, spFile.name, spFile.path)
                tags = result.tags
                extractedText = result.extractedText
                barcodes = result.barcodes
              } catch {
                // AI tagging failure is non-fatal
              }
            }

            // Add folder-based tags from SharePoint path
            if (spFile.path) {
              const pathTags = spFile.path
                .split('/')
                .filter(Boolean)
                .map((s) => s.toLowerCase().replace(/\s+/g, '-'))
                .filter((t) => t.length > 1 && t.length < 50)
              for (const pt of pathTags) {
                if (!tags.includes(pt)) tags.push(pt)
              }
            }

            // 7. Insert asset record
            const { error: dbError } = await serviceClient
              .schema('northvault')
              .from('assets')
              .insert({
                file_name: spFile.name,
                original_filename: spFile.name,
                sha256_hash: hash,
                file_size: spFile.size,
                mime_type: spFile.mimeType,
                content_type: contentType,
                storage_path: storagePath,
                storage_url: urlData?.signedUrl ?? null,
                business,
                tags,
                extracted_text: extractedText.length > 0 ? extractedText : null,
                barcodes: barcodes.length > 0 ? barcodes : null,
                uploaded_by: user.id,
                original_created_at: spFile.lastModified,
              })

            if (dbError) {
              results.errors++
              results.files.push({ name: spFile.name, status: 'error', error: dbError.message })
              send('file', { name: spFile.name, status: 'error', error: dbError.message })
              continue
            }

            results.uploaded++
            results.files.push({ name: spFile.name, status: 'uploaded', tags })
            send('file', { name: spFile.name, status: 'uploaded', tags })
          } catch (fileErr) {
            results.errors++
            const msg = (fileErr as Error).message
            results.files.push({ name: spFile.name, status: 'error', error: msg })
            send('file', { name: spFile.name, status: 'error', error: msg })
          }
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
