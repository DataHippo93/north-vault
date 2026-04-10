import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { fileName, mimeType, contentType, imageDataUrl } = body as {
    fileName: string
    mimeType: string
    contentType: string
    imageDataUrl?: string
    faceGroup?: string
  }

  if (!fileName) {
    return NextResponse.json({ error: 'fileName is required' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ tags: [] })
  }

  const anthropic = new Anthropic({ apiKey })

  try {
    type MessageContent =
      | { type: 'text'; text: string }
      | {
          type: 'image'
          source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string }
        }

    const content: MessageContent[] = []

    if (contentType === 'image' && imageDataUrl) {
      // Strip data URL prefix to get raw base64
      const base64 = imageDataUrl.replace(/^data:[^;]+;base64,/, '')
      let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg'
      if (mimeType.includes('png')) mediaType = 'image/png'
      else if (mimeType.includes('gif')) mediaType = 'image/gif'
      else if (mimeType.includes('webp')) mediaType = 'image/webp'

      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } })
      content.push({
        type: 'text',
        text: `Analyze this image and return a JSON object with:
- "face_group": if this image contains a person, return a short stable grouping label like "adult male", "adult female", "child", or "group"; otherwise null
- "tags": 5-10 lowercase descriptive tags (subject, colors, mood, business context — Nature's Storehouse grocery or ADK Fragrance Farm if identifiable)
- "extracted_text": array of all readable text found in the image (labels, product names, descriptions, ingredients)
- "barcodes": array of any barcode/QR code values visible

Return ONLY valid JSON. Example: {"face_group":"adult female","tags":["soap","green","natural"],"extracted_text":["Healing Woods CBD Soap","4oz"],"barcodes":["012345678901"]}`,
      })
    } else {
      content.push({
        type: 'text',
        text: `Suggest tags for this file. File name: "${fileName}", MIME type: ${mimeType}, content category: ${contentType}.
Return a JSON object: {"face_group":null,"tags":["tag1","tag2"],"extracted_text":[],"barcodes":[]}
Return ONLY valid JSON.`,
      })
    }

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content }],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

    let tags: string[] = []
    let extractedText: string[] = []
    let barcodes: string[] = []
    let faceGroup: string | null = null

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
      faceGroup = typeof parsed.face_group === 'string' && parsed.face_group.trim() ? parsed.face_group.trim().toLowerCase() : null
      extractedText = Array.isArray(parsed.extracted_text) ? parsed.extracted_text.filter(Boolean) : []
      barcodes = Array.isArray(parsed.barcodes) ? parsed.barcodes.filter(Boolean) : []
    } catch {
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

    return NextResponse.json({ tags, extractedText, barcodes, faceGroup })
  } catch (err) {
    console.error('AI tagging error:', err)
    return NextResponse.json({ tags: [] })
  }
}
