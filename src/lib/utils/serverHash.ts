import { createHash } from 'crypto'

/**
 * Computes SHA-256 hash of a Buffer (server-side).
 * Returns hex string.
 */
export function computeSHA256Server(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
