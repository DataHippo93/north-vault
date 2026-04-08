import { createClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const assetId = request.nextUrl.searchParams.get('assetId')
  const creativeId = request.nextUrl.searchParams.get('creativeId')

  if (!assetId && !creativeId) {
    return NextResponse.json({ error: 'Provide assetId or creativeId' }, { status: 400 })
  }

  const serviceClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // If assetId, first find the linked creative(s)
  let creativeIds: string[] = []

  if (assetId) {
    const { data: creatives } = await serviceClient
      .schema('northvault')
      .from('social_creatives')
      .select('id, platform, platform_campaign_name, creative_url')
      .eq('asset_id', assetId)

    if (!creatives || creatives.length === 0) {
      return NextResponse.json({ creatives: [], metrics: [], summary: null })
    }

    creativeIds = creatives.map((c) => c.id)

    // Fetch metrics for all linked creatives
    const { data: metrics } = await serviceClient
      .schema('northvault')
      .from('social_metrics')
      .select('*')
      .in('creative_id', creativeIds)
      .order('date', { ascending: false })
      .limit(365)

    // Compute summary
    const allMetrics = metrics || []
    const summary = {
      totalImpressions: allMetrics.reduce((s, m) => s + (m.impressions || 0), 0),
      totalClicks: allMetrics.reduce((s, m) => s + (m.clicks || 0), 0),
      totalSpendCents: allMetrics.reduce((s, m) => s + (m.spend_cents || 0), 0),
      totalConversions: allMetrics.reduce((s, m) => s + (m.conversions || 0), 0),
      avgCtr:
        allMetrics.length > 0 ? allMetrics.reduce((s, m) => s + parseFloat(m.ctr || '0'), 0) / allMetrics.length : 0,
      avgCpmCents:
        allMetrics.length > 0
          ? allMetrics.reduce((s, m) => s + parseFloat(m.cpm_cents || '0'), 0) / allMetrics.length
          : 0,
      days: allMetrics.length,
    }

    return NextResponse.json({ creatives, metrics: allMetrics, summary })
  }

  // Direct creative lookup
  const { data: metrics } = await serviceClient
    .schema('northvault')
    .from('social_metrics')
    .select('*')
    .eq('creative_id', creativeId)
    .order('date', { ascending: false })
    .limit(365)

  return NextResponse.json({ metrics: metrics || [] })
}
