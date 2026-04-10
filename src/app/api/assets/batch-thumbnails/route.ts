import { createClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { assetIds } = (await request.json()) as { assetIds: string[] }
  if (!assetIds?.length) return NextResponse.json({ error: 'Missing assetIds' }, { status: 400 })

  const serviceClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Fetch thumbnail_path and storage_path for all requested assets
  const { data: assets } = await serviceClient
    .schema('northvault')
    .from('assets')
    .select('id, thumbnail_path, storage_path, content_type')
    .in('id', assetIds)

  if (!assets) return NextResponse.json({ urls: {} })

  const urls: Record<string, string | null> = {}

  // Batch sign all thumbnail URLs
  const toSign: { id: string; path: string }[] = []
  for (const asset of assets) {
    if (asset.thumbnail_path) {
      toSign.push({ id: asset.id, path: asset.thumbnail_path })
    } else if (asset.content_type === 'image' && asset.storage_path) {
      // For images without thumbnails, use Supabase image transform for on-the-fly resize
      toSign.push({ id: asset.id, path: asset.storage_path })
    }
  }

  // Sign URLs in parallel (batches of 50)
  for (let i = 0; i < toSign.length; i += 50) {
    const batch = toSign.slice(i, i + 50)
    const results = await Promise.all(
      batch.map(async ({ id, path }) => {
        const asset = assets.find((a) => a.id === id)
        const isThumb = asset?.thumbnail_path === path

        if (isThumb) {
          const { data } = await serviceClient.storage.from('northvault-assets').createSignedUrl(path, 3600)
          return { id, url: data?.signedUrl ?? null }
        } else {
          // Use Supabase transform for on-the-fly thumbnail
          const { data } = await serviceClient.storage.from('northvault-assets').createSignedUrl(path, 3600, {
            transform: { width: 400, height: 400, resize: 'contain' },
          })
          return { id, url: data?.signedUrl ?? null }
        }
      }),
    )
    for (const { id, url } of results) {
      urls[id] = url
    }
  }

  return NextResponse.json({ urls })
}
