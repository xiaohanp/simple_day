// End-to-end encryption of the synced plan, keyed by the user's secret key.
//
//   master = PBKDF2-SHA256(secret, salt "simpleday-v1", 600k iterations, 32 bytes)
//   auth   = hex(HMAC-SHA256(master, "auth"))  -> sent as X-Key; the worker stores only its hash
//   encKey =     HMAC-SHA256(master, "enc")    -> AES-256-GCM key, never leaves the device
//
// Envelope stored on the worker: { v: 1, iv: base64(12 bytes), ct: base64(ciphertext + 16-byte tag) }
// The same scheme is implemented in the macOS widget (Swift) and the sync script (Python),
// so keep all three in step if anything here changes.

const te = new TextEncoder();
const td = new TextDecoder();
const SALT = 'simpleday-v1';
const ITERATIONS = 600000;

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function derive(secret) {
  const s = crypto.subtle;
  const base = await s.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const master = await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(SALT), iterations: ITERATIONS }, base, 256);
  const prf = await s.importKey('raw', master, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const auth = hex(await s.sign('HMAC', prf, te.encode('auth')));
  const encRaw = await s.sign('HMAC', prf, te.encode('enc'));
  const key = await s.importKey('raw', encRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { auth, key };
}

// PBKDF2 is deliberately slow, so derive once per secret and reuse.
const cache = new Map();
export function deriveKeys(secret) {
  if (!cache.has(secret)) {
    const p = derive(secret);
    p.catch(() => cache.delete(secret));
    cache.set(secret, p);
  }
  return cache.get(secret);
}

export async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
  return { v: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function unseal(key, env) {
  if (!env || env.v !== 1) throw new Error('unknown encryption format');
  let pt;
  try {
    pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct));
  } catch {
    throw new Error('could not decrypt: is the secret key the same as on your other devices?');
  }
  return JSON.parse(td.decode(pt));
}
