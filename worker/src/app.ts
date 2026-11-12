// Sync and push backend for the personal finance site (stage 6), on the
// Cloudflare Workers free plan with one KV namespace.
//
//   GET  /vault/:id      encrypted app data and its version
//   PUT  /vault/:id      replace it; the client sends the version it last saw
//   POST /push/subscribe save this browser's push subscription
//   POST /push/unsubscribe
//   POST /push/test      wake this vault's browsers now
//   cron (trading days)  wake every subscribed browser
//
// The server never sees plaintext: data arrives AES-GCM encrypted, the
// vault id is the SHA-256 of an access token derived from the passphrase,
// and only the token's hash is stored. Pushes carry no payload; the
// browser's service worker builds the notification from its own data.

export interface KV {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(options: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>
}

export interface Env {
  VAULT: KV
  // The site's origin, e.g. https://aceehsu7396.github.io
  SITE_ORIGIN: string
  // VAPID keys: public key as base64url of the raw P-256 point; private key
  // as a JWK (secret); subject as mailto: or https: URL.
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_JWK: string
  VAPID_SUBJECT: string
}

export const MAX_BODY = 10 * 1024 * 1024
export const MIN_WRITE_GAP_MS = 5000
export const MAX_SUBSCRIPTIONS = 10

interface StoredVault {
  tokenHash: string
  version: number
  updatedAt: string
  sealed: { iv: string; data: string }
}

interface PushSubscriptionJSON {
  endpoint: string
  keys?: { p256dh: string; auth: string }
}

const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function cors(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.SITE_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

const json = (env: Env, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(env), 'Content-Type': 'application/json' } })
const text = (env: Env, body: string, status: number) => new Response(body, { status, headers: cors(env) })

// The caller owns a vault when the id is the hash of its token.
async function authorise(req: Request, id: string): Promise<{ token: string; tokenHash: string } | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/, '') ?? ''
  if (token.length < 20) return null
  const tokenHash = await sha256(token)
  return tokenHash.slice(0, 32) === id ? { token, tokenHash } : null
}

async function readBody(req: Request, env: Env): Promise<unknown | Response> {
  const size = Number(req.headers.get('Content-Length') ?? 0)
  if (size > MAX_BODY) return text(env, '資料太大', 413)
  const raw = await req.text()
  if (raw.length > MAX_BODY) return text(env, '資料太大', 413)
  try {
    return JSON.parse(raw)
  } catch {
    return text(env, '格式錯誤', 400)
  }
}

async function vault(req: Request, env: Env, id: string, now: () => number): Promise<Response> {
  const auth = await authorise(req, id)
  if (!auth) return text(env, '未授權', 401)
  const key = `vault:${id}`
  const stored = await env.VAULT.get(key)
  const current = stored ? (JSON.parse(stored) as StoredVault) : null
  if (current && current.tokenHash !== auth.tokenHash) return text(env, '未授權', 401)

  if (req.method === 'GET') {
    if (!current) return text(env, '沒有資料', 404)
    return json(env, { version: current.version, updatedAt: current.updatedAt, sealed: current.sealed })
  }

  const body = await readBody(req, env)
  if (body instanceof Response) return body
  const { sealed, expectedVersion } = body as { sealed?: StoredVault['sealed']; expectedVersion?: number | null }
  if (!sealed || typeof sealed.iv !== 'string' || typeof sealed.data !== 'string') return text(env, '格式錯誤', 400)
  if ((current?.version ?? null) !== (expectedVersion ?? null)) return json(env, { error: 'conflict', version: current?.version ?? null }, 409)
  if (current && now() - Date.parse(current.updatedAt) < MIN_WRITE_GAP_MS) return text(env, '上傳太頻繁', 429)
  const next: StoredVault = { tokenHash: auth.tokenHash, version: (current?.version ?? 0) + 1, updatedAt: new Date(now()).toISOString(), sealed }
  await env.VAULT.put(key, JSON.stringify(next))
  return json(env, { version: next.version, updatedAt: next.updatedAt, sealed })
}

async function subscriptions(req: Request, env: Env, action: string): Promise<Response> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/, '') ?? ''
  if (token.length < 20) return text(env, '未授權', 401)
  const id = (await sha256(token)).slice(0, 32)
  const key = `push:${id}`
  const list = JSON.parse((await env.VAULT.get(key)) ?? '[]') as PushSubscriptionJSON[]
  if (action === 'test') {
    const results = await Promise.all(list.map((s) => sendPush(s, env)))
    return json(env, { sent: results.filter((r) => r.ok).length })
  }
  const body = await readBody(req, env)
  if (body instanceof Response) return body
  const sub = (body as { subscription?: PushSubscriptionJSON }).subscription
  if (!sub?.endpoint?.startsWith('https://')) return text(env, '格式錯誤', 400)
  const others = list.filter((s) => s.endpoint !== sub.endpoint)
  const next = action === 'subscribe' ? [...others, { endpoint: sub.endpoint, keys: sub.keys }].slice(-MAX_SUBSCRIPTIONS) : others
  if (next.length === 0) await env.VAULT.delete(key)
  else await env.VAULT.put(key, JSON.stringify(next))
  return json(env, { subscriptions: next.length })
}

// --- Web Push without payload (RFC 8030 + VAPID, RFC 8292) -------------------

async function vapidJwt(audience: string, env: Env, now: number): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })))
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  // WebCrypto returns the raw r || s signature JWS expects.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)))
  return `${header}.${claims}.${b64url(sig)}`
}

export async function sendPush(sub: PushSubscriptionJSON, env: Env, fetcher: typeof fetch = fetch, now = Date.now()): Promise<{ ok: boolean; gone: boolean }> {
  const jwt = await vapidJwt(new URL(sub.endpoint).origin, env, now)
  const res = await fetcher(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`, TTL: '43200', Urgency: 'normal', 'Content-Length': '0' },
  })
  return { ok: res.ok, gone: res.status === 404 || res.status === 410 }
}

export async function wakeAll(env: Env, fetcher: typeof fetch = fetch): Promise<{ sent: number; removed: number }> {
  let cursor: string | undefined
  let sent = 0
  let removed = 0
  do {
    const page = await env.VAULT.list({ prefix: 'push:', cursor })
    for (const { name } of page.keys) {
      const list = JSON.parse((await env.VAULT.get(name)) ?? '[]') as PushSubscriptionJSON[]
      const results = await Promise.all(list.map((s) => sendPush(s, env, fetcher)))
      sent += results.filter((r) => r.ok).length
      const keep = list.filter((_, i) => !results[i].gone)
      removed += list.length - keep.length
      if (keep.length !== list.length) {
        if (keep.length === 0) await env.VAULT.delete(name)
        else await env.VAULT.put(name, JSON.stringify(keep))
      }
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return { sent, removed }
}

export async function handle(req: Request, env: Env, now: () => number = Date.now): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) })
  const url = new URL(req.url)
  const vaultMatch = url.pathname.match(/^\/vault\/([0-9a-f]{32})$/)
  if (vaultMatch && (req.method === 'GET' || req.method === 'PUT')) return vault(req, env, vaultMatch[1], now)
  const pushMatch = url.pathname.match(/^\/push\/(subscribe|unsubscribe|test)$/)
  if (pushMatch && req.method === 'POST') return subscriptions(req, env, pushMatch[1])
  if (url.pathname === '/' && req.method === 'GET') return json(env, { ok: true, vapidPublicKey: env.VAPID_PUBLIC_KEY })
  return text(env, '找不到', 404)
}
