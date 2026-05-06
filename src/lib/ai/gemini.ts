/**
 * Google Gemini Vision tagger.
 *
 * Sister to the Claude tagger in /api/ai-tags. We run both models in
 * parallel and merge tags so each one's blind spots get covered. Gemini
 * tends to be stronger at concrete object enumeration; Claude is stronger
 * at brand/voice context. Different models also rarely hallucinate the
 * same wrong tag, so agreement = high confidence.
 *
 * Uses the v1beta REST API directly to avoid pulling another SDK dep.
 * Returns null tags array if the key is missing — caller should treat as
 * "Gemini disabled" and just use Claude's output.
 */

export interface GeminiTagResult {
  tags: string[]
  faceGroup: string | null
  extractedText: string[]
  barcodes: string[]
  raw?: unknown
}

const GEMINI_MODEL = 'gemini-flash-latest' // fast, cheap, vision-capable
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const SYSTEM_PROMPT = `You are an image tagger for NorthVault, a private digital asset library
shared by two related businesses: Nature's Storehouse (a natural-foods grocery) and
Adirondack Fragrance Farm (a heritage fragrance/body-care brand established 1979).

Return ONLY valid JSON, no commentary, with this exact shape:
{
  "face_group": null | "adult male" | "adult female" | "child" | "group",
  "tags": [array of 5-10 lowercase short descriptors],
  "extracted_text": [array of any readable text on the image, e.g. labels, signage, product names],
  "barcodes": [array of any visible barcode/QR code values]
}

Tag guidance:
- Concrete subjects, colors, mood, setting (storefront, farm, kitchen, event, retail shelf)
- Business context if identifiable: "natures storehouse" or "adk fragrance" or "both"
- Product types if visible: candles, soap, body care, herbs, supplements, produce, etc.
- Avoid generic filler like "image" or "photo"
- No PII or names in tags`

export async function tagWithGemini(
  apiKey: string,
  input: {
    fileName: string
    mimeType: string
    contentType: string
    imageDataUrl?: string
  },
  signal?: AbortSignal,
): Promise<GeminiTagResult> {
  const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = []

  parts.push({ text: SYSTEM_PROMPT })

  if (input.contentType === 'image' && input.imageDataUrl) {
    const base64 = input.imageDataUrl.replace(/^data:[^;]+;base64,/, '')
    let mediaType = 'image/jpeg'
    if (input.mimeType.includes('png')) mediaType = 'image/png'
    else if (input.mimeType.includes('webp')) mediaType = 'image/webp'
    else if (input.mimeType.includes('gif')) mediaType = 'image/gif'
    parts.push({ inline_data: { mime_type: mediaType, data: base64 } })
    parts.push({
      text: `Analyze this image. File name: "${input.fileName}". Return JSON.`,
    })
  } else {
    parts.push({
      text: `Suggest tags for: file_name="${input.fileName}" mime="${input.mimeType}" type="${input.contentType}". Return JSON with empty face_group/extracted_text/barcodes.`,
    })
  }

  const res = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
    }),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`)
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!text) return { tags: [], faceGroup: null, extractedText: [], barcodes: [], raw: json }

  let parsed: {
    tags?: unknown
    face_group?: unknown
    extracted_text?: unknown
    barcodes?: unknown
  } = {}
  try {
    parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim())
  } catch {
    // Model occasionally wraps JSON in prose despite the constraint
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        parsed = JSON.parse(match[0])
      } catch {
        return { tags: [], faceGroup: null, extractedText: [], barcodes: [], raw: text }
      }
    }
  }

  const tags = Array.isArray(parsed.tags)
    ? (parsed.tags as unknown[])
        .filter((t): t is string => typeof t === 'string')
        .map((t) =>
          t
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, ''),
        )
        .filter(Boolean)
    : []

  const faceGroup =
    typeof parsed.face_group === 'string' && parsed.face_group.trim()
      ? parsed.face_group.trim().toLowerCase()
      : null

  const extractedText = Array.isArray(parsed.extracted_text)
    ? (parsed.extracted_text as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : []

  const barcodes = Array.isArray(parsed.barcodes)
    ? (parsed.barcodes as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : []

  return { tags, faceGroup, extractedText, barcodes }
}
