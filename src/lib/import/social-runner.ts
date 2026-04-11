import { createClient as createRawClient, type SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/utils/encryption'
import { enumerateCreatives } from '@/lib/social/meta'
import { computeSHA256Server } from '@/lib/utils/serverHash'
import { getContentType } from '@/lib/utils/fileType'
import { analyzeImageWithClaude, generateThumbnail, tusUpload } from '@/lib/import/shared'

export interface SocialImportResult {
  total: number
  uploaded: number
  duplicates: number
  errors: number
}

export interface SocialImportRunItem {
  name: string
  status: 'uploaded' | 'duplicate' | 'error'
  duplicateOf?: string
  error?: string
  tags?: string[]
}

export async function runSocialImport(params: {
  connectionId: string
  business: string
  enableAiTagging: boolean
  serviceClient?: SupabaseClient
  onStatus?: (message: string) => void
  onProgress?: (data: { current: string; phase: string }) => void
  onCounts?: (data: { processed: number; total: number }) => void
  onFile?: (data: SocialImportRunItem) => void
}): Promise<SocialImportResult> {
  const serviceClient =
    params.serviceClient ??
    createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: conn } = await serviceClient
    .schema('northvault')
    .from('social_connections')
    .select('*')
    .eq('id', params.connectionId)
    .single()

  if (!conn) throw new Error('Connection not found')

  let accessToken: string
  try {
    const raw = conn.access_token_encrypted
    const hexStr = typeof raw === 'string' ? raw.replace(/^\\x/, '') : Buffer.from(raw).toString('hex')
    const encryptedBuf = Buffer.from(hexStr, 'hex')
    accessToken = decrypt(encryptedBuf)
  } catch (err) {
    throw new Error(`Token decryption failed: ${(err as Error).message}`)
  }

  params.onStatus?.(`Enumerating creatives from ${conn.account_name || conn.platform}...`)

  const results: SocialImportResult = { total: 0, uploaded: 0, duplicates: 0, errors: 0 }
  let processed = 0
  let enumerated = 0

  for await (const creative of enumerateCreatives(conn.account_id, accessToken)) {
    enumerated++
    results.total++
    params.onProgress?.({ current: creative.name, phase: 'enumerate' })
    params.onCounts?.({ processed, total: enumerated })

    const displayName = creative.campaignName ? `${creative.campaignName} / ${creative.name}` : creative.name

    try {
      params.onProgress?.({ current: displayName, phase: 'downloading' })
      const dlRes = await fetch(creative.mediaUrl)
      if (!dlRes.ok) throw new Error(`HTTP ${dlRes.status}`)
      const buffer = Buffer.from(await dlRes.arrayBuffer())

      const hash = computeSHA256Server(buffer)
      const { data: existing } = await serviceClient
        .schema('northvault')
        .from('assets')
        .select('id, file_name')
        .eq('sha256_hash', hash)
        .maybeSingle()

      if (existing) {
        results.duplicates++
        params.onFile?.({ name: displayName, status: 'duplicate', duplicateOf: existing.file_name })
        await serviceClient
          .schema('northvault')
          .from('social_creatives')
          .upsert(
            {
              asset_id: existing.id,
              connection_id: params.connectionId,
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
        continue
      }

      const ext = creative.name.split('.').pop() ?? (creative.mediaType === 'video' ? 'mp4' : 'jpg')
      const storagePath = `social/import/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

      params.onProgress?.({ current: displayName, phase: 'uploading' })
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
        params.onFile?.({ name: displayName, status: 'error', error: tusErr })
        continue
      }

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

      if (contentType === 'image') {
        thumbnailPath = await generateThumbnail(buffer, storagePath, serviceClient)
        if (params.enableAiTagging) {
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
          business: params.business,
          tags,
          notes,
          extracted_text: extractedText.length > 0 ? extractedText : null,
          barcodes: barcodes.length > 0 ? barcodes : null,
          uploaded_by: conn.created_by ?? null,
        })
        .select('id')
        .single()

      if (dbError || !asset) {
        results.errors++
        params.onFile?.({ name: displayName, status: 'error', error: dbError?.message ?? 'Insert failed' })
        continue
      }

      await serviceClient
        .schema('northvault')
        .from('social_creatives')
        .insert({
          asset_id: asset.id,
          connection_id: params.connectionId,
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
      params.onFile?.({ name: displayName, status: 'uploaded', tags })
    } catch (err) {
      results.errors++
      params.onFile?.({ name: displayName, status: 'error', error: (err as Error).message })
    }

    processed++
    params.onCounts?.({ processed, total: enumerated })
  }

  return results
}
