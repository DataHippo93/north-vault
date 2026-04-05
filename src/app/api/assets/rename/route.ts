import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { assetId, newName } = await request.json()

  if (!assetId || !newName || !newName.trim()) {
    return NextResponse.json({ error: 'assetId and newName are required' }, { status: 400 })
  }

  // Fetch the current asset
  const { data: asset, error: fetchError } = await supabase
    .schema('northvault')
    .from('assets')
    .select('*')
    .eq('id', assetId)
    .single()

  if (fetchError || !asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }

  // Check permissions (owner or admin)
  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (asset.uploaded_by !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const oldPath = asset.storage_path || asset.file_path
  if (!oldPath) {
    return NextResponse.json({ error: 'Asset has no storage path' }, { status: 400 })
  }

  // Preserve the extension from the old path
  const oldExt = oldPath.split('.').pop() || ''
  const sanitizedName = newName.trim()

  // Build new storage path: keep the same directory prefix, use new name
  const pathDir = oldPath.substring(0, oldPath.lastIndexOf('/') + 1)
  const newStorageName = `${Date.now()}-${sanitizedName.replace(/[^a-zA-Z0-9._-]/g, '_')}.${oldExt}`
  const newPath = `${pathDir}${newStorageName}`

  // Use service client to move the file in storage (copy + delete)
  const serviceClient = await createServiceClient()

  // Download the file
  const { data: fileData, error: downloadError } = await serviceClient.storage
    .from('northvault-assets')
    .download(oldPath)

  if (downloadError || !fileData) {
    console.error('Download error:', downloadError)
    return NextResponse.json({ error: 'Failed to access file in storage' }, { status: 500 })
  }

  // Upload with new path
  const { error: uploadError } = await serviceClient.storage
    .from('northvault-assets')
    .upload(newPath, fileData, {
      contentType: asset.mime_type,
      upsert: false,
    })

  if (uploadError) {
    console.error('Upload error:', uploadError)
    return NextResponse.json({ error: 'Failed to rename file in storage' }, { status: 500 })
  }

  // Generate new signed URL
  const { data: urlData } = await serviceClient.storage
    .from('northvault-assets')
    .createSignedUrl(newPath, 60 * 60 * 24 * 365)

  // Determine file_name: new name with extension
  const newFileName = sanitizedName.toLowerCase().endsWith(`.${oldExt.toLowerCase()}`)
    ? sanitizedName
    : `${sanitizedName}.${oldExt}`

  // Update the database record
  const { data: updated, error: updateError } = await supabase
    .schema('northvault')
    .from('assets')
    .update({
      file_name: newFileName,
      storage_path: newPath,
      storage_url: urlData?.signedUrl ?? null,
    })
    .eq('id', assetId)
    .select()
    .single()

  if (updateError) {
    console.error('DB update error:', updateError)
    // Try to clean up the new file since DB update failed
    await serviceClient.storage.from('northvault-assets').remove([newPath])
    return NextResponse.json({ error: 'Failed to update asset record' }, { status: 500 })
  }

  // Delete old file from storage (best effort)
  await serviceClient.storage.from('northvault-assets').remove([oldPath])

  return NextResponse.json({ asset: updated })
}
