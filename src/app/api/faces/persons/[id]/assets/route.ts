import { createClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const serviceClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Get all faces for this person, joined with asset info
  const { data: faces, error } = await serviceClient
    .schema('northvault')
    .from('faces')
    .select('id, asset_id, box_x, box_y, box_width, box_height, confidence, crop_path')
    .eq('person_id', id)
    .order('confidence', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get unique asset IDs
  const assetIds = [...new Set((faces ?? []).map((f) => f.asset_id))]

  if (assetIds.length === 0) return NextResponse.json({ assets: [], faces: [] })

  // Fetch assets
  const { data: assets } = await serviceClient
    .schema('northvault')
    .from('assets')
    .select('id, file_name, storage_path, thumbnail_path, content_type, tags, business, file_size, created_at')
    .in('id', assetIds)

  // Sign thumbnail URLs
  const assetsWithUrls = await Promise.all(
    (assets ?? []).map(async (a) => {
      let thumbUrl: string | null = null
      if (a.thumbnail_path) {
        const { data } = await serviceClient.storage.from('northvault-assets').createSignedUrl(a.thumbnail_path, 3600)
        thumbUrl = data?.signedUrl ?? null
      }
      return { ...a, thumb_url: thumbUrl }
    }),
  )

  return NextResponse.json({ assets: assetsWithUrls, faces: faces ?? [] })
}
