import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { runSocialImport } from '@/lib/import/social-runner'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: connections, error } = await serviceClient
    .schema('northvault')
    .from('social_connections')
    .select('id, business, account_name, platform')
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: Array<{ connectionId: string; ok: boolean; error?: string }> = []

  for (const connection of connections ?? []) {
    try {
      await runSocialImport({
        connectionId: connection.id,
        business: connection.business ?? 'both',
        enableAiTagging: true,
        serviceClient,
      })
      results.push({ connectionId: connection.id, ok: true })
    } catch (err) {
      results.push({ connectionId: connection.id, ok: false, error: (err as Error).message })
    }
  }

  return NextResponse.json({ ok: true, results })
}
