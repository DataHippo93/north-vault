import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/api-auth'

export async function DELETE(request: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth({ role: 'admin' })
    if (authError) return authError

    const { userId } = await request.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    if (userId === user.id)
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })

    const adminClient = createAdminClient()

    // Delete profile first (service role bypasses RLS)
    const { error: profileError } = await adminClient
      .schema('northvault')
      .from('profiles')
      .delete()
      .eq('id', userId)
    if (profileError) console.error('Profile delete error:', profileError)

    // Delete from auth.users
    const { error } = await adminClient.auth.admin.deleteUser(userId)
    if (error) {
      console.error('Auth delete error:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Delete exception:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth({ role: 'admin' })
    if (authError) return authError

    const { userId, role } = await request.json()

    if (!userId || !role) {
      return NextResponse.json({ error: 'userId and role required' }, { status: 400 })
    }

    if (!['admin', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // Prevent self-demotion
    if (user.id === userId) {
      return NextResponse.json({ error: 'You cannot change your own role' }, { status: 403 })
    }

    const adminClient = createAdminClient()
    const { error } = await adminClient
      .schema('northvault')
      .from('profiles')
      .update({ role })
      .eq('id', userId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Role change error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
