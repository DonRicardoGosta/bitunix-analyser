import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from './config'
import { kvRepo } from './db/repos/kv'

// AES-256-GCM encryption for credentials at rest.
//
// Key resolution:
//   1. CHALLENGE_ENCRYPTION_KEY env (any string) -> sha256-derived 32-byte key.
//   2. Otherwise a random 32-byte key generated once and persisted in `kv`
//      (inside the mounted data volume), so it survives restarts.

const KV_KEY = 'encryption_key'
const PREFIX = 'v1:'

let cachedKey: Buffer | null = null

function resolveKey(): Buffer {
  if (config.encryptionKey) {
    return createHash('sha256').update(config.encryptionKey, 'utf8').digest()
  }
  const stored = kvRepo.get(KV_KEY)
  if (stored) {
    const buf = Buffer.from(stored, 'base64')
    if (buf.length === 32) return buf
  }
  const generated = randomBytes(32)
  kvRepo.set(KV_KEY, generated.toString('base64'))
  return generated
}

function key(): Buffer {
  if (!cachedKey) cachedKey = resolveKey()
  return cachedKey
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(blob: string): string {
  const raw = blob.startsWith(PREFIX) ? blob.slice(PREFIX.length) : blob
  const buf = Buffer.from(raw, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value))
}

export function decryptJson<T>(blob: string): T {
  return JSON.parse(decrypt(blob)) as T
}
