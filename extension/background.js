// Mochi background: the only place that talks to the backend. Chrome (service worker) and Firefox (event page).
/* global PetCommon */
if (typeof importScripts === 'function' && !globalThis.PetCommon) importScripts('common.js');

const api = globalThis.browser || globalThis.chrome;
const { withDefaults, cleanBackend } = PetCommon;

const SCAN_TTL = 3 * 60 * 1000;
const SITE_TTL = 6 * 60 * 60 * 1000;
const HISTORY_MAX = 10;

const scanCache = new Map(); // key -> {at, data}
const inflight = new Map();

async function settings() {
  const s = await api.storage.local.get(null);
  return withDefaults(s);
}

async function call(path, body, s) {
  s = s || (await settings());
  const headers = { 'Content-Type': 'application/json' };
  if (s.orKey) headers['X-OpenRouter-Key'] = s.orKey;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(cleanBackend(s.backend) + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await r.json(); } catch (e) { /* not json */ }
    if (!r.ok) return { error: (data && data.error) || 'server said ' + r.status, status: r.status };
    return data || { error: 'empty answer' };
  } catch (e) {
    return { error: e && e.name === 'AbortError' ? 'timeout' : 'backend unreachable', offline: true };
  } finally {
    clearTimeout(t);
  }
}

function voice(s) {
  return { lang: 'en', persona: s.persona, petName: s.petName };
}

async function scan(address, force) {
  const s = await settings();
  const key = [address, s.persona, s.petName].join('|');
  const hit = scanCache.get(key);
  if (!force && hit && Date.now() - hit.at < SCAN_TTL) return Object.assign({}, hit.data, { fromCache: true });
  if (inflight.has(key)) return inflight.get(key);
  const p = call('/api/token', Object.assign({ address }, voice(s)), s).then((data) => {
    inflight.delete(key);
    if (data && !data.error) {
      scanCache.set(key, { at: Date.now(), data });
      if (scanCache.size > 200) scanCache.delete(scanCache.keys().next().value);
    }
    return data;
  });
  inflight.set(key, p);
  return p;
}

function domainOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; }
}

async function siteCheck(url, signals, force) {
  const s = await settings();
  const domain = domainOf(url);
  if (!domain) return { error: 'bad url' };
  const key = 'site:' + domain + '|' + s.persona;
  if (!force) {
    const got = await api.storage.session.get(key);
    const hit = got[key];
    if (hit && Date.now() - hit.at < SITE_TTL) return Object.assign({}, hit.data, { fromCache: true });
  }
  // Only the origin is sent, never the full path or query.
  let origin = url;
  try { origin = new URL(url).origin + '/'; } catch (e) { /* keep */ }
  const data = await call('/api/site', Object.assign({ url: origin, signals: signals || undefined }, voice(s)), s);
  if (data && !data.error) await api.storage.session.set({ [key]: { at: Date.now(), data } });
  return data;
}

async function chat(tabId, messages, page) {
  const s = await settings();
  return call('/api/chat', Object.assign({ messages, page }, voice(s)), s);
}

// Per-tab chat history (last 10 items) in session storage, cleared when the tab closes.
async function history(tabId) {
  const k = 'hist:' + tabId;
  const got = await api.storage.session.get(k);
  return got[k] || [];
}
let histChain = Promise.resolve();
function pushHistory(tabId, item) {
  // Serialized so two quick messages never overwrite each other.
  const run = async () => {
    const k = 'hist:' + tabId;
    const list = (await history(tabId)).concat([item]).slice(-HISTORY_MAX);
    await api.storage.session.set({ [k]: list });
    return { ok: true, n: list.length };
  };
  histChain = histChain.then(run, run);
  return histChain;
}

async function offeredOnce(coin) {
  const k = 'offered:' + coin;
  const got = await api.storage.session.get(k);
  if (got[k]) return false;
  await api.storage.session.set({ [k]: 1 });
  return true;
}

const handlers = {
  scan: (m) => scan(String(m.address || ''), !!m.force),
  site: (m) => siteCheck(String(m.url || ''), m.signals, !!m.force),
  chat: (m, tabId) => chat(tabId, m.messages || [], m.page || null),
  health: () => call('/api/health'),
  history: (m, tabId) => history(tabId),
  pushHistory: (m, tabId) => pushHistory(tabId, m.item),
  clearHistory: async (m, tabId) => { await api.storage.session.remove('hist:' + tabId); return { ok: true }; },
  offerOnce: (m) => offeredOnce(String(m.coin || '')),
  getFlag: async (m) => { const k = 'flag:' + String(m.key || ''); const g = await api.storage.session.get(k); return g[k] === true; },
  setFlag: async (m) => { await api.storage.session.set({ ['flag:' + String(m.key || '')]: true }); return { ok: true }; },
  openOptions: async () => { await api.runtime.openOptionsPage(); return { ok: true }; },
};

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = msg && handlers[msg.type];
  if (!h) return false;
  // Only our own content scripts and pages talk to us.
  if (sender.id && sender.id !== api.runtime.id) return false;
  const tabId = sender.tab ? sender.tab.id : msg.tabId;
  Promise.resolve()
    .then(() => h(msg, tabId))
    .then((r) => sendResponse(r), (e) => sendResponse({ error: String((e && e.message) || e) }));
  return true;
});

api.tabs.onRemoved.addListener((tabId) => {
  api.storage.session.remove('hist:' + tabId).catch(() => {});
});

api.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-panel') return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) api.tabs.sendMessage(tab.id, { type: 'togglePanel' }).catch(() => {});
});

api.runtime.onInstalled.addListener(async (d) => {
  if (d.reason === 'update') { await api.storage.local.remove('lang').catch(() => {}); return; }
  if (d.reason !== 'install') return;
  const s = await api.storage.local.get(null);
  await api.storage.local.set(withDefaults(s));
});
