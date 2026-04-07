import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { assetId } = await request.json()
  if (!assetId) return NextResponse.json({ error: 'Missing assetId' }, { status: 400 })

  const { data: asset } = await supabase
    .schema('northvault')
    .from('assets')
    .select('id, file_name, original_filename, tags, extracted_text, barcodes, content_type, mime_type')
    .eq('id', assetId)
    .single()

  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

  const ext = asset.file_name.includes('.') ? asset.file_name.split('.').pop()! : ''

  const context = [
    `Original filename: ${asset.original_filename}`,
    asset.tags?.length ? `Tags: ${asset.tags.join(', ')}` : null,
    asset.extracted_text?.length ? `Text visible in image: ${asset.extracted_text.slice(0, 10).join(' | ')}` : null,
    asset.barcodes?.length ? `Barcodes: ${asset.barcodes.join(', ')}` : null,
    `File type: ${asset.content_type} (${asset.mime_type})`,
  ]
    .filter(Boolean)
    .join('\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 128,
      messages: [
        {
          role: 'user',
          content: `Based on this asset's metadata, suggest a clear, descriptive filename (without extension). Use lowercase, hyphens for spaces, keep it under 60 characters. Focus on what the file actually is — product name, subject, context. Return ONLY the filename stem, nothing else.\n\n${context}`,
        },
      ],
    })

    const stem = (message.content[0].type === 'text' ? message.content[0].text : '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)

    const newFileName = ext ? `${stem}.${ext}` : stem

    return NextResponse.json({ suggestedName: newFileName })
  } catch (err) {
    console.error('AI rename error:', err)
    return NextResponse.json({ error: 'AI rename failed' }, { status: 500 })
  }
}
