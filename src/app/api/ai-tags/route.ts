/**
 * AI tagging endpoint — runs Claude + Gemini in parallel and merges results.
 *
 * - Claude (Haiku) for context-aware brand/voice tags
 * - Gemini (Flash) for concrete-object enumeration + a second opinion
 *
 * Either model can fail / be missing without breaking the request: if the
 * Gemini key isn't set we fall through to Claude-only, and vice versa. If
 * both fail we return tags=[] with a 200 (so the upload pipeline doesn't
 * error out — tagging is non-essential).
 *
 * Response shape:
 *   { tags, extractedText, barcodes, faceGroup, sources, agreement }
 *   - sources: which models contributed tags
 *   - agreement: tags that BOTH models suggested (highest-confidence subset)
 */
import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { tagWithGemini, type GeminiTagResult } from '@/lib/ai/gemini'

export const runtime = 'nodejs'
export const maxDuration = 60

interface TagInput {
  fileName: string
  mimeType: string
  contentType: string
  imageDataUrl?: string
}

interface TagResult {
  tags: string[]
  faceGroup: string | null
  extractedText: string[]
  barcodes: string[]
}

const EMPTY: TagResult = { tags: [], faceGroup: null, extractedText: [], barcodes: [] }

function normalizeTag(t: string): string {
  return t
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
}

async function tagWithClaude(apiKey: string, input: TagInput, signal?: AbortSignal): Promise<TagResult> {
  const anthropic = new Anthropic({ apiKey })

  type MessageContent =
    | { type: 'text'; text: string }
    | {
        type: 'image'
        source: {
          type: 'base64'
          media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
          data: string
        }
      }

  const content: MessageContent[] = []

  if (input.contentType === 'image' && input.imageDataUrl) {
    const base64 = input.imageDataUrl.replace(/^data:[^;]+;base64,/, '')
    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg'
    if (input.mimeType.includes('png')) mediaType = 'image/png'
    else if (input.mimeType.includes('gif')) mediaType = 'image/gif'
    else if (input.mimeType.includes('webp')) mediaType = 'image/webp'

    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } })
    content.push({
      type: 'text',
      text: `Analyze this image for NorthVault (Nature's Storehouse grocery + ADK Fragrance Farm). Return ONLY valid JSON:
{"face_group":"adult female|adult male|child|group|null","tags":[5-10 lowercase tags],"extracted_text":[readable text],"barcodes":[barcode values]}
Tag guidance: subject, colors, mood, business context, product types. No filler tags.`,
    })
  } else {
    content.push({
      type: 'text',
      text: `Suggest tags for: name="${input.fileName}" mime=${input.mimeType} type=${input.contentType}. Return JSON only: {"face_group":null,"tags":[],"extracted_text":[],"barcodes":[]}`,
    })
  }

  const message = await anthropic.messages.create(
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content }],
    },
    { signal },
  )

  const responseText = message.content[0]?.type === 'text' ? message.content[0].text : ''

  let parsed: {
    tags?: unknown
    face_group?: unknown
    extracted_text?: unknown
    barcodes?: unknown
  } = {}
  try {
    parsed = JSON.parse(responseText.replace(/```json\n?|\n?```/g, '').trim())
  } catch {
    // Fall back to comma-separated tags
    return {
      ...EMPTY,
      tags: responseText.split(',').map(normalizeTag).filter(Boolean),
    }
  }

  return {
    tags: Array.isArray(parsed.tags)
      ? (parsed.tags as unknown[])
          .filter((t): t is string => typeof t === 'string')
          .map(normalizeTag)
          .filter(Boolean)
      : [],
    faceGroup:
      typeof parsed.face_group === 'string' && parsed.face_group.trim()
        ? parsed.face_group.trim().toLowerCase()
        : null,
    extractedText: Array.isArray(parsed.extracted_text)
      ? (parsed.extracted_text as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    barcodes: Array.isArray(parsed.barcodes)
      ? (parsed.barcodes as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json()) as TagInput & { faceGroup?: string }

  if (!body.fileName) {
    return NextResponse.json({ error: 'fileName is required' }, { status: 400 })
  }

  const claudeKey = process.env.ANTHROPIC_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY

  // Both models share a 30s budget — bail early if one stalls
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30_000)

  const claudePromise: Promise<TagResult | null> = claudeKey
    ? tagWithClaude(claudeKey, body, ctrl.signal).catch((err) => {
        console.error('Claude tagging failed:', err)
        return null
      })
    : Promise.resolve(null)

  const geminiPromise: Promise<GeminiTagResult | null> = geminiKey
    ? tagWithGemini(geminiKey, body, ctrl.signal).catch((err) => {
        console.error('Gemini tagging failed:', err)
        return null
      })
    : Promise.resolve(null)

  const [claudeRes, geminiRes] = await Promise.all([claudePromise, geminiPromise])
  clearTimeout(timer)

  // Merge with light dedup. Tags that BOTH models produced get bumped to front
  // and surfaced as `agreement` for the client to weight as high-confidence.
  const claudeTags = new Set(claudeRes?.tags ?? [])
  const geminiTags = new Set(geminiRes?.tags ?? [])
  const agreement = [...claudeTags].filter((t) => geminiTags.has(t))
  const merged = Array.from(new Set([...agreement, ...claudeTags, ...geminiTags]))

  // For face_group prefer Claude's read (more nuanced) but fall back to Gemini.
  const faceGroup = claudeRes?.faceGroup ?? geminiRes?.faceGroup ?? null

  // Union extracted_text / barcodes across both — deduplicated case-insensitively.
  const extractedText = Array.from(
    new Map(
      [...(claudeRes?.extractedText ?? []), ...(geminiRes?.extractedText ?? [])]
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => [s.toLowerCase(), s] as const),
    ).values(),
  )
  const barcodes = Array.from(
    new Set([...(claudeRes?.barcodes ?? []), ...(geminiRes?.barcodes ?? [])].filter(Boolean)),
  )

  const sources: string[] = []
  if (claudeRes) sources.push('claude')
  if (geminiRes) sources.push('gemini')

  return NextResponse.json({
    tags: merged,
    agreement,
    faceGroup,
    extractedText,
    barcodes,
    sources,
  })
}
