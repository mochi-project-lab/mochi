// Notable traders in a coin.
// Who counts as notable: pump.fun's PnL leaderboards (top 100 of the day, week and month, with usernames and X handles),
// refreshed every 30 min. Which of them hold the coin: every holder of the mint from Helius DAS getTokenAccounts
// (1000 per page) intersected with that list. GMGN adds how many smart-money and renowned (KOL) wallets hold it.
import crypto from 'node:crypto';
import { fetchJson, TTLCache, cached, num, round, log } from './lib.js';

const PUMP = 'https://frontend-api-v3.pump.fun';
const PUMP_HEADERS = { origin: 'https://pump.fun', referer: 'https://pump.fun/' };
const PERIODS = ['daily', 'weekly', 'monthly'];
const REFRESH_MS = 30 * 60_000;
const MAX_PAGES = 8; // ≤ 8,000 holders read per coin
const MIN_POSITION_USD = 25;

let known = new Map(); // wallet → {wallet, name, x, verified, pnl: {daily, weekly, monthly}}
let knownAt = 0;
let loading = null;

async function loadKnown() {
  const lists = await Promise.allSettled(PERIODS.map((p) => fetchJson(`${PUMP}/pnl-leaderboard?period=${p}&limit=100`, { headers: PUMP_HEADERS, timeout: 10_000 })));
  const next = new Map();
  lists.forEach((r, i) => {
    for (const e of (r.status === 'fulfilled' && r.value.ok && r.value.data?.entries) || []) {
      if (!e?.walletAddress) continue;
      const k = next.get(e.walletAddress) || { wallet: e.walletAddress, name: null, x: null, verified: false, pnl: {} };
      k.name = k.name || e.username || null;
      k.x = k.x || e.xUsername || null;
      k.verified = k.verified || Boolean(e.isVerified);
      k.pnl[PERIODS[i]] = { usd: Math.round(num(e.pnlUsd) || 0), rank: num(e.rank) };
      next.set(e.walletAddress, k);
    }
  });
  if (next.size) { known = next; knownAt = Date.now(); }
  log({ msg: 'notable traders', count: next.size, withX: [...next.values()].filter((k) => k.x).length });
}

export function startTraders() {
  const tick = () => { loading = loadKnown().catch(() => {}).finally(() => { loading = null; }); };
  tick();
  setInterval(tick, REFRESH_MS).unref();
}
export const tradersInfo = () => ({ known: known.size, at: knownAt });

async function rpc(method, params) {
  const url = process.env.SOLANA_RPC_URL;
  if (!url) return null;
  const r = await fetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method, params }, timeout: 8000 });
  return r.ok ? r.data?.result ?? null : null;
}

// owner → raw amount, for every holder (up to MAX_PAGES pages)
async function allHolders(mint) {
  const owners = new Map();
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await rpc('getTokenAccounts', { mint, limit: 1000, page });
    const accs = res?.token_accounts;
    if (!Array.isArray(accs)) return owners.size ? { owners, complete: false } : null;
    for (const a of accs) if (a.owner && a.amount > 0) owners.set(a.owner, (owners.get(a.owner) || 0) + Number(a.amount));
    if (accs.length < 1000) { complete = true; break; }
  }
  return { owners, complete };
}

async function gmgnCounts(mint) {
  const qs = new URLSearchParams({ chain: 'sol', address: mint, timestamp: String(Math.floor(Date.now() / 1000)), client_id: crypto.randomUUID() });
  const r = await fetchJson(`https://openapi.gmgn.ai/v1/token/info?${qs}`, { headers: { 'X-APIKEY': process.env.GMGN_API_KEY || 'gmgn_solbscbaseethmonadtron' }, timeout: 8000 });
  const w = r.ok ? r.data?.data?.wallet_tags_stat : null;
  if (!w) return null;
  return { smart: num(w.smart_wallets), renowned: num(w.renowned_wallets), snipers: num(w.sniper_wallets), whales: num(w.whale_wallets) };
}

const cache = new TTLCache(2 * 60_000);
// supplyUi / decimals / priceUsd are optional: used to show % of supply and $ value per holder
export const notableIn = cached(cache, async (mint, { decimals, supplyUi, priceUsd } = {}) => {
  if (!known.size && loading) await loading;
  const [hR, gR] = await Promise.allSettled([allHolders(mint), gmgnCounts(mint)]);
  const h = hR.value || null;
  const list = [];
  if (h) {
    for (const [owner, raw] of h.owners) {
      const k = known.get(owner);
      if (!k) continue;
      const ui = decimals != null ? raw / 10 ** decimals : null;
      // dust and airdrops are not a position: need $25+ (or 0.005%+ of supply when there's no price)
      if (ui != null && priceUsd ? ui * priceUsd < MIN_POSITION_USD : ui != null && supplyUi ? ui / supplyUi < 0.00005 : false) continue;
      const best = PERIODS.map((p) => k.pnl[p] && { period: p, ...k.pnl[p] }).filter(Boolean).sort((a, b) => b.usd - a.usd)[0];
      list.push({
        wallet: owner, name: k.name, x: k.x, verified: k.verified,
        pnlUsd: best?.usd ?? null, pnlPeriod: best?.period === 'daily' ? 'today' : best?.period === 'weekly' ? 'this week' : best ? 'this month' : null,
        rank: best?.rank ?? null,
        holdsPct: ui != null && supplyUi ? round((ui / supplyUi) * 100, 3) : null,
        valueUsd: ui != null && priceUsd ? Math.round(ui * priceUsd) : null,
      });
    }
    list.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0) || (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0));
  }
  return {
    holdersChecked: h ? h.owners.size : null,
    allHoldersChecked: h ? h.complete : null,
    knownTraders: known.size,
    list: list.slice(0, 12),
    count: list.length,
    gmgn: gR.value || null,
  };
}, (v) => (v.holdersChecked == null ? 20_000 : undefined));
