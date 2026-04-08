import type { SocialPlatform } from '@/types'

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  scopes: string[]
}

export interface PlatformAdAccount {
  id: string
  name: string
  platform: SocialPlatform
}

/** Normalized creative from any platform, ready for import */
export interface NormalizedCreative {
  platform: SocialPlatform
  creativeId: string
  adId?: string
  adsetId?: string
  campaignId?: string
  campaignName?: string
  name: string
  mediaUrl: string
  mediaType: 'image' | 'video'
  mimeType: string
  creativeUrl?: string
  metadata: Record<string, unknown>
}

/** Normalized daily metrics from any platform */
export interface NormalizedMetrics {
  date: string
  impressions: number
  clicks: number
  spendCents: number
  conversions: number
  videoViews: number
  reach: number
  engagement: number
  rawData: Record<string, unknown>
}
