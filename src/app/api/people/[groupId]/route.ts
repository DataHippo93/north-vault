import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { groupId } = await params
  const body = await request.json().catch(() => ({}))
  const rawDisplayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  const displayName = rawDisplayName || null

  const { data: group, error: groupError } = await supabase
    .schema('northvault')
    .from('face_groups')
    .select('id, slug, display_name, face_count, image_count')
    .eq('id', groupId)
    .single()

  if (groupError || !group) {
    return NextResponse.json({ error: 'Face group not found' }, { status: 404 })
  }

  const { data: updated, error: updateError } = await supabase
    .schema('northvault')
    .from('face_groups')
    .update({ display_name: displayName, updated_at: new Date().toISOString() })
    .eq('id', groupId)
    .select('id, slug, display_name, face_count, image_count, representative_asset_id, representative_face_index, representative_face_confidence, created_at, updated_at')
    .single()

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message ?? 'Failed to update face group' }, { status: 500 })
  }

  await supabase
    .schema('northvault')
    .from('assets')
    .update({ face_label: displayName })
    .eq('face_group', group.slug)

  return NextResponse.json({
    group: {
      ...updated,
      label: updated.display_name ?? updated.slug.replace(/^person-/, 'Person '),
    },
  })
}
