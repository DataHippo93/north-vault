#!/usr/bin/env node
/**
 * Standalone batch face scanner. Talks straight to Supabase using the
 * service role key from BWS-injected env. Skips Next.js entirely.
 *
 * Image decoding is done via sharp -> raw RGBA -> tf.tensor3d, which
 * sidesteps node-canvas (which is brittle to install on Windows).
 *
 * Usage:
 *   bws run -- node scripts/scan-faces-batch.cjs [batchSize=20]
 */
const path = require('node:path')
const sharp = require('sharp')
const { createClient } = require('@supabase/supabase-js')
const tf = require('@tensorflow/tfjs')
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js')
const crypto = require('node:crypto')

faceapi.tf = tf

const MODELS_PATH = path.join(__dirname, '..', 'public', 'models')
const BATCH_SIZE = parseInt(process.argv[2] || process.env.FACE_BATCH_SIZE || '20', 10)
// Tightened for face-api.js descriptors computed from tensor3d inputs:
// observed pairwise cosine similarities in our corpus run 0.85-0.98, so 0.92
// only clusters genuinely-same-person matches. Tune down if cluster count is
// excessive vs visual judgment, up if persons get false-merged.
const SIM_THRESHOLD = 0.92
const DETECT_THRESHOLD = 0.7 // up from 0.5 — kill non-face false positives
const MAX_DIM = 1280

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

/**
 * Decode an image buffer into a 3-channel RGB tensor with shape [h,w,3].
 * face-api.js expects RGB; sharp gives us a byte stream we can wrap.
 */
async function bufferToTensor(buffer) {
  // Resize + force RGB (drop alpha so the 3-channel detector input is clean)
  const { data, info } = await sharp(buffer)
    .rotate() // honor EXIF
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  // Wrap raw bytes as a [h,w,3] uint8 tensor → face-api will normalize internally.
  const tensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32')
  return { tensor, width: info.width, height: info.height }
}

async function detectFaces(buffer) {
  const meta = await sharp(buffer).metadata()
  if (!meta.width || !meta.height) return []

  const { tensor, width: procW, height: procH } = await bufferToTensor(buffer)

  try {
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: DETECT_THRESHOLD })
    const results = await faceapi.detectAllFaces(tensor, opts).withFaceLandmarks().withFaceDescriptors()

    const out = []
    // We re-decode with sharp for crops since the tensor is already disposed.
    const processed = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer()

    for (const r of results) {
      const b = r.detection.box
      const normBox = { x: b.x / procW, y: b.y / procH, width: b.width / procW, height: b.height / procH }
      const cropX = Math.max(0, Math.floor((normBox.x - normBox.width * 0.2) * procW))
      const cropY = Math.max(0, Math.floor((normBox.y - normBox.height * 0.2) * procH))
      const cropW = Math.min(Math.ceil(normBox.width * 1.4 * procW), procW - cropX)
      const cropH = Math.min(Math.ceil(normBox.height * 1.4 * procH), procH - cropY)
      let cropBuffer
      try {
        cropBuffer = await sharp(processed)
          .extract({ left: cropX, top: cropY, width: Math.max(1, cropW), height: Math.max(1, cropH) })
          .resize(150, 150, { fit: 'cover' })
          .jpeg({ quality: 85 })
          .toBuffer()
      } catch {
        cropBuffer = await sharp({
          create: { width: 150, height: 150, channels: 3, background: { r: 200, g: 200, b: 200 } },
        }).jpeg().toBuffer()
      }
      out.push({
        box: normBox,
        confidence: r.detection.score,
        descriptor: Array.from(r.descriptor),
        cropBuffer,
      })
    }
    return out
  } finally {
    tensor.dispose()
  }
}

