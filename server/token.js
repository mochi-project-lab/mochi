// /api/token: resolve mint|pair → gather facts (DexScreener, pump.fun, Solana RPC, twitterapi.io, RDAP) → verdict
// (LLM via OpenRouter, rule-based fallback). Every source optional; failures become nulls.
import { fetchJson, TTLCache, cached, num, round, clamp, isSolAddress } from './lib.js';
import { rdap, hostOf, baseDomain } from './domain.js';
import { chat, parseJson, llmAvailable } from './llm.js';
import { notableIn } from './traders.js';
import { devIntel, coinIntel, holderStats, feesPer100k, isPainted, isReal } from './intel.js';
import { tokenSay, tidy, persona as normPersona, lang as normLang, petName as normName } from './voice.js';

const PUMP = 'https://frontend-api-v3.pump.fun';
const PUMP_HEADERS = { origin: 'https://pump.fun', referer: 'https://pump.fun/' };
const QUOTES = new Set([
  'So11111111111111111111111111111111111111112', // wSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
]);
// programs whose PDAs hold liquidity (owner of the owner = one of these → pool)
const AMM_PROGRAMS = new Set([
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // pump.fun bonding curve
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // PumpSwap
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', // Raydium CPMM
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
  'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj', // Raydium LaunchLab
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora DLMM
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', // Meteora pools
  'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG', // Meteora DAMM v2
  'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN', // Meteora DBC
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
  'MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG', // Moonshot
]);
const POOL_AUTHORITIES = new Set([
  '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium AMM v4 authority
  'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL', // Raydium CPMM authority
  'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh', // Raydium LaunchLab authority
]);

// ---------- Solana RPC ----------
async function rpc(method, params) {
  const url = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method, params }, timeout: 6000 });
    if (r.status === 429 && attempt === 0) { await new Promise((ok) => setTimeout(ok, 600 + Math.random() * 600)); continue; }
    if (!r.ok || !r.data || r.data.error) return null;
    return r.data.result;
  }
  return null;
}

// ---------- DexScreener ----------
async function dexTokenPairs(addr) {
  const r = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
  return (r.data?.pairs || []).filter((p) => p.chainId === 'solana');
}
async function dexPair(addr) {
  const r = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/solana/${addr}`);
  return r.data?.pairs?.[0] || r.data?.pair || null;
}
const mintOfPair = (p) => {
  const b = p?.baseToken?.address, q = p?.quoteToken?.address;
  if (!b) return null;
  return QUOTES.has(b) && q && !QUOTES.has(q) ? q : b;
};

// ---------- pump.fun ----------
const pumpCoin = async (mint) => {
  const r = await fetchJson(`${PUMP}/coins-v2/${mint}`, { headers: PUMP_HEADERS });
  return r.ok && r.data?.mint ? r.data : null;
};
const devCache = new TTLCache(10 * 60_000);
const devHistory = cached(devCache, async (creator, mint) => {
  const r = await fetchJson(`${PUMP}/coins-v2/user-created-coins/${creator}?offset=0&limit=50&includeNsfw=true`, { headers: PUMP_HEADERS });
  if (!r.ok || !Array.isArray(r.data?.coins)) return null;
  const others = r.data.coins.filter((c) => c.mint !== mint);
  const total = Math.max(num(r.data.count) ?? 0, r.data.coins.length);
  const hasThis = r.data.coins.length !== others.length;
  return {
    launches: Math.max(0, total - (hasThis ? 1 : 0)),
    graduated: others.filter((c) => c.complete).length,
    bestMcapUsd: Math.round(Math.max(0, ...others.map((c) => num(c.usd_market_cap) || num(c.ath_market_cap) || 0))),
    sampled: others.length,
  };
}, (v) => (v ? undefined : 60_000));

// ---------- X via twitterapi.io ----------
let xDownUntil = 0;
export const xState = () => ({ key: Boolean(process.env.TWITTERAPI_KEY), down: Date.now() < xDownUntil });
export function handleOf(url) {
  if (!url) return null;
  const m = String(url).match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/?#]+)/i);
  if (!m) return /^@?[A-Za-z0-9_]{1,15}$/.test(url) ? url.replace('@', '') : null;
  const h = m[1];
  if (/^(i|intent|search|home|hashtag|share|explore|messages|notifications|settings)$/i.test(h)) return null; // communities etc.
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? h : null;
}
const xCache = new TTLCache(30 * 60_000);
const xLookup = cached(xCache, async (handle) => {
  const key = process.env.TWITTERAPI_KEY;
  if (!key || Date.now() < xDownUntil) return null;
  const H = { 'X-API-Key': key };
  const u = await fetchJson(`https://api.twitterapi.io/twitter/user/info?userName=${handle}`, { headers: H });
  if ([401, 402, 403, 429].includes(u.status)) { xDownUntil = Date.now() + 10 * 60_000; return null; }
  if (!u.ok) return null;
  const d = u.data?.data;
  if (!d) return { exists: false };
  const t = await fetchJson(`https://api.twitterapi.io/twitter/user/last_tweets?userName=${handle}`, { headers: H });
  const tweets = t.data?.data?.tweets || t.data?.tweets || [];
  const created = Date.parse(d.createdAt || '');
  return {
    exists: true,
    followers: num(d.followers),
    accountAgeDays: Number.isFinite(created) ? Math.floor((Date.now() - created) / 86_400_000) : null,
    posts: tweets.slice(0, 8).map((x) => String(x.text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean),
    bio: String(d.description || '').slice(0, 200),
  };
}, (v) => (v ? undefined : 2 * 60_000));

