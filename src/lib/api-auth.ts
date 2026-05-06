import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Verify the caller is authenticated and optionally has a required role.
 *
 * Returns { user, error }:
 * - On success: user is the Supabase auth user, error is null.
 * - On failure: user is null, error is a NextResponse (401 or 403).
 *
 * Usage in a route handler:
 *   const { user, error } = await requireAuth({ role: 'admin' })
 *   if (error) return error
 */
export async function requireAuth(options?: { role?: 'admin' | 'viewer' }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      user: null as null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  if (options?.role) {
    const adminClient = createAdminClient()
    const { data: profile } = await adminClient
      .schema('northvault')
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single()

    if (!profile || !profile.is_active) {
      return {
        user: null as null,
        error: NextResponse.json({ error: 'Account deactivated' }, { status: 403 }),
      }
    }

    if (profile.role !== options.role) {
      return {
        user: null as null,
        error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
      }
    }
  }

  return { user, error: null }
}
