# Mochi — AI pet for your browser

Working name: **Mochi**. Default pet name: **Mochi** (user can rename). Character: 16x16 pixel cat-blob,
`shared/sprite.js` (moods: idle, blink, happy, think, alert, sad, sleep; colours: mint, peach, lilac, sky, lemon, rose, ghost).
Do not redraw the character — use sprite.js (copy the file into your folder if you need it there, keep it identical).

The pet lives in the corner of every page, shares the window with you and talks in short bubbles:
- Hover a token on a memescope (axiom.trade, gmgn.ai, pump.fun, dexscreener, photon-sol.tinyastro.io, bullx.io,
  neo.bullx.io, birdeye.so, solscan.io) → pet offers to sniff it → reads the coin: on-chain facts, holders, dev history,
  X account, socials → says if it's a larp or not, what it found on wallets, and its score.
- Open a sketchy site → pet warns: "bro don't connect your wallet here, this domain is 3 days old".
- Commands in a chat box, free chat about the page, fully configurable pet (name, colour, personality, features).

## Layout
```
Mochi/
  shared/sprite.js     pet sprite (source of truth)
  server/              Node 24, zero npm deps (built-in fetch/http). Holds all API keys. Serves site/ at /.
  extension/           Chrome MV3, vanilla JS, no build step. NO keys inside, ever (it goes public on GitHub + Web Store).
  site/                static landing + privacy policy, served by server.
```

## Server API (base URL default `http://localhost:4400`, later `https://<domain>`)
All JSON. CORS open (`*`). Errors: `{error: "text"}` with 4xx/5xx. Rate limit per IP (e.g. 30 scans/min).
Optional header `X-OpenRouter-Key`: user's own key, used instead of ours for LLM calls (never logged/stored).

### GET /api/health → `{ok:true, llm:boolean, version}`

### POST /api/token
Body: `{address, persona?: "chill"|"degen"|"nerd"|"mom", petName?}`
`address` = any Solana address seen on the page: mint OR pair/pool address (axiom/dexscreener use pairs) — server resolves.
Response:
```json
{
  "mint": "...", "name": "...", "symbol": "...", "image": "url|null", "chain": "solana",
  "facts": {
    "mcapUsd": 0, "liqUsd": 0, "vol24hUsd": 0, "chg1hPct": 0, "chg24hPct": 0, "ageHours": 0,
    "onPumpCurve": true, "graduated": false,
    "mintAuthority": null, "freezeAuthority": null,
    "holders": { "top10Pct": 0, "top1Pct": 0, "devHoldsPct": null, "list": [{"owner":"...","pct":0, "label": "dev|pool|null"}] },
    "dev": { "address": "...", "launches": 0, "graduated": 0, "bestMcapUsd": 0 },
    "x": { "handle": null, "followers": null, "accountAgeDays": null, "posts": ["..."], "mentionsCoin": null },
    "links": { "website": null, "twitter": null, "telegram": null },
    "website": { "domain": null, "ageDays": null }
  },
  "verdict": {
    "label": "legit" | "mid" | "larp" | "danger",
    "score": 0,
    "summary": "2-3 sentences: what it is and why this label",
    "wallets": "1-2 sentences: what was found on wallets (holders, dev, bundles)",
    "flags": [{"level":"good"|"warn"|"bad","text":"short"}],
    "say": "one short line in the pet's voice/persona"
  },
  "llm": true,
  "cachedAt": 0
}
```
Any source may fail → that field is null, never crash. If LLM is unavailable (no key / 402 / timeout) a rule-based
verdict is produced (`llm:false`). Cache by mint 3 min (verdict cached by mint+persona).

### POST /api/site
Body: `{url, signals?: {walletButton:boolean, seedInput:boolean, title:string}, persona?, petName?}`
Response:
```json
{ "domain":"...", "ageDays": 3, "registrar": "...", "listed": "phishing"|"trusted"|null,
  "lookalike": {"of":"phantom.app","distance":1} | null,
  "risk": "safe"|"caution"|"danger", "reasons": ["..."], "say": "pet line" }
```
Rules: known phishing list → danger. Lookalike of a trusted crypto domain → danger. seedInput on non-trusted → danger.
Age < 30 days + walletButton → caution (< 7 days → danger). Trusted list → safe immediately (no network).
Cache per domain 6 h.

### POST /api/chat
Body: `{messages:[{role,content}], page?: {url,title,text?(≤4000 chars), lastScan?}, persona?, petName?}`
→ `{reply}` short, in persona. Without LLM: friendly fallback that lists commands.

## Extension commands (chat box, also via Alt+P to open)
`/scan [address]` (no arg = coin on current page), `/site` (check this site), `/hide`, `/sleep`, `/help`,
`/name <name>`, `/color <color>`, `/mood`, `/settings`. Anything else = chat.

## Personas
chill (default, friendly short), degen (trenches slang: ser, larp, rug, aped, cooked, ngmi — never cringe-long),
nerd (dry, numbers first), mom (caring, protective). Pet voice: lowercase, short, no emojis spam (max 1).

## Brand / look
Minimal + pretty. Warm off-white background (#F6F3EE) / near-black ink (#1E1B2E), pet mint (#8EE3C8) accent,
pixel font for headings (Silkscreen or Pixelify Sans), clean sans for text (Inter). Dark mode supported.
Site copy in English. No marketing slop: plain words, short sentences.
