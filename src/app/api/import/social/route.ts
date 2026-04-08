import { createClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { decrypt } from '@/lib/utils/encryption'
import { enumerateCreatives } from '@/lib/social/meta'
import { computeSHA256Server } from '@/lib/utils/serverHash'
import { getContentType } from '@/lib/utils/fileType'
import { analyzeImageWithClaude, generateThumbnail, tusUpload } from '@/lib/import/shared'

export const runtime = 'nodejs'
export const maxDuration = 300

const CONCURRENCY = 4

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
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const {
    connectionId,
    business = 'both',
    enableAiTagging = true,
  } = (await request.json()) as {
    connectionId: string
    business?: string
    enableAiTagging?: boolean
  }

  if (!connectionId) return NextResponse.json({ error: 'Missing connectionId' }, { status: 400 })

  const serviceClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Fetch connection and decrypt token
  const { data: conn } = await serviceClient
    .schema('northvault')
    .from('social_connections')
    .select('*')
    .eq('id', connectionId)
    .single()

  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  let accessToken: string
  try {
    // access_token_encrypted comes as hex string from Supabase bytea
    const encryptedBuf = Buffer.from(conn.access_token_encrypted.replace(/^\\x/, ''), 'hex')
    accessToken = decrypt(encryptedBuf)
  } catch (err) {
    return NextResponse.json({ error: `Token decryption failed: ${(err as Error).message}` }, { status: 500 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const results = { total: 0, uploaded: 0, duplicates: 0, errors: 0 }
      let processed = 0
      let enumerated = 0

      const activePool = new Set<Promise<void>>()

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
        send('status', { message: `Enumerating creatives from ${conn.account_name || conn.platform}...` })

        for await (const creative of enumerateCreatives(conn.account_id, accessToken)) {
          enumerated++
          results.total++
          send('progress', { current: creative.name, phase: 'enumerate' })
          send('counts', { processed, total: enumerated })

          await waitForSlot()

          const task = (async () => {
            const displayName = creative.campaignName ? `${creative.campaignName} / ${creative.name}` : creative.name

            try {
              // Download the media
              send('progress', { current: displayName, phase: 'downloading' })
              const dlRes = await fetch(creative.mediaUrl)
              if (!dlRes.ok) throw new Error(`HTTP ${dlRes.status}`)
              const buffer = Buffer.from(await dlRes.arrayBuffer())

              // Dedup by hash
              const hash = computeSHA256Server(buffer)
              const { data: existing } = await serviceClient
                .schema('northvault')
                .from('assets')
                .select('id, file_name')
                .eq('sha256_hash', hash)
                .maybeSingle()

              if (existing) {
                results.duplicates++
                send('file', { name: displayName, status: 'duplicate', duplicateOf: existing.file_name })

                // Still link the existing asset to this creative
                await serviceClient
                  .schema('northvault')
                  .from('social_creatives')
                  .upsert(
                    {
                      asset_id: existing.id,
                      connection_id: connectionId,
                      platform: creative.platform,
                      platform_creative_id: creative.creativeId,
                      platform_ad_id: creative.adId ?? null,
                      platform_adset_id: creative.adsetId ?? null,
                      platform_campaign_id: creative.campaignId ?? null,
                      platform_campaign_name: creative.campaignName ?? null,
                      creative_url: creative.creativeUrl ?? null,
                      creative_metadata: creative.metadata,
                    },
                    { onConflict: 'platform,platform_creative_id' },
                  )
                return
              }

              // Upload via TUS
              const ext = creative.name.split('.').pop() ?? (creative.mediaType === 'video' ? 'mp4' : 'jpg')
              const storagePath = `import/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

              send('progress', { current: displayName, phase: 'uploading' })
              const { error: tusErr } = await tusUpload(
                'northvault-assets',
                storagePath,
                buffer,
                buffer.length,
                creative.mimeType,
                process.env.SUPABASE_SERVICE_ROLE_KEY!,
              )

              if (tusErr) {
                results.errors++
                send('file', { name: displayName, status: 'error', error: tusErr })
                return
              }

              // Signed URL
              const { data: urlData } = await serviceClient.storage
                .from('northvault-assets')
                .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

              const contentType = getContentType(creative.mimeType, creative.name)
              let tags = ['social-media', creative.platform]
              if (creative.campaignName) {
                tags.push(
                  creative.campaignName
                    .toLowerCase()
                    .replace(/\s+/g, '-')
                    .replace(/[^a-z0-9-]/g, ''),
                )
              }
              let extractedText: string[] = []
              let barcodes: string[] = []
              let thumbnailPath: string | null = null

              // Thumbnail + AI tagging for images
              if (contentType === 'image') {
                thumbnailPath = await generateThumbnail(buffer, storagePath, serviceClient)

                if (enableAiTagging) {
                  send('progress', { current: displayName, phase: 'tagging' })
                  try {
                    const context = creative.campaignName
                      ? `Social media ad creative from ${creative.platform}. Campaign: ${creative.campaignName}`
                      : `Social media ad creative from ${creative.platform}`
                    const result = await analyzeImageWithClaude(buffer, creative.mimeType, creative.name, context)
                    tags = Array.from(new Set([...tags, ...result.tags]))
                    extractedText = result.extractedText
                    barcodes = result.barcodes
                  } catch {
                    // non-fatal
                  }
                }
              }

              const notes = creative.campaignName
                ? `Source: ${creative.platform} › ${creative.campaignName}`
                : `Source: ${creative.platform}`

              // Insert asset
              const { data: asset, error: dbError } = await serviceClient
                .schema('northvault')
                .from('assets')
                .insert({
                  file_name: creative.name,
                  original_filename: creative.name,
                  sha256_hash: hash,
                  file_size: buffer.length,
                  mime_type: creative.mimeType,
                  content_type: contentType,
                  storage_path: storagePath,
                  storage_url: urlData?.signedUrl ?? null,
                  thumbnail_path: thumbnailPath,
                  business,
                  tags,
                  notes,
                  extracted_text: extractedText.length > 0 ? extractedText : null,
                  barcodes: barcodes.length > 0 ? barcodes : null,
                  uploaded_by: user!.id,
                })
                .select('id')
                .single()

              if (dbError || !asset) {
                results.errors++
                send('file', { name: displayName, status: 'error', error: dbError?.message ?? 'Insert failed' })
                return
              }

              // Link asset to creative
              await serviceClient
                .schema('northvault')
                .from('social_creatives')
                .insert({
                  asset_id: asset.id,
                  connection_id: connectionId,
                  platform: creative.platform,
                  platform_creative_id: creative.creativeId,
                  platform_ad_id: creative.adId ?? null,
                  platform_adset_id: creative.adsetId ?? null,
                  platform_campaign_id: creative.campaignId ?? null,
                  platform_campaign_name: creative.campaignName ?? null,
                  creative_url: creative.creativeUrl ?? null,
                  creative_metadata: creative.metadata,
                })

              results.uploaded++
              send('file', { name: displayName, status: 'uploaded', tags })
            } catch (err) {
              results.errors++
              send('file', { name: displayName, status: 'error', error: (err as Error).message })
            }
          })()
            .then(() => {
              processed++
              send('counts', { processed, total: enumerated })
            })
            .finally(() => {
              activePool.delete(task)
            })

          activePool.add(task)
        }

        await drainPool()
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
