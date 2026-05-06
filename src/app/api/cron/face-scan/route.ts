import { createClient as createRawClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { detectFaces, FaceModelsUnavailableError } from '@/lib/faceapi'
import { findOrCreatePerson, updateRepresentativeFace } from '@/lib/faceapi/matching'
import sharp from 'sharp'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Cron-driven face scan using face-api.js (no external API).
 *
 * Priority order:
 * 1. Images with face-related tags (event, portrait, team, etc.)
 * 2. All other unscanned images
 * 3. Newly imported images (faces_scanned = false)
 *
 * On error we record the message in `face_scan_error` instead of silently
 * marking scanned, so failures are visible. Set faces_scanned=true only on
 * successful processing or known-permanent failure (corrupt image).
 */

// face-api.js on CPU runs ~300-700ms per image at 1280px. With Vercel's
// 300s timeout and a small overhead margin, ~25 images per cron is safe.
const BATCH_SIZE = 25
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

      // Mark attempt time up front so we can throttle retries on transient failures
      await serviceClient
        .schema('northvault')
        .from('assets')
        .update({ face_scan_attempted_at: new Date().toISOString() })
        .eq('id', asset.id)

      if (!signedData?.signedUrl) {
        await serviceClient
          .schema('northvault')
          .from('assets')
          .update({ face_scan_error: 'Could not sign URL' })
          .eq('id', asset.id)
        results.push({ assetId: asset.id, fileName: asset.file_name, faces: 0, error: 'Could not sign URL' })
        continue
      }

      const res = await fetch(signedData.signedUrl)
      if (!res.ok) {
        await serviceClient
          .schema('northvault')
          .from('assets')
          .update({ face_scan_error: `Download failed: HTTP ${res.status}` })
          .eq('id', asset.id)
        results.push({ assetId: asset.id, fileName: asset.file_name, faces: 0, error: 'Download failed' })
        continue
      }

      const buffer = Buffer.from(await res.arrayBuffer())

      // Verify it's a valid image — corrupt files are permanent failures
      try {
        await sharp(buffer).metadata()
      } catch {
        await serviceClient
          .schema('northvault')
          .from('assets')
          .update({ faces_scanned: true, face_scan_error: 'Invalid image' })
          .eq('id', asset.id)
        results.push({ assetId: asset.id, fileName: asset.file_name, faces: 0, error: 'Invalid image' })
        continue
      }

      // Detect faces via face-api.js
      const faces = await detectFaces(buffer)

      if (faces.length === 0) {
        await serviceClient
          .schema('northvault')
          .from('assets')
          .update({ faces_scanned: true, face_scan_error: null })
          .eq('id', asset.id)
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

      await serviceClient
        .schema('northvault')
        .from('assets')
        .update({ faces_scanned: true, face_scan_error: null })
        .eq('id', asset.id)
      results.push({ assetId: asset.id, fileName: asset.file_name, faces: faces.length })
    } catch (err) {
      const msg = (err as Error).message
      if (err instanceof FaceModelsUnavailableError) {
        // Hard configuration failure — stop the whole batch and surface loudly
        rateLimited = true
        results.push({
          assetId: asset.id,
          fileName: asset.file_name,
          faces: 0,
          error: 'Face models not installed on server (run download-face-models.sh)',
        })
        await serviceClient
          .schema('northvault')
          .from('assets')
          .update({ face_scan_error: 'Face models not installed on server' })
          .eq('id', asset.id)
      } else {
        // Transient failure — record but DON'T mark scanned, so we'll retry next run
        await serviceClient
          .schema('northvault')
          .from('assets')
          .update({ face_scan_error: msg.slice(0, 500) })
          .eq('id', asset.id)
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
