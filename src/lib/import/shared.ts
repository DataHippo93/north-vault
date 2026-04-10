/**
 * Shared import utilities used by both SharePoint and social media importers.
 * Extracted from the SharePoint import route to avoid duplication.
 */

import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import * as tus from 'tus-js-client'
import { Readable } from 'stream'
import type { SupabaseClient } from '@supabase/supabase-js'

// Images above this skip AI tagging
const MAX_VISION_BYTES = 50 * 1024 * 1024

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/** Analyze an image with Claude Haiku for tags, text extraction, and barcode detection */
export async function analyzeImageWithClaude(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  context: string,
): Promise<{ tags: string[]; extractedText: string[]; barcodes: string[] }> {
  if (buffer.length > MAX_VISION_BYTES) {
    return { tags: [], extractedText: [], barcodes: [] }
  }

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

File name: "${fileName}"
${context}

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

/** Generate a 400px JPEG thumbnail and upload it. Returns the thumb path or null. */
export async function generateThumbnail(
  buffer: Buffer,
  storagePath: string,
  serviceClient: SupabaseClient,
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

/** Upload a file to Supabase Storage via TUS resumable protocol. */
export async function tusUpload(
  bucket: string,
  objectPath: string,
  fileBody: Buffer,
  fileSize: number,
  contentType: string,
  serviceRoleKey: string,
): Promise<{ error: string | null }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  return new Promise((resolve) => {
    const upload = new tus.Upload(Readable.from(fileBody) as unknown as any, {
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
      chunkSize: 6 * 1024 * 1024,
      uploadSize: fileSize,
      onError(err: unknown) {
        resolve({ error: err instanceof Error ? err.message : 'Upload failed' })
      },
      onSuccess() {
        resolve({ error: null })
      },
    })
    upload.start()
  })
}

/** Best-effort MIME type from file extension */
export function guessMimeType(filename: string): string {
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
