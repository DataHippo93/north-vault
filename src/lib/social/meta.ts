/**
 * Meta Marketing API client.
 * Handles OAuth flow, ad creative enumeration, and insights fetching.
 */

import type { NormalizedCreative, NormalizedMetrics, OAuthTokens, PlatformAdAccount } from './types'

const GRAPH_API_VERSION = 'v22.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

/** Build the Meta OAuth authorization URL */
export function getAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: redirectUri,
    scope: 'ads_read',
    response_type: 'code',
    state,
  })
  return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params}`
}

/** Exchange authorization code for access tokens */
export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<OAuthTokens> {
  // Exchange code for short-lived token
  const tokenRes = await fetch(
    `${GRAPH_BASE}/oauth/access_token?` +
      new URLSearchParams({
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        redirect_uri: redirectUri,
        code,
      }),
  )

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    throw new Error(`Meta token exchange failed: ${err}`)
  }

  const { access_token: shortLived } = await tokenRes.json()

  // Exchange short-lived token for long-lived token (60 days)
  const longRes = await fetch(
    `${GRAPH_BASE}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        fb_exchange_token: shortLived,
      }),
  )

  if (!longRes.ok) {
    const err = await longRes.text()
    throw new Error(`Meta long-lived token exchange failed: ${err}`)
  }

  const longData = await longRes.json()
  const expiresAt = longData.expires_in ? new Date(Date.now() + longData.expires_in * 1000) : undefined

  return {
    accessToken: longData.access_token,
    expiresAt,
    scopes: ['ads_read'],
  }
}

/** List ad accounts accessible by the token */
export async function listAdAccounts(accessToken: string): Promise<PlatformAdAccount[]> {
  const res = await fetch(`${GRAPH_BASE}/me/adaccounts?fields=id,name&access_token=${accessToken}`)
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Failed to list ad accounts: ${err}`)
  }

  const data = await res.json()
  return (data.data || []).map((a: { id: string; name: string }) => ({
    id: a.id,
    name: a.name,
    platform: 'meta' as const,
  }))
}

interface MetaCreative {
  id: string
  name?: string
  image_url?: string
  thumbnail_url?: string
  video_id?: string
  object_story_spec?: Record<string, unknown>
}

interface MetaAd {
  id: string
  adset_id?: string
  campaign_id?: string
  campaign?: { id: string; name: string }
}

/** Enumerate all ad creatives for an ad account, yielding normalized creatives */
export async function* enumerateCreatives(
  adAccountId: string,
  accessToken: string,
): AsyncGenerator<NormalizedCreative> {
  let url: string | null =
    `${GRAPH_BASE}/${adAccountId}/adcreatives?fields=id,name,image_url,thumbnail_url,video_id,object_story_spec&limit=50&access_token=${accessToken}`

  while (url) {
    const res: Response = await fetch(url)
    if (!res.ok) break

    const data: { data?: MetaCreative[]; paging?: { next?: string } } = await res.json()
    const creatives: MetaCreative[] = data.data || []

    for (const creative of creatives) {
      let mediaUrl: string | undefined
      let mediaType: 'image' | 'video' = 'image'
      let mimeType = 'image/jpeg'

      if (creative.video_id) {
        // Fetch video source URL
        const videoRes = await fetch(`${GRAPH_BASE}/${creative.video_id}?fields=source&access_token=${accessToken}`)
        if (videoRes.ok) {
          const videoData = await videoRes.json()
          mediaUrl = videoData.source
          mediaType = 'video'
          mimeType = 'video/mp4'
        }
      } else if (creative.image_url) {
        mediaUrl = creative.image_url
      } else if (creative.thumbnail_url) {
        mediaUrl = creative.thumbnail_url
      }

      if (!mediaUrl) continue

      // Fetch ad linkage for campaign info
      const adInfo = await fetchAdForCreative(adAccountId, creative.id, accessToken)

      yield {
        platform: 'meta',
        creativeId: creative.id,
        adId: adInfo?.id,
        adsetId: adInfo?.adset_id,
        campaignId: adInfo?.campaign_id ?? adInfo?.campaign?.id,
        campaignName: adInfo?.campaign?.name,
        name: creative.name || `Creative ${creative.id}`,
        mediaUrl,
        mediaType,
        mimeType,
        creativeUrl: `https://www.facebook.com/ads/manager/`,
        metadata: {
          object_story_spec: creative.object_story_spec,
        },
      }
    }

    url = data.paging?.next ?? null
  }
}

async function fetchAdForCreative(
  adAccountId: string,
  creativeId: string,
  accessToken: string,
): Promise<MetaAd | null> {
  const filter = encodeURIComponent(JSON.stringify([{ field: 'creative.id', operator: 'EQUAL', value: creativeId }]))
  const res = await fetch(
    `${GRAPH_BASE}/${adAccountId}/ads?filtering=${filter}&fields=id,adset_id,campaign_id,campaign{id,name}&limit=1&access_token=${accessToken}`,
  )
  if (!res.ok) return null

  const data = await res.json()
  return data.data?.[0] ?? null
}

/** Fetch daily insights for an ad over a date range */
export async function fetchInsights(
  adAccountId: string,
  accessToken: string,
  dateFrom: string,
  dateTo: string,
  adIds?: string[],
): Promise<Map<string, NormalizedMetrics[]>> {
  const results = new Map<string, NormalizedMetrics[]>()

  const timeRange = JSON.stringify({ since: dateFrom, until: dateTo })
  let url: string | null =
    `${GRAPH_BASE}/${adAccountId}/insights?` +
    new URLSearchParams({
      level: 'ad',
      fields: 'ad_id,impressions,clicks,spend,actions,video_views,reach',
      time_range: timeRange,
      time_increment: '1',
      limit: '100',
      access_token: accessToken,
    })

  while (url) {
    const res: Response = await fetch(url)
    if (!res.ok) break

    interface InsightRow {
      ad_id: string
      date_start: string
      impressions?: string
      clicks?: string
      spend?: string
      video_views?: string
      reach?: string
      actions?: { action_type: string; value: string }[]
    }
    const data: { data?: InsightRow[]; paging?: { next?: string } } = await res.json()
    const rows: InsightRow[] = data.data || []

    for (const row of rows) {
      if (adIds && !adIds.includes(row.ad_id)) continue

      const conversions = (row.actions || [])
        .filter((a) => a.action_type === 'offsite_conversion' || a.action_type === 'lead')
        .reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0)

      const metric: NormalizedMetrics = {
        date: row.date_start,
        impressions: parseInt(row.impressions || '0', 10),
        clicks: parseInt(row.clicks || '0', 10),
        spendCents: Math.round(parseFloat(row.spend || '0') * 100),
        conversions,
        videoViews: parseInt(row.video_views || '0', 10),
        reach: parseInt(row.reach || '0', 10),
        engagement: parseInt(row.clicks || '0', 10),
        rawData: row as unknown as Record<string, unknown>,
      }

      const existing = results.get(row.ad_id) || []
      existing.push(metric)
      results.set(row.ad_id, existing)
    }

    url = data.paging?.next ?? null
  }

  return results
}
