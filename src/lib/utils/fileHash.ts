import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Computes SHA-256 hash of a File using the Web Crypto API.
 * Returns hex string.
 */
export async function computeSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Checks if a hash already exists in the assets table.
 * Returns the existing asset ID if found, null otherwise.
 */
export async function checkDuplicate(
  supabase: SupabaseClient,
  hash: string
): Promise<{ id: string; file_name: string } | null> {
  const { data, error } = await supabase
    .schema('northvault')
    .from('assets')
    .select('id, file_name')
    .eq('sha256_hash', hash)
    .maybeSingle()

  if (error || !data) return null
  return data
}
