// Dev track records and coin history from data/intel.db (built by scripts/import-dev-data.mjs from an indexer dump),
// plus live pump.fun holder stats: traders' fees, snipers, bundlers.
//
// Fees are the best "real traders?" marker: a bundle can paint any ATH but can't fake hundreds of people paying fees.
// Coins with real traders pay 10+ SOL per $100K of ATH; painted charts (dev buys the curve, migrates, dumps) under 1.
import fs from 'node:fs';
import path from 'node:path';
import { fetchJson, TTLCache, cached, num, round } from './lib.js';

const DB_PATH = path.join(import.meta.dirname, 'data', 'intel.db');
let db = null;
try {
  if (fs.existsSync(DB_PATH)) {
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(DB_PATH, { readOnly: true });
  }
} catch (e) { console.log(JSON.stringify({ at: new Date().toISOString(), msg: 'intel.db not loaded', err: String(e.message || e) })); }

const qDev = db?.prepare('SELECT * FROM devs WHERE wallet = ?');
const qCoin = db?.prepare('SELECT * FROM coins WHERE mint = ?');
const qDevCoins = db?.prepare('SELECT COUNT(*) n, SUM(complete) done, MAX(ath_usd) best FROM coins WHERE creator = ? AND mint != ?');
const qMeta = db?.prepare("SELECT value FROM meta WHERE key = 'built_at'");

export const PAINT_MIN_ATH_USD = 30_000;
export const PAINT_FEES_PER_100K = 1; // under this: painted chart
export const REAL_FEES_PER_100K = 5; // at or above this (or 20+ SOL): real traders

export const feesPer100k = (feesSol, athUsd) => (feesSol == null || !athUsd ? null : round(feesSol / (athUsd / 100_000), 1));
export const isPainted = (athUsd, feesSol) => feesSol != null && athUsd >= PAINT_MIN_ATH_USD && feesSol < (athUsd / 100_000) * PAINT_FEES_PER_100K;
export const isReal = (athUsd, feesSol) => feesSol != null && (feesSol >= 20 || feesSol >= (Math.max(athUsd, 1) / 100_000) * REAL_FEES_PER_100K);

export const intelInfo = () => ({ loaded: Boolean(db), builtAt: db ? num(qMeta.get()?.value) : null });

// Dev record from the local DB, or null when the wallet isn't in it.
export function devIntel(wallet, exceptMint) {
  if (!db || !wallet) return null;
  const r = qDev.get(wallet);
  const c = qDevCoins.get(wallet, exceptMint || '');
  if (!r && !c?.n) return null;
  let coins = [];
  try { coins = JSON.parse(r?.coins || '[]'); } catch {}
  coins = coins.filter((x) => x.m !== exceptMint);
  const painted = coins.filter((x) => isPainted(x.ath, x.f)).length;
  const realCoins = coins.filter((x) => x.ath >= 25_000 && isReal(x.ath, x.f)).length;
  return {
    launches: Math.max(r?.launches ?? 0, c?.n ?? 0),
    migrated: r?.migrated ?? c?.done ?? 0,
    realCoins: Math.max(r?.real_coins ?? 0, realCoins),
    hits: r?.hits ?? null, // coins with a $25K+ ATH
    bestAthUsd: r?.best_ath_usd != null ? Math.round(r.best_ath_usd) : (c?.best ? Math.round(c.best) : null),
    bestSymbol: r?.best_symbol || null,
    avgAthUsd: r?.avg_ath_usd != null ? Math.round(r.avg_ath_usd) : null,
    creatorFeesSol: r?.creator_fees_sol != null ? round(r.creator_fees_sol, 1) : null,
    paintedCoins: painted,
    top: coins.slice(0, 5).map((x) => ({ symbol: x.s, athUsd: x.ath, feesSol: x.f, migrated: Boolean(x.done) })),
    seenAt: r?.seen_at ?? null,
  };
}

export function coinIntel(mint) {
  if (!db || !mint) return null;
  return qCoin.get(mint) || null;
}

// Live pump.fun holder breakdown + total fees traders paid on the coin. Works for curve and PumpSwap coins.
const statsCache = new TTLCache(2 * 60_000);
export const holderStats = cached(statsCache, async (mint) => {
  const r = await fetchJson(`https://frontend-api-v3.pump.fun/coins/holder-stats/${mint}`, { headers: { origin: 'https://pump.fun', referer: 'https://pump.fun/' } });
  if (!r.ok || !r.data || r.data.totalHolders == null) return null;
  const d = r.data;
  return {
    holders: num(d.totalHolders),
    top10Pct: num(d.top10HoldersPercent),
    devPct: num(d.devHoldingsPercent),
    snipersPct: num(d.snipersHoldingsPercent),
    bundlersPct: num(d.bundlersHoldingsPercent),
    feesSol: num(d.totalFeesSol) != null ? round(num(d.totalFeesSol), 2) : null,
  };
}, (v) => (v ? undefined : 30_000));

// Coins by ticker (case-insensitive), biggest ATH first.
const qBySym = db?.prepare('SELECT mint, symbol, creator, ath_usd, fees_sol, created_at, complete, painted FROM coins WHERE symbol = ? COLLATE NOCASE ORDER BY ath_usd DESC LIMIT 5');
export function coinsBySymbol(sym) {
  if (!db || !sym) return [];
  return qBySym.all(String(sym).replace(/^\$/, '').slice(0, 20));
}

// Devs whose coins had real traders lately: most real coins, then best ATH.
const qTopDevs = db?.prepare(`SELECT wallet, launches, migrated, real_coins, best_ath_usd, best_symbol, last_launch_at FROM devs
  WHERE real_coins >= 3 AND last_launch_at > ? ORDER BY (real_coins * 1.0 / launches) DESC, real_coins DESC LIMIT ?`);
export function topDevs(days = 7, n = 8) {
  if (!db) return [];
  return qTopDevs.all(Date.now() - days * 86_400_000, n);
}

// Overall numbers of the indexed period (for "how many coins are real" type questions).
let statsMemo = null;
export function intelStats() {
  if (!db) return null;
  if (statsMemo) return statsMemo;
  const c = db.prepare(`SELECT COUNT(*) n, SUM(complete) migrated, SUM(painted) painted, SUM(ath_usd >= 100000) over100k,
    MIN(created_at) since, MAX(created_at) till FROM coins`).get();
  const d = db.prepare('SELECT COUNT(*) n, SUM(real_coins >= 1) withReal, SUM(launches >= 10 AND real_coins = 0) farmers FROM devs').get();
  statsMemo = { coins: c.n, migrated: c.migrated, painted: c.painted, over100k: c.over100k, since: c.since, till: c.till, devs: d.n, devsWithRealCoin: d.withReal, serialNoHits: d.farmers };
  return statsMemo;
}
