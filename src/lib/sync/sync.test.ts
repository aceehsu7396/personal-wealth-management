import { describe, expect, it } from 'vitest'
import { deriveKeys, open, seal } from './crypto'
import { decide, isBlank } from './sync'

// Fewer iterations keep the tests fast; the scheme is the same.
const FAST = 1000

describe('vault crypto', () => {
  it('derives the same keys from the same passphrase', async () => {
    const a = await deriveKeys('correct horse battery', FAST)
    const b = await deriveKeys('correct horse battery', FAST)
    expect(a.vaultId).toBe(b.vaultId)
    expect(a.token).toBe(b.token)
    expect(a.vaultId).toHaveLength(32)
    expect((await deriveKeys('another long phrase!', FAST)).vaultId).not.toBe(a.vaultId)
  })

  it('rejects short passphrases', async () => {
    await expect(deriveKeys('short')).rejects.toThrow('至少 12')
  })

  it('round-trips, fails with the wrong key, and detects tampering', async () => {
    const k = await deriveKeys('correct horse battery', FAST)
    const sealed = await seal(k.aesKey, '{"trades":[1,2,3]}')
    expect(await open(k.aesKey, sealed)).toBe('{"trades":[1,2,3]}')
    const wrong = await deriveKeys('wrong horse battery!', FAST)
    await expect(open(wrong.aesKey, sealed)).rejects.toThrow()
    const tampered = { ...sealed, data: sealed.data.slice(0, -2) + (sealed.data.endsWith('A') ? 'BB' : 'AA') }
    await expect(open(k.aesKey, tampered)).rejects.toThrow()
  })
})

describe('sync decisions', () => {
  const state = { version: 3, hash: 'h1', at: '' }
  it('uploads a first copy and local changes', () => {
    expect(decide(null, null, 'h1')).toBe('upload')
    expect(decide(3, state, 'h2')).toBe('upload')
  })
  it('downloads newer remote data when nothing changed here', () => {
    expect(decide(4, state, 'h1')).toBe('download')
    expect(decide(3, state, 'h1')).toBe('none')
  })
  it('asks when both changed, or this device never synced and has its own data', () => {
    expect(decide(4, state, 'h2')).toBe('conflict')
    expect(decide(1, null, 'h1')).toBe('conflict')
    expect(decide(1, null, 'h1', true)).toBe('download')
  })

  it('treats a device without trades, holdings, cards or plans as blank', () => {
    expect(isBlank('')).toBe(true)
    expect(isBlank(JSON.stringify({ state: { trades: [], holdings: [] } }))).toBe(true)
    expect(isBlank(JSON.stringify({ state: { trades: [{ id: 1 }] } }))).toBe(false)
  })
})
