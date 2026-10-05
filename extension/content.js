// Mochi content script: the pet, its chat panel, hover sniffing on memescopes and site warnings.
// Everything the user sees lives in one closed shadow root. Data from the backend goes in as text only.
/* global PetSprite, PetCommon */
(function () {
  'use strict';
  if (window.top !== window) return;
  if (window.__petContentLoaded) return;
  window.__petContentLoaded = true;
  if (!/^https?:$/.test(location.protocol)) return;

  const api = globalThis.browser || globalThis.chrome;
  const Sprite = PetSprite;
  const { withDefaults, MEMESCOPES, hostMatches } = PetCommon;
  const HOST = location.hostname.toLowerCase();

  // ---------- text ----------
  const T = {
    en: {
      sniff: 'sniff?',
      sniffing: 'sniffing',
      offer: 'want me to sniff this coin?',
      offerBtn: 'sniff it',
      placeholder: 'ask me, or /help',
      offline: "can't reach my backend. check the url in settings.",
      noCoin: 'no coin on this page. try /scan <address>',
      badAddr: "that doesn't look like a solana address.",
      help: [
        '/scan [address] — sniff a coin (no address = this page)',
        '/site — check this site',
        '/hide — hide me on this site',
        '/sleep — let me nap',
        '/name <name> — rename me',
        '/color <' + Object.keys(Sprite.COLORS).join('|') + '>',
        '/mood — how i feel',
        '/settings — open settings',
        'anything else — chat about this page',
      ],
      hello: (n) => `hi, i'm ${n}. hover a coin on a memescope and i'll sniff it. /help for commands.`,
      hidden: "ok, hiding here. bring me back from the toolbar icon.",
      sleeping: 'zzz… click me to wake me up.',
      renamed: (n) => `call me ${n} now.`,
      recolored: (c) => `${c} it is.`,
      colors: 'colours: ' + Object.keys(Sprite.COLORS).join(', '),
      mood: (m) => `mood: ${m}`,
      siteSafe: 'this site looks fine to me.',
      details: 'details',
      rules: 'rules mode',
      cached: 'cached',
      onWallets: 'on wallets',
      facts: { mcap: 'mcap', liq: 'liquidity', age: 'age', top10: 'top 10', x: 'x followers', gmgn: 'smart money / KOLs', topTraders: 'top traders in it', made: 'made', holdsNow: 'holds', more: 'more', vol: 'vol 24h', chg: '24h', traders: 'traders paid', painted: 'painted chart', real: 'real', holders: 'holders', bs: 'bundlers / snipers', auth: 'mint / freeze', revoked: 'revoked', dev: 'dev', launch: 'launch', launches: 'launches', grad: 'grad', realCoins: 'real', paintedN: 'painted', best: 'best', ath: 'ath' },
      on: 'on', off: 'off', none: 'none',
      risk: { safe: 'safe', caution: 'caution', danger: 'danger' },
      label: { legit: 'legit', mid: 'mid', larp: 'larp', danger: 'danger' },
      domainAge: (d) => `domain ${d}d old`,
      tapMe: 'tap me for details',
      cleared: 'chat cleared.',
      minimize: 'minimize', close: 'close',
    },
  };
  const t = () => T.en;

  // ---------- addresses ----------
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const ADDR_RE = /(?:^|[^1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/;
  const DENY = new Set([
    '11111111111111111111111111111111',
    'So11111111111111111111111111111111111111112',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
    'ComputeBudget111111111111111111111111111111',
  ]);
  // Decodes to exactly 32 bytes = a real public key, not a random word.
  function isAddr(s) {
    if (!s || s.length < 32 || s.length > 44 || DENY.has(s)) return false;
    const bytes = [0];
    for (let i = 0; i < s.length; i++) {
      let c = B58.indexOf(s[i]);
      if (c < 0) return false;
      for (let j = 0; j < bytes.length; j++) {
        c += bytes[j] * 58;
        bytes[j] = c & 255;
        c >>= 8;
      }
      while (c > 0) { bytes.push(c & 255); c >>= 8; }
    }
    let zeros = 0;
    while (zeros < s.length && s[zeros] === '1') zeros++;
    let len = bytes.length + zeros;
    if (bytes.length === 1 && bytes[0] === 0) len = zeros;
    return len === 32;
  }
  function findIn(str) {
    if (!str || str.length < 32) return null;
    const m = ADDR_RE.exec(str);
    if (m && isAddr(m[1])) return m[1];
    // Some sites glue a prefix with "_" or "-" (gmgn referral paths).
    const parts = str.split(/[^1-9A-HJ-NP-Za-km-z]+/);
    for (const p of parts) if (isAddr(p)) return p;
    return null;
  }
  function fromUrl(href) {
    let u;
    try { u = new URL(href, location.href); } catch (e) { return null; }
    for (const seg of u.pathname.split('/')) {
      const a = findIn(decodeURIComponent(seg));
      if (a) return a;
    }
    for (const [, v] of u.searchParams) {
      const a = findIn(v);
      if (a) return a;
    }
    return null;
  }
  function addrOfElement(el) {
    if (!el || el.nodeType !== 1) return null;
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const n = attrs[i].name;
      const v = attrs[i].value;
      if (!v || v.length < 32) continue;
      if (n === 'href') { const a = fromUrl(v); if (a) return a; continue; }
      if (n.startsWith('data-') || n === 'title' || n === 'aria-label' || n === 'value' || n === 'alt') {
        const a = findIn(v);
        if (a) return a;
      }
    }
    const tx = el.textContent;
    if (tx && tx.length >= 32 && tx.length <= 90) return findIn(tx);
    return null;
  }
  function addrNear(target) {
    let el = target;
    for (let d = 0; d < 6 && el && el !== document.body && el !== document.documentElement; d++) {
      const a = addrOfElement(el);
      if (a) return a;
      el = el.parentElement;
    }
    return null;
  }

  // Coin of the current page, from the URL.
  const PAGE_KEYS = new Set(['coin', 'meme', 'token', 'tokens', 'solana', 'lp', 't', 'pair', 'address']);
  function pageCoin() {
    if (!isScope()) return null;
    let u;
    try { u = new URL(location.href); } catch (e) { return null; }
    const segs = u.pathname.split('/').filter(Boolean);
    if (/solscan\.io$/.test(HOST) && segs[0] !== 'token') return null; // accounts/txs are not coins
    if (/pump\.fun$/.test(HOST) && segs.length === 1 && isAddr(segs[0])) return segs[0];
    for (let i = 1; i < segs.length; i++) {
      if (PAGE_KEYS.has(segs[i - 1].toLowerCase())) {
        const a = findIn(decodeURIComponent(segs[i]));
        if (a) return a;
      }
    }
    for (const k of ['address', 'token', 'mint', 'tokenAddress', 'pair']) {
      const v = u.searchParams.get(k);
      if (v && isAddr(v)) return v;
    }
    return null;
  }

  function isScope() {
    return hostMatches(HOST, MEMESCOPES) || hostMatches(HOST, (S && S.extraHosts) || []);
  }
  function isPrivateHost() {
    return HOST === 'localhost' || /\.(local|localhost|internal)$/.test(HOST) ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?$)/.test(HOST);
  }

  // ---------- messaging ----------
  function send(msg) {
    try {
      return Promise.resolve(api.runtime.sendMessage(msg)).then(
        (r) => r || { error: 'no answer' },
        () => ({ error: 'extension reloaded. refresh the page.' })
      );
    } catch (e) {
      return Promise.resolve({ error: 'extension reloaded. refresh the page.' });
    }
  }

  // ---------- state ----------
  let S = null;            // settings
  let mounted = false;
  let root = null;         // closed shadow root
  let hostEl = null;
  const ui = {};
  let baseMood = 'idle';
  let mood = 'idle';
  let moodTimer = 0;
  let blinkTimer = 0;
  let forcedSleep = false;
  let lastActive = Date.now();
  let lastScan = null;
  let siteResult = null;
  let health = null;
  let healthAt = 0;
  let history = [];
  let historyLoaded = false;

  // ---------- styles ----------
  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { --ink:#1E1B2E; --paper:#F6F3EE; --card:#FFFFFF; --muted:#6E6A7C; --line:#1E1B2E; --soft:#EFEAE2;
  --mint:#8EE3C8; --shadow:rgba(30,27,46,.85); --legit:#1F9E72; --mid:#C98A1B; --larp:#D2604C; --danger:#D43B3B;
  position: fixed; z-index: 2147483647; width: 64px; height: 64px;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--ink); -webkit-font-smoothing: antialiased; text-align: left; }
@media (prefers-color-scheme: dark) {
  .wrap, .chip { --ink:#F2EEF8; --paper:#1E1B2E; --card:#26223A; --muted:#A8A3B8; --line:#5A5474; --soft:#302B47; --shadow:rgba(0,0,0,.55); }
}
.pet { position: absolute; inset: 0; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.pet:active { cursor: grabbing; }
.bob { position: absolute; left: 0; top: 0; width: 64px; height: 64px; animation: bob 2.6s ease-in-out infinite; }
.sleep .bob { animation-duration: 4.5s; }
.pet canvas { width: 64px; height: 64px; image-rendering: pixelated; image-rendering: crisp-edges; display: block;
  filter: drop-shadow(0 2px 0 rgba(30,27,46,.18)); }
.pet .ground { position: absolute; left: 14px; right: 14px; bottom: -3px; height: 5px; border-radius: 50%;
  background: rgba(30,27,46,.14); animation: ground 2.6s ease-in-out infinite; }
.sleep .ground { animation-duration: 4.5s; }
@keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes ground { 0%,100% { transform: scaleX(1); } 50% { transform: scaleX(.86); opacity: .7; } }
.alertmode .bob { animation: shake .5s ease-in-out 3, bob 2.6s ease-in-out 1.5s infinite; }
@keyframes shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }
@media (prefers-reduced-motion: reduce) { .bob, .ground { animation: none !important; } }

.bubble { position: absolute; min-width: 120px; max-width: 250px; width: max-content; padding: 9px 11px; background: var(--card);
  color: var(--ink); border: 2px solid var(--line); border-radius: 12px; box-shadow: 3px 3px 0 var(--shadow);
  font-size: 13px; line-height: 1.35; opacity: 0; transform: translateY(4px); pointer-events: none;
  transition: opacity .16s, transform .16s; word-wrap: break-word; }
.bubble.show { opacity: 1; transform: none; pointer-events: auto; }
.bubble.alert { border-color: var(--danger); box-shadow: 3px 3px 0 var(--danger); }
.bubble.caution { border-color: var(--mid); box-shadow: 3px 3px 0 var(--mid); }
.bubble .who { font: 700 10px/1 ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace; letter-spacing: .06em; color: var(--muted); margin-bottom: 4px; }
.bubble .x { position: absolute; top: 3px; right: 5px; border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 15px; line-height: 1; padding: 2px; }
.bubble.sticky .txt { padding-right: 14px; }
.bubble .acts { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
.bubble .tail { position: absolute; width: 10px; height: 10px; background: var(--card); border-right: 2px solid var(--line); border-bottom: 2px solid var(--line); transform: rotate(45deg); }
.bubble.alert .tail { border-color: var(--danger); }
.bubble.caution .tail { border-color: var(--mid); }

button.btn { all: unset; box-sizing: border-box; cursor: pointer; font: 700 11px/1 ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace;
  letter-spacing: .06em; text-transform: uppercase; padding: 6px 9px; border: 2px solid var(--line); border-radius: 8px;
  background: var(--mint); color: #1E1B2E; box-shadow: 2px 2px 0 var(--shadow); }
button.btn:hover { transform: translate(-1px,-1px); box-shadow: 3px 3px 0 var(--shadow); }
button.btn.ghost { background: var(--soft); color: var(--ink); }

.panel { position: absolute; width: 340px; height: 470px; max-height: calc(100vh - 110px); display: none; flex-direction: column;
  background: var(--paper); color: var(--ink); border: 2px solid var(--line); border-radius: 14px; box-shadow: 4px 4px 0 var(--shadow); overflow: hidden; }
.panel.open { display: flex; }
.head { flex: none; display: flex; align-items: center; gap: 8px; padding: 9px 10px 9px 12px; border-bottom: 2px solid var(--line); background: var(--card); }
.head .nm { font: 700 12px/1 ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; }
.head .st { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 5px; }
.head .dot { width: 7px; height: 7px; border-radius: 50%; background: #B9B4C6; }
.head .dot.on { background: #2FB383; } .head .dot.off { background: var(--danger); }
.head .sp { flex: 1; }
.head button { all: unset; cursor: pointer; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; color: var(--muted); font: 700 15px/1 system-ui, sans-serif; }
.head button:hover { background: var(--soft); color: var(--ink); }
.msgs { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; scrollbar-width: thin; }
.m { max-width: 88%; padding: 7px 10px; border-radius: 11px; white-space: pre-wrap; word-wrap: break-word; }
.m.fp { align-self: flex-start; background: var(--card); border: 1.5px solid var(--line); border-bottom-left-radius: 3px; }
.m.fu { align-self: flex-end; background: var(--mint); color: #1E1B2E; border: 1.5px solid var(--line); border-bottom-right-radius: 3px; }
.m.err { border-color: var(--danger); }
.typing { align-self: flex-start; color: var(--muted); font-size: 12px; padding: 2px 4px; }
.typing i { display: inline-block; width: 5px; height: 5px; margin-right: 3px; background: var(--muted); border-radius: 1px; animation: dots 1s infinite; }
.typing i:nth-child(2) { animation-delay: .15s; } .typing i:nth-child(3) { animation-delay: .3s; }
@keyframes dots { 0%,100% { opacity: .25; } 50% { opacity: 1; } }
.inp { flex: none; display: flex; gap: 6px; padding: 9px; border-top: 2px solid var(--line); background: var(--card); }
.inp input { all: unset; box-sizing: border-box; flex: 1; min-width: 0; padding: 8px 10px; border: 1.5px solid var(--line); border-radius: 9px; background: var(--paper); color: var(--ink); font: 13px/1.3 system-ui, -apple-system, "Segoe UI", Inter, Roboto, sans-serif; }
.inp input::placeholder { color: var(--muted); }
.inp input:focus { box-shadow: 0 0 0 2px var(--mint); }

.card { align-self: stretch; background: var(--card); border: 2px solid var(--line); border-radius: 12px; padding: 11px; display: flex; flex-direction: column; gap: 9px; }
.card .top { display: flex; align-items: center; gap: 9px; }
.card .img { width: 38px; height: 38px; border-radius: 9px; border: 1.5px solid var(--line); object-fit: cover; background: var(--soft); flex: none; display: grid; place-items: center; font: 700 14px ui-monospace, Consolas, monospace; overflow: hidden; }
.card .img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.card .ttl { flex: 1; min-width: 0; }
.card .name { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card .sym { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 999px; color: #fff; font: 700 11px/1 ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }
.pill.legit, .pill.safe { background: var(--legit); } .pill.mid, .pill.caution { background: var(--mid); }
.pill.larp { background: var(--larp); } .pill.danger { background: var(--danger); }
.score { text-align: right; flex: none; }
.score b { font: 700 20px/1 ui-monospace, "Cascadia Mono", Consolas, monospace; }
.score span { color: var(--muted); font-size: 11px; }
.bar { height: 6px; border-radius: 3px; background: var(--soft); overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 3px; }
.sec { font: 700 10px/1 ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin-bottom: 3px; }
.txt2 { font-size: 12.5px; }
.flags { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; }
.flags li { display: flex; gap: 7px; align-items: baseline; }
.flags li b { flex: none; width: 14px; height: 14px; border-radius: 4px; display: inline-grid; place-items: center; color: #fff; font: 700 10px/1 ui-monospace, Consolas, monospace; transform: translateY(2px); }
.flags .good b { background: var(--legit); } .flags .warn b { background: var(--mid); } .flags .bad b { background: var(--danger); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); border: 1.5px solid var(--line); border-radius: 9px; overflow: hidden; }
.grid div { background: var(--card); padding: 6px 8px; min-width: 0; }
.grid small { display: block; color: var(--muted); font-size: 10.5px; }
.grid strong { display: block; font: 600 12.5px/1.3 ui-monospace, "Cascadia Mono", Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grid .bad { color: var(--danger); } .grid .good { color: var(--legit); } .grid .dim { color: var(--muted); font-weight: 400; }
.grid .wide { grid-column: 1 / -1; }
.tops { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; }
.tops li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tops a { color: var(--ink); font-weight: 600; text-decoration: none; border-bottom: 1.5px solid var(--mint); }
.tops a:hover { background: var(--mint); color: #1E1B2E; }
.tops .dim, .tops li.dim { color: var(--muted); }
.grid em { display: block; font: 11.5px/1.3 ui-monospace, "Cascadia Mono", Consolas, monospace; font-style: normal; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grid .tag { display: inline-block; margin-left: 5px; padding: 0 4px; border-radius: 4px; font: 700 9.5px/14px ui-monospace, Consolas, monospace; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; background: var(--danger); color: #fff; vertical-align: 1px; }
.links { display: flex; flex-wrap: wrap; gap: 6px; }
.links a { color: var(--ink); text-decoration: none; font-size: 12px; padding: 4px 8px; border: 1.5px solid var(--line); border-radius: 7px; background: var(--paper); }
.links a:hover { background: var(--mint); color: #1E1B2E; }
.meta { display: flex; gap: 8px; color: var(--muted); font-size: 11px; }
.meta .rules { border: 1px dashed var(--muted); border-radius: 5px; padding: 0 5px; }
.addr { font: 11px ui-monospace, Consolas, monospace; color: var(--muted); word-break: break-all; }

.chip { position: fixed; z-index: 2147483647; display: none; align-items: center; gap: 6px; padding: 5px 8px 5px 5px;
  background: #1E1B2E; color: #F6F3EE; border: 2px solid #1E1B2E; border-radius: 9px; box-shadow: 2px 2px 0 rgba(142,227,200,.9);
  font: 700 11px/1 ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace; letter-spacing: .06em; cursor: pointer; user-select: none; }
.chip.show { display: inline-flex; animation: pop .14s ease-out; }
.chip canvas { width: 20px; height: 20px; image-rendering: pixelated; }
.chip span.a { color: #8EE3C8; font-weight: 400; }
@keyframes pop { from { transform: scale(.85); opacity: 0; } to { transform: none; opacity: 1; } }

.mini { position: fixed; z-index: 2147483647; right: 0; bottom: 90px; display: none; width: 34px; height: 34px; padding: 3px; cursor: pointer;
  background: #F6F3EE; border: 2px solid #1E1B2E; border-right: 0; border-radius: 9px 0 0 9px; box-shadow: -2px 2px 0 rgba(30,27,46,.5); }
.mini.show { display: block; }
.mini canvas { width: 26px; height: 26px; image-rendering: pixelated; display: block; }
`;

  // ---------- small DOM helper (text only, never innerHTML for data) ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
  }
  const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

  // ---------- sprite drawing ----------
  function paint(canvas, m) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 16, 16);
    Sprite.draw(ctx, m, S.color, 1);
  }
  function setMood(m, ms) {
    clearTimeout(moodTimer);
    mood = m;
    redraw();
    if (ms) moodTimer = setTimeout(() => { mood = baseMood; redraw(); }, ms);
  }
  function setBase(m) { baseMood = m; setMood(m); }
  function redraw() {
    if (!mounted) return;
    paint(ui.canvas, mood);
    paint(ui.chipCanvas, 'happy');
    paint(ui.miniCanvas, mood === 'sleep' ? 'sleep' : 'idle');
    ui.wrap.classList.toggle('sleep', mood === 'sleep');
  }
  function scheduleBlink() {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      if (mounted && mood === 'idle' && !document.hidden) {
        paint(ui.canvas, 'blink');
        setTimeout(() => { if (mounted && mood === 'idle') paint(ui.canvas, 'idle'); }, 140);
      }
      scheduleBlink();
    }, 2500 + Math.random() * 4500);
  }

  // ---------- mount ----------
  function mount() {
    if (mounted) return;
    mounted = true;
    hostEl = document.createElement('pet-companion');
    hostEl.setAttribute('style', 'all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; display: block !important; contain: style !important;');
    root = hostEl.attachShadow({ mode: 'closed' });
    let styled = false;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
      styled = true;
    } catch (e) { /* older engines */ }
    if (!styled) root.appendChild(h('style', null, CSS));

    ui.canvas = h('canvas', { width: 16, height: 16, 'aria-hidden': 'true' });
    ui.bob = h('div', { class: 'bob' }, ui.canvas);
    ui.pet = h('div', { class: 'pet', title: S.petName, role: 'button', 'aria-label': S.petName }, h('div', { class: 'ground' }), ui.bob);
    ui.bubbleTxt = h('div', { class: 'txt' });
    ui.bubbleWho = h('div', { class: 'who' });
    ui.bubbleActs = h('div', { class: 'acts' });
    ui.bubbleX = h('button', { class: 'x', title: t().close, 'aria-label': t().close }, '×');
    ui.tail = h('div', { class: 'tail' });
    ui.bubble = h('div', { class: 'bubble', role: 'status' }, ui.bubbleX, ui.bubbleWho, ui.bubbleTxt, ui.bubbleActs, ui.tail);
    ui.dot = h('i', { class: 'dot' });
    ui.status = h('span', null, '');
    ui.title = h('span', { class: 'nm' }, S.petName);
    ui.msgs = h('div', { class: 'msgs' });
    ui.input = h('input', { type: 'text', placeholder: t().placeholder, maxlength: '600', 'aria-label': 'message' });
    ui.panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': S.petName },
      h('div', { class: 'head' }, ui.title, h('span', { class: 'st' }, ui.dot, ui.status), h('span', { class: 'sp' }),
        h('button', { title: t().minimize, 'aria-label': t().minimize, onclick: minimize }, '–'),
        h('button', { title: t().close, 'aria-label': t().close, onclick: () => openPanel(false) }, '×')),
      ui.msgs,
      h('div', { class: 'inp' }, ui.input, h('button', { class: 'btn', onclick: submit }, '→')));
    ui.wrap = h('div', { class: 'wrap' }, ui.panel, ui.bubble, ui.pet);
    ui.chipCanvas = h('canvas', { width: 16, height: 16 });
    ui.chipAddr = h('span', { class: 'a' });
    ui.chipLabel = h('span', null, t().sniff);
    ui.chip = h('div', { class: 'chip', role: 'button' }, ui.chipCanvas, ui.chipLabel, ui.chipAddr);
    ui.miniCanvas = h('canvas', { width: 16, height: 16 });
    ui.mini = h('div', { class: 'mini', title: S.petName, role: 'button' }, ui.miniCanvas);
    root.append(ui.wrap, ui.chip, ui.mini);
    // Keys typed in our UI must not trigger site hotkeys.
    for (const ev of ['keydown', 'keyup', 'keypress']) root.addEventListener(ev, (e) => e.stopPropagation());
    (document.documentElement || document.body).appendChild(hostEl);

    placeWrap();
    redraw();
    scheduleBlink();
    bindPet();
    ui.bubble.addEventListener('mouseenter', () => { bubbleHover = true; });
    ui.bubble.addEventListener('mouseleave', () => { bubbleHover = false; if (!bubbleSticky) armBubble(1500); });
    ui.bubbleX.addEventListener('click', (e) => { e.stopPropagation(); hideBubble(true); });
    ui.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } if (e.key === 'Escape') openPanel(false); });
    ui.chip.addEventListener('mouseenter', () => clearTimeout(chipTimer));
    ui.chip.addEventListener('mouseleave', () => armChip(1800));
    ui.chip.addEventListener('click', (e) => { e.stopPropagation(); const a = chipAddr; hideChip(); if (a) runScan(a, { open: true }); });
    ui.mini.addEventListener('click', () => setMinimized(false));
    window.addEventListener('resize', placeWrap, { passive: true });
    if (S.minimized) setMinimized(true, true);

    startActivity();
    if (isScope()) startSniff();
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    clearTimeout(blinkTimer); clearTimeout(moodTimer); clearTimeout(bubbleTimer); clearTimeout(chipTimer);
    stopSniff();
    stopActivity();
    window.removeEventListener('resize', placeWrap);
    try { hostEl.remove(); } catch (e) { /* ignore */ }
    hostEl = null; root = null;
  }

  // ---------- position / drag ----------
  function pos() {
    const p = S.pos || { right: 22, bottom: 22 };
    const maxR = Math.max(0, window.innerWidth - 64);
    const maxB = Math.max(0, window.innerHeight - 64);
    return { right: Math.min(Math.max(0, p.right), maxR), bottom: Math.min(Math.max(0, p.bottom), maxB) };
  }
  function placeWrap(p) {
    if (!mounted) return;
    p = p && p.right != null ? p : pos();
    ui.wrap.style.right = p.right + 'px';
    ui.wrap.style.bottom = p.bottom + 'px';
    layoutPopups(p);
  }
  // Panel and bubble open toward the middle of the screen.
  function layoutPopups(p) {
    p = p || pos();
    const petLeft = window.innerWidth - p.right - 64;
    const onRight = petLeft + 32 > window.innerWidth / 2;
    const onBottom = window.innerHeight - p.bottom - 32 > window.innerHeight / 2;
    for (const el of [ui.panel, ui.bubble]) {
      el.style.left = el.style.right = el.style.top = el.style.bottom = '';
      if (onRight) el.style.right = '0px'; else el.style.left = '0px';
      if (onBottom) el.style.bottom = (el === ui.panel ? 76 : 74) + 'px'; else el.style.top = (el === ui.panel ? 76 : 74) + 'px';
    }
    const ts = ui.tail.style;
    ts.left = ts.right = ts.top = ts.bottom = '';
    if (onRight) ts.right = '24px'; else ts.left = '24px';
    if (onBottom) { ts.bottom = '-7px'; ts.transform = 'rotate(45deg)'; } else { ts.top = '-7px'; ts.transform = 'rotate(225deg)'; }
    // Panel must stay on screen when the pet sits near an edge.
    const avail = onBottom ? window.innerHeight - p.bottom - 76 - 10 : p.bottom + 64 - 76 - 10;
    ui.panel.style.maxHeight = Math.max(200, Math.min(470, avail)) + 'px';
  }

  function bindPet() {
    let start = null;
    ui.pet.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = pos();
      start = { x: e.clientX, y: e.clientY, right: p.right, bottom: p.bottom, moved: false };
      try { ui.pet.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
    });
    ui.pet.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      start.moved = true;
      const right = Math.min(Math.max(0, start.right - dx), window.innerWidth - 64);
      const bottom = Math.min(Math.max(0, start.bottom - dy), window.innerHeight - 64);
      start.cur = { right, bottom };
      placeWrap(start.cur);
    });
    const end = (e) => {
      if (!start) return;
      const s = start;
      start = null;
      try { ui.pet.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (s.moved && s.cur) {
        S.pos = s.cur;
        save({ pos: s.cur });
      } else if (e.type === 'pointerup') {
        onPetClick();
      }
    };
    ui.pet.addEventListener('pointerup', end);
    ui.pet.addEventListener('pointercancel', end);
  }

  function onPetClick() {
    if (forcedSleep || mood === 'sleep') {
      forcedSleep = false;
      setBase('idle');
      setMood('happy', 1200);
      return;
    }
    if (bubbleSticky && ui.bubble.classList.contains('show') && !panelOpen()) {
      // A warning is up: open details.
      hideBubble(true);
    }
    openPanel(!panelOpen());
  }

  function save(patch) {
    try { api.storage.local.set(patch); } catch (e) { /* ignore */ }
  }

  function setMinimized(on, silent) {
    S.minimized = on;
    if (!silent) save({ minimized: on });
    if (!mounted) return;
    ui.wrap.style.display = on ? 'none' : '';
    ui.mini.classList.toggle('show', on);
    if (on) { hideChip(); }
  }
  function minimize() { openPanel(false); hideBubble(true); setMinimized(true); }

  // ---------- bubble ----------
  let bubbleTimer = 0, bubbleHover = false, bubbleSticky = false;
  function say(text, opts) {
    if (!mounted || !text) return;
    opts = opts || {};
    if (S.minimized && opts.level) setMinimized(false);
    if (S.minimized) return;
    if (panelOpen() && !opts.level && !opts.force) return; // panel shows it already
    clearTimeout(bubbleTimer);
    bubbleSticky = !!opts.sticky;
    ui.bubble.className = 'bubble show' + (opts.level === 'danger' ? ' alert' : opts.level === 'caution' ? ' caution' : '') + (bubbleSticky ? ' sticky' : '');
    ui.bubbleWho.textContent = opts.who || '';
    ui.bubbleWho.style.display = opts.who ? '' : 'none';
    ui.bubbleTxt.textContent = String(text).slice(0, 400);
    ui.bubbleX.style.display = bubbleSticky ? '' : 'none';
    ui.bubbleActs.textContent = '';
    for (const a of opts.actions || []) {
      ui.bubbleActs.appendChild(h('button', { class: 'btn' + (a.ghost ? ' ghost' : ''), onclick: (e) => { e.stopPropagation(); hideBubble(true); a.run(); } }, a.label));
    }
    ui.bubbleActs.style.display = (opts.actions || []).length ? '' : 'none';
    layoutPopups();
    if (!bubbleSticky) armBubble(3800 + Math.min(6000, String(text).length * 45));
    bubbleOnClose = opts.onClose || null;
  }
  let bubbleOnClose = null;
  function armBubble(ms) {
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { if (!bubbleHover) hideBubble(); }, ms);
  }
  function hideBubble(byUser) {
    clearTimeout(bubbleTimer);
    if (!mounted) return;
    ui.bubble.classList.remove('show');
    const cb = bubbleOnClose;
    bubbleOnClose = null;
    bubbleSticky = false;
    if (byUser && cb) cb();
  }

  // ---------- panel ----------
  const panelOpen = () => mounted && ui.panel.classList.contains('open');
  async function openPanel(on) {
    if (!mounted) return;
    if (on && S.minimized) setMinimized(false);
    ui.panel.classList.toggle('open', !!on);
    if (!on) return;
    hideBubble();
    hideChip();
    layoutPopups();
    if (forcedSleep) { forcedSleep = false; setBase('idle'); }
    await loadHistory();
    if (!history.length) addMsg({ role: 'pet', text: t().hello(S.petName) }, true);
    renderAll();
    setTimeout(() => { try { ui.input.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 30);
    refreshHealth();
  }

  async function refreshHealth() {
    if (Date.now() - healthAt < 60000 && health) return showHealth();
    healthAt = Date.now();
    health = await send({ type: 'health' });
    showHealth();
  }
  function showHealth() {
    if (!mounted) return;
    const ok = health && health.ok;
    ui.dot.className = 'dot ' + (ok ? 'on' : 'off');
    ui.status.textContent = ok ? (health.llm ? 'online' : 'online · ' + t().rules) : 'offline';
  }

  async function loadHistory() {
    if (historyLoaded) return;
    const r = await send({ type: 'history' });
    history = Array.isArray(r) ? r : [];
    historyLoaded = true;
  }
  function addMsg(item, quiet) {
    history.push(item);
    history = history.slice(-10);
    send({ type: 'pushHistory', item });
    if (!quiet && panelOpen()) renderAll();
  }
  function renderAll() {
    if (!mounted) return;
    ui.msgs.textContent = '';
    let last = null;
    for (const it of history) last = ui.msgs.appendChild(renderItem(it));
    if (busy) ui.msgs.appendChild(typingEl());
    // A fresh card shows from its top (verdict first); otherwise stick to the bottom.
    const lastIt = history[history.length - 1];
    if (!busy && last && lastIt && lastIt.role === 'card') {
      const prev = last.previousElementSibling;
      const anchor = prev && prev.classList.contains('fp') ? prev : last;
      ui.msgs.scrollTop = Math.max(0, anchor.offsetTop - ui.msgs.offsetTop - 8);
    } else {
      ui.msgs.scrollTop = ui.msgs.scrollHeight;
    }
  }
  function renderItem(it) {
    if (it.role === 'card' && it.kind === 'scan') return scanCard(it.data);
    if (it.role === 'card' && it.kind === 'site') return siteCard(it.data);
    return h('div', { class: 'm ' + (it.role === 'user' ? 'fu' : 'fp') + (it.err ? ' err' : '') }, String(it.text || ''));
  }
  let busy = 0;
  const typingEl = () => h('div', { class: 'typing' }, h('i'), h('i'), h('i'));
  function setBusy(on) {
    busy = Math.max(0, busy + (on ? 1 : -1));
    if (busy) setMood('think'); else if (mood === 'think') setMood(baseMood);
    if (panelOpen()) renderAll();
  }

  // ---------- formatting ----------
  const num = (n) => typeof n === 'number' && isFinite(n);
  function money(n) {
    if (!num(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(a < 1e4 ? 1 : 0) + 'K';
    return '$' + n.toFixed(a < 10 ? 2 : 0);
  }
  function age(hrs) {
    if (!num(hrs)) return '—';
    if (hrs < 1) return Math.max(1, Math.round(hrs * 60)) + 'm';
    if (hrs < 48) return Math.round(hrs) + 'h';
    if (hrs < 24 * 60) return Math.round(hrs / 24) + 'd';
    return (hrs / 24 / 365).toFixed(1) + 'y';
  }
  const pct = (n) => (num(n) ? (Math.abs(n) < 10 ? n.toFixed(1) : Math.round(n)) + '%' : '—');
  const short = (a) => (a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a || '');
  const kfmt = (n) => (!num(n) ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));
  const LABEL_COLOR = { legit: '#1F9E72', mid: '#C98A1B', larp: '#D2604C', danger: '#D43B3B' };

  // Known pump.fun PnL-leaderboard traders who hold the coin now. Up to 3 rows.
  function notableBlock(n, tt) {
    const F = tt.facts;
    const list = n && Array.isArray(n.list) ? n.list : [];
    if (!list.length) return null;
    const rows = list.slice(0, 3).map((p) => {
      const handle = typeof p.x === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(p.x) ? p.x : null;
      const wallet = typeof p.wallet === 'string' && isAddr(p.wallet) ? p.wallet : null;
      const who = handle
        ? h('a', { href: 'https://x.com/' + handle, target: '_blank', rel: 'noopener noreferrer' }, '@' + handle)
        : wallet
          ? h('a', { href: 'https://solscan.io/account/' + wallet, target: '_blank', rel: 'noopener noreferrer' }, p.name ? String(p.name).slice(0, 20) : short(wallet))
          : h('span', null, String(p.name || '?').slice(0, 20));
      const bits = [];
      const per = { today: ' today', 'this week': '/wk', 'this month': '/mo' }[p.pnlPeriod] || '';
      if (num(p.pnlUsd)) bits.push(F.made + ' ' + money(p.pnlUsd) + per);
      if (num(p.valueUsd)) bits.push(F.holdsNow + ' ' + money(p.valueUsd));
      return h('li', null, who, h('span', { class: 'dim' }, bits.length ? ' · ' + bits.join(' · ') : ''));
    });
    const count = num(n.count) ? n.count : list.length;
    if (count > 3) rows.push(h('li', { class: 'dim' }, '+' + (count - 3) + ' ' + F.more));
    return h('div', null, h('div', { class: 'sec' }, F.topTraders), h('ul', { class: 'tops' }, rows));
  }

  // Key facts. Cells with no data are left out; the dev row spans both columns.
  function factsGrid(f, tt) {
    const F = tt.facts;
    const holders = f.holders || {}, dev = f.dev || {}, x = f.x || {}, tr = f.traders || {};
    const cells = [];
    const cell = (k, ...val) => cells.push(h('div', null, h('small', null, ...[].concat(k)), h('strong', null, ...val)));
    const span = (txt, cls) => h('span', { class: cls || null }, txt);
    if (num(f.mcapUsd)) cell(F.mcap, money(f.mcapUsd));
    if (num(f.liqUsd)) cell(F.liq, money(f.liqUsd));
    if (num(f.ageHours)) cell(F.age, age(f.ageHours));
    if (num(f.vol24hUsd)) cell(F.vol, money(f.vol24hUsd));
    if (num(tr.feesSol)) {
      const cls = tr.painted ? 'bad' : tr.real ? 'good' : null;
      cell(tr.painted ? [F.traders, span(F.painted, 'tag')] : F.traders, span(sol(tr.feesSol) + ' SOL', cls));
    }
    if (num(holders.count)) cell(F.holders, kfmt(holders.count));
    if (num(holders.top10Pct)) cell(F.top10, span(pct(holders.top10Pct), holders.top10Pct > 40 ? 'bad' : null));
    if (num(holders.bundlersPct) || num(holders.snipersPct)) {
      cell(F.bs, span(pct(holders.bundlersPct), num(holders.bundlersPct) && holders.bundlersPct > 30 ? 'bad' : null), span(' / ', 'dim'),
        span(pct(holders.snipersPct), num(holders.snipersPct) && holders.snipersPct > 20 ? 'bad' : null));
    }
    if (num(x.followers)) cell(F.x, kfmt(x.followers));
    const gm = f.notable && f.notable.gmgn;
    if (gm && (num(gm.smart) || num(gm.renowned))) cell(F.gmgn, (num(gm.smart) ? String(gm.smart) : '—') + ' / ' + (num(gm.renowned) ? String(gm.renowned) : '—'));
    if (f.mintAuthority !== undefined || f.freezeAuthority !== undefined) {
      const on = (a) => a != null;
      if (!on(f.mintAuthority) && !on(f.freezeAuthority)) cell(F.auth, span(F.revoked, 'good'));
      else cell(F.auth, span(on(f.mintAuthority) ? tt.on : tt.off, on(f.mintAuthority) ? 'bad' : 'good'), span(' / ', 'dim'),
        span(on(f.freezeAuthority) ? tt.on : tt.off, on(f.freezeAuthority) ? 'bad' : 'good'));
    }
    if (cells.length % 2) cells[cells.length - 1].classList.add('wide');
    if (num(dev.launches)) {
      const parts = [span(dev.launches + ' ' + (dev.launches === 1 && F.launch ? F.launch : F.launches), dev.launches > 10 ? 'bad' : null)];
      if (num(dev.graduated)) parts.push(span(' · ' + dev.graduated + ' ' + F.grad));
      if (num(dev.realCoins)) parts.push(span(' · ' + dev.realCoins + ' ' + F.realCoins, dev.realCoins > 0 ? 'good' : null));
      if (num(dev.paintedCoins) && dev.paintedCoins >= 1) parts.push(span(' · ' + F.paintedN + ' ' + dev.paintedCoins, 'bad'));
      const top = Array.isArray(dev.top) && dev.top[0];
      const bestSym = (top && top.symbol) || (num(dev.bestMcapUsd) && dev.bestMcapUsd > 0 ? dev.bestSymbol : null);
      const bestAth = top && num(top.athUsd) ? top.athUsd : dev.bestMcapUsd;
      const best = bestSym && num(bestAth) && bestAth > 0 ? F.best + ' $' + String(bestSym).slice(0, 14) + ' ' + F.ath + ' ' + money(bestAth) : null;
      cells.push(h('div', { class: 'wide' }, h('small', null, F.dev), h('strong', null, ...parts), best ? h('em', null, best) : null));
    }
    return cells.length ? h('div', { class: 'grid' }, cells) : null;
  }
  const sol = (n) => (n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(1) : n.toFixed(2)).toString();

  function scanCard(d) {
    const tt = t();
    const v = d.verdict || {};
    const f = d.facts || {};
    const label = ['legit', 'mid', 'larp', 'danger'].includes(v.label) ? v.label : 'mid';
    const score = num(v.score) ? Math.max(0, Math.min(100, Math.round(v.score))) : null;
    const img = h('div', { class: 'img' }, (d.symbol || '?').slice(0, 2).toUpperCase());
    const src = safeUrl(d.image);
    if (src) {
      const im = h('img', { alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' });
      im.addEventListener('load', () => { img.textContent = ''; img.appendChild(im); });
      im.src = src;
    }
    const x = f.x || {};
    const mint = d.mint || '';
    const links = [];
    if (mint) {
      links.push(h('a', { href: 'https://dexscreener.com/solana/' + encodeURIComponent(mint), target: '_blank', rel: 'noopener noreferrer' }, 'dexscreener'));
      links.push(h('a', { href: 'https://solscan.io/token/' + encodeURIComponent(mint), target: '_blank', rel: 'noopener noreferrer' }, 'solscan'));
      if (f.onPumpCurve || /pump$/.test(mint)) links.push(h('a', { href: 'https://pump.fun/coin/' + encodeURIComponent(mint), target: '_blank', rel: 'noopener noreferrer' }, 'pump.fun'));
    }
    const L = f.links || {};
    if (safeUrl(L.twitter)) links.push(h('a', { href: L.twitter, target: '_blank', rel: 'noopener noreferrer' }, x.handle ? '@' + String(x.handle).replace(/^@/, '') : 'x'));
    if (safeUrl(L.website)) links.push(h('a', { href: L.website, target: '_blank', rel: 'noopener noreferrer' }, (f.website && f.website.domain) || 'site'));
    if (safeUrl(L.telegram)) links.push(h('a', { href: L.telegram, target: '_blank', rel: 'noopener noreferrer' }, 'telegram'));

    const flags = Array.isArray(v.flags) ? v.flags.slice(0, 8) : [];
    const mark = { good: '+', warn: '!', bad: '×' };
    return h('div', { class: 'card' },
      h('div', { class: 'top' }, img,
        h('div', { class: 'ttl' }, h('div', { class: 'name' }, d.name || short(mint) || '?'), h('div', { class: 'sym' }, (d.symbol ? '$' + d.symbol + ' · ' : '') + short(mint))),
        h('div', { class: 'score' }, h('b', null, score == null ? '—' : String(score)), h('span', null, '/100'))),
      h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('span', { class: 'pill ' + label }, tt.label[label] || label),
        h('div', { class: 'bar', style: 'flex:1' }, h('i', { style: `width:${score || 0}%;background:${LABEL_COLOR[label]}` }))),
      v.summary ? h('div', { class: 'txt2' }, String(v.summary)) : null,
      v.wallets ? h('div', null, h('div', { class: 'sec' }, tt.onWallets), h('div', { class: 'txt2' }, String(v.wallets))) : null,
      flags.length ? h('ul', { class: 'flags' }, flags.map((fl) => {
        const lv = ['good', 'warn', 'bad'].includes(fl && fl.level) ? fl.level : 'warn';
        return h('li', { class: lv }, h('b', null, mark[lv]), h('span', null, String((fl && fl.text) || '')));
      })) : null,
      notableBlock(f.notable, tt),
      factsGrid(f, tt),
      links.length ? h('div', { class: 'links' }, links) : null,
      h('div', { class: 'meta' },
        d.llm === false ? h('span', { class: 'rules', title: 'no AI for this one, rules only' }, tt.rules) : null,
        d.fromCache ? h('span', null, tt.cached) : null));
  }

  function siteCard(d) {
    const tt = t();
    const risk = ['safe', 'caution', 'danger'].includes(d.risk) ? d.risk : 'caution';
    const reasons = Array.isArray(d.reasons) ? d.reasons.slice(0, 8) : [];
    const mark = { safe: '+', caution: '!', danger: '×' };
    const lv = risk === 'safe' ? 'good' : risk === 'caution' ? 'warn' : 'bad';
    return h('div', { class: 'card' },
      h('div', { class: 'top' },
        h('div', { class: 'ttl' }, h('div', { class: 'name' }, d.domain || HOST), h('div', { class: 'sym' },
          [num(d.ageDays) ? tt.domainAge(d.ageDays) : null, d.registrar ? String(d.registrar) : null, d.listed ? String(d.listed) : null].filter(Boolean).join(' · ') || '—')),
        h('span', { class: 'pill ' + risk }, tt.risk[risk])),
      d.say ? h('div', { class: 'txt2' }, String(d.say)) : null,
      d.lookalike && d.lookalike.of ? h('div', { class: 'txt2' }, 'looks like ' + String(d.lookalike.of)) : null,
      reasons.length ? h('ul', { class: 'flags' }, reasons.map((r) => h('li', { class: lv }, h('b', null, mark[risk]), h('span', null, String(r))))) : null);
  }

  // ---------- actions ----------
  async function runScan(address, opts) {
    opts = opts || {};
    if (!isAddr(address)) { addMsg({ role: 'pet', text: t().badAddr, err: true }); if (opts.open) openPanel(true); return; }
    if (opts.open) await openPanel(true);
    if (!opts.open && !panelOpen()) say(t().sniffing + ' ' + short(address) + '…', { force: true });
    setBusy(true);
    const r = await send({ type: 'scan', address });
    setBusy(false);
    if (!r || r.error) {
      const msg = r && r.offline ? t().offline : String((r && r.error) || 'error');
      addMsg({ role: 'pet', text: msg, err: true });
      setMood('sad', 4000);
      if (!panelOpen()) say(msg);
      return;
    }
    lastScan = r;
    const label = r.verdict && r.verdict.label;
    const line = (r.verdict && r.verdict.say) || '';
    const open = panelOpen();
    if (line && open) addMsg({ role: 'pet', text: line }, true);
    addMsg({ role: 'card', kind: 'scan', data: r });
    setMood(label === 'legit' ? 'happy' : label === 'danger' ? 'alert' : label === 'larp' ? 'sad' : 'idle', 9000);
    if (line && !open) {
      const score = num(r.verdict && r.verdict.score) ? ' · ' + Math.round(r.verdict.score) + '/100' : '';
      say(line, { force: true, who: (r.symbol ? '$' + r.symbol : short(r.mint || address)) + ' · ' + (t().label[label] || label || '') + score,
        actions: [{ label: t().details, run: () => openPanel(true) }] });
    }
  }

  async function checkSite(opts) {
    opts = opts || {};
    const signals = collectSignals();
    if (opts.manual) setBusy(true);
    const r = await send({ type: 'site', url: location.href, signals, force: !!opts.manual });
    if (opts.manual) setBusy(false);
    if (!r || r.error) {
      if (opts.manual) addMsg({ role: 'pet', text: r && r.offline ? t().offline : String((r && r.error) || 'error'), err: true });
      return null;
    }
    siteResult = r;
    if (opts.manual) {
      addMsg({ role: 'card', kind: 'site', data: r });
      setMood(r.risk === 'safe' ? 'happy' : 'alert', 6000);
    }
    return r;
  }

  function warnSite(r) {
    if (!r || r.risk === 'safe' || !mounted) return;
    setBase('alert');
    ui.wrap.classList.add('alertmode');
    const level = r.risk === 'danger' ? 'danger' : 'caution';
    const text = r.say || (r.reasons || []).join(". ");
    say(text, {
      sticky: true, level, who: (r.domain || HOST) + ' · ' + (t().risk[r.risk] || r.risk),
      actions: [{ label: t().details, run: () => { addMsg({ role: 'card', kind: 'site', data: r }, true); openPanel(true); } }],
      onClose: () => {
        ui.wrap.classList.remove('alertmode');
        setBase('idle');
        send({ type: 'setFlag', key: 'dismissed:' + (r.domain || HOST) });
      },
    });
  }

  function collectSignals() {
    const sig = { walletButton: false, seedInput: false, title: String(document.title || '').slice(0, 200) };
    try {
      const btnRe = /^\s*(connect(\s+wallet)?|select\s+wallet|connect\s+phantom)\s*$/i;
      const els = document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]');
      for (let i = 0; i < els.length && i < 400; i++) {
        const tx = (els[i].textContent || els[i].value || '').trim();
        if (tx.length <= 30 && btnRe.test(tx)) { sig.walletButton = true; break; }
      }
      const seedRe = /(seed|recovery|secret|mnemonic|passphrase|private\s*key|12[\s-]*words?|24[\s-]*words?)/i;
      const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea');
      let small = 0;
      for (let i = 0; i < inputs.length && i < 300; i++) {
        const el = inputs[i];
        const lab = [el.placeholder, el.getAttribute('aria-label'), el.name, el.id, el.labels && el.labels[0] && el.labels[0].textContent].join(' ');
        if (seedRe.test(lab)) { sig.seedInput = true; break; }
        if (el.tagName === 'INPUT') small++;
      }
      // A grid of 12+ plain inputs on a page that talks about phrases.
      if (!sig.seedInput && small >= 12 && /phrase|words|seed|recovery/i.test((document.body && document.body.innerText || '').slice(0, 20000))) sig.seedInput = true;
    } catch (e) { /* ignore */ }
    // The title only goes along when the page looks wallet-related.
    if (!sig.walletButton && !sig.seedInput) sig.title = '';
    return sig;
  }

  // ---------- chat & commands ----------
  async function submit() {
    const text = ui.input.value.trim();
    if (!text) return;
    ui.input.value = '';
    await loadHistory();
    if (text.startsWith('/')) return command(text);
    addMsg({ role: 'user', text });
    setBusy(true);
    const messages = history.filter((m) => m.role === 'user' || m.role === 'pet').slice(-10)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.text || '').slice(0, 800) }));
    const page = {
      url: location.href.slice(0, 500),
      title: String(document.title || '').slice(0, 200),
      text: pageText(),
      lastScan: lastScan ? {
        mint: lastScan.mint, name: lastScan.name, symbol: lastScan.symbol,
        label: lastScan.verdict && lastScan.verdict.label, score: lastScan.verdict && lastScan.verdict.score,
        summary: lastScan.verdict && lastScan.verdict.summary,
      } : undefined,
    };
    const r = await send({ type: 'chat', messages, page });
    setBusy(false);
    if (!r || r.error) addMsg({ role: 'pet', text: r && r.offline ? t().offline : String((r && r.error) || 'error'), err: true });
    else addMsg({ role: 'pet', text: String(r.reply || '…') });
  }
  function pageText() {
    try {
      const raw = (document.body && document.body.innerText) || '';
      return raw.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, 4000);
    } catch (e) { return ''; }
  }

  async function command(text) {
    const [cmdRaw, ...rest] = text.split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    const arg = rest.join(' ').trim();
    addMsg({ role: 'user', text });
    const tt = t();
    switch (cmd) {
      case '/help': case '/?':
        addMsg({ role: 'pet', text: tt.help.join('\n') }); break;
      case '/scan': {
        const a = arg ? findIn(arg) || arg : pageCoin();
        if (!a) { addMsg({ role: 'pet', text: tt.noCoin }); break; }
        await runScan(a, { open: true });
        break;
      }
      case '/site':
        await checkSite({ manual: true }); break;
      case '/hide': {
        addMsg({ role: 'pet', text: tt.hidden });
        const list = Array.from(new Set((S.hiddenSites || []).concat([HOST])));
        setTimeout(() => save({ hiddenSites: list }), 1200);
        break;
      }
      case '/sleep':
        forcedSleep = true;
        openPanel(false);
        setBase('sleep');
        say(tt.sleeping, { force: true });
        break;
      case '/name': {
        const n = arg.replace(/[<>]/g, '').slice(0, 20).trim();
        if (!n) { addMsg({ role: 'pet', text: '/name <name>' }); break; }
        save({ petName: n });
        addMsg({ role: 'pet', text: tt.renamed(n) });
        setMood('happy', 2000);
        break;
      }
      case '/color': case '/colour': {
        const c = arg.toLowerCase();
        if (!Sprite.COLORS[c]) { addMsg({ role: 'pet', text: tt.colors }); break; }
        save({ color: c });
        addMsg({ role: 'pet', text: tt.recolored(c) });
        setMood('happy', 2000);
        break;
      }
      case '/mood': {
        const m = arg.toLowerCase();
        if (m && Sprite.MOODS[m] !== undefined) { setMood(m, 6000); addMsg({ role: 'pet', text: tt.mood(m) }); }
        else addMsg({ role: 'pet', text: tt.mood(mood) + '\n(' + Object.keys(Sprite.MOODS).join(', ') + ')' });
        break;
      }
      case '/settings': case '/options':
        send({ type: 'openOptions' }); break;
      case '/clear':
        history = []; send({ type: 'clearHistory' }); addMsg({ role: 'pet', text: tt.cleared }); break;
      default:
        addMsg({ role: 'pet', text: tt.help.join('\n') });
    }
    renderAll();
  }

  // ---------- hover sniffing (memescopes only) ----------
  let sniffOn = false, hoverAddr = null, hoverTimer = 0, chipTimer = 0, chipAddr = null, lastTarget = null;
  let mx = 0, my = 0;
  const recent = new Map(); // address -> time chip was shown/scanned
  function startSniff() {
    if (sniffOn) return;
    sniffOn = true;
    document.addEventListener('mouseover', onOver, { passive: true, capture: true });
    document.addEventListener('mousemove', onMove, { passive: true, capture: true });
  }
  function stopSniff() {
    sniffOn = false;
    document.removeEventListener('mouseover', onOver, { capture: true });
    document.removeEventListener('mousemove', onMove, { capture: true });
    clearTimeout(hoverTimer);
  }
  function onMove(e) { mx = e.clientX; my = e.clientY; }
  function onOver(e) {
    const tg = e.target;
    if (tg === lastTarget) return;
    lastTarget = tg;
    if (!mounted || tg === hostEl || S.minimized) return;
    if (!S.features.sniffChip && !S.features.autoScan) return;
    const a = addrNear(tg);
    if (a === hoverAddr) return;
    hoverAddr = a;
    clearTimeout(hoverTimer);
    if (!a) return;
    hoverTimer = setTimeout(() => {
      if (hoverAddr !== a) return;
      const seen = recent.get(a);
      if (seen && Date.now() - seen < 10000) return;
      recent.set(a, Date.now());
      if (recent.size > 300) recent.delete(recent.keys().next().value);
      if (S.features.autoScan) runScan(a, { auto: true });
      else showChip(a);
    }, 700);
  }
  function showChip(a) {
    chipAddr = a;
    ui.chipLabel.textContent = t().sniff;
    ui.chipAddr.textContent = short(a);
    ui.chip.classList.add('show');
    const w = ui.chip.offsetWidth || 130, hgt = ui.chip.offsetHeight || 30;
    let x = mx + 14, y = my + 16;
    if (x + w > window.innerWidth - 6) x = mx - w - 10;
    if (y + hgt > window.innerHeight - 6) y = my - hgt - 10;
    ui.chip.style.left = Math.max(4, x) + 'px';
    ui.chip.style.top = Math.max(4, y) + 'px';
    armChip(3200);
  }
  function armChip(ms) {
    clearTimeout(chipTimer);
    chipTimer = setTimeout(hideChip, ms);
  }
  function hideChip() {
    clearTimeout(chipTimer);
    chipAddr = null;
    if (mounted) ui.chip.classList.remove('show');
  }

  // Offer a scan when you land on a coin page (once per coin per session). SPAs: cheap URL poll.
  let lastHref = '', pagePoll = 0;
  function watchPage() {
    if (!isScope()) return;
    const tick = async () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      const c = pageCoin();
      if (!c || !mounted || !S.features.offerScan || S.minimized) return;
      const first = await send({ type: 'offerOnce', coin: c });
      if (first !== true) return;
      if (S.features.autoScan) return runScan(c, { auto: true });
      setMood('happy', 2500);
      say(t().offer, { who: short(c), actions: [{ label: t().offerBtn, run: () => runScan(c, { open: true }) }] });
    };
    tick();
    clearInterval(pagePoll);
    pagePoll = setInterval(() => { if (!document.hidden) tick(); }, 1500);
  }

  // ---------- idle sleep ----------
  let idleInt = 0;
  const touch = () => {
    lastActive = Date.now();
    if (mood === 'sleep' && !forcedSleep && baseMood === 'sleep') setBase('idle');
  };
  function startActivity() {
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'mousemove']) window.addEventListener(ev, touch, { passive: true, capture: true });
    idleInt = setInterval(() => {
      if (!mounted || !S.features.idleSleep || forcedSleep || busy) return;
      if (Date.now() - lastActive > (S.sleepMinutes || 10) * 60000 && baseMood === 'idle') setBase('sleep');
    }, 30000);
  }
  function stopActivity() {
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'mousemove']) window.removeEventListener(ev, touch, { capture: true });
    clearInterval(idleInt);
    clearInterval(pagePoll);
  }

  // ---------- messages from popup / background ----------
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;
    if (msg.type === 'ping') {
      sendResponse({ host: HOST, coin: pageCoin(), hidden: (S.hiddenSites || []).includes(HOST), enabled: S.enabled, scope: isScope() });
      return false;
    }
    if (msg.type === 'togglePanel') {
      if (!mounted) { sendResponse({ ok: false }); return false; }
      if (S.minimized) setMinimized(false);
      openPanel(!panelOpen());
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === 'scanPage') {
      if (!mounted) { sendResponse({ ok: false }); return false; }
      const a = msg.address || pageCoin();
      if (a) runScan(a, { open: true });
      else { openPanel(true).then(() => addMsg({ role: 'pet', text: t().noCoin })); }
      sendResponse({ ok: true, coin: a || null });
      return false;
    }
    if (msg.type === 'checkSite') {
      if (!mounted) { sendResponse({ ok: false }); return false; }
      openPanel(true).then(() => checkSite({ manual: true }));
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  // ---------- settings ----------
  function shouldShow() {
    return S.enabled && !(S.hiddenSites || []).includes(HOST);
  }
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !S) return;
    const next = {};
    for (const k in changes) next[k] = changes[k].newValue;
    const prevScope = isScope();
    S = withDefaults(Object.assign({}, S, next));
    if (shouldShow() && !mounted) { mount(); watchPage(); }
    else if (!shouldShow() && mounted) unmount();
    if (!mounted) return;
    if ('petName' in next) { ui.title.textContent = S.petName; ui.pet.title = S.petName; }
    if ('color' in next) redraw();
    if ('pos' in next) placeWrap();
    if ('minimized' in next) setMinimized(!!S.minimized, true);
    if ('extraHosts' in next && isScope() !== prevScope) { if (isScope()) { startSniff(); watchPage(); } else stopSniff(); }
  });

  async function init() {
    try { S = withDefaults(await api.storage.local.get(null)); } catch (e) { S = withDefaults({}); }
    if (!shouldShow()) return;
    mount();
    watchPage();
    if (S.features.siteWarnings && !isPrivateHost()) {
      // Let the page render its buttons first.
      setTimeout(async () => {
        if (!mounted) return;
        const r = await checkSite({});
        if (!r || r.risk === 'safe') return;
        if ((await send({ type: 'getFlag', key: 'dismissed:' + (r.domain || HOST) })) === true) return;
        warnSite(r, false);
      }, 1800);
    }
  }
  init();
})();
