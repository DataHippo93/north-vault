import { createClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  // Verify caller is admin
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

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

  // Use raw service client (not cookie-based) for admin auth operations
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server configuration error: missing Supabase credentials' }, { status: 500 })
  }

  const serviceClient = createRawClient(supabaseUrl, serviceKey)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://northvault.adkfragrance.com'

  try {
    const { data, error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?next=/auth/set-password`,
      data: { role },
    })

    if (error) {
      console.error('Invite error:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Pre-create profile with correct role
    if (data.user) {
      await serviceClient.schema('northvault').from('profiles').upsert(
        {
          id: data.user.id,
          email,
          role,
        },
        { onConflict: 'id' },
      )
    }

    return NextResponse.json({ success: true, userId: data.user?.id })
  } catch (err) {
    console.error('Invite exception:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
