import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  try {
    const { error: authError } = await requireAuth({ role: 'admin' })
    if (authError) return authError

    const { userId } = await req.json()
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    const adminClient = createAdminClient()

    // Remove ban from Supabase Auth
    const { error: banError } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: 'none',
    })

    if (banError) {
      console.error('Failed to unban user in Auth:', banError)
      return NextResponse.json({ error: banError.message }, { status: 500 })
    }

    // Mark as active in profiles table
    const { error: dbError } = await adminClient
      .schema('northvault')
      .from('profiles')
      .update({ is_active: true })
      .eq('id', userId)

    if (dbError) {
      console.error('Failed to reactivate user in DB:', dbError)
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Reactivate user error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
