import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { assetId, fileName } = await request.json()

  if (!assetId || !fileName) {
    return NextResponse.json({ error: 'Missing assetId or fileName' }, { status: 400 })
  }

  // 1. Get current asset details
  const { data: asset, error: fetchError } = await supabase
    .schema('northvault')
    .from('assets')
    .select('*')
    .eq('id', assetId)
    .single()

  if (fetchError || !asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  // 2. Check permissions (owner or admin)
  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (asset.uploaded_by !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 3. Prepare new path
  const oldPath = asset.storage_path
  const pathParts = oldPath.split('/')
  const oldFileName = pathParts.pop()!
  const ext = oldFileName.split('.').pop()
  const newFileName = fileName.endsWith(`.${ext}`) ? fileName : `${fileName}.${ext}`
  const newPath = [...pathParts, newFileName].join('/')

  if (oldPath === newPath) {
    return NextResponse.json({ success: true, message: 'Name unchanged' })
  }

  // 4. Rename in Storage (move)
  const { error: moveError } = await supabase.storage
    .from('northvault-assets')
    .move(oldPath, newPath)

  if (moveError) {
    return NextResponse.json({ error: `Storage error: ${moveError.message}` }, { status: 500 })
  }

  // 5. Update DB record
  const { error: updateError } = await supabase
    .schema('northvault')
    .from('assets')
    .update({
      file_name: newFileName,
      storage_path: newPath
    })
    .eq('id', assetId)

  if (updateError) {
    // Rollback storage move? Move back?
    await supabase.storage.from('northvault-assets').move(newPath, oldPath)
    return NextResponse.json({ error: `Database error: ${updateError.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true, newPath, newFileName })
}