// ---------- holders ----------
async function holders(mint, supplyUi, { creator, pools }) {
  const largest = await rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
  const accs = largest?.value;
  if (!Array.isArray(accs) || !accs.length || !supplyUi) return null;
  const info = await rpc('getMultipleAccounts', [accs.map((a) => a.address), { encoding: 'jsonParsed' }]);
  const owners = accs.map((a, i) => info?.value?.[i]?.data?.parsed?.info?.owner || null);
  const uniq = [...new Set(owners.filter(Boolean))];
  const progOf = new Map();
  if (uniq.length) {
    const o = await rpc('getMultipleAccounts', [uniq, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
    uniq.forEach((k, i) => progOf.set(k, o?.value?.[i]?.owner || null));
  }
  const byOwner = new Map();
  accs.forEach((a, i) => {
    const owner = owners[i] || a.address;
    const amt = num(a.uiAmountString ?? a.uiAmount) || 0;
    byOwner.set(owner, (byOwner.get(owner) || 0) + amt);
  });
  const list = [...byOwner].map(([owner, amt]) => {
    const isPool = pools.has(owner) || POOL_AUTHORITIES.has(owner) || AMM_PROGRAMS.has(progOf.get(owner));
    return { owner, pct: round((amt / supplyUi) * 100, 2), label: isPool ? 'pool' : owner === creator ? 'dev' : null };
  }).sort((a, b) => b.pct - a.pct);
  const people = list.filter((h) => h.label !== 'pool');
  return {
    top10Pct: round(people.slice(0, 10).reduce((s, h) => s + h.pct, 0), 2),
    top1Pct: people[0] ? people[0].pct : 0,
    list: list.slice(0, 12),
    // an owner that is a program-owned account we don't know (not a wallet) may be another pool/locker
    unknownPrograms: people.slice(0, 10).filter((h) => { const p = progOf.get(h.owner); return p && p !== '11111111111111111111111111111111'; }).length,
  };
}
async function devHolds(creator, mint, supplyUi) {
  if (!creator || !supplyUi) return null;
  const r = await rpc('getTokenAccountsByOwner', [creator, { mint }, { encoding: 'jsonParsed' }]);
  if (!r?.value) return null;
  const amt = r.value.reduce((s, a) => s + (num(a.account?.data?.parsed?.info?.tokenAmount?.uiAmountString) || 0), 0);
  return round((amt / supplyUi) * 100, 2);
}

// ---------- resolve ----------
const resolveCache = new TTLCache(30 * 60_000);
async function resolve(addr) {
  const hit = resolveCache.get(addr);
  if (hit) return hit;
  const [tok, pair, acct] = await Promise.allSettled([dexTokenPairs(addr), dexPair(addr), rpc('getAccountInfo', [addr, { encoding: 'jsonParsed' }])]);
  let mint = null;
  const pairs = tok.value || [];
  if (pairs.length) mint = addr;
  else if (pair.value) mint = mintOfPair(pair.value);
  else if (acct.value?.value?.data?.parsed?.type === 'mint') mint = addr;
  else if (await pumpCoin(addr)) mint = addr;
  const out = mint ? { mint, pairs: mint === addr ? pairs : null, mintAcct: mint === addr ? acct.value : null } : null;
  if (out) resolveCache.set(addr, { mint }); // only the mapping; data refetched with the facts
  return out || null;
}

// ---------- facts ----------
const factsCache = new TTLCache(3 * 60_000);
const inflight = new Map();

export async function getFacts(address) {
  const r = await resolve(address);
  if (!r) return null;
  const { mint } = r;
  const hit = factsCache.get(mint);
  if (hit) return hit;
  if (inflight.has(mint)) return inflight.get(mint);
  const p = buildFacts(mint, r).then((f) => { factsCache.set(mint, f); return f; }).finally(() => inflight.delete(mint));
  inflight.set(mint, p);
  return p;
}

async function buildFacts(mint, pre) {
  const [pairsR, pumpR, acctR] = await Promise.allSettled([
    pre.pairs ? Promise.resolve(pre.pairs) : dexTokenPairs(mint),
    pumpCoin(mint),
    pre.mintAcct ? Promise.resolve(pre.mintAcct) : rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]),
  ]);
  const pairs = (pairsR.value || []).filter((p) => p.baseToken?.address === mint || p.quoteToken?.address === mint);
  const best = pairs.slice().sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] || null;
  const pump = pumpR.value || null;
  const mi = acctR.value?.value?.data?.parsed?.info || null;
  const meta = mi?.extensions?.find((e) => e.extension === 'tokenMetadata')?.state || null;
  const decimals = num(mi?.decimals);
  const supplyUi = mi?.supply != null && decimals != null ? Number(BigInt(mi.supply)) / 10 ** decimals : null;

  const side = best ? (best.baseToken?.address === mint ? best.baseToken : best.quoteToken) : null;
  const name = pump?.name || side?.name || meta?.name || null;
  const symbol = pump?.symbol || side?.symbol || meta?.symbol || null;

  const infoSocial = (type) => best?.info?.socials?.find((s) => s.type === type)?.url || null;
  const links = {
    website: pump?.website || best?.info?.websites?.[0]?.url || null,
    twitter: pump?.twitter || infoSocial('twitter') || null,
    telegram: pump?.telegram || infoSocial('telegram') || null,
  };
  for (const k of Object.keys(links)) if (links[k] && !/^https?:\/\//i.test(links[k]) && !/^[\w.-]+\.\w{2,}/.test(links[k])) links[k] = null;

  const created = Math.min(...[num(pump?.created_timestamp), ...pairs.map((p) => num(p.pairCreatedAt))].filter((v) => v && v > 0));
  // pump.fun also indexes coins launched elsewhere (program 'non_launchpad'): creator/curve there mean nothing
  const launchpad = pump && pump.program !== 'non_launchpad' ? pump : null;
  const known = coinIntel(mint);
  const creator = launchpad?.creator || known?.creator || null;
  const pools = new Set([pump?.bonding_curve, pump?.pump_swap_pool, pump?.pool_address, ...pairs.map((p) => p.pairAddress)].filter(Boolean));

  const handle = handleOf(links.twitter);
  let siteDomain = null;
  if (links.website) { const h = hostOf(links.website); if (h?.host && h.host.includes('.')) siteDomain = baseDomain(h.host); }
  // skip "websites" that are just X / pump.fun / dexscreener pages
  if (siteDomain && /^(x|twitter|pump|dexscreener|t|telegram|youtube|tiktok|instagram)\.(com|fun|me|org)$/.test(siteDomain)) siteDomain = null;

  const [holdR, devR, devHoldR, xR, siteR, statsR, notR] = await Promise.allSettled([
    holders(mint, supplyUi, { creator, pools }),
    creator ? devHistory(creator, mint) : null,
    devHolds(creator, mint, supplyUi),
    handle ? xLookup(handle.toLowerCase()) : null,
    siteDomain ? rdap(siteDomain) : null,
    launchpad || known || mint.endsWith('pump') ? holderStats(mint) : null,
    notableIn(mint, { decimals, supplyUi, priceUsd: num(best?.priceUsd) }),
  ]);
  const stats = statsR.value || null;
  const intel = devIntel(creator, mint);
  const athUsd = Math.max(num(launchpad?.ath_market_cap) || 0, num(known?.ath_usd) || 0, num(best?.marketCap) || 0) || null;
  const feesSol = stats?.feesSol ?? (known?.fees_sol != null ? round(known.fees_sol, 2) : null);
  const hold = holdR.value || null;
  const dev = devR.value || null;
  const x = xR.value || null;

  const words = [symbol, name].filter(Boolean).map((w) => String(w).toLowerCase().replace(/^\$/, '')).filter((w) => w.length >= 3);
  const mentions = x?.posts?.length ? x.posts.filter((p) => words.some((w) => p.toLowerCase().includes(w))).length : null;

  const mcap = num(best?.marketCap) ?? num(best?.fdv) ?? num(pump?.usd_market_cap);
  return {
    mint, name, symbol,
    image: best?.info?.imageUrl || pump?.image_uri || null,
    chain: 'solana',
    facts: {
      mcapUsd: mcap != null ? Math.round(mcap) : null,
      liqUsd: best?.liquidity?.usd != null ? Math.round(best.liquidity.usd) : (num(pump?.canonical_pool_liquidity_usd) != null ? Math.round(pump.canonical_pool_liquidity_usd) : null),
      vol24hUsd: best?.volume?.h24 != null ? Math.round(best.volume.h24) : null,
      chg1hPct: num(best?.priceChange?.h1),
      chg24hPct: num(best?.priceChange?.h24),
      ageHours: Number.isFinite(created) ? round((Date.now() - created) / 3_600_000, 1) : null,
      onPumpCurve: launchpad ? !launchpad.complete : (mint.endsWith('pump') && !pairs.length ? null : false),
      graduated: launchpad ? Boolean(launchpad.complete) : null,
      mintAuthority: mi ? mi.mintAuthority ?? null : null,
      freezeAuthority: mi ? mi.freezeAuthority ?? null : null,
      holders: {
        top10Pct: hold?.top10Pct ?? stats?.top10Pct ?? null,
        count: stats?.holders ?? null,
        snipersPct: stats?.snipersPct ?? null,
        bundlersPct: stats?.bundlersPct ?? null,
        top1Pct: hold?.top1Pct ?? null,
        devHoldsPct: devHoldR.value ?? (stats ? stats.devPct ?? 0 : null),
        list: hold?.list || [],
      },
      dev: {
        address: creator,
        launches: dev?.launches != null || intel ? Math.max(dev?.launches ?? 0, intel?.launches ?? 0) : null,
        graduated: dev?.graduated != null || intel ? Math.max(dev?.graduated ?? 0, intel?.migrated ?? 0) : null,
        bestMcapUsd: dev?.bestMcapUsd != null || intel?.bestAthUsd != null ? Math.max(dev?.bestMcapUsd ?? 0, intel?.bestAthUsd ?? 0) : null,
        realCoins: intel?.realCoins ?? null,
        paintedCoins: intel?.paintedCoins ?? null,
        bestSymbol: intel?.bestSymbol ?? null,
        creatorFeesSol: intel?.creatorFeesSol ?? null,
        top: intel?.top ?? [],
      },
      traders: {
        feesSol,
        athUsd: athUsd != null ? Math.round(athUsd) : null,
        feesPer100kAth: feesPer100k(feesSol, athUsd),
        real: feesSol == null ? null : isReal(athUsd || 0, feesSol),
        painted: feesSol == null ? null : isPainted(athUsd || 0, feesSol),
      },
      x: {
        handle: handle || null,
        followers: x?.followers ?? null,
        accountAgeDays: x?.accountAgeDays ?? null,
        posts: x?.posts || [],
        mentionsCoin: mentions == null ? null : mentions > 0,
      },
      links,
      website: { domain: siteDomain, ageDays: siteR.value?.ageDays ?? null },
      notable: notR.value || null,
    },
    // internal, stripped from the response
    _extra: {
      authoritiesKnown: Boolean(mi), xExists: x ? x.exists !== false : null, xBio: x?.bio || null, mentions,
      xChecked: Boolean(x), about: pump?.description ? String(pump.description).slice(0, 300) : null,
      supplyKnown: supplyUi != null, unknownHolderPrograms: hold?.unknownPrograms ?? 0, sources: {
        dexscreener: pairsR.status === 'fulfilled' && Array.isArray(pairsR.value), pump: Boolean(pump), rpc: Boolean(mi), holders: Boolean(hold), dev: Boolean(dev), x: Boolean(x), rdap: siteR.value ? siteR.value.ageDays != null : null,
      },
    },
    cachedAt: Date.now(),
  };
}

