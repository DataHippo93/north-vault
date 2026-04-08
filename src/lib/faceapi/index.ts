import * as faceapi from '@vladmandic/face-api'
import canvas from 'canvas'
import path from 'path'
import sharp from 'sharp'

const { Canvas, Image, ImageData } = canvas

let modelsLoaded = false

const DETECTION_CONFIDENCE = 0.5
const MAX_IMAGE_DIM = 1200

export interface DetectedFace {
  /** Bounding box as fractions (0-1) of image dimensions */
  box: { x: number; y: number; width: number; height: number }
  confidence: number
  /** 128-dimensional face descriptor */
  descriptor: number[]
  /** Pre-cropped face thumbnail (150x150 JPEG buffer) */
  cropBuffer: Buffer
}

async function ensureModels() {
  if (modelsLoaded) return

  // Monkey-patch canvas into face-api's environment
  faceapi.env.monkeyPatch({ Canvas, Image, ImageData } as unknown as faceapi.Environment)

  const modelPath = path.join(process.cwd(), 'public', 'models', 'face-api')
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath)
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath)
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath)
  modelsLoaded = true
}

/**
 * Detect all faces in an image buffer.
 * Returns an array of detected faces with bounding boxes, 128-dim descriptors, and face crop thumbnails.
 */
export async function detectFaces(imageBuffer: Buffer): Promise<DetectedFace[]> {
  await ensureModels()

  // Resize image to reasonable dimensions for detection
  const resized = await sharp(imageBuffer)
    .resize({ width: MAX_IMAGE_DIM, height: MAX_IMAGE_DIM, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer()

  const img = await canvas.loadImage(resized)
  const cnv = canvas.createCanvas(img.width, img.height)
  const ctx = cnv.getContext('2d')
  ctx.drawImage(img, 0, 0)

  const detections = await faceapi
    .detectAllFaces(
      cnv as unknown as HTMLCanvasElement,
      new faceapi.SsdMobilenetv1Options({ minConfidence: DETECTION_CONFIDENCE }),
    )
    .withFaceLandmarks()
    .withFaceDescriptors()

  const results: DetectedFace[] = []

  for (const d of detections) {
    const rawBox = d.detection.box
    // Normalize box to 0-1 fractions
    const box = {
      x: rawBox.x / img.width,
      y: rawBox.y / img.height,
      width: rawBox.width / img.width,
      height: rawBox.height / img.height,
    }

    // Extract face crop with 20% padding
    const pad = 0.2
    const cropX = Math.max(0, Math.round((box.x - box.width * pad) * img.width))
    const cropY = Math.max(0, Math.round((box.y - box.height * pad) * img.height))
    const cropW = Math.min(Math.round(box.width * (1 + 2 * pad) * img.width), img.width - cropX)
    const cropH = Math.min(Math.round(box.height * (1 + 2 * pad) * img.height), img.height - cropY)

    let cropBuffer: Buffer
    try {
      cropBuffer = await sharp(resized)
        .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
        .resize(150, 150, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer()
    } catch {
      // If crop fails (edge case), use a small placeholder
      cropBuffer = await sharp({
        create: { width: 150, height: 150, channels: 3, background: { r: 200, g: 200, b: 200 } },
      })
        .jpeg()
        .toBuffer()
    }

    results.push({
      box,
      confidence: d.detection.score,
      descriptor: Array.from(d.descriptor),
      cropBuffer,
    })
  }

  return results
}
