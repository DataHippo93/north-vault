#!/usr/bin/env node
// CJS-style smoke test — sidesteps Node 22 ESM strict resolution quirks
const path = require('node:path')
const fs = require('node:fs')
const sharp = require('sharp')
const tf = require('@tensorflow/tfjs')
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js')
const nodeCanvas = require('canvas')

faceapi.tf = tf

const MODELS_PATH = path.join(__dirname, '..', 'public', 'models')
const SAMPLE_URL = 'https://raw.githubusercontent.com/vladmandic/face-api/master/demo/sample1.jpg'

async function loadInput(arg) {
  if (!arg) {
    const r = await fetch(SAMPLE_URL)
    if (!r.ok) throw new Error(`fetch ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  if (arg.startsWith('http')) {
    const r = await fetch(arg)
    if (!r.ok) throw new Error(`fetch ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  return fs.readFileSync(arg)
}

;(async () => {
  try {
    const buffer = await loadInput(process.argv[2])
    console.log('[t] bytes:', buffer.length)
    await tf.setBackend('cpu')
    await tf.ready()
    console.log('[t] backend:', tf.getBackend())
    const { Canvas, Image, ImageData } = nodeCanvas
    faceapi.env.monkeyPatch({ Canvas, Image, ImageData })
    const t0 = Date.now()
    await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH)
    await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH)
    await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH)
    console.log('[t] models loaded in', Date.now() - t0, 'ms')
    const processed = await sharp(buffer).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
    const img = await nodeCanvas.loadImage(processed)
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })
    const td = Date.now()
    const results = await faceapi.detectAllFaces(img, opts).withFaceLandmarks().withFaceDescriptors()
    console.log('[t] detected', results.length, 'face(s) in', Date.now() - td, 'ms')
    for (const [i, r] of results.entries()) {
      const b = r.detection.box
      console.log(`  face[${i}] score=${r.detection.score.toFixed(3)} box=${b.x.toFixed(0)},${b.y.toFixed(0)} ${b.width.toFixed(0)}x${b.height.toFixed(0)} desc.len=${r.descriptor.length}`)
    }
    process.exit(results.length === 0 ? 2 : 0)
  } catch (e) {
    console.error('[t] FAILED:', e.message)
    process.exit(1)
  }
})()
