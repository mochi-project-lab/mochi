// /api/site: trusted list, phishing lists (MetaMask + Phantom, refreshed every 6 h), lookalike check, RDAP age.
import { fetchJson, TTLCache, log } from './lib.js';
import { hostOf, isIp, isLocal, baseDomain, unicode, rdap } from './domain.js';
import { siteSay, persona as normPersona, lang as normLang } from './voice.js';

// subdomains of these are trusted too
export const TRUSTED = [
  'phantom.app', 'phantom.com', 'solflare.com', 'backpack.app', 'backpack.exchange', 'jup.ag', 'jupiter.ag', 'raydium.io', 'pump.fun',
  'axiom.trade', 'gmgn.ai', 'dexscreener.com', 'birdeye.so', 'solscan.io', 'photon-sol.tinyastro.io', 'tinyastro.io', 'bullx.io',
  'meteora.ag', 'orca.so', 'magiceden.io', 'magiceden.us', 'tensor.trade', 'solana.com', 'solana.org', 'solanabeach.io', 'explorer.solana.com',
  'kamino.finance', 'drift.trade', 'marinade.finance', 'sanctum.so', 'coingecko.com', 'coinmarketcap.com', 'metamask.io',
  'coinbase.com', 'binance.com', 'kraken.com', 'okx.com', 'bybit.com', 'uniswap.org', 'opensea.io', 'ledger.com', 'trezor.io',
  'helius.dev', 'helius.xyz', 'pumpportal.fun', 'trojan.app', 'bonk.fun', 'believe.app', 'moonshot.money', 'dextools.io', 'geckoterminal.com',
  'x.com', 'twitter.com', 'google.com', 'github.com', 'youtube.com', 'telegram.org', 't.me', 'discord.com', 'reddit.com',
  'wikipedia.org', 'microsoft.com', 'apple.com', 'amazon.com', 'cloudflare.com', 'openai.com',
  'openrouter.ai', 'tradingview.com', 'medium.com', 'substack.com', 'notion.so', 'linkedin.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'chatgpt.com', 'gmail.com', 'outlook.com', 'stackoverflow.com', 'npmjs.com', 'vercel.app',
];
// brands people get phished as: label → real domain (only these are used for lookalike checks)
const BRANDS = {
  phantom: 'phantom.app', solflare: 'solflare.com', backpack: 'backpack.app', jupiter: 'jup.ag', jup: 'jup.ag', raydium: 'raydium.io',
  pumpfun: 'pump.fun', pump: 'pump.fun', axiom: 'axiom.trade', gmgn: 'gmgn.ai', dexscreener: 'dexscreener.com', birdeye: 'birdeye.so',
  solscan: 'solscan.io', photon: 'photon-sol.tinyastro.io', tinyastro: 'tinyastro.io', bullx: 'bullx.io', meteora: 'meteora.ag',
  orca: 'orca.so', magiceden: 'magiceden.io', tensor: 'tensor.trade', metamask: 'metamask.io', coinbase: 'coinbase.com',
  binance: 'binance.com', uniswap: 'uniswap.org', opensea: 'opensea.io', ledger: 'ledger.com', trezor: 'trezor.io',
  solana: 'solana.com', kamino: 'kamino.finance', marinade: 'marinade.finance', sanctum: 'sanctum.so', coingecko: 'coingecko.com',
  dextools: 'dextools.io', trojan: 'trojan.app',
};

const isTrusted = (host) => TRUSTED.some((d) => host === d || host.endsWith('.' + d));

