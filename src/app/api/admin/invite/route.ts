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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server configuration error: missing Supabase credentials' }, { status: 500 })
  }

  const serviceClient = createRawClient(supabaseUrl, serviceKey)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://northvault.adkfragrance.com'

  try {
    // Use createUser instead of inviteUserByEmail because a trigger on
    // auth.users auto-inserts into public.profiles with a strict role enum.
    // We pass role:'production' in metadata to satisfy that trigger.
    const { data, error } = await serviceClient.auth.admin.createUser({
      email,
      email_confirm: true, // Mark email as confirmed so they can log in after setting password
      user_metadata: { role: 'production', full_name: '' },
    })

    if (error) {
      console.error('Create user error:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (!data.user) {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
    }

    // Create NorthVault profile with the actual role
    await serviceClient.schema('northvault').from('profiles').upsert(
      {
        id: data.user.id,
        email,
        role,
      },
      { onConflict: 'id' },
    )

    // Send password reset email so the invited user can set their password
    const { error: resetError } = await serviceClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?next=/auth/set-password`,
    })

    if (resetError) {
      console.error('Reset email error:', resetError)
      return NextResponse.json({
        success: true,
        userId: data.user.id,
        warning: 'User created but invite email failed. Use password reset to send them a link.',
      })
    }

    return NextResponse.json({ success: true, userId: data.user.id })
  } catch (err) {
    console.error('Invite exception:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
