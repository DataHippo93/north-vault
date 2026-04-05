import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const sourceType = body.sourceType || 'sharepoint'
  const sourceUrl = body.sourceUrl
  const folderPath = body.folderPath || null
  const chunkSize = Math.max(1, Math.min(Number(body.chunkSize) || 25, 100))
  const totalItems = Number(body.totalItems) || 0
  const status = body.status || 'queued'

  if (!sourceUrl) {
    return NextResponse.json({ error: 'sourceUrl is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .schema('northvault')
    .from('import_jobs')
    .insert({
      source_type: sourceType,
      source_url: sourceUrl,
      folder_path: folderPath,
      status,
      chunk_size: chunkSize,
      total_items: totalItems,
      processed_items: 0,
      failed_items: 0,
      created_by: user.id,
      metadata: {
        folderPath,
        sourceUrl,
        chunkSize,
      },
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, job: data })
}