// ---------- rule-based verdict ----------
const usd = (v) => (v == null ? '?' : v >= 1e9 ? `$${round(v / 1e9, 1)}b` : v >= 1e6 ? `$${round(v / 1e6, 1)}m` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);
const ageTxt = (h) => (h == null ? 'unknown age' : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)} days`);

export function hints(t) {
  const f = t.facts;
  const rate = f.dev.launches ? f.dev.graduated / Math.min(f.dev.launches, 50) : null;
  return {
    mint_authority_present: f.mintAuthority != null,
    freeze_authority_present: f.freezeAuthority != null,
    serial_launcher: f.dev.launches != null && f.dev.launches >= 10 && (rate ?? 0) < 0.3,
    first_time_dev: f.dev.launches === 0,
    dev_graduation_rate_pct: rate == null ? null : Math.round(rate * 100),
    top10_concentrated: f.holders.top10Pct != null && f.holders.top10Pct > 50,
    dev_holds_big: f.holders.devHoldsPct != null && f.holders.devHoldsPct > 10,
    x_looks_like_the_team: f.x.mentionsCoin,
    x_linked: Boolean(f.x.handle),
    x_is_community_or_unparsed: Boolean(f.links.twitter) && !f.x.handle,
    no_socials: !f.links.twitter && !f.links.website && !f.links.telegram,
    website_age_days: f.website.ageDays,
    thin_liquidity: f.liqUsd != null && f.liqUsd < 10_000 && !f.onPumpCurve,
    very_new: f.ageHours != null && f.ageHours < 1,
    traders_fees_sol: f.traders.feesSol,
    fees_per_100k_ath: f.traders.feesPer100kAth,
    real_traders: f.traders.real,
    painted_chart: f.traders.painted,
    dev_real_coins: f.dev.realCoins,
    dev_painted_coins: f.dev.paintedCoins,
    snipers_heavy: f.holders.snipersPct != null && f.holders.snipersPct > 20,
    bundlers_heavy: f.holders.bundlersPct != null && f.holders.bundlersPct > 30,
  };
}

export function ruleVerdict(t, p, l) {
  const f = t.facts, h = hints(t);
  const L = (en) => en;
  const flags = [];
  let score = 50, hard = false;
  const add = (level, text, d) => { flags.push({ level, text }); score += d; };

  if (h.mint_authority_present) { add('bad', L('mint authority is on: dev can print more'), -35); hard = true; }
  if (h.freeze_authority_present) { add('bad', L('freeze authority is on: your tokens can be frozen'), -30); hard = true; }
  if (t._extra.authoritiesKnown && !h.mint_authority_present && !h.freeze_authority_present) add('good', L('mint and freeze authority revoked'), 5);

  const top10 = f.holders.top10Pct;
  if (top10 != null) {
    if (top10 > 60) { add('bad', L(`top 10 wallets hold ${top10}%`), -25); hard = true; }
    else if (top10 > 50) add('bad', L(`top 10 wallets hold ${top10}%`), -15);
    else if (top10 > 35) add('warn', L(`top 10 hold ${top10}%`), -5);
    else if (top10 <= 25) add('good', L(`spread out: top 10 hold ${top10}%`), 8);
  }
  const dh = f.holders.devHoldsPct;
  if (dh != null) {
    if (dh > 15) { add('bad', L(`dev still holds ${dh}%`), -25); hard = true; }
    else if (dh > 5) add('warn', L(`dev holds ${dh}%`), -8);
    else if (dh === 0 && f.dev.address) add('good', L('dev sold or holds nothing'), 0);
  }

  if (h.serial_launcher) add('bad', L(`serial launcher: ${f.dev.launches} coins, ${f.dev.graduated} graduated`), -20);
  else if (f.dev.launches > 0 && h.dev_graduation_rate_pct >= 30) add('good', L(`dev has ${f.dev.graduated} graduated coins before`), 10);
  else if (f.dev.launches >= 3) add('warn', L(`dev launched ${f.dev.launches} coins, ${f.dev.graduated} graduated`), -5);
  else if (h.first_time_dev) add('warn', L('first-time dev'), 0);
  if (f.dev.bestMcapUsd >= 1_000_000) add('good', L(`dev's best coin hit ${usd(f.dev.bestMcapUsd)}`), 5);

  if (h.no_socials) add('bad', L('no socials at all'), -15);
  else if (f.x.handle) {
    if (t._extra.xExists === false) add('bad', L(`linked x @${f.x.handle} doesn't exist`), -15);
    else if (f.x.mentionsCoin === true) add('good', L(`@${f.x.handle} posts about the coin`), 12);
    else if (f.x.mentionsCoin === false) add('warn', L(`@${f.x.handle} never mentions the coin: likely not the team`), -10);
    if (f.x.followers != null && f.x.followers >= 5000 && f.x.mentionsCoin) add('good', L(`${f.x.followers} followers on x`), 4);
    if (f.x.accountAgeDays != null && f.x.accountAgeDays < 7) add('warn', L(`x account is ${f.x.accountAgeDays} days old`), -4);
  } else if (h.x_is_community_or_unparsed) add('warn', L('x link is a community, not an account'), -3);
  else if (!f.links.twitter) add('warn', L('no x account'), -8);

  if (h.painted_chart) { add('bad', L(`painted chart: ${f.traders.feesSol} sol fees on a ${usd(f.traders.athUsd)} ath`), -30); hard = true; }
  else if (h.real_traders && f.traders.feesSol >= 5) add('good', L(`real traders: ${Math.round(f.traders.feesSol)} sol paid in fees`), 10);
  else if (f.traders.feesSol != null && f.traders.feesSol < 1 && f.ageHours > 3) add('warn', L(`barely traded: ${f.traders.feesSol} sol in fees`), -6);
  if (h.bundlers_heavy) add('bad', L(`bundlers hold ${f.holders.bundlersPct}%`), -15);
  if (h.snipers_heavy) add('warn', L(`snipers hold ${f.holders.snipersPct}%`), -8);
  if (f.dev.paintedCoins >= 2) add('bad', L(`dev painted ${f.dev.paintedCoins} charts before`), -15);
  if (f.dev.realCoins >= 1 && !h.serial_launcher) add('good', L(`dev had ${f.dev.realCoins} coin${f.dev.realCoins > 1 ? 's' : ''} with real traders`), 6);

  const nt = f.notable;
  if (nt?.count) add('good', L(`${nt.count} top pump.fun trader${nt.count > 1 ? 's' : ''} hold it${nt.list[0]?.x ? ` (@${nt.list[0].x})` : nt.list[0]?.name ? ` (${nt.list[0].name})` : ''}`), Math.min(12, 4 * nt.count));
  if (nt?.gmgn?.renowned >= 10) add('good', L(`${nt.gmgn.renowned} known kol wallets hold it`), 4);
  else if (nt?.gmgn && nt.gmgn.smart != null && nt.gmgn.smart < 10 && f.ageHours > 6) add('warn', L(`almost no smart money: ${nt.gmgn.smart} wallets`), -4);

  if (f.website.domain && f.website.ageDays != null) {
    if (f.website.ageDays < 7) add('warn', L(`website is ${f.website.ageDays} days old`), -3);
    else if (f.website.ageDays > 180) add('good', L(`website is ${Math.round(f.website.ageDays / 30)} months old`), 4);
  }

  if (h.thin_liquidity) add('bad', L(`thin liquidity: ${usd(f.liqUsd)}`), -10);
  else if (f.liqUsd >= 50_000) add('good', L(`${usd(f.liqUsd)} liquidity`), 6);
  if (f.vol24hUsd >= 250_000) add('good', L(`${usd(f.vol24hUsd)} volume in 24h`), 4);
  if (f.chg24hPct != null && f.chg24hPct < -70) add('warn', L(`down ${Math.round(-f.chg24hPct)}% in 24h`), -8);
  if (h.very_new) add('warn', L('less than an hour old'), -5);
  if (f.graduated) add('good', L('graduated from pump.fun'), 3);

  score = Math.round(clamp(score, 0, 100));
  let label = score >= 70 ? 'legit' : score >= 45 ? 'mid' : 'larp';
  if (hard || score < 20) label = 'danger';
  if (hard) score = Math.min(score, 25);

  const bad = flags.filter((x) => x.level === 'bad');
  const goodF = flags.filter((x) => x.level === 'good');
  const lead = label === 'legit' || label === 'mid' ? goodF[0] || bad[0] : bad[0] || flags.find((x) => x.level === 'warn');
  const why = lead ? lead.text : L('not much data to go on');

  const sym = t.symbol ? `$${t.symbol}` : L('this coin');
  const where = f.onPumpCurve ? L('still on the pump.fun curve') : f.graduated ? L('graduated from pump.fun') : L('trading on a dex');
  const reasons = flags.filter((x) => (label === 'legit' ? x.level === 'good' : x.level !== 'good')).slice(0, 2).map((x) => x.text);
  const summary = `${sym} is ${ageTxt(f.ageHours)} old, ${usd(f.mcapUsd)} mcap, ${where}. ${label === 'legit' ? 'looks fine' : label === 'mid' ? 'mixed picture' : label === 'larp' ? 'looks empty' : 'dangerous'}: ${reasons.join('; ') || why}.`;

  const w = [];
  if (top10 != null) w.push(L(`top 10 wallets hold ${top10}% (pool excluded)`));
  if (dh != null) w.push(L(`dev holds ${dh}%`));
  if (f.holders.bundlersPct) w.push(L(`bundlers hold ${f.holders.bundlersPct}%`));
  if (f.holders.snipersPct) w.push(L(`snipers hold ${f.holders.snipersPct}%`));
  if (f.traders.feesSol != null) w.push(L(`traders paid ${f.traders.feesSol} sol in fees`));
  if (f.dev.launches != null) w.push(L(`dev launched ${f.dev.launches} other coins, ${f.dev.graduated} graduated`));
  const wallets = w.length ? w.join(', ') + '.' : L('could not read the wallets this time.');

  return {
    label, score, summary, wallets,
    flags: flags.slice(0, 8),
    say: tokenSay({ label, score, symbol: t.symbol, why, persona: p, lang: l }),
  };
}

