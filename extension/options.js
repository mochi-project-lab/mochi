/* global PetSprite, PetCommon */
(async function () {
  'use strict';
  const api = globalThis.browser || globalThis.chrome;
  const { withDefaults, DEFAULTS, PERSONAS, cleanBackend } = PetCommon;
  const $ = (id) => document.getElementById(id);
  let S = withDefaults(await api.storage.local.get(null));
  let pvMood = 'happy';

  const LINES = {
    en: { chill: "hi, i'm {n}. i'll keep an eye on things.", degen: 'gm ser. {n} here. show me what you aped.', nerd: '{n} online. give me a mint, i give you numbers.', mom: "hi sweetie, it's {n}. don't connect your wallet to strangers." },
  };

  // ---------- save ----------
  let savedT = 0;
  async function save(patch) {
    Object.assign(S, patch);
    await api.storage.local.set(patch);
    const el = $('saved');
    el.classList.add('show');
    clearTimeout(savedT);
    savedT = setTimeout(() => el.classList.remove('show'), 1200);
    paintAll();
  }

  // ---------- drawing ----------
  function paint(canvas, mood, color) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 16, 16);
    PetSprite.draw(ctx, mood, color || S.color, 1);
  }
  function paintAll() {
    paint($('logo'), 'happy');
    paint($('pv'), pvMood);
    $('pvSay').textContent = (LINES.en[S.persona] || LINES.en.chill).replace('{n}', S.petName || 'Mochi');
    document.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c === S.color)));
    document.querySelectorAll('.persona').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === S.persona)));
    document.querySelectorAll('#moods button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === pvMood)));
  }

  // ---------- pet ----------
  $('petName').value = S.petName;
  $('petName').addEventListener('input', debounce((e) => {
    const n = e.target.value.replace(/[<>]/g, '').trim().slice(0, 20);
    if (n) save({ petName: n });
  }, 350));

  const sw = $('swatches');
  for (const c of Object.keys(PetSprite.COLORS)) {
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 16; cv.className = 'sprite';
    paint(cv, 'idle', c);
    const b = document.createElement('button');
    b.className = 'swatch'; b.dataset.c = c; b.type = 'button'; b.title = c;
    const s = document.createElement('span'); s.textContent = c;
    b.append(cv, s);
    b.addEventListener('click', () => save({ color: c }));
    sw.appendChild(b);
  }

  const pr = $('personas');
  for (const p of Object.keys(PERSONAS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'persona'; b.dataset.p = p;
    const bt = document.createElement('b'); bt.textContent = p;
    const sp = document.createElement('span'); sp.textContent = PERSONAS[p];
    b.append(bt, sp);
    b.addEventListener('click', () => save({ persona: p }));
    pr.appendChild(b);
  }

  // ---------- features ----------
  const FEATS = [
    ['sniffChip', 'Hover sniff', 'On memescopes, hovering a coin shows a small "sniff?" button.'],
    ['autoScan', 'Auto-scan on hover', 'Skip the button and scan right away. Sends more requests.'],
    ['offerScan', 'Offer a scan on coin pages', 'Once per coin, when you open its page.'],
    ['siteWarnings', 'Site warnings', 'Checks each site you open (domain only) and warns if it looks risky.'],
    ['idleSleep', 'Sleep when idle', 'The pet naps when you are away.'],
  ];
  const fe = $('features');
  for (const [k, title, desc] of FEATS) {
    const row = document.createElement('label');
    row.className = 'feat'; row.dataset.k = k;
    const txt = document.createElement('div');
    const b = document.createElement('b'); b.textContent = title;
    const sm = document.createElement('small'); sm.textContent = desc;
    txt.append(b, sm);
    const swl = document.createElement('span'); swl.className = 'sw';
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!S.features[k];
    inp.addEventListener('change', () => save({ features: Object.assign({}, S.features, { [k]: inp.checked }) }));
    swl.append(inp, document.createElement('span'));
    row.append(txt, swl);
    fe.appendChild(row);
  }

  $('sleepMinutes').value = S.sleepMinutes;
  $('sleepMinutes').addEventListener('change', (e) => {
    const v = Math.max(1, Math.min(240, parseInt(e.target.value, 10) || DEFAULTS.sleepMinutes));
    e.target.value = v;
    save({ sleepMinutes: v });
  });
  $('extraHosts').value = (S.extraHosts || []).join('\n');
  $('extraHosts').addEventListener('change', (e) => {
    const list = e.target.value.split(/[\s,]+/).map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter((x) => /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(x));
    e.target.value = list.join('\n');
    save({ extraHosts: list });
  });

  // ---------- backend ----------
  $('backend').value = S.backend;
  $('backend').addEventListener('change', (e) => {
    const v = cleanBackend(e.target.value);
    e.target.value = v;
    save({ backend: v });
  });
  $('test').addEventListener('click', async () => {
    const out = $('testOut');
    out.textContent = 'checking…';
    const r = await api.runtime.sendMessage({ type: 'health' }).catch(() => null);
    out.textContent = r && r.ok ? `online · ${r.llm ? 'AI on' : 'rules mode (no AI)'}${r.version ? ' · v' + r.version : ''}` : 'cannot reach the server: ' + ((r && r.error) || 'no answer');
  });
  $('orKey').value = S.orKey || '';
  $('orKey').addEventListener('change', (e) => save({ orKey: e.target.value.trim() }));

  // ---------- hidden sites ----------
  function renderHidden() {
    const box = $('hidden');
    box.textContent = '';
    if (!S.hiddenSites.length) {
      const m = document.createElement('span'); m.className = 'muted'; m.textContent = 'Nowhere. Use /hide in the chat or the toolbar popup.';
      box.appendChild(m);
      return;
    }
    for (const host of S.hiddenSites) {
      const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = host;
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.title = 'Show the pet here again';
      x.addEventListener('click', async () => { await save({ hiddenSites: S.hiddenSites.filter((h) => h !== host) }); renderHidden(); });
      tag.appendChild(x);
      box.appendChild(tag);
    }
  }
  renderHidden();

  // ---------- preview moods ----------
  const mo = $('moods');
  for (const m of Object.keys(PetSprite.MOODS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.m = m; b.textContent = m;
    b.addEventListener('click', () => { pvMood = m; paintAll(); });
    mo.appendChild(b);
  }
  setInterval(() => {
    if (pvMood !== 'idle' && pvMood !== 'happy') return;
    paint($('pv'), 'blink');
    setTimeout(() => paint($('pv'), pvMood), 140);
  }, 4200);

  $('reset').addEventListener('click', async () => {
    if (!confirm('Reset all Mochi settings to defaults?')) return;
    await api.storage.local.clear();
    await api.storage.local.set(DEFAULTS);
    location.reload();
  });

  api.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    const next = {};
    for (const k in ch) next[k] = ch[k].newValue;
    S = withDefaults(Object.assign({}, S, next));
    if ('hiddenSites' in next) renderHidden();
    if ('petName' in next && document.activeElement !== $('petName')) $('petName').value = S.petName;
    paintAll();
  });

  function debounce(fn, ms) { let tm; return (e) => { clearTimeout(tm); tm = setTimeout(() => fn(e), ms); }; }
  paintAll();
})();
