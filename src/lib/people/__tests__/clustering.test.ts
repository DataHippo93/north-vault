import { describe, expect, it } from 'vitest'
import { averageVectors, bestClusterMatch, cosineSimilarity, makePersonSlug, normalizeVector, updateClusterCentroid } from '../clustering'

describe('people clustering', () => {
  it('normalizes vectors', () => {
    const vector = normalizeVector([3, 4])
    expect(Math.hypot(...vector)).toBeCloseTo(1, 6)
  })

  it('computes cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6)
  })

  it('averages vectors', () => {
    const vector = averageVectors([[1, 0], [0, 1]])
    expect(vector[0]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(vector[1]).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('updates cluster centroids incrementally', () => {
    const centroid = updateClusterCentroid([1, 0], [0, 1], 1)
    expect(Math.hypot(...centroid)).toBeCloseTo(1, 6)
  })

  it('finds a best cluster above threshold', () => {
    const match = bestClusterMatch(
      [1, 0],
      [
        { id: 'a', slug: 'person-001', displayName: null, centroid: [0.99, 0.01], faceCount: 1, imageCount: 1 },
        { id: 'b', slug: 'person-002', displayName: null, centroid: [0, 1], faceCount: 1, imageCount: 1 },
      ],
      0.8,
    )

    expect(match?.cluster.id).toBe('a')
  })

  it('creates stable person slugs', () => {
    expect(makePersonSlug(1)).toBe('person-001')
    expect(makePersonSlug(12)).toBe('person-012')
  })
})
