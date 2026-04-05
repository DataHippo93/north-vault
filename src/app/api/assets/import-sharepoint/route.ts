import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import { computeSHA256FromBuffer } from '@/lib/utils/fileHash'
import { getContentType } from '@/lib/utils/fileType'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'

interface SharePointItem {
  name: string
  url: string
  size?: number
  mimeType?: string
  business?: 'natures' | 'adk' | 'both'
  tags?: string[]
}

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
            text: "Analyze this image and return 5-8 relevant tags in lowercase, comma-separated. Tags should describe: content/subject matter, colors, mood, business context. Return ONLY the comma-separated tags, nothing else.",
          },
        ],
      },
    ],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
  const tags = responseText
    .split(',')
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, ''))
    .filter(Boolean)

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

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const folderUrl = body.folderUrl || body.sharePointFolderUrl
  const items: SharePointItem[] = body.items || []
  const business = body.business || 'both'
  const tags = Array.isArray(body.tags) ? body.tags.map((t: string) => String(t).toLowerCase()).filter(Boolean) : []
  const autoTag = body.autoTag !== false

  if ((!folderUrl && !items.length) || (folderUrl && typeof folderUrl !== 'string')) {
    return NextResponse.json({ error: 'Provide folderUrl or items' }, { status: 400 })
  }

  // Demo mode: if a folder URL is provided but no item list, we report what a client-side resolver should do.
  if (folderUrl && !items.length) {
    return NextResponse.json({
      error: 'SharePoint folder enumeration requires items or a resolver integration.',
      hint: 'Pass a pre-enumerated items array from SharePoint or connect a Graph enumerator.',
      folderUrl,
    }, { status: 501 })
  }

  const results: Array<Record<string, unknown>> = []

  for (const item of items) {
    try {
      const res = await fetch(item.url)
      if (!res.ok) {
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
        results.push({ name: item.name, status: 'duplicate', duplicateOf: duplicate })
        continue
      }

      const mimeType = item.mimeType || res.headers.get('content-type') || 'application/octet-stream'
      const contentType = getContentType(mimeType, item.name)
      const ext = item.name.split('.').pop() || ''
      const storagePath = `${user.id}/${Date.now()}-${hash.slice(0, 8)}.${ext}`

      const upload = await supabase.storage
        .from('northvault-assets')
        .upload(storagePath, buffer, {
          contentType: mimeType,
          upsert: false,
        })

      if (upload.error) {
        results.push({ name: item.name, status: 'error', error: upload.error.message })
        continue
      }

      const { data: signedUrlData } = await supabase.storage
        .from('northvault-assets')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

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
          business: item.business || business,
          tags: Array.from(new Set([...tags, ...(item.tags || [])])),
          uploaded_by: user.id,
          original_created_at: null,
        })
        .select()
        .single()

      if (insert.error || !insert.data) {
        results.push({ name: item.name, status: 'error', error: insert.error?.message || 'db insert failed' })
        continue
      }

      let aiTags: string[] = []
      if (autoTag) {
        try {
          aiTags = await tagImageIfNeeded({
            supabase,
            assetId: insert.data.id,
            storageUrl: signedUrlData?.signedUrl ?? null,
            mimeType,
          })
        } catch (err) {
          console.error('AI tagging failed:', err)
        }
      }

      results.push({
        name: item.name,
        status: 'done',
        assetId: insert.data.id,
        duplicate: false,
        aiTags,
      })
    } catch (error) {
      results.push({ name: item.name, status: 'error', error: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  return NextResponse.json({ success: true, results })
}
