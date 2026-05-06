/**
 * Face detection + 128-d descriptor extraction using face-api.js.
 *
 * Runs server-side via node-canvas. Replaces the prior Azure Face API
 * integration, which is gated behind Microsoft Limited Access for
 * recognition_04 / faceId features and was returning HTTP 403. face-api.js
 * gives us:
 *   - real, stable 128-d face embeddings (cosine similarity works)
 *   - no external API, no rate limits, no approval gate
 *   - models ship with the build (~7 MB total)
 *
 * If the models aren't on disk (download-face-models.sh failed), detectFaces
 * throws FaceModelsUnavailableError so callers can record face_scan_error
 * instead of silently flagging the asset scanned.
 */
import sharp from 'sharp'
import { loadFaceApi, modelsAvailable } from './loader'
import * as nodeCanvas from 'canvas'

const MAX_IMAGE_DIM = 1280
const TINY_FD_INPUT = 416
const TINY_FD_THRESHOLD = 0.5
const CROP_PAD = 0.2

export interface DetectedFace {
  /** Bounding box as fractions (0-1) of the original image dimensions */
  box: { x: number; y: number; width: number; height: number }
  /** Detector confidence in (0,1] */
  confidence: number
  /** 128-d L2-normalized face descriptor from face_recognition_model */
  descriptor: number[]
  /** Pre-cropped 150x150 JPEG of the face for thumbnails */
  cropBuffer: Buffer
}

export class FaceModelsUnavailableError extends Error {
  constructor(message = 'Face models are not installed on this server') {
    super(message)
    this.name = 'FaceModelsUnavailableError'
  }
}

export function faceModelsAvailable(): boolean {
  return modelsAvailable()
}

export async function detectFaces(imageBuffer: Buffer): Promise<DetectedFace[]> {
  if (!modelsAvailable()) {
    throw new FaceModelsUnavailableError()
  }

  const faceapi = await loadFaceApi()

  const meta = await sharp(imageBuffer).metadata()
  const origWidth = meta.width ?? 0
  const origHeight = meta.height ?? 0
  if (!origWidth || !origHeight) return []

  const tooBig = origWidth > MAX_IMAGE_DIM || origHeight > MAX_IMAGE_DIM
  const processed = tooBig
    ? await sharp(imageBuffer)
        .rotate()
        .resize({ width: MAX_IMAGE_DIM, height: MAX_IMAGE_DIM, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer()
    : await sharp(imageBuffer).rotate().jpeg({ quality: 92 }).toBuffer()

  const procMeta = await sharp(processed).metadata()
  const procWidth = procMeta.width ?? origWidth
  const procHeight = procMeta.height ?? origHeight

  const img = await nodeCanvas.loadImage(processed)
  const detectorOpts = new faceapi.TinyFaceDetectorOptions({
    inputSize: TINY_FD_INPUT,
    scoreThreshold: TINY_FD_THRESHOLD,
  })

  // face-api.js typings expect HTMLImageElement; node-canvas Image is
  // structurally compatible at runtime.
  const results = await faceapi
    .detectAllFaces(img as unknown as HTMLImageElement, detectorOpts)
    .withFaceLandmarks()
    .withFaceDescriptors()

  if (!results.length) return []

  const faces: DetectedFace[] = []

  for (const r of results) {
    const detection = r.detection
    const box = detection.box
    const score = detection.score

    const normBox = {
      x: box.x / procWidth,
      y: box.y / procHeight,
      width: box.width / procWidth,
      height: box.height / procHeight,
    }

    const descriptor = Array.from(r.descriptor as Float32Array)

    const cropX = Math.max(0, Math.floor((normBox.x - normBox.width * CROP_PAD) * procWidth))
    const cropY = Math.max(0, Math.floor((normBox.y - normBox.height * CROP_PAD) * procHeight))
    const cropW = Math.min(
      Math.ceil(normBox.width * (1 + 2 * CROP_PAD) * procWidth),
      procWidth - cropX,
    )
    const cropH = Math.min(
      Math.ceil(normBox.height * (1 + 2 * CROP_PAD) * procHeight),
      procHeight - cropY,
    )

    let cropBuffer: Buffer
    try {
      cropBuffer = await sharp(processed)
        .extract({ left: cropX, top: cropY, width: Math.max(1, cropW), height: Math.max(1, cropH) })
        .resize(150, 150, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer()
    } catch {
      cropBuffer = await sharp({
        create: { width: 150, height: 150, channels: 3, background: { r: 200, g: 200, b: 200 } },
      })
        .jpeg()
        .toBuffer()
    }

    faces.push({
      box: normBox,
      confidence: score,
      descriptor,
      cropBuffer,
    })
  }

  return faces
}
