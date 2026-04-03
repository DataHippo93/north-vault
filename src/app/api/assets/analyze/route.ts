import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { assetId, storageUrl, contentType } = await request.json()

  if (!assetId || !storageUrl) {
    return NextResponse.json({ error: 'Missing assetId or storageUrl' }, { status: 400 })
  }

  // Only auto-tag images for now
  if (contentType !== 'image') {
    return NextResponse.json({ tags: [] })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Silently skip auto-tagging if no API key configured
    console.warn('ANTHROPIC_API_KEY not set — skipping auto-tag on upload')
    return NextResponse.json({ success: true, tags: [] })
  }

  try {
    // Fetch the image and convert to base64
    const imageResponse = await fetch(storageUrl)
    if (!imageResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 })
    }
    const arrayBuffer = await imageResponse.arrayBuffer()
    const imageBase64 = Buffer.from(arrayBuffer).toString('base64')

    // Determine media type from response content-type
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
              text: "Analyze this image and return 5-8 relevant tags in lowercase, comma-separated. Tags should describe: content/subject matter, colors, mood, business context (if identifiable as a grocery store or fragrance/beauty product). Return ONLY the comma-separated tags, nothing else.",
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

    // Merge AI tags with any existing tags on the asset
    const { data: asset } = await supabase
      .schema('northvault')
      .from('assets')
      .select('tags')
      .eq('id', assetId)
      .single()

    const currentTags = asset?.tags || []
    const combinedTags = Array.from(new Set([...currentTags, ...tags]))

    await supabase
      .schema('northvault')
      .from('assets')
      .update({ tags: combinedTags })
      .eq('id', assetId)

    return NextResponse.json({ success: true, tags: combinedTags })
  } catch (error) {
    console.error('Auto-tagging error:', error)
    return NextResponse.json({ error: 'Auto-tagging failed' }, { status: 500 })
  }
}
