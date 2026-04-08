import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import { getContentType } from '@/lib/utils/fileType'

/**
 * Register an asset in the DB after the client uploaded it directly to storage.
 * Used for large files that bypass the server-side import pipeline.
 */
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

  const body = await request.json()
  const { fileName, storagePath, fileSize, mimeType, business, folderPath, lastModified } = body as {
    fileName: string
    storagePath: string
    fileSize: number
    mimeType: string
    business: string
    folderPath?: string
    lastModified?: string
  }

  if (!fileName || !storagePath || !fileSize) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const serviceClient = await createServiceClient()

  // Dedup by name + size for large files
  const { data: existing } = await serviceClient
    .schema('northvault')
    .from('assets')
    .select('id, file_name')
    .eq('original_filename', fileName)
    .eq('file_size', fileSize)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ status: 'duplicate', duplicateOf: existing.file_name })
  }

  const { data: urlData } = await serviceClient.storage
    .from('northvault-assets')
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

  const contentType = getContentType(mimeType, fileName)
  const hash = `size:${fileSize}:name:${fileName}`

  // Build tags from folder path
  const tags = folderPath
    ? folderPath
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) =>
          s
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, ''),
        )
        .filter((t) => t.length > 1 && t.length < 60)
    : []

  const notes = folderPath
    ? `Source: SharePoint › ${folderPath
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' › ')}`
    : 'Source: SharePoint'

  const { data: asset, error: dbError } = await serviceClient
    .schema('northvault')
    .from('assets')
    .insert({
      file_name: fileName,
      original_filename: fileName,
      sha256_hash: hash,
      file_size: fileSize,
      mime_type: mimeType,
      content_type: contentType,
      storage_path: storagePath,
      storage_url: urlData?.signedUrl ?? null,
      business,
      tags,
      notes,
      uploaded_by: user.id,
      original_created_at: lastModified,
    })
    .select('id')
    .single()

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  return NextResponse.json({ status: 'uploaded', assetId: asset.id })
}
