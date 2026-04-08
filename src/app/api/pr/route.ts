import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

function lobsterClient() {
  const url = process.env.LOBSTER_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.LOBSTER_SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createSupabaseClient(url, key)
}

// GET /api/pr — list PR items, optionally filtered
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const business = searchParams.get('business')
  const includeArchived = searchParams.get('archived') === 'true'

  const lobster = lobsterClient()
  let query = lobster
    .from('pr_media')
    .select('id, url, title, publication, published_date, media_type, business, person, summary, archived, found_at')
    .order('found_at', { ascending: false })

  if (!includeArchived) query = query.eq('archived', false)
  if (business) query = query.eq('business', business)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ items: data })
}

// PATCH /api/pr — archive (soft-delete) an item
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, archived } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const lobster = lobsterClient()
  const { error } = await lobster.from('pr_media').update({ archived }).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
