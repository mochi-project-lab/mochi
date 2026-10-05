(function () {
  'use strict';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const COLORS = ['mint', 'peach', 'lilac', 'sky', 'lemon', 'rose', 'ghost'];
  const HEX = { mint: '#8EE3C8', peach: '#FFB89A', lilac: '#C3B1F5', sky: '#9CCBFF', lemon: '#FFE08A', rose: '#FF9EC4', ghost: '#E9ECF2' };
  const PERSONAS = ['chill', 'degen', 'nerd', 'mom'];

  // ---------- storage (optional; page works without it) ----------
  function load(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

  const state = { name: 'mochi', color: 'mint', persona: 'chill' };
  const saved = load('pet:settings', {});
  if (typeof saved.name === 'string') state.name = saved.name.slice(0, 16);
  if (COLORS.includes(saved.color)) state.color = saved.color;
  if (PERSONAS.includes(saved.persona)) state.persona = saved.persona;
  const save = () => store('pet:settings', { name: state.name, color: state.color, persona: state.persona });
  const petName = () => state.name.trim() || 'mochi';

  // DOM builder: text only, never innerHTML with server data
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }

  // ---------- pet ----------
  function shiftEyes(g, dx, dy) {
    if (!dx && !dy) return g;
    const pts = [];
    for (let y = 5; y <= 11; y++) for (let x = 1; x < 15; x++) if (g[y][x] === 'e' || g[y][x] === 'w') pts.push([x, y, g[y][x]]);
    const isEye = (x, y) => pts.some((p) => p[0] === x && p[1] === y);
    const ok = pts.every(([x, y]) => { const t = g[y + dy] && g[y + dy][x + dx]; return t === 'b' || (t && isEye(x + dx, y + dy)); });
    if (!ok) return g;
    pts.forEach(([x, y]) => { g[y][x] = 'b'; });
    pts.forEach(([x, y, k]) => { g[y + dy][x + dx] = k; });
    return g;
  }

  const pet = {
    c: null, ctx: null, mood: 'idle', eye: [0, 0], blink: false, last: '', px: 0,
    init(canvas) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.resize();
      addEventListener('resize', () => this.resize());
      const loop = () => {
        setTimeout(() => {
          if (this.mood === 'idle' || this.mood === 'think') { this.blink = true; setTimeout(() => { this.blink = false; }, 140); }
          loop();
        }, 2200 + Math.random() * 3600);
      };
      loop();
      const tick = () => { this.render(); requestAnimationFrame(tick); };
      tick();
    },
    resize() {
      const w = innerWidth, hh = innerHeight;
      const px = w < 600 ? (hh < 700 ? 8 : 10) : hh < 720 ? 11 : 14;
      if (px === this.px) return;
      this.px = px;
      const dpr = Math.max(1, Math.round(devicePixelRatio || 1));
      this.cell = px * dpr;
      this.c.width = this.c.height = 16 * this.cell;
      this.c.style.width = this.c.style.height = 16 * px + 'px';
      this.last = '';
    },
    render() {
      const S = window.PetSprite;
      const mood = this.blink ? 'blink' : this.mood;
      const key = mood + state.color + this.eye.join() + this.cell + darkQ.matches;
      if (key === this.last) return;
      this.last = key;
      let g = S.grid(mood).map((r) => r.split(''));
      if (mood !== 'sleep') g = shiftEyes(g, this.eye[0], this.eye[1]);
      this.ctx.clearRect(0, 0, this.c.width, this.c.height);
      drawGrid(this.ctx, g, this.cell);
    },
  };

  // dark mode: light outline so the pet reads on the dark background
  const darkQ = matchMedia('(prefers-color-scheme: dark)');
  function drawGrid(ctx, g, c) {
    const pal = Object.assign({}, window.PetSprite.palette(state.color));
    if (darkQ.matches) pal.o = '#EEEAE3';
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const k = g[y][x]; if (k === '.') continue;
      ctx.fillStyle = pal[k]; ctx.fillRect(x * c, y * c, c, c);
    }
  }

  let lastMove = Date.now();
  addEventListener('pointermove', (e) => {
    lastMove = Date.now();
    const r = pet.c.getBoundingClientRect();
    const vx = e.clientX - (r.left + r.width / 2), vy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(vx, vy) || 1;
    pet.eye = d > r.width * 0.35 ? [Math.abs(vx / d) > 0.38 ? Math.sign(vx) : 0, vy / d < -0.55 ? -1 : vy / d > 0.6 ? 1 : 0] : [0, 0];
  }, { passive: true });
  addEventListener('keydown', () => { lastMove = Date.now(); });

  // ---------- bubble ----------
  const bubble = $('#bubble');
  let typingId = 0;
  function say(text) {
    $('.who', bubble).textContent = petName();
    const t = $('.text', bubble), id = ++typingId;
    if (reduced) { t.textContent = text; return; }
    t.textContent = ''; t.classList.add('caret');
    let i = 0;
    (function step() {
      if (id !== typingId) return;
      i += 2; t.textContent = text.slice(0, i);
      if (i < text.length) setTimeout(step, 16); else t.classList.remove('caret');
    })();
  }

  // ---------- lines ----------
  const IDLE = ["paste a coin. i'll sniff it.", 'got a sketchy link? drop it here.', 'ca, pair or link. i read them all.', 'i check the holders, the dev and the x account.'];
  const HELLO = {
    chill: "hi. i'm {n}.", degen: 'gm ser. {n} reporting.', nerd: '{n} online. ready to read the chain.', mom: "hi sweetie, it's {n}.",
  };
  const BOOPS = ['boop.', 'that tickles.', 'i only eat clean charts.', 'hi again.'];

  // ---------- idle behaviour ----------
  let busy = false, hasResult = false, idleI = 0, asleep = false;
  function idleLine() { if (!busy && !hasResult && !asleep) say(IDLE[idleI++ % IDLE.length]); }
  setInterval(() => { if (Date.now() - lastMove > 4000) idleLine(); }, 9000);
  setInterval(() => {
    const quiet = Date.now() - lastMove > 45000;
    if (quiet && !asleep && !busy && !document.hidden && !hasResult) { asleep = true; pet.mood = 'sleep'; say('zzz'); }
    if (!quiet && asleep) { asleep = false; pet.mood = 'idle'; say('oh. hi.'); }
  }, 1000);

  // ---------- identicon ----------
  function ident(seed) {
    let n = 2166136261;
    for (const ch of String(seed)) { n ^= ch.charCodeAt(0); n = Math.imul(n, 16777619) >>> 0; }
    const fg = ['#8EE3C8', '#FFB89A', '#C3B1F5', '#9CCBFF', '#FFE08A', '#FF9EC4'][n % 6];
    let r = '';
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
      n = Math.imul(n ^ (n >>> 13), 1103515245) >>> 0;
      if (n & 8) { r += `<rect x="${x + 1}" y="${y + 1}" width="1" height="1"/>`; if (x < 2) r += `<rect x="${5 - x}" y="${y + 1}" width="1" height="1"/>`; }
    }
    const span = document.createElement('span');
    span.className = 'ident'; span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg viewBox="0 0 7 7" shape-rendering="crispEdges"><rect width="7" height="7" fill="#1E1B2E"/><g fill="${fg}">${r}</g></svg>`;
    return span;
  }

  // ---------- formatting ----------
  const fin = (n) => typeof n === 'number' && isFinite(n);
  const fmtUsd = (n) => {
    if (!fin(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  };
  const fmtAge = (hrs) => !fin(hrs) ? '—' : hrs < 1 ? Math.max(1, Math.round(hrs * 60)) + 'm' : hrs < 48 ? Math.round(hrs) + 'h' : Math.round(hrs / 24) + 'd';
  const fmtPct = (n) => !fin(n) ? '—' : (Math.round(n * 10) / 10) + '%';
  const fmtNum = (n) => !fin(n) ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(n);
  const fmtSol = (n) => !fin(n) ? '—' : n >= 100 ? String(Math.round(n)) : n >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
  const short = (a) => a.length > 14 ? a.slice(0, 4) + '…' + a.slice(-4) : a;

  // ---------- input parsing ----------
  const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const SCOPES = /(^|\.)(axiom\.trade|gmgn\.ai|pump\.fun|dexscreener\.com|photon-sol\.tinyastro\.io|bullx\.io|birdeye\.so|solscan\.io|jup\.ag|raydium\.io)$/i;
  function parse(raw) {
    const v = raw.trim();
    if (!v) return null;
    if (B58.test(v)) return { kind: 'token', value: v };
    let u;
    try { u = new URL(/^[a-z]+:\/\//i.test(v) ? v : 'https://' + v); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol) || !/\.[a-z]{2,}$/i.test(u.hostname)) return null;
    // a link to a coin on a memescope -> check the coin, not the site
    if (SCOPES.test(u.hostname)) {
      const parts = (u.pathname + '/' + u.search.replace(/[?&=]/g, '/')).split('/').reverse();
      const addr = parts.find((p) => B58.test(p));
      if (addr) return { kind: 'token', value: addr };
    }
    return { kind: 'site', value: u.href };
  }

  // ---------- check ----------
  const form = $('#checkForm'), input = $('#checkInput'), out = $('#checkOut'), result = $('#result');
  const stage = $('#stage');
  let run = 0, lastQuery = '';

  const MOOD_OF = { legit: 'happy', mid: 'idle', larp: 'sad', danger: 'alert', safe: 'happy', caution: 'think' };
  const FILL_OF = { legit: 'var(--good)', mid: 'var(--warn)', larp: 'var(--larp-fg)', danger: 'var(--bad)' };

  function showResult(node) {
    out.replaceChildren(node);
    result.hidden = false; hasResult = true;
    document.body.classList.add('has-result');
  }
  function clearResult() {
    run++; busy = false; hasResult = false;
    result.hidden = true; out.replaceChildren();
    document.body.classList.remove('has-result');
    pet.mood = 'idle';
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    say(IDLE[0]);
  }

  function react(mood) {
    pet.mood = mood;
    if (reduced) return;
    const cls = mood === 'alert' ? 'shake' : mood === 'happy' ? 'hop' : null;
    if (!cls) return;
    stage.classList.remove('shake', 'hop'); void stage.offsetWidth; stage.classList.add(cls);
  }

  async function post(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error((data && data.error) || 'HTTP ' + r.status); err.status = r.status; throw err; }
    if (!data) throw new Error('empty response');
    return data;
  }

  async function check(raw) {
    const q = parse(raw);
    if (!q) {
      pet.mood = 'think';
      say("that's not an address or a link. try again?");
      input.focus();
      return;
    }
    const id = ++run;
    busy = true; asleep = false; lastMove = Date.now();
    lastQuery = raw.trim();
    try { history.replaceState(null, '', '?check=' + encodeURIComponent(lastQuery)); } catch (e) {}
    pet.mood = 'think';
    say(q.kind === 'token' ? 'sniffing… holders, dev, x.' : 'checking this site…');
    const steps = q.kind === 'token' ? ['reading holders', 'checking the dev', 'looking at the X account'] : ['looking up the domain', 'comparing with known sites'];
    const list = h('div', { class: 'loading' }, steps.map((s) => h('span', null, s + '…')));
    showResult(h('div', { class: 'card px-box' }, list));
    $$('span', list).forEach((s, k) => setTimeout(() => { if (id === run) s.classList.add('done'); }, 700 * (k + 1)));
    out.setAttribute('aria-busy', 'true');

    const common = { lang: 'en', persona: state.persona, petName: petName() };
    try {
      const data = q.kind === 'token'
        ? await post('/api/token', Object.assign({ address: q.value }, common))
        : await post('/api/site', Object.assign({ url: q.value }, common));
      if (id !== run) return;
      if (q.kind === 'token') tokenCard(data, lastQuery); else siteCard(data, lastQuery);
      if (innerWidth <= 900) result.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    } catch (err) {
      if (id === run) fail(err);
    } finally {
      if (id === run) { busy = false; out.removeAttribute('aria-busy'); }
    }
  }

  function fail(err) {
    pet.mood = 'sad';
    let line;
    if (err.status === 429) line = 'too many sniffs. give me a minute.';
    else if (err.status && err.status < 500) line = "hm, i couldn't read that one: " + String(err.message).slice(0, 120);
    else if (err.status) line = 'my nose is blocked. try again in a bit.';
    else line = "can't reach the server right now.";
    say(line);
    // errors live in the bubble only; no empty card next to it
    result.hidden = true; out.replaceChildren(); hasResult = false;
    document.body.classList.remove('has-result');
  }

  function scoreBlock(score, label) {
    const bar = h('div', { class: 'bar10', style: `--fill:${FILL_OF[label]}`, 'aria-hidden': 'true' });
    for (let i = 0; i < 10; i++) bar.append(h('i', { class: i < Math.round(score / 10) ? 'f' : null }));
    return h('div', { class: 'score', role: 'img', 'aria-label': `score ${score} of 100` }, h('span', { class: 'score-num' }, String(score)), h('span', { class: 'score-of' }, '/100'), bar);
  }
  const flagList = (flags) => h('ul', { class: 'flags' }, flags.map(([lv, tx]) => h('li', { class: lv }, tx)));
  const fact = (label, value, cls) => h('div', { class: cls || null }, h('dt', null, label), h('dd', { title: value }, value));

  function tokenCard(d, query) {
    const f = d.facts || {}, v = d.verdict || {}, hol = f.holders || {}, dev = f.dev || {}, x = f.x || {};
    const label = ['legit', 'mid', 'larp', 'danger'].includes(v.label) ? v.label : 'mid';
    const score = Math.max(0, Math.min(100, Math.round(Number(v.score) || 0)));
    react(MOOD_OF[label]);
    say(v.say || v.summary || 'done.');

    let pic = ident(d.mint || d.symbol || 'x');
    if (typeof d.image === 'string' && /^https:\/\//.test(d.image)) {
      const img = h('img', { class: 'ident', src: d.image, alt: '', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.replaceWith(ident(d.mint || 'x')));
      pic = img;
    }
    const flags = Array.isArray(v.flags) ? v.flags.filter((x) => x && x.text).map((x) => [['good', 'warn', 'bad'].includes(x.level) ? x.level : 'warn', x.text]) : [];
    const xVal = x.handle ? '@' + x.handle + (fin(x.followers) ? ' · ' + fmtNum(x.followers) : '') : 'none';
    const auth = (a) => (a == null ? 'revoked' : 'active');
    const tr = f.traders || {};
    const notable = f.notable || {};
    const traders = Array.isArray(notable.list) && notable.count > 0 ? notable.list.filter(Boolean).slice(0, 3) : [];
    const gm = notable.gmgn && typeof notable.gmgn === 'object' ? notable.gmgn : null;
    let devCell = null;
    if (fin(dev.launches)) {
      const parts = dev.launches <= 1 && !dev.graduated ? ['first coin'] : [dev.launches + ' made', (dev.graduated || 0) + ' grad'];
      if (fin(dev.realCoins) && dev.realCoins > 0) parts.push(dev.realCoins + ' real');
      const dd = h('dd', null, parts.join(' · '));
      if (fin(dev.paintedCoins) && dev.paintedCoins > 0) dd.append(' · ', h('span', { class: 'red' }, 'painted ' + dev.paintedCoins));
      dd.title = dd.textContent;
      devCell = h('div', { class: 'wide' }, h('dt', null, 'Dev'), dd);
    }
    const pastCoins = Array.isArray(dev.top) ? dev.top.filter((c) => c && c.symbol && c.symbol !== d.symbol).slice(0, 3) : [];

    showResult(h('div', { class: 'card px-box' },
      h('div', { class: 'card-top' }, pic,
        h('div', { class: 'card-name' }, h('b', null, d.name || 'Unknown coin'),
          h('small', null, [d.symbol ? '$' + d.symbol : null, d.mint ? short(d.mint) : null].filter(Boolean).join(' · '))),
        h('span', { class: 'pill ' + label }, label)),
      scoreBlock(score, label),
      v.summary ? h('p', { class: 'summary' }, v.summary) : null,
      flags.length ? flagList(flags) : null,
      v.wallets ? h('p', { class: 'wallets' }, h('b', null, 'On wallets: '), v.wallets) : null,
      pastCoins.length ? h('p', { class: 'wallets past' }, h('b', null, "Dev's past coins: "),
        pastCoins.map((c, i) => [i ? ' · ' : '', h('span', { class: 'coin-sym' }, '$' + c.symbol), ' ath ' + fmtUsd(c.athUsd) + (fin(c.feesSol) ? ', ' + fmtSol(c.feesSol) + ' SOL fees' : '')])) : null,
      traders.length ? h('div', { class: 'wallets notable' }, h('b', null, 'Top traders in it'),
        h('ul', null, traders.map((t) => {
          const handle = typeof t.x === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(t.x) ? t.x : null;
          const wallet = typeof t.wallet === 'string' && B58.test(t.wallet) ? t.wallet : null;
          const who = handle
            ? h('a', { href: 'https://x.com/' + handle, target: '_blank', rel: 'noopener noreferrer' }, '@' + handle)
            : wallet
              ? h('a', { href: 'https://solscan.io/account/' + wallet, target: '_blank', rel: 'noopener noreferrer' }, t.name ? String(t.name) : short(wallet))
              : h('span', null, String(t.name || 'trader'));
          const made = fin(t.pnlUsd) ? ' made ' + fmtUsd(t.pnlUsd) + ' ' + (['today', 'this week', 'this month'].includes(t.pnlPeriod) ? t.pnlPeriod : 'lately') : '';
          const holds = fin(t.valueUsd) ? ', holds ' + fmtUsd(t.valueUsd) : '';
          return h('li', null, who, made + holds);
        })),
        notable.count > traders.length ? h('span', { class: 'more' }, '+' + (notable.count - traders.length) + ' more') : null) : null,
      h('dl', { class: 'facts' }, [
        fin(f.mcapUsd) && fact('Market cap', fmtUsd(f.mcapUsd)),
        fin(f.liqUsd) && fact('Liquidity', fmtUsd(f.liqUsd)),
        fin(f.ageHours) && fact('Age', fmtAge(f.ageHours)),
        fin(hol.count) && fact('Holders', fmtNum(hol.count)),
        fin(hol.top10Pct) && fact('Top 10', fmtPct(hol.top10Pct)),
        fin(hol.bundlersPct) && fact('Bundlers', fmtPct(hol.bundlersPct), hol.bundlersPct > 30 ? 'no' : null),
        fin(hol.snipersPct) && fact('Snipers', fmtPct(hol.snipersPct), hol.snipersPct > 20 ? 'no' : null),
        gm && (fin(gm.smart) || fin(gm.renowned)) && fact('Smart / KOLs', (fin(gm.smart) ? gm.smart : '—') + ' / ' + (fin(gm.renowned) ? gm.renowned : '—')),
        x.handle && fact('X', xVal),
        f.mintAuthority !== undefined && fact('Mint', auth(f.mintAuthority), f.mintAuthority == null ? 'ok' : 'no'),
        f.freezeAuthority !== undefined && fact('Freeze', auth(f.freezeAuthority), f.freezeAuthority == null ? 'ok' : 'no'),
        fin(tr.feesSol) && fact('Traders paid', fmtSol(tr.feesSol) + ' SOL' + (tr.painted ? ' · painted chart' : ''), (tr.painted ? 'no' : tr.real ? 'ok' : '') + ' wide'),
        devCell,
      ].filter(Boolean)),
      d.llm === false ? h('p', { class: 'mode' }, 'the AI is resting, this read is rule-based') : null));
    remember({ q: query, t: d.symbol ? '$' + d.symbol : short(d.mint || query), l: label });
  }

  function siteCard(d, query) {
    const risk = ['safe', 'caution', 'danger'].includes(d.risk) ? d.risk : 'caution';
    const pill = { safe: 'legit', caution: 'mid', danger: 'danger' }[risk];
    react(MOOD_OF[risk]);
    say(d.say || (risk === 'safe' ? 'looks fine.' : 'careful here.'));
    const lvl = { safe: 'good', caution: 'warn', danger: 'bad' }[risk];
    const reasons = Array.isArray(d.reasons) ? d.reasons.filter(Boolean) : [];
    const age = fin(d.ageDays) ? (d.ageDays < 365 ? d.ageDays + (d.ageDays === 1 ? ' day' : ' days') : Math.floor(d.ageDays / 365) + ' y') : '—';
    showResult(h('div', { class: 'card px-box' },
      h('div', { class: 'card-top' }, h('span', { class: 'site-dom' }, d.domain || ''), h('span', { class: 'pill ' + pill }, risk)),
      reasons.length ? flagList(reasons.map((r) => [lvl, String(r)])) : null,
      (() => {
        const rows = [
          fin(d.ageDays) && fact('Domain age', age, d.ageDays < 30 ? 'no' : null),
          d.registrar && fact('Registrar', String(d.registrar)),
          fact('Lists', d.listed || 'not listed', d.listed === 'phishing' ? 'no' : d.listed === 'trusted' ? 'ok' : null),
          d.lookalike && d.lookalike.of && fact('Looks like', String(d.lookalike.of), 'no'),
        ].filter(Boolean);
        return h('dl', { class: 'facts' }, rows);
      })()));
    remember({ q: query, t: d.domain || query, l: risk });
  }

  // ---------- recent ----------
  let recent = load('pet:recent', []);
  if (!Array.isArray(recent)) recent = [];
  function remember(item) {
    recent = [item].concat(recent.filter((r) => r && r.q !== item.q)).slice(0, 5);
    store('pet:recent', recent);
    drawRecent();
  }
  function drawRecent() {
    const ul = $('#recentList');
    ul.replaceChildren(...recent.filter((r) => r && typeof r.q === 'string').map((r) => {
      const b = h('button', { type: 'button', title: r.q }, h('i', { class: 'dot ' + (r.l || '') }), h('span', null, String(r.t || r.q)));
      b.addEventListener('click', () => { input.value = r.q; check(r.q); });
      return h('li', null, b);
    }));
    $('#recent').hidden = recent.length === 0;
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); check(input.value); });
  $('#clearBtn').addEventListener('click', () => { clearResult(); input.value = ''; input.focus(); });
  $('#copyLink').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const url = location.origin + location.pathname + '?check=' + encodeURIComponent(lastQuery);
    try { await navigator.clipboard.writeText(url); btn.textContent = 'copied'; }
    catch (err) { input.value = url; input.select(); btn.textContent = 'select + copy'; }
    setTimeout(() => { btn.textContent = 'copy link'; }, 1600);
  });

  // ---------- settings ----------
  const settings = $('#settings'), gear = $('#gear');
  function openSettings(open) {
    settings.hidden = !open;
    gear.setAttribute('aria-expanded', String(open));
    stage.setAttribute('aria-expanded', String(open));
    if (open) $('#nameInput').focus({ preventScroll: true });
  }
  gear.addEventListener('click', () => openSettings(settings.hidden));
  $('#setClose').addEventListener('click', () => { openSettings(false); gear.focus(); });

  let boop = 0;
  stage.addEventListener('click', () => {
    lastMove = Date.now(); asleep = false;
    if (!busy) {
      const prev = hasResult ? pet.mood : 'idle';
      pet.mood = 'happy';
      if (!hasResult) say(BOOPS[boop++ % BOOPS.length]);
      if (!reduced) { stage.classList.remove('hop', 'shake'); void stage.offsetWidth; stage.classList.add('hop'); }
      setTimeout(() => { if (!busy && pet.mood === 'happy') pet.mood = prev; }, 1500);
    }
    openSettings(settings.hidden);
  });

  const nameInput = $('#nameInput');
  nameInput.value = state.name;
  nameInput.addEventListener('input', () => {
    state.name = nameInput.value.replace(/[<>]/g, '').slice(0, 16); save();
    $('.who', bubble).textContent = petName();
  });

  function pressed(sel, attr, val) { $$(sel).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === val))); }
  $$('#personas button').forEach((b) => b.addEventListener('click', () => {
    state.persona = b.dataset.p; save(); pressed('#personas button', 'p', state.persona);
    if (!busy && !hasResult) say(HELLO[state.persona].replace('{n}', petName()));
  }));
  pressed('#personas button', 'p', state.persona);

  $$('.swatches').forEach((group) => COLORS.forEach((c) => {
    const b = h('button', { class: 'swatch', type: 'button', style: `--c:${HEX[c]}`, 'aria-label': c, title: c, 'data-c': c, 'aria-pressed': String(c === state.color) });
    b.addEventListener('click', () => {
      state.color = c; save();
      $$('.swatch').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.c === c)));
      drawLogos();
    });
    group.append(b);
  }));

  function drawLogos() {
    $$('canvas.logo-pet').forEach((cv) => { const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, 32, 32); drawGrid(ctx, window.PetSprite.grid('happy'), 2); });
  }

  // ---------- commands popover + extension drawer ----------
  const cmdBtn = $('#cmdBtn'), cmdPop = $('#cmdPop');
  function openCmds(open) { cmdPop.hidden = !open; cmdBtn.setAttribute('aria-expanded', String(open)); }
  cmdBtn.addEventListener('click', (e) => { e.stopPropagation(); openCmds(cmdPop.hidden); });

  const ext = $('#ext');
  $('#extBtn').addEventListener('click', () => { openCmds(false); if (ext.showModal) ext.showModal(); else ext.setAttribute('open', ''); });
  $('#extClose').addEventListener('click', () => ext.close ? ext.close() : ext.removeAttribute('open'));
  ext.addEventListener('click', (e) => { if (e.target === ext) ext.close(); });

  document.addEventListener('click', (e) => {
    if (!cmdPop.hidden && !cmdPop.contains(e.target) && e.target !== cmdBtn) openCmds(false);
    if (!settings.hidden && !settings.contains(e.target) && !gear.contains(e.target) && !stage.contains(e.target)) openSettings(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!cmdPop.hidden) { openCmds(false); cmdBtn.focus(); }
    if (!settings.hidden) { openSettings(false); gear.focus(); }
  });

  // ---------- boot ----------
  if (!window.PetSprite) { console.warn('Mochi: sprite.js missing'); return; }
  pet.init($('#pet'));
  drawLogos();
  drawRecent();
  if (darkQ.addEventListener) darkQ.addEventListener('change', drawLogos);
  const pre = new URLSearchParams(location.search).get('check');
  if (pre) { input.value = pre.slice(0, 300); check(input.value); }
  else say(IDLE[0]);
})();
