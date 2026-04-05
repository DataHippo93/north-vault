import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import { parseSharePointUrl, enumerateFiles, downloadFile } from '@/lib/graph/sharepoint'
import { computeSHA256Server } from '@/lib/utils/serverHash'
import { getContentType } from '@/lib/utils/fileType'

const AI_ENDPOINT = process.env.AI_ENDPOINT || 'http://localhost:3456'
const AI_MODEL = process.env.AI_MODEL || 'claude-sonnet-4-20250514'

const TAG_SYSTEM_PROMPT = `You are a digital asset management tagging assistant. Given information about a file, suggest 3-8 relevant tags that would help organize it in a brand asset library. Tags should be lowercase, single words or short hyphenated phrases. Focus on:
- Subject matter (e.g. product, logo, team, storefront, nature, food)
- Visual style (e.g. lifestyle, flat-lay, close-up, aerial, minimalist)
- Use case (e.g. social-media, packaging, print, web, banner)
- Season/time (e.g. summer, holiday, 2024)
- Color/mood (e.g. bright, moody, earth-tones)

Respond with ONLY a JSON array of tag strings. No explanation, no markdown. Example: ["product","lifestyle","bright","summer","social-media"]`

async function requestAiTags(fileName: string, mimeType: string, contentType: string): Promise<string[]> {
  try {
    const response = await fetch(`${AI_ENDPOINT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: TAG_SYSTEM_PROMPT },
          { role: 'user', content: `Suggest tags for this file based on its name and type. File name: "${fileName}", MIME type: ${mimeType}, content category: ${contentType}.` },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    })

    if (!response.ok) return []

    const data = await response.json()
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '[]'
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const tags = JSON.parse(cleaned)
    if (!Array.isArray(tags)) return []
    return tags
      .map((t: unknown) => String(t).trim().toLowerCase())
      .filter((t: string) => t.length > 0 && t.length < 50)
      .slice(0, 10)
  } catch {
    return []
  }
}

export async function POST(request: NextRequest) {
  // Verify authenticated + admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
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
  const { sharePointUrl, business = 'both', enableAiTagging = true, dryRun = false } = body as {
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

            // 6. AI tagging
            const contentType = getContentType(spFile.mimeType, spFile.name)
            let tags: string[] = []
            if (enableAiTagging) {
              send('progress', { total: results.total, current: spFile.name, phase: 'tagging' })
              tags = await requestAiTags(spFile.name, spFile.mimeType, contentType)
            }

            // Add folder-based tags from SharePoint path
            if (spFile.path) {
              const pathTags = spFile.path
                .split('/')
                .filter(Boolean)
                .map(s => s.toLowerCase().replace(/\s+/g, '-'))
                .filter(t => t.length > 1 && t.length < 50)
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