async function findOrCreatePerson(descriptor) {
  const embeddingStr = `[${descriptor.join(',')}]`
  const { data: matches } = await supabase
    .schema('northvault')
    .rpc('match_face', { query_embedding: embeddingStr, similarity_threshold: SIM_THRESHOLD, max_results: 1 })
  if (matches && matches.length > 0) {
    const personId = matches[0].person_id
    await supabase
      .schema('northvault')
      .from('persons')
      .update({ face_count: (matches[0].face_count ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', personId)
    return personId
  }
  const { data: newPerson, error } = await supabase
    .schema('northvault')
    .from('persons')
    .insert({ face_count: 1 })
    .select('id')
    .single()
  if (error) throw new Error(`Create person failed: ${error.message}`)
  return newPerson.id
}

async function updateRepresentativeFace(personId) {
  const { data: bestFace } = await supabase
    .schema('northvault')
    .from('faces')
    .select('id')
    .eq('person_id', personId)
    .order('confidence', { ascending: false })
    .limit(1)
    .single()
  if (bestFace) {
    await supabase
      .schema('northvault')
      .from('persons')
      .update({ representative_face_id: bestFace.id })
      .eq('id', personId)
  }
}

async function main() {
  console.log(`[scan] Loading models from ${MODELS_PATH}`)
  await tf.setBackend('cpu')
  await tf.ready()
  console.log(`[scan] tf backend: ${tf.getBackend()}`)
  const t0 = Date.now()
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH)
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH)
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH)
  console.log(`[scan] Models loaded in ${Date.now() - t0}ms`)

  // Prioritize images likely to have faces. Falls back to anything unscanned.
  const FACE_PRIORITY = [
    'portrait', 'people', 'team', 'staff', 'event', 'wedding', 'family',
    'headshot', 'party', 'meeting', 'employee', 'person', 'crew', 'group',
    'group shot', 'team photo', 'staff photo', 'woman', 'man', 'child',
    'family photo', 'lifestyle', 'lifestyle photography', 'candid moment',
    'face', 'faces',
  ]
  console.log(`[scan] Fetching face-priority images first, batch=${BATCH_SIZE}`)
  const { data: priorityAssets, error: pErr } = await supabase
    .schema('northvault')
    .from('assets')
    .select('id, storage_path, file_name')
    .eq('content_type', 'image')
    .or('faces_scanned.is.null,faces_scanned.eq.false')
    .overlaps('tags', FACE_PRIORITY)
    .order('created_at', { ascending: false })
    .limit(BATCH_SIZE)
  if (pErr) throw new Error(`Priority fetch failed: ${pErr.message}`)

  let collected = priorityAssets ?? []
  if (collected.length < BATCH_SIZE) {
    const remaining = BATCH_SIZE - collected.length
    const seen = new Set(collected.map((a) => a.id))
    const { data: filler } = await supabase
      .schema('northvault')
      .from('assets')
      .select('id, storage_path, file_name')
      .eq('content_type', 'image')
      .or('faces_scanned.is.null,faces_scanned.eq.false')
      .order('created_at', { ascending: false })
      .limit(remaining + 50)
    for (const a of filler ?? []) {
      if (seen.has(a.id)) continue
      collected.push(a)
      if (collected.length >= BATCH_SIZE) break
    }
  }

  if (collected.length === 0) {
    console.log('[scan] No unscanned images')
    return
  }
  console.log(`[scan] Got ${collected.length} assets (${(priorityAssets ?? []).length} face-prioritized)`)

  let totalFaces = 0
  const totalPeople = new Set()
  let processed = 0
  let errors = 0
  const assets = collected

  for (const asset of assets) {
    const ts = Date.now()
    try {
      const { data: signed } = await supabase.storage
        .from('northvault-assets')
        .createSignedUrl(asset.storage_path, 300)
      if (!signed?.signedUrl) {
        await supabase.schema('northvault').from('assets').update({ face_scan_error: 'No signed URL', face_scan_attempted_at: new Date().toISOString() }).eq('id', asset.id)
        errors++
        continue
      }
      const res = await fetch(signed.signedUrl)
      if (!res.ok) {
        await supabase.schema('northvault').from('assets').update({ face_scan_error: `Download HTTP ${res.status}`, face_scan_attempted_at: new Date().toISOString() }).eq('id', asset.id)
        errors++
        continue
      }
      const buffer = Buffer.from(await res.arrayBuffer())
      try {
        await sharp(buffer).metadata()
      } catch {
        await supabase.schema('northvault').from('assets').update({ faces_scanned: true, face_scan_error: 'Invalid image', face_scan_attempted_at: new Date().toISOString() }).eq('id', asset.id)
        processed++
        continue
      }

      const faces = await detectFaces(buffer)
      if (faces.length === 0) {
        await supabase.schema('northvault').from('assets').update({ faces_scanned: true, face_scan_error: null, face_scan_attempted_at: new Date().toISOString() }).eq('id', asset.id)
        processed++
        console.log(`  [${processed}/${assets.length}] 0 faces  ${asset.file_name.slice(0, 60)}  (${Date.now() - ts}ms)`)
        continue
      }

      const personIds = new Set()
      for (const face of faces) {
        const faceId = crypto.randomUUID()
        const cropPath = `faces/${asset.id}/${faceId}.jpg`
        await supabase.storage.from('northvault-assets').upload(cropPath, face.cropBuffer, { contentType: 'image/jpeg', upsert: true })
        const personId = await findOrCreatePerson(face.descriptor)
        personIds.add(personId)
        totalPeople.add(personId)
        const embeddingStr = `[${face.descriptor.join(',')}]`
        await supabase.schema('northvault').from('faces').insert({
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
        await updateRepresentativeFace(pid)
      }
      await supabase.schema('northvault').from('assets').update({ faces_scanned: true, face_scan_error: null, face_scan_attempted_at: new Date().toISOString() }).eq('id', asset.id)
      totalFaces += faces.length
      processed++
      console.log(`  [${processed}/${assets.length}] ${faces.length} FACE(S)!  ${asset.file_name.slice(0, 60)}  (${Date.now() - ts}ms)`)
    } catch (err) {
      await supabase.schema('northvault').from('assets').update({ face_scan_error: String(err.message).slice(0, 500), face_scan_attempted_at: new Date().toISOString() }).eq('id', asset.id)
      errors++
      console.error(`  ERROR on ${asset.file_name}:`, err.message)
    }
  }

  console.log(`\n[scan] Done. processed=${processed} faces=${totalFaces} unique_people=${totalPeople.size} errors=${errors}`)
}

main().catch((e) => { console.error('[scan] FATAL:', e); process.exit(1) })
