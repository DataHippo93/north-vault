import { createClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const { name, mergeInto } = body as { name?: string; mergeInto?: string }

  const serviceClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  if (mergeInto) {
    // Merge this person into another: move all faces, delete this person
    await serviceClient.schema('northvault').from('faces').update({ person_id: mergeInto }).eq('person_id', id)

    // Recalculate face count on target
    const { count } = await serviceClient
      .schema('northvault')
      .from('faces')
      .select('id', { count: 'exact', head: true })
      .eq('person_id', mergeInto)

    await serviceClient
      .schema('northvault')
      .from('persons')
      .update({ face_count: count ?? 0, updated_at: new Date().toISOString() })
      .eq('id', mergeInto)

    // Delete the merged person
    await serviceClient.schema('northvault').from('persons').delete().eq('id', id)

    return NextResponse.json({ merged: true, into: mergeInto })
  }

  if (name !== undefined) {
    const { error } = await serviceClient
      .schema('northvault')
      .from('persons')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ updated: true })
  }

  return NextResponse.json({ error: 'No action specified' }, { status: 400 })
}
