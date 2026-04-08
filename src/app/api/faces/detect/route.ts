import { createClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { detectFaces } from '@/lib/faceapi'
import { findOrCreatePerson, updateRepresentativeFace } from '@/lib/faceapi/matching'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { assetIds } = (await request.json()) as { assetIds: string[] }
  if (!assetIds?.length) return NextResponse.json({ error: 'Missing assetIds' }, { status: 400 })

  const serviceClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      const results: { assetId: string; facesFound: number; error?: string }[] = []

      for (let i = 0; i < assetIds.length; i++) {
        const assetId = assetIds[i]
        send('progress', { current: i + 1, total: assetIds.length, assetId })

        try {
          // Fetch asset
          const { data: asset } = await serviceClient
            .schema('northvault')
            .from('assets')
            .select('id, storage_path, file_name, content_type')
            .eq('id', assetId)
            .single()

          if (!asset || asset.content_type !== 'image') {
            results.push({ assetId, facesFound: 0, error: 'Not an image' })
            send('file', { assetId, facesFound: 0, status: 'skipped' })
            continue
          }

          // Download image
          const { data: signedData } = await serviceClient.storage
            .from('northvault-assets')
            .createSignedUrl(asset.storage_path, 300)

          if (!signedData?.signedUrl) {
            results.push({ assetId, facesFound: 0, error: 'Could not sign URL' })
            send('file', { assetId, facesFound: 0, status: 'error', error: 'Could not sign URL' })
            continue
          }

          const res = await fetch(signedData.signedUrl)
          if (!res.ok) {
            results.push({ assetId, facesFound: 0, error: 'Download failed' })
            send('file', { assetId, facesFound: 0, status: 'error', error: 'Download failed' })
            continue
          }

          const buffer = Buffer.from(await res.arrayBuffer())

          // Detect faces
          const faces = await detectFaces(buffer)

          if (faces.length === 0) {
            // Mark as scanned even if no faces found
            await serviceClient.schema('northvault').from('assets').update({ faces_scanned: true }).eq('id', assetId)

            results.push({ assetId, facesFound: 0 })
            send('file', { assetId, fileName: asset.file_name, facesFound: 0, status: 'done' })
            continue
          }

          // Process each detected face
          const personIds = new Set<string>()
          for (const face of faces) {
            // Upload face crop
            const faceId = crypto.randomUUID()
            const cropPath = `faces/${assetId}/${faceId}.jpg`
            await serviceClient.storage
              .from('northvault-assets')
              .upload(cropPath, face.cropBuffer, { contentType: 'image/jpeg', upsert: true })

            // Find or create person
            const personId = await findOrCreatePerson(face.descriptor, serviceClient)
            personIds.add(personId)

            // Insert face record
            const embeddingStr = `[${face.descriptor.join(',')}]`
            await serviceClient.schema('northvault').from('faces').insert({
              asset_id: assetId,
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

          // Update representative face for each person
          for (const pid of personIds) {
            await updateRepresentativeFace(pid, serviceClient)
          }

          // Mark asset as scanned
          await serviceClient.schema('northvault').from('assets').update({ faces_scanned: true }).eq('id', assetId)

          results.push({ assetId, facesFound: faces.length })
          send('file', { assetId, fileName: asset.file_name, facesFound: faces.length, status: 'done' })
        } catch (err) {
          results.push({ assetId, facesFound: 0, error: (err as Error).message })
          send('file', { assetId, facesFound: 0, status: 'error', error: (err as Error).message })
        }
      }

      send('complete', { results })
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
