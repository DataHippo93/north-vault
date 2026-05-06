import { type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/api-auth'
import { detectFaces, FaceModelsUnavailableError } from '@/lib/faceapi'
import { findOrCreatePerson, updateRepresentativeFace } from '@/lib/faceapi/matching'
import sharp from 'sharp'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Scan ALL unscanned images for faces. Streams progress via SSE.
 * face-api.js on CPU runs ~500ms per image; with 300s timeout we can chew
 * through ~500 images per invocation.
 */
export async function POST(_request: NextRequest) {
  const { error: authError } = await requireAuth({ role: 'admin' })
  if (authError) return authError

  const adminClient = createAdminClient()
  const startTime = Date.now()
  const MAX_RUNTIME = 280_000 // 280s — leave 20s buffer before 300s maxDuration

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      let totalProcessed = 0
      let totalFaces = 0
      let rateLimited = false

      // Count total unscanned
      const { count: totalUnscanned } = await adminClient
        .schema('northvault')
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('content_type', 'image')
        .or('faces_scanned.is.null,faces_scanned.eq.false')

      send('start', { totalUnscanned: totalUnscanned ?? 0 })

      // Process in batches of 20
      const BATCH = 20

      while (Date.now() - startTime < MAX_RUNTIME && !rateLimited) {
        const { data: assets } = await adminClient
          .schema('northvault')
          .from('assets')
          .select('id, storage_path, file_name')
          .eq('content_type', 'image')
          .or('faces_scanned.is.null,faces_scanned.eq.false')
          .order('created_at', { ascending: false })
          .limit(BATCH)

        if (!assets || assets.length === 0) break

        for (const asset of assets) {
          if (Date.now() - startTime >= MAX_RUNTIME || rateLimited) break

          try {
            const { data: signedData } = await adminClient.storage
              .from('northvault-assets')
              .createSignedUrl(asset.storage_path, 300)

            if (!signedData?.signedUrl) {
              await adminClient
                .schema('northvault')
                .from('assets')
                .update({ faces_scanned: true })
                .eq('id', asset.id)
              totalProcessed++
              send('file', { assetId: asset.id, fileName: asset.file_name, faces: 0, error: 'No URL' })
              continue
            }

            const res = await fetch(signedData.signedUrl)
            if (!res.ok) {
              await adminClient
                .schema('northvault')
                .from('assets')
                .update({ faces_scanned: true })
                .eq('id', asset.id)
              totalProcessed++
              continue
            }

            const buffer = Buffer.from(await res.arrayBuffer())

            // Validate image
            try {
              await sharp(buffer).metadata()
            } catch {
              await adminClient
                .schema('northvault')
                .from('assets')
                .update({ faces_scanned: true })
                .eq('id', asset.id)
              totalProcessed++
              continue
            }

            const faces = await detectFaces(buffer)

            if (faces.length > 0) {
              const personIds = new Set<string>()
              for (const face of faces) {
                const faceId = crypto.randomUUID()
                const cropPath = `faces/${asset.id}/${faceId}.jpg`
                await adminClient.storage
                  .from('northvault-assets')
                  .upload(cropPath, face.cropBuffer, { contentType: 'image/jpeg', upsert: true })

                const personId = await findOrCreatePerson(face.descriptor, adminClient)
                personIds.add(personId)

                const embeddingStr = `[${face.descriptor.join(',')}]`
                await adminClient.schema('northvault').from('faces').insert({
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
                await updateRepresentativeFace(pid, adminClient)
              }

              totalFaces += faces.length
            }

            await adminClient
              .schema('northvault')
              .from('assets')
              .update({ faces_scanned: true })
              .eq('id', asset.id)

            totalProcessed++
            send('file', {
              assetId: asset.id,
              fileName: asset.file_name,
              faces: faces.length,
              processed: totalProcessed,
              totalFaces,
            })
          } catch (err) {
            const msg = (err as Error).message
            if (err instanceof FaceModelsUnavailableError) {
              rateLimited = true
              send('rate_limited', { reason: 'face models not installed on server' })
              await adminClient
                .schema('northvault')
                .from('assets')
                .update({ face_scan_error: 'Face models not installed on server' })
                .eq('id', asset.id)
            } else {
              // Record the error but don't mark scanned — retry-able
              await adminClient
                .schema('northvault')
                .from('assets')
                .update({ face_scan_error: msg.slice(0, 500) })
                .eq('id', asset.id)
              totalProcessed++
              send('file', { assetId: asset.id, faces: 0, error: msg })
            }
          }
        }
      }

      // Count remaining
      const { count: remaining } = await adminClient
        .schema('northvault')
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('content_type', 'image')
        .or('faces_scanned.is.null,faces_scanned.eq.false')

      send('complete', {
        processed: totalProcessed,
        facesFound: totalFaces,
        remaining: remaining ?? 0,
        rateLimited,
        timeElapsed: Date.now() - startTime,
      })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
