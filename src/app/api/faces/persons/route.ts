import { createClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Get all persons with their representative face crop path
  const { data: persons, error } = await serviceClient
    .schema('northvault')
    .from('persons')
    .select('id, name, representative_face_id, face_count, created_at, updated_at')
    .order('face_count', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get crop paths for representative faces
  const faceIds = (persons ?? []).map((p) => p.representative_face_id).filter(Boolean)

  const cropMap: Record<string, string> = {}
  if (faceIds.length > 0) {
    const { data: faces } = await serviceClient
      .schema('northvault')
      .from('faces')
      .select('id, crop_path')
      .in('id', faceIds)

    if (faces) {
      for (const f of faces) {
        if (f.crop_path) {
          const { data: urlData } = await serviceClient.storage
            .from('northvault-assets')
            .createSignedUrl(f.crop_path, 3600)
          if (urlData?.signedUrl) {
            cropMap[f.id] = urlData.signedUrl
          }
        }
      }
    }
  }

  const result = (persons ?? []).map((p) => ({
    ...p,
    crop_url: p.representative_face_id ? (cropMap[p.representative_face_id] ?? null) : null,
  }))

  return NextResponse.json(result)
}
