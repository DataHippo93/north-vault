import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { computeSHA256FromBuffer } from '@/lib/utils/fileHash'
import { getContentType } from '@/lib/utils/fileType'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'

async function tagImageIfNeeded(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  assetId: string
  storageUrl: string | null
  mimeType: string
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !params.storageUrl) return [] as string[]

  const contentType = getContentType(params.mimeType, params.storageUrl)
  if (contentType !== 'image') return [] as string[]

  const imageResponse = await fetch(params.storageUrl)
  if (!imageResponse.ok) return [] as string[]

  const arrayBuffer = await imageResponse.arrayBuffer()
  const imageBase64 = Buffer.from(arrayBuffer).toString('base64')

  const respType = imageResponse.headers.get('content-type')?.toLowerCase() ?? ''
  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg'
  if (respType.includes('png')) mediaType = 'image/png'
  else if (respType.includes('gif')) mediaType = 'image/gif'
  else if (respType.includes('webp')) mediaType = 'image/webp'

  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: 'Return 5-8 lowercase, comma-separated tags for this image. Return only tags.',
          },
        ],
      },
    ],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
  const tags = responseText.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
  if (!tags.length) return [] as string[]

  const { data: asset } = await params.supabase
    .schema('northvault')
    .from('assets')
    .select('tags')
    .eq('id', params.assetId)
    .single()

  const currentTags = asset?.tags || []
  const combinedTags = Array.from(new Set([...currentTags, ...tags]))

  await params.supabase
    .schema('northvault')
    .from('assets')
    .update({ tags: combinedTags })
    .eq('id', params.assetId)

  return combinedTags
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const jobId = body.jobId
  const items = Array.isArray(body.items) ? body.items : []
  const chunkSize = Math.max(1, Math.min(Number(body.chunkSize) || 25, 100))

  if (!jobId || !items.length) {
    return NextResponse.json({ error: 'jobId and items are required' }, { status: 400 })
  }

  const chunk = items.slice(0, chunkSize)
  const results: Array<Record<string, unknown>> = []
  let processed = 0
  let failed = 0

  for (const item of chunk) {
    try {
      const res = await fetch(item.url)
      if (!res.ok) {
        failed++
        results.push({ name: item.name, status: 'error', error: `download failed: ${res.status}` })
        continue
      }

      const buffer = await res.arrayBuffer()
      const hash = await computeSHA256FromBuffer(buffer)

      const { data: duplicate } = await supabase
        .schema('northvault')
        .from('assets')
        .select('id, file_name')
        .eq('sha256_hash', hash)
        .maybeSingle()

      if (duplicate) {
        processed++
        results.push({ name: item.name, status: 'duplicate', duplicateOf: duplicate })
        continue
      }

      const mimeType = item.mimeType || res.headers.get('content-type') || 'application/octet-stream'
      const contentType = getContentType(mimeType, item.name)
      const ext = item.name.split('.').pop() || ''
      const storagePath = `${user.id}/${Date.now()}-${hash.slice(0, 8)}.${ext}`

      const upload = await supabase.storage.from('northvault-assets').upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      })

      if (upload.error) {
        failed++
        results.push({ name: item.name, status: 'error', error: upload.error.message })
        continue
      }

      const { data: signedUrlData } = await supabase.storage.from('northvault-assets').createSignedUrl(storagePath, 60 * 60 * 24 * 365)

      const insert = await supabase
        .schema('northvault')
        .from('assets')
        .insert({
          file_name: item.name,
          original_filename: item.name,
          sha256_hash: hash,
          file_size: item.size ?? buffer.byteLength,
          mime_type: mimeType,
          content_type: contentType,
          storage_path: storagePath,
          storage_url: signedUrlData?.signedUrl ?? null,
          business: item.business || 'both',
          tags: Array.isArray(item.tags) ? item.tags : [],
          notes: item.folderPath ? `Source: SharePoint > ${item.folderPath.split('/').map((s: string) => s.trim()).filter(Boolean).join(' > ')}` : null,
          uploaded_by: user.id,
          original_created_at: null,
        })
        .select()
        .single()

      if (insert.error || !insert.data) {
        failed++
        results.push({ name: item.name, status: 'error', error: insert.error?.message || 'db insert failed' })
        continue
      }

      if (getContentType(mimeType, item.name) === 'image' && signedUrlData?.signedUrl) {
        await tagImageIfNeeded({
          supabase,
          assetId: insert.data.id,
          storageUrl: signedUrlData.signedUrl,
          mimeType,
        })
      }

      processed++
      results.push({ name: item.name, status: 'done', assetId: insert.data.id })
    } catch (error) {
      failed++
      results.push({ name: item.name, status: 'error', error: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  await supabase
    .schema('northvault')
    .from('import_jobs')
    .update({
      processed_items: body.processedItems ?? processed,
      failed_items: body.failedItems ?? failed,
      last_cursor: body.lastCursor ?? null,
      status: body.done ? 'completed' : 'running',
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)

  return NextResponse.json({ success: true, processed, failed, results, nextCursor: items.length > chunk.length ? chunk.length : null })
}
