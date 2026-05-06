import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth({ role: 'admin' })
    if (authError) return authError

    const { userId } = await req.json()
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    if (userId === user.id) {
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Mark user as inactive in profiles table
    const { error: dbError } = await adminClient
      .schema('northvault')
      .from('profiles')
      .update({ is_active: false })
      .eq('id', userId)

    if (dbError) {
      console.error('Failed to deactivate user in DB:', dbError)
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    // Ban user in Supabase Auth (100 years = effectively permanent)
    const { error: banError } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: '876000h',
    })

    if (banError) {
      console.error('Failed to ban user in Auth:', banError)
      // Rollback the DB change
      await adminClient
        .schema('northvault')
        .from('profiles')
        .update({ is_active: true })
        .eq('id', userId)
      return NextResponse.json({ error: banError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Deactivate user error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
