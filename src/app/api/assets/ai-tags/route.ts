import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { assetId } = await request.json()

  if (!assetId) {
    return NextResponse.json({ error: 'Missing assetId' }, { status: 400 })
  }

  // Fetch asset from DB
  const { data: asset, error: fetchError } = await supabase
    .schema('northvault')
    .from('assets')
    .select('id, storage_path, content_type, mime_type')
    .eq('id', assetId)
    .single()

  if (fetchError || !asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  // Only support images for now
  if (asset.content_type !== 'image') {
    return NextResponse.json({ error: 'AI tagging is only supported for images at this time.' }, { status: 422 })
  }

  // Get a signed URL for the asset
  const { data: signedData, error: signedError } = await supabase.storage
    .from('northvault-assets')
    .createSignedUrl(asset.storage_path, 300)

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 })
  }

  // Fetch the image and convert to base64
  let imageBase64: string
  let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  try {
    const imageResponse = await fetch(signedData.signedUrl)
    if (!imageResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch image from storage' }, { status: 500 })
    }
    const arrayBuffer = await imageResponse.arrayBuffer()
    let imageBuffer: Buffer = Buffer.from(arrayBuffer)

    // Claude max dimension is 8000px — resize large images to fit within 4000px
    // (4000px is plenty for analysis and avoids Claude limits on high-res DSLR photos)
    const metadata = await sharp(imageBuffer).metadata()
    const maxDim = Math.max(metadata.width ?? 0, metadata.height ?? 0)
    if (maxDim > 4000) {
      imageBuffer = await sharp(imageBuffer)
        .resize({ width: 4000, height: 4000, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()
      mediaType = 'image/jpeg'
    } else {
      // Determine media type — default to jpeg if unrecognized
      const mimeType = asset.mime_type?.toLowerCase() ?? ''
      if (mimeType.includes('png')) mediaType = 'image/png'
      else if (mimeType.includes('gif')) mediaType = 'image/gif'
      else if (mimeType.includes('webp')) mediaType = 'image/webp'
      else mediaType = 'image/jpeg'
    }

    imageBase64 = imageBuffer.toString('base64')
  } catch (err) {
    console.error('Image fetch error:', err)
    return NextResponse.json({ error: 'Failed to process image' }, { status: 500 })
  }

  // Call Claude API
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' }, { status: 500 })
  }

  const anthropic = new Anthropic({ apiKey })

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
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

Return ONLY valid JSON, nothing else. Example: {"tags":["soap","cbd","white background","minimalist","close-up","hero shot","natural","green","instagram-ready","adk fragrance farm"],"extracted_text":["Healing Woods CBD Soap","4oz","$12.99"],"barcodes":[]}`,
            },
          ],
        },
      ],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

    let tags: string[] = []
    let extractedText: string[] = []
    let barcodes: string[] = []

    try {
      const parsed = JSON.parse(responseText.replace(/```json\n?|\n?```/g, '').trim())
      tags = Array.isArray(parsed.tags)
        ? parsed.tags
            .map((t: string) =>
              t
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, ''),
            )
            .filter(Boolean)
        : []
      extractedText = Array.isArray(parsed.extracted_text) ? parsed.extracted_text.filter(Boolean) : []
      barcodes = Array.isArray(parsed.barcodes) ? parsed.barcodes.filter(Boolean) : []
    } catch {
      // Fallback: treat entire response as comma-separated tags
      tags = responseText
        .split(',')
        .map((t) =>
          t
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, ''),
        )
        .filter(Boolean)
    }

    // Store extracted text and barcodes in the asset record
    if (extractedText.length > 0 || barcodes.length > 0) {
      await supabase
        .schema('northvault')
        .from('assets')
        .update({
          ...(extractedText.length > 0 && { extracted_text: extractedText }),
          ...(barcodes.length > 0 && { barcodes }),
        })
        .eq('id', assetId)
    }

    return NextResponse.json({ tags, extractedText, barcodes })
  } catch (err) {
    console.error('Claude API error:', err)
    return NextResponse.json({ error: 'AI analysis failed. Please try again.' }, { status: 500 })
  }
}
