import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  // Verify caller is admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { email, role = 'viewer' } = await request.json()

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  // Use service role to send invite
  const serviceClient = await createServiceClient()
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://north-vault.vercel.app'

  const { data, error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/auth/callback?type=invite`,
    data: { role },
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Pre-create profile with correct role
  if (data.user) {
    await serviceClient
      .schema('northvault')
      .from('profiles')
      .upsert({
        id: data.user.id,
        email,
        role,
      }, { onConflict: 'id' })
  }

  return NextResponse.json({ success: true, userId: data.user?.id })
}
