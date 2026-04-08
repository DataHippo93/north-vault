/**
 * Metrics normalization and upsert logic.
 * Takes platform-specific API responses and writes normalized daily snapshots.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { NormalizedMetrics } from './types'

/** Upsert a batch of normalized metrics for a creative into the daily snapshots table. */
export async function upsertMetrics(
  creativeId: string,
  metrics: NormalizedMetrics[],
  supabase: SupabaseClient,
): Promise<number> {
  let upserted = 0

  for (const m of metrics) {
    const { error } = await supabase.schema('northvault').from('social_metrics').upsert(
      {
        creative_id: creativeId,
        date: m.date,
        impressions: m.impressions,
        clicks: m.clicks,
        spend_cents: m.spendCents,
        conversions: m.conversions,
        video_views: m.videoViews,
        reach: m.reach,
        engagement: m.engagement,
        raw_data: m.rawData,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'creative_id,date' },
    )
    if (!error) upserted++
  }

  return upserted
}
