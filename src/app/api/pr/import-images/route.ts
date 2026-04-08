import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import { computeSHA256FromBuffer } from '@/lib/utils/fileHash'
import sharp from 'sharp'
import Anthropic from '@anthropic-ai/sdk'

// Minimum dimensions to skip tiny icons/spacers
const MIN_WIDTH = 300
const MIN_HEIGHT = 200
const MAX_IMAGE_BYTES = 20 * 1024 * 1024 // 20 MB

function resolveUrl(src: string, base: string): string | null {
  try {
    return new URL(src, base).href
  } catch {
    return null
  }
}

function extractImageUrls(html: string, pageUrl: string): string[] {
  const urls = new Set<string>()

  // og:image (highest priority)
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
  if (og) {
    const u = resolveUrl(og[1], pageUrl)
    if (u) urls.add(u)
  }

  // <img src> tags — skip tracking pixels / icons
  const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[1]
    if (src.startsWith('data:')) continue
    if (/\.(gif|svg|ico|webp)(\?|$)/i.test(src)) continue
    if (/logo|icon|avatar|pixel|spacer|badge|sprite|thumb-tiny/i.test(src)) continue
    const u = resolveUrl(src, pageUrl)
    if (u) urls.add(u)
  }

  return Array.from(urls).slice(0, 20)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: prId, url: articleUrl, business } = await request.json()
  if (!articleUrl) return NextResponse.json({ error: 'Missing url' }, { status: 400 })

  // Fetch article HTML
  let html: string
  try {
    const res = await fetch(articleUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NorthVault/1.0)' },
      signal: AbortSignal.timeout(15000),
    })
    html = await res.text()
  } catch {
    return NextResponse.json({ error: 'Could not fetch article page' }, { status: 502 })
  }

  const imageUrls = extractImageUrls(html, articleUrl)
  if (imageUrls.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0 })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  let imported = 0
  let skipped = 0

  for (const imgUrl of imageUrls) {
    try {
      // Fetch image
      const imgRes = await fetch(imgUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NorthVault/1.0)' },
      })
      if (!imgRes.ok) {
        skipped++
        continue
      }

      const contentType = imgRes.headers.get('content-type') ?? ''
      if (!contentType.startsWith('image/')) {
        skipped++
        continue
      }
      if (contentType.includes('svg') || contentType.includes('gif')) {
        skipped++
        continue
      }

      const arrayBuffer = await imgRes.arrayBuffer()
      const buf: Buffer = Buffer.from(arrayBuffer)
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        skipped++
        continue
      }

      // Check dimensions
      const meta = await sharp(buf).metadata()
      if ((meta.width ?? 0) < MIN_WIDTH || (meta.height ?? 0) < MIN_HEIGHT) {
        skipped++
        continue
      }

      // Dedup by hash
      const hash = await computeSHA256FromBuffer(arrayBuffer)
      const { data: existing } = await supabase
        .schema('northvault')
        .from('assets')
        .select('id')
        .eq('sha256_hash', hash)
        .maybeSingle()
      if (existing) {
        skipped++
        continue
      }

      // Derive file name from URL
      const rawName = decodeURIComponent(imgUrl.split('/').pop()?.split('?')[0] ?? 'image.jpg')
      const ext = rawName.includes('.') ? rawName.split('.').pop()! : 'jpg'
      const fileName = `pr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
      const storagePath = `${user.id}/${fileName}`

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('northvault-assets')
        .upload(storagePath, buf, { contentType, upsert: false })
      if (uploadError) {
        skipped++
        continue
      }

      const { data: urlData } = supabase.storage.from('northvault-assets').getPublicUrl(storagePath)

      // Auto-tag with Claude
      let tags: string[] = ['pr', 'media', 'article']
      let extractedText: string[] = []
      let barcodes: string[] = []
      try {
        // Resize for Claude if needed
        let analysisBuffer: Buffer = buf
        const maxDim = Math.max(meta.width ?? 0, meta.height ?? 0)
        if (maxDim > 4000) {
          analysisBuffer = await sharp(buf)
            .resize({ width: 4000, height: 4000, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer()
        }

        const message = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: 'image/jpeg', data: analysisBuffer.toString('base64') },
                },
                {
                  type: 'text',
                  text: `Analyze this image from a press/media article and return JSON with:
- "tags": 10-20 lowercase tags covering subject, background style, colors, mood, composition, social media use, brand context (ADK Fragrance or Nature's Storehouse if visible), season
- "extracted_text": all readable text in the image
- "barcodes": any barcode/QR values

Return ONLY valid JSON. Example: {"tags":["product","natural","white background"],"extracted_text":[],"barcodes":[]}`,
                },
              ],
            },
          ],
        })

        const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
        const parsed = JSON.parse(responseText.replace(/```json\n?|\n?```/g, '').trim())
        if (Array.isArray(parsed.tags)) {
          tags = [
            ...new Set([
              ...tags,
              ...parsed.tags.map((t: string) =>
                t
                  .trim()
                  .toLowerCase()
                  .replace(/[^a-z0-9\s-]/g, ''),
              ),
            ]),
          ].filter(Boolean)
        }
        extractedText = Array.isArray(parsed.extracted_text) ? parsed.extracted_text.filter(Boolean) : []
        barcodes = Array.isArray(parsed.barcodes) ? parsed.barcodes.filter(Boolean) : []
      } catch {
        // AI tagging failed — still import with basic tags
      }

      // Insert asset record
      const mimeType = contentType.split(';')[0]
      await supabase
        .schema('northvault')
        .from('assets')
        .insert({
          file_name: fileName,
          original_filename: rawName,
          sha256_hash: hash,
          file_size: buf.byteLength,
          mime_type: mimeType,
          content_type: 'image',
          storage_path: storagePath,
          storage_url: urlData.publicUrl,
          business: business ?? null,
          tags,
          extracted_text: extractedText.length > 0 ? extractedText : null,
          barcodes: barcodes.length > 0 ? barcodes : null,
          uploaded_by: user.id,
        })

      imported++
    } catch {
      skipped++
    }
  }

  // Mark as imported in pr_media (using file_path field as a flag)
  if (imported > 0 && prId) {
    try {
      const { createClient: createSupabaseClient } = await import('@supabase/supabase-js')
      const lobster = createSupabaseClient(
        process.env.LOBSTER_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.LOBSTER_SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
      await lobster
        .from('pr_media')
        .update({ file_path: `imported:${imported}` })
        .eq('id', prId)
    } catch {
      // Non-critical
    }
  }

  return NextResponse.json({ imported, skipped })
}
