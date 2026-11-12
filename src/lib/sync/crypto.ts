// End-to-end encryption for cross-device sync (stage 6). The passphrase
// never leaves the browser: PBKDF2 turns it into 512 bits, the first half
// an AES-256-GCM key, the second half an access token. The server stores
// only ciphertext and a hash of the token, and the vault id is the token's
// SHA-256, so neither reveals the passphrase or the data.

export const PBKDF2_ITERATIONS = 310_000
export const MIN_PASSPHRASE = 12
// Fixed per app: one user, one vault per passphrase.
const SALT = new TextEncoder().encode('pfm-sync-v1')

export interface VaultKeys {
  aesKey: CryptoKey
  token: string
  vaultId: string
  // Raw AES key, kept only when the trader asks to remember this device.
  rawKey: string
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

export async function deriveKeys(passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<VaultKeys> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`密語至少 ${MIN_PASSPHRASE} 個字`)
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: SALT, iterations }, base, 512))
  const raw = bits.slice(0, 32)
  const token = b64url(bits.slice(32))
  return { aesKey: await importAesKey(raw), token, vaultId: (await sha256Hex(token)).slice(0, 32), rawKey: b64url(raw) }
}

export const importAesKey = (raw: Uint8Array) => crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])

export interface Sealed {
  iv: string
  data: string
}

export async function seal(key: CryptoKey, plaintext: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)))
  return { iv: b64url(iv), data: b64url(data) }
}

// Throws when the key is wrong or the ciphertext was changed.
export async function open(key: CryptoKey, sealed: Sealed): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(sealed.iv) as BufferSource }, key, fromB64url(sealed.data) as BufferSource)
  return new TextDecoder().decode(plain)
}