// ---------- LLM verdict ----------
const LABELS = ['legit', 'mid', 'larp', 'danger'];
const PERSONA_TXT = {
  chill: 'chill: friendly, calm, short',
  degen: 'degen: pump.fun trenches slang used correctly: ser, larp (fake project), rug, aped, cooked / ngmi only for BAD, cooking / based for GOOD; short, never cringe',
  nerd: 'nerd: dry, numbers first',
  mom: 'mom: caring, protective, calls the user sweetie/dear',
};

async function llmVerdict(t, p, l, name, userKey, rule) {
  const f = t.facts;
  const facts = {
    coin: { name: t.name, symbol: t.symbol, about: t._extra.about, mcap: usd(f.mcapUsd), liquidity: usd(f.liqUsd), volume_24h: usd(f.vol24hUsd), chg1h_pct: f.chg1hPct, chg24h_pct: f.chg24hPct, age_hours: f.ageHours, on_pump_curve: f.onPumpCurve, graduated: f.graduated },
    authorities: { mint: f.mintAuthority ? 'present' : t._extra.authoritiesKnown ? 'revoked' : 'unknown', freeze: f.freezeAuthority ? 'present' : t._extra.authoritiesKnown ? 'revoked' : 'unknown' },
    holders: { count: f.holders.count, snipers_pct: f.holders.snipersPct, bundlers_pct: f.holders.bundlersPct, top10_pct_excluding_pool: f.holders.top10Pct, top1_pct: f.holders.top1Pct, dev_holds_pct: f.holders.devHoldsPct, top: f.holders.list.slice(0, 8).map((h) => ({ pct: h.pct, label: h.label })) },
    dev: { past_launches: f.dev.launches, past_graduated: f.dev.graduated, best_past_ath: usd(f.dev.bestMcapUsd), best_past_symbol: f.dev.bestSymbol, past_coins_with_real_traders: f.dev.realCoins, past_painted_charts: f.dev.paintedCoins, top_past_coins: f.dev.top.map((c) => ({ symbol: c.symbol, ath: usd(c.athUsd), fees_sol: c.feesSol, migrated: c.migrated })) },
    notable_traders_holding: f.notable ? { from_pumpfun_pnl_leaderboards: f.notable.list.map((n) => ({ who: n.x ? '@' + n.x : n.name || n.wallet.slice(0, 6), pnl: `${usd(n.pnlUsd)} ${n.pnlPeriod}`, holds: n.valueUsd != null ? usd(n.valueUsd) : null })), gmgn_smart_wallets: f.notable.gmgn?.smart, gmgn_kol_wallets: f.notable.gmgn?.renowned, holders_checked: f.notable.holdersChecked } : null,
    traders: { fees_paid_sol: f.traders.feesSol, ath: usd(f.traders.athUsd), fees_sol_per_100k_ath: f.traders.feesPer100kAth },
    x: f.x.handle ? { handle: f.x.handle, exists: t._extra.xExists, followers: f.x.followers, account_age_days: f.x.accountAgeDays, bio: t._extra.xBio, posts: f.x.posts, posts_mentioning_coin: t._extra.mentions } : (f.links.twitter ? 'x link is a community or unreadable' : 'no x linked'),
    links: f.links,
    website: f.website,
  };
  const system = [
    `You are ${name}, a small AI pet living in the user's browser. You sniff Solana memecoins and give an honest read. Not financial advice, but be honest and strict: most memecoins are larps.`,
    'Judge from the facts only. Hints are precomputed and correct, trust them: serial_launcher (10+ launches, <30% graduated) = bad; first_time_dev = neutral, judge the X instead; dev past coins that graduated or got big = good; x_looks_like_the_team false = the linked X never mentions the coin, it is probably someone else (often a famous account) and says nothing good; mint or freeze authority present = danger; top 10 holders > 50% (pool excluded) = bad; dev holding >10% = bad; no socials = weak. Fees paid by traders are the strongest "real or fake" marker: bundles can paint any ATH but cannot fake hundreds of traders paying fees; real coins pay 10+ SOL per $100K of ATH, painted charts (painted_chart true: dev bought the curve and dumped) under 1 — painted = larp or danger. Bundlers > 30% or snipers > 20% of supply = bad. dev_painted_coins 2+ = bad dev; dev_real_coins 1+ = dev shipped real coins before. notable_traders_holding = top pump.fun PnL-leaderboard traders who hold the coin right now with their position size, plus GMGN smart-money and KOL wallet counts: real traders holding = good sign; if any are listed, name the biggest one or two by @handle (or name) with their position in one flag. Null means unknown, not bad.',
    'Labels: legit (real team/activity, clean wallets), mid (unclear, mixed), larp (no real team, empty narrative, serial dev), danger (rug risk: authorities, concentrated wallets, dev holding a lot, known scam signs). Score 0-100 (higher = better). A rule engine scored it ' + rule.score + ' (' + rule.label + '); you may disagree if the facts support it.',
    `Write all text fields in English. summary: 2-3 short sentences, what it is and why this label. wallets: 1-2 sentences on holders, dev wallet, concentration. flags: up to 6 items {level: good|warn|bad, text: short, ≤60 chars, plain words a trader understands with real numbers — never field or hint names like x_looks_like_the_team, fees_sol_per_100k_ath, true/false, null}. say: one short line (≤120 chars) in the pet's voice, persona ${PERSONA_TXT[p]}, lowercase, max one emoji.`,
    'Answer JSON only: {"label":"...","score":0,"summary":"...","wallets":"...","flags":[{"level":"...","text":"..."}],"say":"..."}',
  ].join('\n');
  const user = JSON.stringify({ facts, hints: hints(t) });
  const r = await chat([{ role: 'system', content: system }, { role: 'user', content: user }], { userKey, json: true, temperature: 0.4, maxTokens: 600, timeout: 15_000 });
  const j = parseJson(r?.text);
  if (!j || !LABELS.includes(j.label)) return null;
  const s = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const out = {
    label: j.label,
    score: Math.round(clamp(num(j.score) ?? rule.score, 0, 100)),
    summary: s(j.summary, 500) || rule.summary,
    wallets: s(j.wallets, 350) || rule.wallets,
    flags: (Array.isArray(j.flags) ? j.flags : []).filter((x) => x && ['good', 'warn', 'bad'].includes(x.level) && s(x.text, 80) && !/not triggered|^n\/?a$|^none$|unknown$/i.test(s(x.text, 80))).slice(0, 8).map((x) => ({ level: x.level, text: s(x.text, 80) })),
    say: tidy(j.say, 160) || rule.say,
  };
  if (!out.flags.length) out.flags = rule.flags;
  // hard on-chain dangers are not up for debate
  const hh = hints(t);
  if (rule.label === 'danger' && (hh.mint_authority_present || hh.freeze_authority_present || hh.painted_chart)) { out.label = 'danger'; out.score = Math.min(out.score, 25); }
  return out;
}

const verdictCache = new TTLCache(3 * 60_000);
export async function scanToken({ address, persona, lang, petName }, userKey) {
  const p = normPersona(persona), l = normLang(lang), name = normName(petName);
  const t = await getFacts(address);
  if (!t) return null;
  const vkey = `${t.mint}|${p}|${l}|${t.cachedAt}|${userKey ? 'u' : 'o'}`;
  let v = verdictCache.get(vkey);
  if (!v) {
    const rule = ruleVerdict(t, p, l);
    let llm = null;
    if (llmAvailable(userKey)) llm = await llmVerdict(t, p, l, name, userKey, rule).catch(() => null);
    v = { verdict: llm || rule, llm: Boolean(llm) };
    if (llm || !llmAvailable(userKey)) verdictCache.set(vkey, v); // a failed LLM call is retried next time
  }
  const { _extra, ...pub } = t;
  return { ...pub, verdict: v.verdict, llm: v.llm, cachedAt: t.cachedAt };
}

export { isSolAddress };
