// Build server/data/intel.db: raw pump.fun dev + coin stats from a source SQLite (indexer dump).
// Numbers only — no ranks, labels or branding from the source project.
// usage: node scripts/import-dev-data.mjs <source.db>
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('usage: node scripts/import-dev-data.mjs <source.db>'); process.exit(1); }
const outDir = path.join(import.meta.dirname, '..', 'server', 'data');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'intel.db');
const tmp = out + '.tmp';
fs.rmSync(tmp, { force: true });

const s = new DatabaseSync(src, { readOnly: true });
const d = new DatabaseSync(tmp);
d.exec(`
  PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
  CREATE TABLE devs (
    wallet TEXT PRIMARY KEY, launches INTEGER, migrated INTEGER, real_coins INTEGER, hits INTEGER,
    best_ath_usd REAL, best_symbol TEXT, avg_ath_usd REAL, best_fees_sol REAL, creator_fees_sol REAL,
    last_launch_at INTEGER, seen_at INTEGER, coins TEXT);
  CREATE TABLE coins (
    mint TEXT PRIMARY KEY, creator TEXT, symbol TEXT, created_at INTEGER, ath_usd REAL, complete INTEGER,
    fees_sol REAL, painted INTEGER, holders INTEGER, top10_pct REAL, dev_pct REAL, snipers_pct REAL, bundlers_pct REAL);
  CREATE INDEX coins_creator ON coins(creator);
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
`);

// devs: keep the 8 biggest past coins (by ATH) with their fees — enough for the pet to name a track record
const insDev = d.prepare('INSERT INTO devs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
let nd = 0;
d.exec('BEGIN');
for (const r of s.prepare('SELECT * FROM devs').iterate()) {
  let coins = [];
  try {
    coins = JSON.parse(r.coins_json || '[]')
      .filter((c) => c && c.mint)
      .sort((a, b) => (b.ath || 0) - (a.ath || 0))
      .slice(0, 8)
      .map((c) => ({ m: c.mint, s: c.symbol, ath: Math.round(c.ath || 0), f: c.fees == null ? null : +(+c.fees).toFixed(2), done: c.complete ? 1 : 0, t: c.created }));
  } catch {}
  insDev.run(r.wallet, r.launches, r.graduated, r.real_coins, r.hits, r.best_ath_usd, r.best_symbol, r.avg_ath_usd,
    r.best_fees_sol, r.fees_sol, r.last_launch_at, r.profiled_at, JSON.stringify(coins));
  nd++;
}
d.exec('COMMIT');

const insCoin = d.prepare('INSERT INTO coins VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
let nc = 0;
d.exec('BEGIN');
for (const r of s.prepare(`SELECT t.mint, t.creator, t.symbol, t.created_at, t.ath_usd, t.complete, t.fake,
    f.fees_sol, c.holders, c.top10_pct, c.dev_pct, c.snipers_pct, c.bundlers_pct
  FROM tokens t LEFT JOIN coin_fees f ON f.mint = t.mint LEFT JOIN coin_stats c ON c.mint = t.mint`).iterate()) {
  insCoin.run(r.mint, r.creator, r.symbol, r.created_at, r.ath_usd, r.complete, r.fees_sol, r.fake ? 1 : 0,
    r.holders, r.top10_pct, r.dev_pct, r.snipers_pct, r.bundlers_pct);
  nc++;
}
d.exec('COMMIT');
d.prepare('INSERT INTO meta VALUES (?,?)').run('built_at', String(Date.now()));
d.close(); s.close();
fs.renameSync(tmp, out);
console.log(`intel.db: ${nd} devs, ${nc} coins, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
