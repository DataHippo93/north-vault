import { createClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { decrypt } from '@/lib/utils/encryption'
import { fetchInsights } from '@/lib/social/meta'
import { upsertMetrics } from '@/lib/social/metrics'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const { connectionId, dateFrom, dateTo } = (await request.json()) as {
    connectionId: string
    dateFrom?: string
    dateTo?: string
  }

  if (!connectionId) return NextResponse.json({ error: 'Missing connectionId' }, { status: 400 })

  const serviceClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Fetch connection
  const { data: conn } = await serviceClient
    .schema('northvault')
    .from('social_connections')
    .select('*')
    .eq('id', connectionId)
    .single()

  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  let accessToken: string
  try {
    const raw = conn.access_token_encrypted
    const hexStr = typeof raw === 'string' ? raw.replace(/^\\x/, '') : Buffer.from(raw).toString('hex')
    const encryptedBuf = Buffer.from(hexStr, 'hex')
    accessToken = decrypt(encryptedBuf)
  } catch (err) {
    return NextResponse.json({ error: `Token decryption failed: ${(err as Error).message}` }, { status: 500 })
  }

  // Default date range: last 30 days
  const now = new Date()
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const from = dateFrom || defaultFrom.toISOString().split('T')[0]
  const to = dateTo || now.toISOString().split('T')[0]

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      // Create sync log
      const { data: syncLog } = await serviceClient
        .schema('northvault')
        .from('social_sync_log')
        .insert({ connection_id: connectionId, sync_type: 'metrics' })
        .select('id')
        .single()

      try {
        send('status', { message: `Fetching metrics from ${from} to ${to}...` })

        // Get all creatives linked to this connection
        const { data: creatives } = await serviceClient
          .schema('northvault')
          .from('social_creatives')
          .select('id, platform_ad_id, platform_creative_id')
          .eq('connection_id', connectionId)

        if (!creatives || creatives.length === 0) {
          send('status', { message: 'No creatives found for this connection. Import creatives first.' })
          send('complete', { totalMetrics: 0 })
          controller.close()
          return
        }

        send('status', { message: `Syncing metrics for ${creatives.length} creatives...` })

        // Collect ad IDs for filtering
        const adIds = creatives.map((c) => c.platform_ad_id).filter((id): id is string => id !== null)

        // Fetch insights from Meta
        const insightsMap = await fetchInsights(
          conn.account_id,
          accessToken,
          from,
          to,
          adIds.length > 0 ? adIds : undefined,
        )

        let totalUpserted = 0
        let processed = 0

        for (const creative of creatives) {
          processed++
          send('progress', {
            current: creative.platform_creative_id,
            processed,
            total: creatives.length,
          })

          // Match by ad_id
          const adMetrics = creative.platform_ad_id ? insightsMap.get(creative.platform_ad_id) : undefined
          if (adMetrics && adMetrics.length > 0) {
            const count = await upsertMetrics(creative.id, adMetrics, serviceClient)
            totalUpserted += count
          }
        }

        // Update sync log
        if (syncLog) {
          await serviceClient
            .schema('northvault')
            .from('social_sync_log')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
              items_synced: totalUpserted,
            })
            .eq('id', syncLog.id)
        }

        send('complete', { totalMetrics: totalUpserted, creativesProcessed: creatives.length })
      } catch (err) {
        if (syncLog) {
          await serviceClient
            .schema('northvault')
            .from('social_sync_log')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_message: (err as Error).message,
            })
            .eq('id', syncLog.id)
        }
        send('error', { message: (err as Error).message })
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
