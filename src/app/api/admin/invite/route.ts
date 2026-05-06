import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/api-auth'

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

export async function POST(request: NextRequest) {
  try {
    const { error: authError } = await requireAuth({ role: 'admin' })
    if (authError) return authError

    const { email, role = 'viewer', fullName = '' } = await request.json()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    if (!['viewer', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    const adminClient = createAdminClient()
    const siteUrl =
      process.env.SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'https://northvault.adkfragrance.com'

    // Send invite email via Supabase Auth with 8s timeout
    let inviteData: Awaited<ReturnType<typeof adminClient.auth.admin.inviteUserByEmail>>['data']
    let inviteError: Awaited<ReturnType<typeof adminClient.auth.admin.inviteUserByEmail>>['error']
    try {
      const result = await withTimeout(
        adminClient.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${siteUrl}/auth/callback`,
          data: {
            full_name: fullName,
            role,
          },
        }),
        8000,
        'Supabase inviteUserByEmail',
      )
      inviteData = result.data
      inviteError = result.error
    } catch {
      return NextResponse.json(
        {
          error:
            'Invite request timed out. This may be due to email rate limits. Please try again later.',
        },
        { status: 503 },
      )
    }

    if (inviteError) {
      console.error('Supabase invite error:', inviteError)
      return NextResponse.json({ error: inviteError.message }, { status: 400 })
    }

    if (!inviteData?.user) {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
    }

    // Upsert the NorthVault profile
    const { error: dbError } = await adminClient
      .schema('northvault')
      .from('profiles')
      .upsert(
        {
          id: inviteData.user.id,
          email,
          name: fullName || null,
          role,
          is_active: true,
        },
        { onConflict: 'id' },
      )

    if (dbError) {
      console.error('Failed to sync user to profiles table:', dbError)
    }

    return NextResponse.json({
      success: true,
      userId: inviteData.user.id,
      message: `Invite sent to ${email}`,
    })
  } catch (err) {
    console.error('Invite error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
