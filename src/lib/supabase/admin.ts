import { createClient } from '@supabase/supabase-js'

/**
 * Admin client for server-side API routes only (uses service role key).
 *
 * This bypasses RLS and should only be used in trusted server contexts
 * (API route handlers). Never expose the service role key to the client.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
