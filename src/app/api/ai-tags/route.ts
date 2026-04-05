import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

const AI_ENDPOINT = process.env.AI_ENDPOINT || 'http://localhost:3456'
const AI_MODEL = process.env.AI_MODEL || 'claude-sonnet-4-20250514'

const TAG_SYSTEM_PROMPT = `You are a digital asset management tagging assistant. Given information about a file, suggest 3-8 relevant tags that would help organize it in a brand asset library. Tags should be lowercase, single words or short hyphenated phrases. Focus on:
- Subject matter (e.g. product, logo, team, storefront, nature, food)
- Visual style (e.g. lifestyle, flat-lay, close-up, aerial, minimalist)
- Use case (e.g. social-media, packaging, print, web, banner)
- Season/time (e.g. summer, holiday, 2024)
- Color/mood (e.g. bright, moody, earth-tones)

Respond with ONLY a JSON array of tag strings. No explanation, no markdown. Example: ["product","lifestyle","bright","summer","social-media"]`

export async function POST(request: NextRequest) {
  // Verify authenticated
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { fileName, mimeType, contentType, imageDataUrl } = body as {
    fileName: string
    mimeType: string
    contentType: string
    imageDataUrl?: string  // base64 data URL for images
  }

  if (!fileName) {
    return NextResponse.json({ error: 'fileName is required' }, { status: 400 })
  }

  try {
    // Build the message content based on file type
    let userContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>

    if (contentType === 'image' && imageDataUrl) {
      // For images, use vision - send the image directly
      userContent = [
        {
          type: 'text',
          text: `Analyze this image and suggest tags. File name: "${fileName}", MIME type: ${mimeType}.`,
        },
        {
          type: 'image_url',
          image_url: { url: imageDataUrl },
        },
      ]
    } else {
      // For non-images, tag based on filename and metadata
      userContent = `Suggest tags for this file based on its name and type. File name: "${fileName}", MIME type: ${mimeType}, content category: ${contentType}.`
    }

    const response = await fetch(`${AI_ENDPOINT}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: TAG_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('AI endpoint error:', response.status, errText)
      return NextResponse.json({ error: 'AI service error', tags: [] }, { status: 502 })
    }

    const data = await response.json()
    const raw = data.choices?.[0]?.message?.content?.trim() ?? '[]'

    // Parse the JSON array from the response
    let tags: string[] = []
    try {
      // Handle potential markdown code fences
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      tags = JSON.parse(cleaned)
      if (!Array.isArray(tags)) tags = []
      // Sanitize: lowercase, trim, no empty strings
      tags = tags
        .map((t: unknown) => String(t).trim().toLowerCase())
        .filter((t: string) => t.length > 0 && t.length < 50)
        .slice(0, 10)
    } catch {
      console.error('Failed to parse AI tags:', raw)
      tags = []
    }

    return NextResponse.json({ tags })
  } catch (err) {
    console.error('AI tagging error:', err)
    return NextResponse.json({ error: 'AI service unavailable', tags: [] }, { status: 502 })
  }
}
