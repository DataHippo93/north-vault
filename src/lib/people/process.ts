import { cropFace, detectFacesWithClaude, embedFaceCrop } from '@/lib/people/analysis'
import { bestClusterMatch, makePersonSlug, updateClusterCentroid } from '@/lib/people/clustering'

export interface PeopleProcessResult {
  processedAssets: number
  facesDetected: number
  groupsMatched: number
  groupsCreated: number
  skippedAssets: number
  details: Array<{
    assetId: string
    fileName: string
    facesDetected: number
    groupSlug: string | null
    groupLabel: string | null
  }>
}

interface FaceGroupRow {
  id: string
  slug: string
  display_name: string | null
  centroid: unknown
  face_count: number | null
  image_count: number | null
  representative_asset_id: string | null
  representative_face_index: number | null
  representative_face_confidence: number | null
}

interface PeopleAssetRow {
  id: string
  file_name: string
  storage_path: string | null
  file_path: string | null
  mime_type: string
  content_type: string
  face_group: string | null
  face_label: string | null
  face_confidence: number | null
  people_indexed_at: string | null
}

interface QueryResult<T> {
  data: T | null
  error: { message: string } | null
}

interface QueryBuilder<T = unknown> extends PromiseLike<QueryResult<T>> {
  then<TResult1 = QueryResult<T>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>
  select(...args: string[]): QueryBuilder<T>
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>
  eq(column: string, value: string | null): QueryBuilder<T>
  in(column: string, values: string[]): QueryBuilder<T>
  is(column: string, value: null): QueryBuilder<T>
  insert(values: Record<string, unknown>): QueryBuilder<T>
  update(values: Record<string, unknown>): QueryBuilder<T>
  single<U = T>(): Promise<QueryResult<U>>
  maybeSingle<U = T>(): Promise<QueryResult<U>>
}

interface SupabaseLike {
  schema(name: string): { from<T = unknown>(table: string): QueryBuilder<T> }
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>
    }
  }
}

interface FaceGroupState {
  id: string
  slug: string
  displayName: string | null
  centroid: number[]
  faceCount: number
  imageCount: number
  representativeAssetId: string | null
  representativeFaceIndex: number | null
  representativeFaceConfidence: number | null
  dirty: boolean
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
}

function toGroupState(row: FaceGroupRow): FaceGroupState {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    centroid: toNumberArray(row.centroid),
    faceCount: Number(row.face_count ?? 0),
    imageCount: Number(row.image_count ?? 0),
    representativeAssetId: row.representative_asset_id,
    representativeFaceIndex: row.representative_face_index,
    representativeFaceConfidence: row.representative_face_confidence,
    dirty: false,
  }
}

function groupDisplayName(group: FaceGroupState) {
  return group.displayName?.trim() || group.slug.replace(/^person-/, 'Person ')
}

async function loadFaceGroups(supabase: SupabaseLike): Promise<FaceGroupState[]> {
  const result = (await supabase
    .schema('northvault')
    .from('face_groups')
    .select(
      'id, slug, display_name, centroid, face_count, image_count, representative_asset_id, representative_face_index, representative_face_confidence',
    )
    .order('image_count', { ascending: false })
    .order('face_count', { ascending: false })) as QueryResult<FaceGroupRow[]>
  const { data, error } = result

  if (error) throw error
  return (data ?? []).map(toGroupState)
}

async function loadAssets(supabase: SupabaseLike, assetIds?: string[]) {
  let query = supabase
    .schema('northvault')
    .from('assets')
    .select('id, file_name, storage_path, file_path, mime_type, content_type, face_group, face_label, face_confidence, people_indexed_at')
    .eq('content_type', 'image')
    .order('created_at', { ascending: true })

  if (assetIds && assetIds.length > 0) {
    query = query.in('id', assetIds)
  } else {
    query = query.is('people_indexed_at', null)
  }

  const result = (await query) as QueryResult<PeopleAssetRow[]>
  const { data, error } = result
  if (error) throw error
  return (data ?? []) as PeopleAssetRow[]
}

async function downloadAssetBuffer(supabase: SupabaseLike, storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from('northvault-assets').download(storagePath)
  if (error || !data) throw error ?? new Error('Failed to download asset from storage')
  return Buffer.from(await data.arrayBuffer())
}

