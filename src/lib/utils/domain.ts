import { headers } from 'next/headers'

const DOMAIN_BUSINESS_MAP: Record<string, string> = {
  'northvault.adkfragrance.com': 'adk_fragrance',
  'northvault.natures-storehouse.com': 'natures_storehouse',
}

/**
 * Returns the business slug inferred from the request hostname,
 * or null if the host doesn't map to a specific business (e.g. localhost, Vercel preview).
 * Must be called from a Server Component or Route Handler.
 */
export async function getDefaultBusiness(): Promise<string | null> {
  const headersList = await headers()
  const host = headersList.get('host') ?? ''
  // Strip port if present (e.g. localhost:3005)
  const hostname = host.split(':')[0]
  return DOMAIN_BUSINESS_MAP[hostname] ?? null
}
