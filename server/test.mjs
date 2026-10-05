// Smoke test against a RUNNING server (does not start one).
// Usage: node server/test.mjs [baseUrl]   (default http://localhost:4400)
const BASE = (process.argv[2] || process.env.PET_URL || 'http://localhost:4400').replace(/\/$/, '');
const MINT = '7GUnr7krtQhJwd6ASY2VUprd9t4c64zcgCsjdmZepump';
let fails = 0;
const ok = (cond, name, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) fails++; };
const post = async (p, body, headers = {}) => {
  const t = Date.now();
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
  return { status: r.status, j: await r.json().catch(() => null), ms: Date.now() - t };
};

// health
{
  const r = await fetch(BASE + '/api/health').then(async (r) => ({ status: r.status, j: await r.json() }));
  ok(r.status === 200 && r.j.ok === true && typeof r.j.llm === 'boolean', 'health', JSON.stringify(r.j));
}

// token by mint
let pair = null;
{
  const r = await post('/api/token', { address: MINT, persona: 'degen', lang: 'en', petName: 'Mochi' });
  const v = r.j?.verdict;
  ok(r.status === 200 && r.j.mint === MINT, 'token by mint', `${r.ms}ms llm=${r.j?.llm}`);
  ok(['legit', 'mid', 'larp', 'danger'].includes(v?.label) && Number.isInteger(v?.score) && typeof v?.say === 'string' && Array.isArray(v?.flags), 'token verdict shape', `${v?.label} ${v?.score} "${v?.say}"`);
  const f = r.j?.facts || {};
  console.log('      facts:', JSON.stringify({ sym: r.j?.symbol, mcap: f.mcapUsd, liq: f.liqUsd, age: f.ageHours, curve: f.onPumpCurve, grad: f.graduated, mintAuth: f.mintAuthority, top10: f.holders?.top10Pct, dev: f.dev, devHolds: f.holders?.devHoldsPct, x: { h: f.x?.handle, fol: f.x?.followers, posts: f.x?.posts?.length, m: f.x?.mentionsCoin }, web: f.website }));
  console.log('      holders:', JSON.stringify(f.holders?.list?.slice(0, 4)));
  console.log('      summary:', v?.summary, '| wallets:', v?.wallets);
  ok(f.holders && 'top10Pct' in f.holders && f.dev && f.x && f.links && f.website, 'token facts shape');
  // find the pair for the next check
  const d = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${MINT}`).then((r) => r.json()).catch(() => null);
  pair = d?.pairs?.[0]?.pairAddress || null;
}

// token by pair address, ru + mom
if (pair) {
  const r = await post('/api/token', { address: pair, persona: 'mom', lang: 'ru' });
  ok(r.status === 200 && r.j.mint === MINT, 'token by pair resolves to mint', `${pair.slice(0, 6)}… ${r.ms}ms say="${r.j?.verdict?.say}"`);
} else ok(false, 'token by pair (could not find a pair on dexscreener)');

// a fresh pump.fun coin (still on the curve, most likely)
{
  const s = await fetch('https://api.dexscreener.com/token-profiles/latest/v1').then((r) => r.json()).catch(() => null);
  const fresh = (Array.isArray(s) ? s : []).find((p) => p.chainId === 'solana' && p.tokenAddress?.endsWith('pump') && p.tokenAddress !== MINT);
  if (fresh) {
    const r = await post('/api/token', { address: fresh.tokenAddress, persona: 'nerd' });
    const f = r.j?.facts || {};
    console.log('      facts:', JSON.stringify({ mcap: f.mcapUsd, age: f.ageHours, curve: f.onPumpCurve, top10: f.holders?.top10Pct, devHolds: f.holders?.devHoldsPct, dev: f.dev, x: f.x?.handle, web: f.website }));
    ok(r.status === 200 && r.j.verdict, 'token: another live pump coin', `$${r.j?.symbol} ${r.j?.verdict?.label} ${r.j?.verdict?.score} llm=${r.j?.llm} ${r.ms}ms`);
  } else console.log('SKIP  no other pump coin found in dexscreener search');
}

// rule-based fallback: a bogus user key makes the LLM call fail (our key is not marked unpaid)
{
  const r = await post('/api/token', { address: MINT, persona: 'degen', lang: 'en' }, { 'X-OpenRouter-Key': 'sk-or-v1-bogus-key-for-fallback-test-000000' });
  const v = r.j?.verdict;
  ok(r.status === 200 && r.j.llm === false && v?.label && v?.summary && v?.say, 'token rule fallback (bogus user key)', `${v?.label} ${v?.score} "${v?.say}"`);
  console.log('      summary:', v?.summary, '| wallets:', v?.wallets, '| flags:', JSON.stringify(v?.flags));
  const r2 = await post('/api/token', { address: MINT, persona: 'mom', lang: 'ru' }, { 'X-OpenRouter-Key': 'sk-or-v1-bogus-key-for-fallback-test-000000' });
  ok(r2.status === 200 && r2.j.llm === false, 'token rule fallback ru/mom', `"${r2.j?.verdict?.say}" | ${r2.j?.verdict?.summary}`);
  const h = await fetch(BASE + '/api/health').then((r) => r.json());
  ok(h.llm === true, 'our llm still available after a bad user key');
}

// bad input
{
  const r = await post('/api/token', { address: 'not-an-address' });
  ok(r.status === 400 && r.j?.error, 'token rejects bad address');
  const r2 = await post('/api/token', { address: '11111111111111111111111111111111' });
  ok(r2.status === 404 && r2.j?.error, 'token 404 for non-token address', `${r2.status}`);
}

// site checks
const site = async (url, signals, name, want, extra = {}) => {
  const r = await post('/api/site', { url, signals, persona: 'degen', ...extra });
  ok(r.status === 200 && want.includes(r.j?.risk), `site ${name}`, `${r.j?.risk} age=${r.j?.ageDays} listed=${r.j?.listed} look=${JSON.stringify(r.j?.lookalike)} say="${r.j?.say}" ${r.ms}ms`);
  return r.j;
};
await site('https://phantom.app/download', { walletButton: true }, 'phantom.app (trusted)', ['safe']);
await site('https://phantorn.app/', { walletButton: true }, 'phantorn.app (lookalike)', ['danger']);
await site('https://raydlum.io/swap', {}, 'raydlum.io (phishing list + lookalike)', ['danger']);
await site('https://ph4ntom-wallet.com', {}, 'ph4ntom-wallet.com (token lookalike)', ['danger']);
await site('https://finance.yahoo.com', { walletButton: false }, 'finance.yahoo.com (no false positive)', ['safe']);
await site('https://wenpc.family/', { walletButton: true }, 'wenpc.family (young, wallet button)', ['caution', 'danger'], { lang: 'ru' });
await site(`https://pet-${Math.random().toString(36).slice(2, 10)}.com/`, { walletButton: true }, 'random unregistered domain', ['safe', 'caution']);
await site('https://some-blog.example.org/', { seedInput: true }, 'seed input on unknown site', ['danger']);
await site('chrome://extensions', {}, 'chrome page', ['safe']);
await site('http://localhost:3000', {}, 'localhost', ['safe']);

// chat
{
  const r = await post('/api/chat', { messages: [{ role: 'user', content: 'what can you do?' }], persona: 'chill', petName: 'Mochi', page: { url: 'https://pump.fun', title: 'pump' } });
  ok(r.status === 200 && typeof r.j?.reply === 'string' && r.j.reply.length > 0, 'chat', `llm=${r.j?.llm} "${r.j?.reply}"`);
  const r2 = await post('/api/chat', { messages: [] });
  ok(r2.status === 400, 'chat rejects empty messages');
}

// static
{
  const r = await fetch(BASE + '/shared/sprite.js');
  ok(r.status === 200 && /javascript/.test(r.headers.get('content-type') || ''), 'serves /shared/sprite.js');
  const r2 = await fetch(BASE + '/');
  ok([200, 404].includes(r2.status), 'serves / (or 404 if site not built yet)', String(r2.status));
  const r3 = await fetch(BASE + '/..%2f..%2fserver%2f.env');
  ok(r3.status === 404, 'no path traversal');
  const r4 = await fetch(BASE + '/api/token', { method: 'OPTIONS' });
  ok(r4.status === 204 && r4.headers.get('access-control-allow-origin') === '*', 'cors preflight');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
