// Small shared helpers: env loader, fetch with timeout, TTL cache, rate limiter, logger. Zero dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(SERVER_DIR, '..');

// KEY=value lines, # comments, optional quotes. Real environment variables win over the file.
export function loadEnv(file = path.join(SERVER_DIR, '.env')) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// fetch → {status, ok, data} ; never throws. data = parsed JSON (or text when json:false), null on failure.
export async function fetchJson(url, { method = 'GET', headers = {}, body, timeout = 6000, json = true } = {}) {
  try {
    const r = await fetch(url, {
      method,
      headers: { 'user-agent': UA, accept: json ? 'application/json' : '*/*', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow',
    });
    const text = await r.text();
    let data = text;
    if (json) { try { data = JSON.parse(text); } catch { data = null; } }
    return { status: r.status, ok: r.ok, data };
  } catch (err) {
    return { status: 0, ok: false, data: null, error: err?.name === 'TimeoutError' ? 'timeout' : String(err?.message || err) };
  }
}

export class TTLCache {
  constructor(ttlMs, max = 5000) { this.ttl = ttlMs; this.max = max; this.map = new Map(); }
  get(k) {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (Date.now() > e.exp) { this.map.delete(k); return undefined; }
    return e.v;
  }
  set(k, v, ttl = this.ttl) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(k, { v, exp: Date.now() + ttl, at: Date.now() });
    return v;
  }
  at(k) { return this.map.get(k)?.at || 0; }
}

// memoize an async loader in a cache, and share one in-flight promise per key
// ttlOf(value) may return a shorter TTL (e.g. for failures) so a timeout isn't remembered for hours
export function cached(cache, loader, ttlOf) {
  const inflight = new Map();
  return (key, ...args) => {
    const hit = cache.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.resolve().then(() => loader(key, ...args)).then((v) => { cache.set(key, v, ttlOf?.(v) ?? cache.ttl); return v; })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

// fixed-window limiter per ip+bucket
export function createLimiter() {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now > v.reset) hits.delete(k); }, 60_000).unref();
  return (key, limit, windowMs = 60_000) => {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || now > e.reset) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
    e.n++;
    return e.n <= limit;
  };
}

export const log = (obj) => { try { console.log(JSON.stringify({ t: new Date().toISOString(), ...obj })); } catch {} };

export const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
export const round = (v, d = 0) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const isSolAddress = (s) => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
