// Mochi server: static site + /api/{health,token,site,chat}. Node 24, zero dependencies.
// Start: node server/index.js (from Mochi/) or node index.js (from server/).
import { intelInfo } from './intel.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, SERVER_DIR, ROOT_DIR, createLimiter, log, isSolAddress } from './lib.js';

loadEnv();
const { scanToken } = await import('./token.js');
const { startTraders, tradersInfo } = await import('./traders.js');
const { apiChat: apiChatGrounded } = await import('./chat.js');
const { checkSite, startLists } = await import('./site.js');
const { chat, llmAvailable } = await import('./llm.js');
const { chatFallback, tidy, persona: normPersona, lang: normLang, petName: normName } = await import('./voice.js');

const VERSION = '0.1.0';
const PORT = Number(process.env.PORT) || 4400;
const BODY_LIMIT = 64 * 1024;
const SITE_DIR = path.join(ROOT_DIR, 'site');
const SHARED_DIR = path.join(ROOT_DIR, 'shared');
const DL_DIRS = [path.join(SERVER_DIR, 'public-dl'), path.join(ROOT_DIR, 'dist')];
const LIMITS = { token: 30, site: 60, chat: 20 };
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const limited = createLimiter();
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4',
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-openrouter-key',
  'access-control-max-age': '86400',
};

function send(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS, ...extra });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(j && typeof j === 'object' ? j : {}); }
      catch { reject(Object.assign(new Error('invalid json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function ipOf(req) {
  if (TRUST_PROXY) { const f = req.headers['x-forwarded-for']; if (f) return String(f).split(',')[0].trim(); }
  return req.socket.remoteAddress || '?';
}

// static file under a root; null when missing or outside the root
function fileIn(root, rel) {
  let p;
  try { p = path.resolve(root, '.' + path.posix.normalize('/' + decodeURIComponent(rel))); } catch { return null; }
  if (!p.startsWith(path.resolve(root))) return null;
  try {
    let st = fs.statSync(p);
    if (st.isDirectory()) { p = path.join(p, 'index.html'); st = fs.statSync(p); }
    return st.isFile() ? { p, size: st.size } : null;
  } catch { return null; }
}
function serveFile(req, res, f, cache = 'public, max-age=300') {
  const type = TYPES[path.extname(f.p).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-length': f.size, 'cache-control': cache, 'x-content-type-options': 'nosniff', ...(type.startsWith('text/javascript') ? CORS : {}) });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(f.p).on('error', () => res.destroy()).pipe(res);
}
function notFound(res) {
  const f = fileIn(SITE_DIR, '/404.html');
  if (f) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); return fs.createReadStream(f.p).pipe(res); }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

// ---------- api ----------
const userKeyOf = (req) => {
  const k = req.headers['x-openrouter-key'];
  return typeof k === 'string' && /^[\w-]{20,200}$/.test(k.trim()) ? k.trim() : null;
};

async function apiToken(req, res, body) {
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  if (!isSolAddress(address)) return send(res, 400, { error: 'address must be a solana mint or pair address' });
  const out = await scanToken({ address, persona: body.persona, lang: body.lang, petName: body.petName }, userKeyOf(req));
  if (!out) return send(res, 404, { error: 'no token or pair found for this address' });
  send(res, 200, out);
}

async function apiSite(req, res, body) {
  const url = typeof body.url === 'string' ? body.url.slice(0, 2048) : '';
  if (!url) return send(res, 400, { error: 'url required' });
  const out = await checkSite({ url, signals: body.signals, persona: body.persona, lang: body.lang });
  if (!out) return send(res, 400, { error: 'invalid url' });
  send(res, 200, out);
}

async function apiChat(req, res, body) {
  const p = normPersona(body.persona), l = normLang(body.lang), name = normName(body.petName);
  const msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
    .slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return send(res, 400, { error: 'messages must end with a user message' });
  const userKey = userKeyOf(req);
  if (!llmAvailable(userKey)) return send(res, 200, { reply: chatFallback(p, l, name), llm: false });
  const page = body.page && typeof body.page === 'object' ? body.page : null;
  const { text } = await apiChatGrounded({ messages: msgs, page, persona: p, lang: l, petName: name, userKey });
  if (!text) return send(res, 200, { reply: chatFallback(p, l, name), llm: false });
  send(res, 200, { reply: text, llm: true });
}


// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const u = new URL(req.url || '/', 'http://x');
  const pathname = u.pathname;
  res.on('finish', () => log({ m: req.method, p: pathname.slice(0, 120), s: res.statusCode, ms: Date.now() - t0 }));
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, llm: llmAvailable(), version: VERSION, intel: intelInfo(), traders: tradersInfo() });
      const route = { '/api/token': 'token', '/api/site': 'site', '/api/chat': 'chat' }[pathname];
      if (!route) return send(res, 404, { error: 'unknown endpoint' });
      if (req.method !== 'POST') return send(res, 405, { error: 'use POST' }, { allow: 'POST, OPTIONS' });
      if (!limited(`${ipOf(req)}|${route}`, LIMITS[route])) return send(res, 429, { error: 'slow down: too many requests' }, { 'retry-after': '60' });
      const body = await readBody(req);
      if (route === 'token') return await apiToken(req, res, body);
      if (route === 'site') return await apiSite(req, res, body);
      return await apiChat(req, res, body);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
    if (pathname === '/shared/sprite.js') {
      const f = fileIn(SHARED_DIR, '/sprite.js');
      return f ? serveFile(req, res, f, 'public, max-age=3600') : notFound(res);
    }
    if (pathname.startsWith('/download/')) {
      const name = path.basename(pathname);
      for (const d of DL_DIRS) {
        const f = fileIn(d, '/' + name);
        if (f) { res.setHeader('content-disposition', `attachment; filename="${name}"`); return serveFile(req, res, f, 'no-cache'); }
      }
      return notFound(res);
    }
    let f = fileIn(SITE_DIR, pathname);
    if (!f && !path.extname(pathname)) f = fileIn(SITE_DIR, pathname.replace(/\/$/, '') + '.html'); // /privacy → privacy.html
    if (f) return serveFile(req, res, f);
    return notFound(res);
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'internal error' });
    else res.destroy();
    if (!err.status) log({ m: req.method, p: pathname.slice(0, 120), err: String(err?.message || err).slice(0, 200) });
  }
});
server.requestTimeout = 60_000;
server.headersTimeout = 15_000;

process.on('unhandledRejection', (e) => log({ msg: 'unhandledRejection', err: String(e?.message || e).slice(0, 200) }));
process.on('uncaughtException', (e) => log({ msg: 'uncaughtException', err: String(e?.message || e).slice(0, 200) }));

server.listen(PORT, () => {
  log({ msg: 'pet server up', port: PORT, version: VERSION, llm: llmAvailable(), x: Boolean(process.env.TWITTERAPI_KEY), rpc: process.env.SOLANA_RPC_URL ? 'custom' : 'public' });
  startLists();
  startTraders();
});
