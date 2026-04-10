import { createClient as createRawClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { detectFaces } from '@/lib/faceapi'
import { findOrCreatePerson, updateRepresentativeFace } from '@/lib/faceapi/matching'
import sharp from 'sharp'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Azure Free tier: 30 calls/minute, 30K/month.
 * Process a small batch per invocation. Vercel Cron calls this periodically.
 *
 * Priority order:
 * 1. Images with face-related tags (event, portrait, team, group, staff, etc.)
 * 2. All other unscanned images
 * 3. Newly imported images (faces_scanned = false)
 *
 * Rate limiting: process up to BATCH_SIZE images per invocation.
 * If we hit Azure's rate limit, stop gracefully.
 */

const BATCH_SIZE = 10 // ~10 API calls per 5-min cron run, well within 30/min
const FACE_PRIORITY_TAGS = [
  'event',
  'portrait',
  'team',
  'group',
  'staff',
  'people',
  'headshot',
  'dinner',
  'ceremony',
  'meeting',
  'conference',
  'party',
  'gala',
  'photo',
  'annual',
  'award',
  'employee',
  'family',
  'wedding',
  'celebration',
  'reception',
  'graduation',
  'class',
  'reunion',
]

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Check if Azure Face API is configured
  if (!process.env.AZURE_FACE_ENDPOINT || !process.env.AZURE_FACE_KEY) {
    return NextResponse.json({ error: 'Azure Face API not configured' }, { status: 500 })
  }

  const results: { assetId: string; fileName: string; faces: number; error?: string }[] = []
  let rateLimited = false

  // First: fetch priority images (with face-related tags, not yet scanned)
  const { data: priorityAssets } = await serviceClient
    .schema('northvault')
    .from('assets')
    .select('id, storage_path, file_name, tags')
    .eq('content_type', 'image')
    .or('faces_scanned.is.null,faces_scanned.eq.false')
    .overlaps('tags', FACE_PRIORITY_TAGS)
    .order('created_at', { ascending: false })
    .limit(BATCH_SIZE)

  // Then: fill remaining slots with any unscanned images
  const priorityIds = (priorityAssets || []).map((a) => a.id)
  const remaining = BATCH_SIZE - priorityIds.length

  let regularAssets: typeof priorityAssets = []
  if (remaining > 0) {
    const query = serviceClient
      .schema('northvault')
      .from('assets')
      .select('id, storage_path, file_name, tags')
      .eq('content_type', 'image')
      .or('faces_scanned.is.null,faces_scanned.eq.false')
      .order('created_at', { ascending: false })
      .limit(remaining)

    // Exclude priority assets we already fetched
    if (priorityIds.length > 0) {
      // Can't use .not('id', 'in', ...) easily, so filter client-side
      const { data } = await query
      regularAssets = (data || []).filter((a) => !priorityIds.includes(a.id))
    } else {
      const { data } = await query
      regularAssets = data || []
    }
  }

  const allAssets = [...(priorityAssets || []), ...(regularAssets || [])].slice(0, BATCH_SIZE)

  if (allAssets.length === 0) {
    return NextResponse.json({ message: 'No unscanned images remaining', processed: 0 })
  }

  for (const asset of allAssets) {
    if (rateLimited) break

    try {
      // Download image
      const { data: signedData } = await serviceClient.storage
        .from('northvault-assets')
        .createSignedUrl(asset.storage_path, 300)

      if (!signedData?.signedUrl) {
        results.push({ assetId: asset.id, fileName: asset.file_name, faces: 0, error: 'Could not sign URL' })
        continue
      }

      const res = await fetch(signedData.signedUrl)
      if (!res.ok) {
        results.push({ assetId: asset.id, fileName: asset.file_name, faces: 0, error: 'Download failed' })
        continue
      }

      const buffer = Buffer.from(await res.arrayBuffer())

      // Verify it's a valid image before sending to Azure
      try {
        await sharp(buffer).metadata()
      } catch {
        // Not a valid image — mark as scanned to skip in future
        await serviceClient.schema('northvault').from('assets').update({ faces_scanned: true }).eq('id', asset.id)
        results.push({ assetId: asset.id, fileName: asset.file_name, faces: 0, error: 'Invalid image' })
        continue
      }

      // Detect faces via Azure
      const faces = await detectFaces(buffer)

      if (faces.length === 0) {
        await serviceClient.schema('northvault').from('assets').update({ faces_scanned: true }).eq('id', asset.id)
        results.push({ assetId: asset.id, fileName: asset.file_name, faces: 0 })
        continue
      }

      // Process each detected face
      const personIds = new Set<string>()
      for (const face of faces) {
        const faceId = crypto.randomUUID()
        const cropPath = `faces/${asset.id}/${faceId}.jpg`
        await serviceClient.storage
          .from('northvault-assets')
          .upload(cropPath, face.cropBuffer, { contentType: 'image/jpeg', upsert: true })

        const personId = await findOrCreatePerson(face.descriptor, serviceClient)
        personIds.add(personId)

        const embeddingStr = `[${face.descriptor.join(',')}]`
        await serviceClient.schema('northvault').from('faces').insert({
          asset_id: asset.id,
          person_id: personId,
          embedding: embeddingStr,
          box_x: face.box.x,
          box_y: face.box.y,
          box_width: face.box.width,
          box_height: face.box.height,
          confidence: face.confidence,
          crop_path: cropPath,
        })
      }

      for (const pid of personIds) {
        await updateRepresentativeFace(pid, serviceClient)
      }

      await serviceClient.schema('northvault').from('assets').update({ faces_scanned: true }).eq('id', asset.id)
      results.push({ assetId: asset.id, fileName: asset.file_name, faces: faces.length })
    } catch (err) {
      const msg = (err as Error).message
      if (msg.startsWith('RATE_LIMITED:')) {
        rateLimited = true
        results.push({ assetId: asset.id, fileName: asset.file_name, faces: 0, error: 'Rate limited — stopping batch' })
      } else {
        // Mark as scanned to avoid retrying broken images indefinitely
        await serviceClient.schema('northvault').from('assets').update({ faces_scanned: true }).eq('id', asset.id)
        results.push({ assetId: asset.id, fileName: asset.file_name, faces: 0, error: msg })
      }
    }
  }

  const totalFaces = results.reduce((sum, r) => sum + r.faces, 0)

  // Count remaining unscanned
  const { count } = await serviceClient
    .schema('northvault')
    .from('assets')
    .select('id', { count: 'exact', head: true })
    .eq('content_type', 'image')
    .or('faces_scanned.is.null,faces_scanned.eq.false')

  return NextResponse.json({
    processed: results.length,
    facesFound: totalFaces,
    rateLimited,
    remaining: count ?? 0,
    results,
  })
}