export async function processPeopleAssets(params: {
  supabase: SupabaseLike
  assetIds?: string[]
}): Promise<PeopleProcessResult> {
  const { supabase, assetIds } = params
  const targetAssets = await loadAssets(supabase, assetIds)
  const groups = await loadFaceGroups(supabase)
  const nextGroupIndexBase = groups.length + 1
  let nextGroupIndex = nextGroupIndexBase

  const result: PeopleProcessResult = {
    processedAssets: 0,
    facesDetected: 0,
    groupsMatched: 0,
    groupsCreated: 0,
    skippedAssets: 0,
    details: [],
  }

  for (const asset of targetAssets) {
    const storagePath = asset.storage_path || asset.file_path
    if (!storagePath) {
      result.skippedAssets += 1
      continue
    }

    try {
      const buffer = await downloadAssetBuffer(supabase, storagePath)
      const detections = await detectFacesWithClaude({
        imageBuffer: buffer,
        mimeType: asset.mime_type,
        fileName: asset.file_name,
      })

      if (detections.length === 0) {
        await supabase
          .schema('northvault')
          .from('assets')
          .update({
            face_group: null,
            face_label: null,
            face_confidence: null,
            people_indexed_at: new Date().toISOString(),
          })
          .eq('id', asset.id)

        result.processedAssets += 1
        result.details.push({
          assetId: asset.id,
          fileName: asset.file_name,
          facesDetected: 0,
          groupSlug: null,
          groupLabel: null,
        })
        continue
      }

      result.facesDetected += detections.length
      const assetGroupsSeen = new Set<string>()
      let primaryGroup: FaceGroupState | null = null
      let primaryConfidence = 0

      for (let faceIndex = 0; faceIndex < detections.length; faceIndex += 1) {
        const detection = detections[faceIndex]
        const faceBuffer = await cropFace(buffer, detection.box)
        const embedding = await embedFaceCrop(faceBuffer)
        if (!embedding.length) continue

        const match = bestClusterMatch(
          embedding,
          groups.map((group) => ({
            id: group.id,
            slug: group.slug,
            displayName: group.displayName,
            centroid: group.centroid,
            faceCount: group.faceCount,
            imageCount: group.imageCount,
          })),
          0.82,
        )

        let group: FaceGroupState
        let matchConfidence = detection.confidence

        if (match) {
          const existingGroup = groups.find((candidate) => candidate.id === match.cluster.id)
          if (!existingGroup) throw new Error('Matched face group disappeared during indexing')
          group = existingGroup
          group.centroid = updateClusterCentroid(group.centroid, embedding, group.faceCount)
          group.faceCount += 1
          group.dirty = true
          result.groupsMatched += 1
          matchConfidence = Math.max(match.similarity, detection.confidence)
        } else {
          const slug = makePersonSlug(nextGroupIndex)
          nextGroupIndex += 1
          const insertedResult = (await supabase
            .schema('northvault')
            .from('face_groups')
            .insert({
              slug,
              display_name: null,
              centroid: embedding,
              face_count: 1,
              image_count: 1,
              representative_asset_id: asset.id,
              representative_face_index: faceIndex,
              representative_face_confidence: detection.confidence,
            })
            .select('id, slug, display_name, centroid, face_count, image_count, representative_asset_id, representative_face_index, representative_face_confidence')
            .single()) as QueryResult<FaceGroupRow>
          const { data: inserted, error: insertError } = insertedResult

          if (insertError || !inserted) throw insertError ?? new Error('Failed to create face group')

          group = toGroupState(inserted as FaceGroupRow)
          group.centroid = toNumberArray((inserted as FaceGroupRow).centroid)
          groups.push(group)
          result.groupsCreated += 1
        }

        if (!assetGroupsSeen.has(group.id)) {
          group.imageCount += 1
          group.dirty = true
          assetGroupsSeen.add(group.id)
        }

        if (!group.representativeAssetId || matchConfidence > (group.representativeFaceConfidence ?? 0)) {
          group.representativeAssetId = asset.id
          group.representativeFaceIndex = faceIndex
          group.representativeFaceConfidence = matchConfidence
          group.dirty = true
        }

        await supabase.schema('northvault').from('asset_faces').insert({
          asset_id: asset.id,
          face_group_id: group.id,
          face_index: faceIndex,
          bounding_box: detection.box,
          embedding,
          confidence: detection.confidence,
        })

        if (!primaryGroup || matchConfidence > primaryConfidence) {
          primaryGroup = group
          primaryConfidence = matchConfidence
        }
      }

      await supabase
        .schema('northvault')
        .from('assets')
        .update({
          face_group: primaryGroup?.slug ?? null,
          face_label: primaryGroup ? primaryGroup.displayName : null,
          face_confidence: primaryGroup ? primaryConfidence : null,
          people_indexed_at: new Date().toISOString(),
        })
        .eq('id', asset.id)

      result.processedAssets += 1
      result.details.push({
        assetId: asset.id,
        fileName: asset.file_name,
        facesDetected: detections.length,
        groupSlug: primaryGroup?.slug ?? null,
        groupLabel: primaryGroup ? groupDisplayName(primaryGroup) : null,
      })
    } catch (error) {
      console.error('People indexing failed for asset', asset.id, error)
      result.skippedAssets += 1
    }
  }

  const updates = groups.filter((group) => group.dirty)
  for (const group of updates) {
    await supabase
      .schema('northvault')
      .from('face_groups')
      .update({
        centroid: group.centroid,
        face_count: group.faceCount,
        image_count: group.imageCount,
        representative_asset_id: group.representativeAssetId,
        representative_face_index: group.representativeFaceIndex,
        representative_face_confidence: group.representativeFaceConfidence,
        updated_at: new Date().toISOString(),
      })
      .eq('id', group.id)
  }

  return result
}

export function formatPeopleGroupName(group: { slug: string; display_name: string | null }) {
  return group.display_name?.trim() || group.slug.replace(/^person-/, 'Person ')
}
