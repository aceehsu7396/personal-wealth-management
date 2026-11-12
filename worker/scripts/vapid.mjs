// Prints a new VAPID key pair for Web Push:
//   node scripts/vapid.mjs
// Put the public key in wrangler.toml (VAPID_PUBLIC_KEY) and store the
// private JWK as a secret: npx wrangler secret put VAPID_PRIVATE_JWK
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
const b64url = (b) => Buffer.from(b).toString('base64url')
console.log('VAPID_PUBLIC_KEY =', b64url(raw))
console.log('VAPID_PRIVATE_JWK =', JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)))
