import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

async function getAdminUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, profile: null }
  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  return { supabase, user, profile }
}

export async function DELETE(request: NextRequest) {
  const { user, profile } = await getAdminUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { userId } = await request.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  if (userId === user.id) return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })

  // Use service role client to delete from auth.users
  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { error } = await serviceClient.auth.admin.deleteUser(userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Profile will be cascade-deleted by DB trigger or FK; delete explicitly if not
  const supabase = await createClient()
  await supabase.schema('northvault').from('profiles').delete().eq('id', userId)

  return NextResponse.json({ success: true })
}

export async function PATCH(request: NextRequest) {
  const { supabase, user, profile } = await getAdminUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { userId, role } = await request.json()

  if (!userId || !role) {
    return NextResponse.json({ error: 'userId and role required' }, { status: 400 })
  }

  const { error } = await supabase.schema('northvault').from('profiles').update({ role }).eq('id', userId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
