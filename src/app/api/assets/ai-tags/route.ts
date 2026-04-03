import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

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
    return NextResponse.json(
      { error: 'AI tagging is only supported for images at this time.' },
      { status: 422 }
    )
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
    imageBase64 = Buffer.from(arrayBuffer).toString('base64')

    // Determine media type — default to jpeg if unrecognized
    const mimeType = asset.mime_type?.toLowerCase() ?? ''
    if (mimeType.includes('png')) mediaType = 'image/png'
    else if (mimeType.includes('gif')) mediaType = 'image/gif'
    else if (mimeType.includes('webp')) mediaType = 'image/webp'
    else mediaType = 'image/jpeg'
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
              text: 'Analyze this image and return 5-8 relevant tags in lowercase, comma-separated. Tags should describe: content/subject matter, colors, mood, business context (if identifiable as nature\'s storehouse grocery store or ADK fragrance farm). Return ONLY the comma-separated tags, nothing else.',
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

    return NextResponse.json({ tags })
  } catch (err) {
    console.error('Claude API error:', err)
    return NextResponse.json({ error: 'AI analysis failed. Please try again.' }, { status: 500 })
  }
}
