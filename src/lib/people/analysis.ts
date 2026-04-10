import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import { env, pipeline, RawImage } from '@huggingface/transformers'

export interface FaceBox {
  left: number
  top: number
  width: number
  height: number
}

export interface DetectedFace {
  box: FaceBox
  confidence: number
}

const FACE_EMBEDDING_MODEL = 'Xenova/clip-vit-base-patch32'
const FACE_SIMILARITY_THRESHOLD = 0.82
const MIN_FACE_CONFIDENCE = 0.5

type FaceEmbeddingOutput = {
  data?: Float32Array | number[]
  logits?: {
    data?: Float32Array | number[]
  }
}

type FaceExtractor = (image: unknown, options?: Record<string, unknown>) => Promise<FaceEmbeddingOutput>

let extractorPromise: Promise<FaceExtractor> | null = null

function parseJsonResponse(text: string): unknown {
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim()
  return JSON.parse(cleaned)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function getFaceSimilarityThreshold() {
  return FACE_SIMILARITY_THRESHOLD
}

export async function detectFacesWithClaude(params: {
  imageBuffer: Buffer
  mimeType: string
  fileName: string
}): Promise<DetectedFace[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return []

  const mediaType = params.mimeType.toLowerCase().includes('png')
    ? 'image/png'
    : params.mimeType.toLowerCase().includes('gif')
      ? 'image/gif'
      : params.mimeType.toLowerCase().includes('webp')
        ? 'image/webp'
        : 'image/jpeg'

  const anthropic = new Anthropic({ apiKey })
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: params.imageBuffer.toString('base64'),
            },
          },
          {
            type: 'text',
            text:
              `Find every visible human face in this photo. Return ONLY JSON in this exact shape:\n` +
              `{"faces":[{"box":{"left":0.12,"top":0.18,"width":0.22,"height":0.24},"confidence":0.94}]}\n` +
              `Coordinates are normalized to the full image, from 0 to 1. Keep boxes tight around each face, and include partially visible faces if they are clearly identifiable. ` +
              `If there are no faces, return {"faces":[]}. Do not include any commentary. File: ${params.fileName}`,
          },
        ],
      },
    ],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
  try {
    const parsed = parseJsonResponse(text) as { faces?: Array<{ box?: FaceBox; confidence?: number }> }
    if (!Array.isArray(parsed.faces)) return []

    return parsed.faces
      .map((face) => {
        const box = face.box
        if (!box) return null
        const left = clamp(Number(box.left ?? 0), 0, 1)
        const top = clamp(Number(box.top ?? 0), 0, 1)
        const width = clamp(Number(box.width ?? 0), 0, 1)
        const height = clamp(Number(box.height ?? 0), 0, 1)
        const confidence = clamp(Number(face.confidence ?? 0), 0, 1)
        if (confidence < MIN_FACE_CONFIDENCE || width <= 0 || height <= 0) return null
        return { box: { left, top, width, height }, confidence }
      })
      .filter((face): face is DetectedFace => Boolean(face))
  } catch {
    return []
  }
}

async function getExtractor(): Promise<FaceExtractor> {
  if (!extractorPromise) {
    env.allowRemoteModels = true
    env.allowLocalModels = false
    extractorPromise = pipeline('feature-extraction', FACE_EMBEDDING_MODEL) as unknown as Promise<FaceExtractor>
  }
  return extractorPromise
}

export async function embedFaceCrop(imageBuffer: Buffer): Promise<number[]> {
  const extractor = await getExtractor()
  const image = await RawImage.fromBlob(new Blob([new Uint8Array(imageBuffer)]))
  const output = await extractor(image, { pooling: 'mean', normalize: true })

  const raw =
    (output as { data?: Float32Array | number[] }).data ??
    (output as { logits?: { data?: Float32Array | number[] } }).logits?.data ??
    []

  return Array.from(raw as ArrayLike<number>)
}

export async function cropFace(imageBuffer: Buffer, box: FaceBox): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0

  if (!width || !height) return imageBuffer

  const padX = box.width * 0.24
  const padY = box.height * 0.26
  const left = clamp(Math.floor((box.left - padX) * width), 0, width - 1)
  const top = clamp(Math.floor((box.top - padY) * height), 0, height - 1)
  const right = clamp(Math.ceil((box.left + box.width + padX) * width), left + 1, width)
  const bottom = clamp(Math.ceil((box.top + box.height + padY) * height), top + 1, height)

  const cropWidth = Math.max(1, right - left)
  const cropHeight = Math.max(1, bottom - top)
  const squareSize = Math.max(cropWidth, cropHeight)
  const centerX = left + cropWidth / 2
  const centerY = top + cropHeight / 2
  const squareLeft = clamp(Math.floor(centerX - squareSize / 2), 0, Math.max(0, width - squareSize))
  const squareTop = clamp(Math.floor(centerY - squareSize / 2), 0, Math.max(0, height - squareSize))
  const boundedSize = Math.max(1, Math.min(squareSize, width - squareLeft, height - squareTop))

  return sharp(imageBuffer)
    .extract({ left: squareLeft, top: squareTop, width: boundedSize, height: boundedSize })
    .resize({ width: 224, height: 224, fit: 'cover' })
    .jpeg({ quality: 90 })
    .toBuffer()
}
