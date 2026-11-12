import { describe, expect, it } from 'vitest'
import { handle, MAX_BODY, wakeAll, type Env, type KV } from './app'

function memoryKv(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
    list: async ({ prefix }) => ({ keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  }
}

async function vapidEnv(kv: KV): Promise<Env> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  return { VAULT: kv, SITE_ORIGIN: 'https://example.github.io', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_JWK: JSON.stringify(jwk), VAPID_SUBJECT: 'mailto:test@example.com' }
}

const hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const TOKEN = 'a'.repeat(43)
const req = (method: string, path: string, body?: unknown, token = TOKEN) =>
  new Request(`https://worker.test${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const sealed = { iv: 'iv', data: 'cipher' }

describe('vault', () => {
  it('creates, reads and versions a vault for the token that owns it', async () => {
    const kv = memoryKv()
    const env = await vapidEnv(kv)
    const id = (await hex(TOKEN)).slice(0, 32)
    let t = 1_000_000
    const now = () => t
    expect((await handle(req('GET', `/vault/${id}`), env, now)).status).toBe(404)
    const created = await handle(req('PUT', `/vault/${id}`, { sealed, expectedVersion: null }), env, now)
    expect(created.status).toBe(200)
    expect(((await created.json()) as { version: number }).version).toBe(1)
    expect(kv.data.get(`vault:${id}`)).not.toContain(TOKEN)
    // Too soon, then a stale version, then the right one.
    expect((await handle(req('PUT', `/vault/${id}`, { sealed, expectedVersion: 1 }), env, now)).status).toBe(429)
    t += 10_000
    expect((await handle(req('PUT', `/vault/${id}`, { sealed, expectedVersion: 0 }), env, now)).status).toBe(409)
    expect((await handle(req('PUT', `/vault/${id}`, { sealed, expectedVersion: 1 }), env, now)).status).toBe(200)
    const got = (await (await handle(req('GET', `/vault/${id}`), env, now)).json()) as { version: number; sealed: unknown }
    expect(got).toMatchObject({ version: 2, sealed })
  })

  it('refuses another token, a short token and an oversized body', async () => {
    const env = await vapidEnv(memoryKv())
    const id = (await hex(TOKEN)).slice(0, 32)
    expect((await handle(req('GET', `/vault/${id}`, undefined, 'b'.repeat(43)), env)).status).toBe(401)
    expect((await handle(req('GET', `/vault/${id}`, undefined, 'short'), env)).status).toBe(401)
    const big = new Request(`https://worker.test/vault/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Length': String(MAX_BODY + 1) }, body: 'x' })
    expect((await handle(big, env)).status).toBe(413)
  })

  it('answers CORS preflight for the site only', async () => {
    const env = await vapidEnv(memoryKv())
    const res = await handle(new Request('https://worker.test/vault/x', { method: 'OPTIONS' }), env)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.github.io')
  })
})

describe('push', () => {
  it('stores subscriptions, wakes them with a VAPID token and drops gone ones', async () => {
    const kv = memoryKv()
    const env = await vapidEnv(kv)
    const sub = (n: number) => ({ subscription: { endpoint: `https://push.example.com/${n}`, keys: { p256dh: 'k', auth: 'a' } } })
    expect((await handle(req('POST', '/push/subscribe', sub(1)), env)).status).toBe(200)
    await handle(req('POST', '/push/subscribe', sub(2)), env)
    await handle(req('POST', '/push/subscribe', sub(2)), env)
    const calls: { url: string; auth: string }[] = []
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: String((init.headers as Record<string, string>).Authorization) })
      return new Response(null, { status: url.endsWith('/2') ? 410 : 201 })
    }) as unknown as typeof fetch
    const r = await wakeAll(env, fetcher)
    expect(r).toEqual({ sent: 1, removed: 1 })
    expect(calls).toHaveLength(2)
    expect(calls[0].auth).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=pub$/)
    expect((await handle(req('POST', '/push/unsubscribe', sub(1)), env)).status).toBe(200)
    expect([...kv.data.keys()].filter((k) => k.startsWith('push:'))).toEqual([])
  })
})
