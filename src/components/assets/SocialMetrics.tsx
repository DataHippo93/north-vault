'use client'

import { useState, useEffect } from 'react'

interface Creative {
  id: string
  platform: string
  platform_campaign_name: string | null
  creative_url: string | null
}

interface Metric {
  date: string
  impressions: number
  clicks: number
  spend_cents: number
  conversions: number
  ctr: number
  cpm_cents: number
}

interface Summary {
  totalImpressions: number
  totalClicks: number
  totalSpendCents: number
  totalConversions: number
  avgCtr: number
  avgCpmCents: number
  days: number
}

interface Props {
  assetId: string
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

export default function SocialMetrics({ assetId }: Props) {
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/social/metrics?assetId=${assetId}`)
      if (res.ok) {
        const data = await res.json()
        setCreatives(data.creatives || [])
        setMetrics(data.metrics || [])
        setSummary(data.summary || null)
      }
      setLoading(false)
    }
    load()
  }, [assetId])

  if (loading) {
    return <div className="text-sage-400 py-4 text-sm">Loading performance data...</div>
  }

  if (creatives.length === 0) {
    return null // No social data for this asset
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sage-900 text-sm font-semibold">Ad Performance</h3>
        {creatives.map((c) => (
          <span key={c.id} className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            {c.platform}
          </span>
        ))}
        {creatives[0]?.platform_campaign_name && (
          <span className="text-sage-500 text-xs">{creatives[0].platform_campaign_name}</span>
        )}
      </div>

      {/* Summary cards */}
      {summary && summary.days > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="bg-sage-50 rounded-lg p-3">
            <div className="text-sage-900 text-lg font-bold">{summary.totalImpressions.toLocaleString()}</div>
            <div className="text-sage-500 text-xs">Impressions</div>
          </div>
          <div className="bg-sage-50 rounded-lg p-3">
            <div className="text-sage-900 text-lg font-bold">{summary.totalClicks.toLocaleString()}</div>
            <div className="text-sage-500 text-xs">Clicks</div>
          </div>
          <div className="bg-sage-50 rounded-lg p-3">
            <div className="text-sage-900 text-lg font-bold">{formatCents(summary.totalSpendCents)}</div>
            <div className="text-sage-500 text-xs">Total Spend</div>
          </div>
          <div className="bg-sage-50 rounded-lg p-3">
            <div className="text-sage-900 text-lg font-bold">{formatPercent(summary.avgCtr)}</div>
            <div className="text-sage-500 text-xs">Avg CTR</div>
          </div>
        </div>
      )}

      {/* Daily metrics table */}
      {metrics.length > 0 && (
        <div className="border-sage-200 max-h-64 overflow-y-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-sage-50 sticky top-0">
                <th className="text-sage-600 px-3 py-2 text-left font-medium">Date</th>
                <th className="text-sage-600 px-3 py-2 text-right font-medium">Impressions</th>
                <th className="text-sage-600 px-3 py-2 text-right font-medium">Clicks</th>
                <th className="text-sage-600 px-3 py-2 text-right font-medium">Spend</th>
                <th className="text-sage-600 px-3 py-2 text-right font-medium">CTR</th>
                <th className="text-sage-600 hidden px-3 py-2 text-right font-medium sm:table-cell">CPM</th>
              </tr>
            </thead>
            <tbody>
              {metrics.slice(0, 60).map((m) => (
                <tr key={m.date} className="border-sage-100 border-t">
                  <td className="text-sage-700 px-3 py-1.5">{m.date}</td>
                  <td className="text-sage-900 px-3 py-1.5 text-right">{m.impressions.toLocaleString()}</td>
                  <td className="text-sage-900 px-3 py-1.5 text-right">{m.clicks.toLocaleString()}</td>
                  <td className="text-sage-900 px-3 py-1.5 text-right">{formatCents(m.spend_cents)}</td>
                  <td className="text-sage-900 px-3 py-1.5 text-right">{formatPercent(m.ctr)}</td>
                  <td className="text-sage-900 hidden px-3 py-1.5 text-right sm:table-cell">
                    {formatCents(m.cpm_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {metrics.length === 0 && (
        <p className="text-sage-400 text-xs">No metrics data yet. Sync metrics from the Social admin page.</p>
      )}
    </div>
  )
}
