import { describe, it, expect, vi } from 'vitest'
import { computeSHA256, computeSHA256FromBuffer, checkDuplicate } from '../fileHash'

describe('computeSHA256', () => {
  it('returns a 64-character hex string', async () => {
    const content = new TextEncoder().encode('hello world')
    const file = new File([content], 'test.txt', { type: 'text/plain' })
    const hash = await computeSHA256(file)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('produces deterministic hashes for the same content', async () => {
    const content = 'deterministic content'
    const file1 = new File([content], 'a.txt')
    const file2 = new File([content], 'b.txt')
    const [hash1, hash2] = await Promise.all([computeSHA256(file1), computeSHA256(file2)])
    expect(hash1).toBe(hash2)
  })

  it('produces different hashes for different content', async () => {
    const file1 = new File(['content one'], 'a.txt')
    const file2 = new File(['content two'], 'b.txt')
    const [hash1, hash2] = await Promise.all([computeSHA256(file1), computeSHA256(file2)])
    expect(hash1).not.toBe(hash2)
  })

  it('matches the known SHA-256 for empty string', async () => {
    const file = new File([''], 'empty.txt')
    const hash = await computeSHA256(file)
    // SHA-256 of empty string
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('computeSHA256FromBuffer', () => {
  it('returns a 64-character hex string', async () => {
    const buffer = new TextEncoder().encode('test data').buffer
    const hash = await computeSHA256FromBuffer(buffer)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  it('matches computeSHA256 output for same content', async () => {
    const content = 'matching content'
    const file = new File([content], 'test.txt')
    const buffer = new TextEncoder().encode(content).buffer

    const [hashFromFile, hashFromBuffer] = await Promise.all([computeSHA256(file), computeSHA256FromBuffer(buffer)])
    expect(hashFromFile).toBe(hashFromBuffer)
  })
})

describe('checkDuplicate', () => {
  it('returns null when no duplicate exists', async () => {
    const mockSupabase = {
      schema: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkDuplicate(mockSupabase as any, 'abc123')
    expect(result).toBeNull()
  })

  it('returns existing asset when duplicate found', async () => {
    const existing = { id: 'asset-1', file_name: 'photo.jpg' }
    const mockSupabase = {
      schema: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkDuplicate(mockSupabase as any, 'abc123')
    expect(result).toEqual(existing)
  })

  it('returns null on database error', async () => {
    const mockSupabase = {
      schema: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await checkDuplicate(mockSupabase as any, 'abc123')
    expect(result).toBeNull()
  })
})
