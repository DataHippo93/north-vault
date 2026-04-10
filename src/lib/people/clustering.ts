export interface FaceClusterState {
  id: string
  slug: string
  displayName: string | null
  centroid: number[]
  faceCount: number
  imageCount: number
}

export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(magnitude) || magnitude === 0) return vector.map(() => 0)
  return vector.map((value) => value / magnitude)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  if (length === 0) return -1

  let dot = 0
  let magA = 0
  let magB = 0

  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }

  if (magA === 0 || magB === 0) return -1
  return dot / Math.sqrt(magA * magB)
}

export function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return []
  const length = vectors[0]?.length ?? 0
  const totals = Array.from({ length }, () => 0)

  for (const vector of vectors) {
    for (let i = 0; i < length; i += 1) {
      totals[i] += vector[i] ?? 0
    }
  }

  return normalizeVector(totals.map((value) => value / vectors.length))
}

export function updateClusterCentroid(centroid: number[], embedding: number[], count: number): number[] {
  if (count <= 0 || centroid.length === 0) return normalizeVector([...embedding])

  const next = centroid.map((value, index) => (value * count + (embedding[index] ?? 0)) / (count + 1))
  return normalizeVector(next)
}

export function bestClusterMatch(
  embedding: number[],
  clusters: FaceClusterState[],
  threshold: number,
): { cluster: FaceClusterState; similarity: number } | null {
  let best: { cluster: FaceClusterState; similarity: number } | null = null

  for (const cluster of clusters) {
    const similarity = cosineSimilarity(embedding, cluster.centroid)
    if (similarity < threshold) continue
    if (!best || similarity > best.similarity) {
      best = { cluster, similarity }
    }
  }

  return best
}

export function makePersonSlug(nextIndex: number): string {
  return `person-${String(nextIndex).padStart(3, '0')}`
}
