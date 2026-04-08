import { createClient } from '@/lib/supabase/server'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import sharp from 'sharp'

export const runtime = 'nodejs'

const THUMB_SIZE = 400

/** Content types we can generate thumbnails for */
const SUPPORTED_TYPES = new Set(['image', 'pdf', 'document'])

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { assetId } = await request.json()
  if (!assetId) return NextResponse.json({ error: 'Missing assetId' }, { status: 400 })

  const serviceClient = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: asset, error: dbErr } = await serviceClient
    .schema('northvault')
    .from('assets')
    .select('id, storage_path, file_name, mime_type, content_type, thumbnail_path')
    .eq('id', assetId)
    .single()

  if (!asset) return NextResponse.json({ error: 'Asset not found', detail: dbErr }, { status: 404 })
  if (!SUPPORTED_TYPES.has(asset.content_type as string)) {
    return NextResponse.json({ error: 'Not supported: ' + (asset.content_type as string) }, { status: 422 })
  }

  // Return existing thumbnail signed URL if available
  if (asset.thumbnail_path) {
    const { data: urlData } = await serviceClient.storage
      .from('northvault-assets')
      .createSignedUrl(asset.thumbnail_path, 3600)
    if (urlData?.signedUrl) {
      return NextResponse.json({ thumbnailPath: asset.thumbnail_path, signedUrl: urlData.signedUrl })
    }
  }

  // Download original
  const { data: signedData } = await serviceClient.storage
    .from('northvault-assets')
    .createSignedUrl(asset.storage_path, 300)

  if (!signedData?.signedUrl) {
    return NextResponse.json({ error: 'Could not sign URL for ' + (asset.storage_path as string) }, { status: 500 })
  }

  const res = await fetch(signedData.signedUrl)
  if (!res.ok) return NextResponse.json({ error: 'Could not download original' }, { status: 500 })

  const buffer = Buffer.from(await res.arrayBuffer())

  let thumbBuffer: Buffer
  try {
    const ct = asset.content_type as string
    const mime = (asset.mime_type as string) ?? ''
    const name = ((asset.file_name as string) ?? '').toLowerCase()

    if (ct === 'image') {
      thumbBuffer = await sharp(buffer)
        .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
    } else if (ct === 'pdf') {
      try {
        thumbBuffer = await generatePdfThumbnail(buffer)
      } catch {
        // pdfjs-dist + canvas may fail in some runtimes — fall back to label card
        thumbBuffer = await generateLabelThumbnail(name)
      }
    } else if (ct === 'document') {
      // DOCX, PPTX, XLSX are ZIP archives — try to extract an embedded thumbnail
      const isOfficeXml =
        mime.includes('officedocument') || name.endsWith('.docx') || name.endsWith('.pptx') || name.endsWith('.xlsx')
      if (isOfficeXml) {
        thumbBuffer = await generateOfficeThumbnail(buffer, name)
      } else {
        // Other document types — generate a plain label card
        thumbBuffer = await generateLabelThumbnail(name)
      }
    } else {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 422 })
    }
  } catch (err) {
    return NextResponse.json({ error: `Thumbnail generation failed: ${(err as Error).message}` }, { status: 500 })
  }

  const thumbPath = `thumbs/${asset.storage_path as string}.jpg`
  const { error: uploadError } = await serviceClient.storage
    .from('northvault-assets')
    .upload(thumbPath, thumbBuffer, { contentType: 'image/jpeg', upsert: true })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  await serviceClient.schema('northvault').from('assets').update({ thumbnail_path: thumbPath }).eq('id', assetId)

  const { data: thumbUrl } = await serviceClient.storage.from('northvault-assets').createSignedUrl(thumbPath, 3600)

  return NextResponse.json({ thumbnailPath: thumbPath, signedUrl: thumbUrl?.signedUrl })
}

// ---------------------------------------------------------------------------
// PDF: render page 1 via pdfjs-dist + node-canvas
// ---------------------------------------------------------------------------
async function generatePdfThumbnail(pdfBuffer: Buffer): Promise<Buffer> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('canvas')

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) })
  const pdfDoc = await loadingTask.promise
  const page = await pdfDoc.getPage(1)

  const viewport = page.getViewport({ scale: 1 })
  const scale = THUMB_SIZE / Math.max(viewport.width, viewport.height)
  const scaled = page.getViewport({ scale })

  const canvas = createCanvas(Math.round(scaled.width), Math.round(scaled.height))
  const ctx = canvas.getContext('2d')

  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport: scaled,
  }).promise

  return sharp(canvas.toBuffer('image/png')).jpeg({ quality: 80 }).toBuffer()
}

// ---------------------------------------------------------------------------
// Office XML (DOCX / PPTX / XLSX): extract embedded thumbnail from ZIP
// ---------------------------------------------------------------------------
async function generateOfficeThumbnail(fileBuffer: Buffer, fileName: string): Promise<Buffer> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(fileBuffer)

  // Office files often embed a thumbnail at docProps/thumbnail.jpeg (or .emf/.png)
  const thumbPaths = ['docProps/thumbnail.jpeg', 'docProps/thumbnail.png', 'docProps/thumbnail.jpg']
  for (const p of thumbPaths) {
    const entry = zip.file(p)
    if (entry) {
      const data = await entry.async('nodebuffer')
      return sharp(data)
        .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
    }
  }

  // PPTX: try to render the first slide's image
  if (fileName.endsWith('.pptx')) {
    const slideImage = zip.file(/^ppt\/media\/image1\.(png|jpg|jpeg)/i)
    if (slideImage.length > 0) {
      const data = await slideImage[0].async('nodebuffer')
      return sharp(data)
        .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
    }
  }

  // DOCX: try first embedded image
  if (fileName.endsWith('.docx')) {
    const mediaFiles = zip.file(/^word\/media\/image\d+\.(png|jpg|jpeg)/i)
    if (mediaFiles.length > 0) {
      const data = await mediaFiles[0].async('nodebuffer')
      return sharp(data)
        .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
    }
  }

  // No embedded images found — generate a styled label card
  return generateLabelThumbnail(fileName)
}

// ---------------------------------------------------------------------------
// Fallback: SVG-based label card rendered via sharp (no canvas dependency)
// ---------------------------------------------------------------------------
async function generateLabelThumbnail(fileName: string): Promise<Buffer> {
  const ext = fileName.split('.').pop()?.toUpperCase() ?? 'FILE'
  const badgeColors: Record<string, string> = {
    DOCX: '#2563eb',
    DOC: '#2563eb',
    PPTX: '#ea580c',
    PPT: '#ea580c',
    XLSX: '#16a34a',
    XLS: '#16a34a',
    PDF: '#dc2626',
  }
  const bg = badgeColors[ext] ?? '#78716c'
  const label = fileName.length > 28 ? fileName.slice(0, 25) + '...' : fileName
  // Escape XML entities
  const safeLabel = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const svg = `<svg width="${THUMB_SIZE}" height="${THUMB_SIZE}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f5f5f4"/>
    <rect x="${THUMB_SIZE / 2 - 40}" y="${THUMB_SIZE / 2 - 38}" width="80" height="36" rx="8" fill="${bg}"/>
    <text x="50%" y="${THUMB_SIZE / 2 - 16}" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold" font-size="18">${ext}</text>
    <text x="50%" y="${THUMB_SIZE / 2 + 24}" text-anchor="middle" fill="#44403c" font-family="sans-serif" font-size="12">${safeLabel}</text>
  </svg>`

  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer()
}
