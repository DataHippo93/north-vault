#!/usr/bin/env node
import path from 'node:path'
import fs from 'node:fs'
import url from 'node:url'
import * as tf from '@tensorflow/tfjs'
import sharp from 'sharp'
import * as faceapi from '@vladmandic/face-api/dist/face-api.esm-nobundle.js'
import * as nodeCanvas from 'canvas'

// Wire pure-JS tfjs into face-api (no-bundle build expects an external tf).
faceapi.tf = tf

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const MODELS_PATH = path.join(__dirname, '..', 'public', 'models')
const SAMPLE_URL = 'https://raw.githubusercontent.com/vladmandic/face-api/master/demo/sample1.jpg'

async function loadInput(arg) {
  if (!arg) {
    const r = await fetch(SAMPLE_URL)
    if (!r.ok) throw new Error(`Sample fetch failed: ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  if (arg.startsWith('http')) {
    const r = await fetch(arg)
    if (!r.ok) throw new Error(`Fetch failed: ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  return fs.readFileSync(arg)
}

async function main() {
  const buffer = await loadInput(process.argv[2])
  console.log('[test] bytes:', buffer.length)

  await tf.setBackend('cpu')
  await tf.ready()
  console.log('[test] tf backend:', tf.getBackend())

  const { Canvas, Image, ImageData } = nodeCanvas
  faceapi.env.monkeyPatch({ Canvas, Image, ImageData })

  const t0 = Date.now()
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH),
    faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH),
    faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH),
  ])
  console.log('[test] models loaded in', Date.now() - t0, 'ms')

  const meta = await sharp(buffer).metadata()
  console.log('[test] source:', meta.width + 'x' + meta.height, meta.format)
  const processed = await sharp(buffer)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer()

  const img = await nodeCanvas.loadImage(processed)
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })
  const td = Date.now()
  const results = await faceapi.detectAllFaces(img, opts).withFaceLandmarks().withFaceDescriptors()
  console.log('[test] detected', results.length, 'face(s) in', Date.now() - td, 'ms')

  for (const [i, r] of results.entries()) {
    const b = r.detection.box
    console.log(`  face[${i}] score=${r.detection.score.toFixed(3)} box=${b.x.toFixed(0)},${b.y.toFixed(0)} ${b.width.toFixed(0)}x${b.height.toFixed(0)} desc.len=${r.descriptor.length}`)
  }

  if (results.length === 0) {
    console.error('[test] WARN: 0 faces')
    process.exit(2)
  }
  console.log('[test] OK')
}
main().catch((e) => { console.error('[test] FAILED:', e.message); process.exit(1) })
