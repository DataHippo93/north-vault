import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

interface GroupRow {
  id: string
  slug: string
  display_name: string | null
  centroid: unknown
  face_count: number | null
  image_count: number | null
  representative_asset_id: string | null
  representative_face_index: number | null
  representative_face_confidence: number | null
  created_at: string
  updated_at: string
}

interface AssetRow {
  id: string
  file_name: string
  original_filename: string
  storage_path: string | null
  file_path: string | null
  mime_type: string
  content_type: string
  created_at: string
}

interface FaceRow {
  id: string
  asset_id: string
  face_group_id: string
  face_index: number
  bounding_box: { left: number; top: number; width: number; height: number }
  confidence: number
  created_at: string
  asset: AssetRow | AssetRow[] | null
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [{ data: groups, error: groupsError }, { data: faces, error: facesError }, { count: unindexedCount }] =
    await Promise.all([
      supabase
        .schema('northvault')
        .from('face_groups')
        .select('id, slug, display_name, centroid, face_count, image_count, representative_asset_id, representative_face_index, representative_face_confidence, created_at, updated_at')
        .order('image_count', { ascending: false })
        .order('face_count', { ascending: false }),
      supabase
        .schema('northvault')
        .from('asset_faces')
        .select(
          'id, asset_id, face_group_id, face_index, bounding_box, confidence, created_at, asset:assets(id, file_name, original_filename, storage_path, file_path, mime_type, content_type, created_at)',
        )
        .order('created_at', { ascending: false }),
      supabase
        .schema('northvault')
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('content_type', 'image')
        .is('people_indexed_at', null),
    ])

  if (groupsError) {
    return NextResponse.json({ error: groupsError.message }, { status: 500 })
  }

  if (facesError) {
    return NextResponse.json({ error: facesError.message }, { status: 500 })
  }

  const signedAssets = new Map<string, string>()
  const signAsset = async (asset: { id: string; storagePath: string | null }) => {
    if (signedAssets.has(asset.id) || !asset.storagePath) return
    const { data } = await supabase.storage.from('northvault-assets').createSignedUrl(asset.storagePath, 60 * 60)
    if (data?.signedUrl) signedAssets.set(asset.id, data.signedUrl)
  }

  const groupRows = (groups ?? []) as unknown as GroupRow[]
  const faceRows = (faces ?? []) as unknown as FaceRow[]

  const faceGroups = groupRows.map((group) => {
    const groupFaces = faceRows.filter((face) => face.face_group_id === group.id)
    const uniqueAssets = new Map<string, AssetRow>()
    for (const face of groupFaces) {
      const asset = Array.isArray(face.asset) ? face.asset[0] ?? null : face.asset
      if (asset && !uniqueAssets.has(asset.id)) uniqueAssets.set(asset.id, asset)
      if (uniqueAssets.size >= 4) break
    }

    return {
      id: group.id,
      slug: group.slug,
      displayName: group.display_name,
      label: group.display_name ?? group.slug.replace(/^person-/, 'Person '),
      faceCount: group.face_count ?? 0,
      imageCount: group.image_count ?? 0,
      representativeAssetId: group.representative_asset_id,
      representativeFaceIndex: group.representative_face_index,
      representativeFaceConfidence: group.representative_face_confidence,
      createdAt: group.created_at,
      updatedAt: group.updated_at,
      samples: Array.from(uniqueAssets.values()).map((asset) => ({
        id: asset.id,
        fileName: asset.file_name,
        originalFilename: asset.original_filename,
        storagePath: asset.storage_path || asset.file_path,
        mimeType: asset.mime_type,
        contentType: asset.content_type,
      })),
      faces: groupFaces.slice(0, 10).map((face) => {
        const asset = Array.isArray(face.asset) ? face.asset[0] ?? null : face.asset
        return {
          id: face.id,
          assetId: face.asset_id,
          faceIndex: face.face_index,
          box: face.bounding_box,
          confidence: face.confidence,
          asset: asset
            ? {
                id: asset.id,
                fileName: asset.file_name,
                originalFilename: asset.original_filename,
                storagePath: asset.storage_path || asset.file_path,
                mimeType: asset.mime_type,
                contentType: asset.content_type,
                createdAt: asset.created_at,
                signedUrl: signedAssets.get(asset.id) ?? null,
              }
            : null,
        }
      }),
    }
  })

  for (const group of faceGroups) {
    for (const sample of group.samples) await signAsset(sample)
    for (const face of group.faces) {
      if (face.asset) await signAsset(face.asset)
    }
  }

  return NextResponse.json({
    groups: faceGroups.map((group) => ({
      ...group,
      samples: group.samples.map((sample) => ({
        ...sample,
        signedUrl: signedAssets.get(sample.id) ?? null,
      })),
      coverSample:
        group.samples[0]
          ? {
              ...group.samples[0],
              signedUrl: signedAssets.get(group.samples[0].id) ?? null,
            }
          : null,
    })),
    summary: {
      groupCount: faceGroups.length,
      faceCount: faceGroups.reduce((sum, group) => sum + group.faceCount, 0),
      imageCount: faceGroups.reduce((sum, group) => sum + group.imageCount, 0),
      unindexedImageCount: unindexedCount ?? 0,
    },
  })
}
