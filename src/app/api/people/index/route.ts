import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import { processPeopleAssets } from '@/lib/people/process'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const assetId = typeof body.assetId === 'string' ? body.assetId : null
  const assetIds = Array.isArray(body.assetIds) ? body.assetIds.filter((value: unknown) => typeof value === 'string') : []

  const serviceClient = await createServiceClient()

  try {
    const result = await processPeopleAssets({
      supabase: serviceClient as unknown as Parameters<typeof processPeopleAssets>[0]['supabase'],
      assetIds: assetId ? [assetId] : assetIds.length > 0 ? assetIds : undefined,
    })

    return NextResponse.json({ ok: true, result })
  } catch (error) {
    console.error('People indexing failed:', error)
    return NextResponse.json({ error: 'Failed to index faces' }, { status: 500 })
  }
}
