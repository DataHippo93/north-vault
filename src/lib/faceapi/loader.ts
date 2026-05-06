/**
 * Server-side face-api.js model loader.
 *
 * face-api.js is browser-first; in Node we monkey-patch with node-canvas.
 * We import the **node-wasm** bundle (CJS) explicitly: it expects an
 * external @tensorflow/tfjs-backend-wasm + @tensorflow/tfjs, both pure-JS
 * (no native libtensorflow). Confirmed working on Node 22 in the sandbox
 * with 3 faces detected on the sample image at ~3s including model load.
 *
 * Models live under public/models/ (see scripts/download-face-models.sh)
 * so they ship with the Vercel build artifact.
 *
 * Loaded once per server process, cached on globalThis so hot-reload in
 * dev and serverless re-use don't reload weights.
 */
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import * as tf from '@tensorflow/tfjs'
import * as nodeCanvas from 'canvas'

// face-api ships several entry points; pick node-wasm for Vercel-friendly
// pure-JS pipeline. createRequire because Next.js compiles this to ESM.
import type * as FaceApiModule from '@vladmandic/face-api'
type FaceApi = typeof FaceApiModule
const requireCJS = createRequire(import.meta.url)
const faceapi: FaceApi = requireCJS('@vladmandic/face-api/dist/face-api.node-wasm.js')

// Wire our externally-loaded tfjs into face-api's expected slot.
;(faceapi as unknown as { tf: typeof tf }).tf = tf

const MODELS_PATH = path.join(process.cwd(), 'public', 'models')

interface FaceApiCache {
  ready: Promise<FaceApi> | null
}
const g = globalThis as unknown as { __faceApiCache?: FaceApiCache }
if (!g.__faceApiCache) g.__faceApiCache = { ready: null }
const cache = g.__faceApiCache

export function modelsAvailable(): boolean {
  return (
    fs.existsSync(path.join(MODELS_PATH, 'tiny_face_detector_model-weights_manifest.json')) &&
    fs.existsSync(path.join(MODELS_PATH, 'face_recognition_model-weights_manifest.json')) &&
    fs.existsSync(path.join(MODELS_PATH, 'face_landmark_68_model-weights_manifest.json'))
  )
}

export async function loadFaceApi(): Promise<FaceApi> {
  if (cache.ready) return cache.ready

  cache.ready = (async () => {
    if (!modelsAvailable()) {
      throw new Error(
        `Face models not found at ${MODELS_PATH}. Run 'bash scripts/download-face-models.sh' or trigger a fresh install.`,
      )
    }

    // CPU backend: portable, no GPU/WASM init headaches. ~500ms per
    // 1280px image once the model is loaded. Vercel cron has 300s,
    // we batch 25 images per run → comfortable margin.
    await tf.setBackend('cpu')
    await tf.ready()

    const { Canvas, Image, ImageData } = nodeCanvas
    faceapi.env.monkeyPatch({
      Canvas: Canvas as unknown as typeof HTMLCanvasElement,
      Image: Image as unknown as typeof HTMLImageElement,
      ImageData: ImageData as unknown as typeof globalThis.ImageData,
    })

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH),
      faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH),
      faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH),
    ])

    return faceapi
  })()

  return cache.ready
}