// ---------- phishing lists ----------
let phishing = new Set();
let listsAt = 0;
let listStats = { metamask: 0, phantom: 0 };
async function refreshLists() {
  const next = new Set();
  const [mm, ph] = await Promise.allSettled([
    fetchJson('https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json', { timeout: 30_000 }),
    fetchJson('https://raw.githubusercontent.com/phantom/blocklist/master/blocklist.yaml', { timeout: 20_000, json: false }),
  ]);
  let a = 0, b = 0;
  const bl = mm.value?.data?.blacklist;
  if (Array.isArray(bl)) for (const d of bl) if (typeof d === 'string') { next.add(d.toLowerCase().trim()); a++; }
  const y = typeof ph.value?.data === 'string' && ph.value.ok ? ph.value.data : '';
  for (const line of y.split(/\r?\n/)) {
    const m = line.match(/^\s*-?\s*(?:url|domain):\s*['"]?([^'"\s#]+)/i);
    if (!m) continue;
    const h = hostOf(m[1])?.host;
    if (h) { next.add(h); b++; }
  }
  if (next.size) {
    // never let a list entry override our trusted domains
    for (const d of next) if (isTrusted(d)) next.delete(d);
    phishing = next; listsAt = Date.now(); listStats = { metamask: a, phantom: b };
  }
  log({ msg: 'phishing lists', metamask: a, phantom: b, total: phishing.size });
}
export function startLists() {
  refreshLists().catch(() => {});
  setInterval(() => refreshLists().catch(() => {}), 6 * 3600_000).unref();
}
export const listState = () => ({ size: phishing.size, at: listsAt, ...listStats });

function onPhishingList(host) {
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) if (phishing.has(parts.slice(i).join('.'))) return true;
  return false;
}

// ---------- lookalikes ----------
const CYR = { '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0458': 'j', '\u0501': 'd', '\u0455': 's', '\u04bb': 'h', '\u04cf': 'l', '\u0261': 'g', '\u03bd': 'v', '\u03bf': 'o', '\u03b1': 'a', '\u03c1': 'p' };
function skeleton(s) {
  let t = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  t = [...t].map((c) => CYR[c] || c).join('');
  return t.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd').replace(/0/g, 'o').replace(/[1i|!]/g, 'l')
    .replace(/3/g, 'e').replace(/5/g, 's').replace(/4/g, 'a').replace(/[-_.]/g, '');
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
export function lookalike(host) {
  if (isTrusted(host)) return null;
  const base = baseDomain(host);
  const uni = unicode(base);
  const label = uni.split('.')[0];
  const raw = base.split('.')[0];
  const sk = skeleton(label);
  // brand domain used as a subdomain: phantom.app.claim-now.com
  for (const real of new Set(Object.values(BRANDS))) {
    if (host.startsWith(real + '.') || host.includes('.' + real + '.')) return { of: real, distance: 0, strong: true };
  }
  // strong = homoglyph / brand token / same name other TLD → always danger.
  // weak = plain edit distance (finance vs binance) → danger only with a wallet button or seed input, else caution.
  let best = null;
  const take = (c) => { if (!best || (c.strong && !best.strong) || (c.strong === best.strong && c.distance < best.distance)) best = c; };
  const tokens = raw.split(/[-_]/);
  for (const [brand, real] of Object.entries(BRANDS)) {
    const realLabel = baseDomain(real).split('.')[0];
    if (raw === realLabel || raw === brand) {
      // same name, other TLD (phantom.io). Short generic words (pump, orca, drift…) are left alone.
      if (base !== baseDomain(real) && brand.length >= 6) take({ of: real, distance: 0, strong: true });
      continue;
    }
    if (sk === skeleton(brand) && label !== brand) { take({ of: real, distance: Math.max(1, lev(label, brand)), strong: true }); continue; } // phantorn, ph4ntom, cyrillic
    // brand as a hyphen token: phantom-wallet.com, claim-jupiter.io
    if (brand.length >= 5 && tokens.length > 1 && tokens.some((t) => t === brand || skeleton(t) === skeleton(brand))) { take({ of: real, distance: 0, strong: true }); continue; }
    if (brand.length < 7 || FALSE_FRIENDS.has(raw)) continue;
    const d = lev(sk, skeleton(brand));
    if (d >= 1 && d <= (brand.length >= 9 ? 2 : 1)) take({ of: real, distance: d, strong: false });
  }
  if (!best && raw.startsWith('xn--')) {
    // punycode whose skeleton contains a brand
    for (const [brand, real] of Object.entries(BRANDS)) if (brand.length >= 5 && sk.includes(skeleton(brand))) return { of: real, distance: 1, strong: true };
  }
  return best;
}
const FALSE_FRIENDS = new Set(['finance', 'photos', 'birdseye', 'ledgers', 'solano', 'tensors', 'opensee', 'orcas', 'binary']);

// ---------- endpoint ----------
const intelCache = new TTLCache(6 * 3600_000, 5000);
async function intel(host) {
  const hit = intelCache.get(host);
  if (hit) return hit;
  const base = baseDomain(host);
  const listed = onPhishingList(host) ? 'phishing' : null;
  const look = lookalike(host);
  const r = await rdap(base).catch(() => null);
  const out = { domain: base, ageDays: r?.ageDays ?? null, registrar: r?.registrar ?? null, listed, lookalike: look };
  intelCache.set(host, out, r?.error && r.error !== 404 ? 10 * 60_000 : undefined);
  return out;
}

export async function checkSite({ url, signals, persona, lang }) {
  const p = normPersona(persona), l = normLang(lang);
  const sig = { walletButton: Boolean(signals?.walletButton), seedInput: Boolean(signals?.seedInput) };
  const h = hostOf(url);
  if (!h) return null;
  const say = (kind, vars = {}) => siteSay(kind, vars, p, l);
  const local = (domain, why) => ({ domain, ageDays: null, registrar: null, listed: null, lookalike: null, risk: 'safe', reasons: [why], say: say('safe') });
  if (!/^https?:$/.test(h.protocol)) return local(h.protocol.replace(':', ''), 'browser page');
  if (!h.host) return local(null, 'no domain');
  if (isIp(h.host) || isLocal(h.host)) return local(h.host, 'local address or ip');
  if (isTrusted(h.host)) {
    const d = baseDomain(h.host);
    return { domain: d, ageDays: null, registrar: null, listed: 'trusted', lookalike: null, risk: 'safe', reasons: ['on the trusted list'], say: say('trusted', { domain: d }) };
  }

  const i = await intel(h.host);
  const reasons = [];
  let risk = 'safe', kind = 'safe';
  const up = (r, k, why) => { reasons.push(why); const rank = { safe: 0, caution: 1, danger: 2 }; if (rank[r] > rank[risk]) { risk = r; kind = k; } };
  if (i.listed === 'phishing') up('danger', 'phishing', 'on a phishing blocklist');
  if (i.lookalike) {
    const why = `looks like ${i.lookalike.of}`;
    up(i.lookalike.strong || sig.walletButton || sig.seedInput ? 'danger' : 'caution', 'lookalike', why);
  }
  if (sig.seedInput) up('danger', 'seed', 'asks for a seed phrase');
  if (i.ageDays != null && sig.walletButton) {
    if (i.ageDays < 7) up('danger', 'new_wallet', `domain is ${i.ageDays} days old and has a wallet button`);
    else if (i.ageDays < 30) up('caution', 'young', `domain is ${i.ageDays} days old and has a wallet button`);
  } else if (i.ageDays != null && i.ageDays < 30) {
    reasons.push(`young domain: ${i.ageDays} days`);
  }
  if (i.ageDays == null && sig.walletButton) reasons.push('domain age unknown');
  if (!reasons.length) reasons.push('no risk signals');
  return {
    domain: i.domain, ageDays: i.ageDays, registrar: i.registrar, listed: i.listed, lookalike: i.lookalike ? { of: i.lookalike.of, distance: i.lookalike.distance } : null, risk, reasons,
    say: say(kind, { age: i.ageDays, of: i.lookalike?.of, dist: i.lookalike?.distance, domain: i.domain }),
  };
}
