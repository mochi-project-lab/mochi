# Store listings — Mochi

One package per store family, built by `node scripts/pack-extension.mjs` (from `Mochi/`):

| store | upload |
|---|---|
| Chrome Web Store | `server/public-dl/mochi-extension.zip` |
| Microsoft Edge Add-ons | `server/public-dl/mochi-extension.zip` (same file) |
| Firefox Add-ons (AMO) | `server/public-dl/mochi-extension-firefox.zip` |

Before submitting: bump `version` in `extension/manifest.json`, set the default backend in `extension/common.js`
(`DEFAULTS.backend`) to the public HTTPS server (the store build must not point at localhost), rebuild the zips,
and publish the privacy policy page on the site (`https://<domain>/privacy`).

Assets in `Mochi/store/`:
- `1-sniff-a-coin.png`, `2-site-warning.png`, `3-settings.png` — screenshots, 1280×800
- `logo-300.png` — Edge store logo, 300×300
- `promo-440x280.png` — Chrome small promo tile, 440×280
- 128×128 icon is inside the package (`icons/icon-128.png`, 96 px art + 16 px padding)

Screenshots to provide (all 1280×800, PNG, no browser chrome needed):
1. Hovering a coin on a memescope → "sniff?" chip → result card in the chat panel (`1-sniff-a-coin.png`).
2. A risky site → pet turns alert and shows the warning bubble (`2-site-warning.png`).
3. Settings page with the live pet preview (`3-settings.png`).
Optional extras: the pet in another colour, the chat answering a question about a page, the toolbar popup.
Use only fake or own pages in screenshots; no third-party logos.

---

## Shared copy

**Name:** Mochi — pixel pet that sniffs memecoins

**Short description (≤132 chars, Chrome summary):**
A pixel pet in the corner of your browser. It checks Solana coins you hover and warns you about sketchy sites.

**Long description:**

Mochi is a small pixel pet that sits in the corner of every page.

On memescopes (pump.fun, axiom, gmgn, dexscreener, photon, bullx, birdeye, solscan) hover a coin and click "sniff?".
The pet reads the coin and tells you what it found:
- a label (legit, mid, larp, danger) and a score out of 100
- market cap, liquidity, age, top 10 holders
- dev history: how many coins the dev launched and how many graduated
- mint and freeze authority
- the project's X account and website
- what it saw on the wallets: concentration, dev share, bundles

On any site the pet checks the domain. If the site is new, looks like a known wallet's domain, is on a phishing list or
asks for your seed phrase, the pet warns you. If a risky site asks your wallet to connect, it warns you again. It never
blocks anything.

You can also chat with it about the page you're on, or use commands: /scan, /site, /hide, /sleep, /name, /color, /help.

Make it yours: name, colour and personality (chill, degen, nerd, mom). Every feature can
be turned off. You can hide the pet on any site.

The pet is not financial advice. A good score does not mean a coin will go up.

**Single purpose (Chrome):**
An on-page assistant that checks crypto tokens and websites for risk and shows the result through a pet in the page corner.

---

## Chrome Web Store

- **Category:** Productivity → Tools (alternative: Lifestyle → Fun)
- **Language:** English
- **Privacy policy URL:** `https://<domain>/privacy`
- **Homepage / support URL:** `https://<domain>/`

**Permission justifications (Privacy practices tab):**
- `storage` — Saves the user's settings (pet name, colour, personality, feature toggles, position, sites where the pet is hidden, optional own API key) and short-lived caches of scan results.
- Host permissions (content scripts on all http/https sites) — The pet is drawn on every page the user visits, and the site-safety check must run on any domain because phishing pages use unknown domains. Coin hover detection only activates on a fixed list of memescope sites. The extension never touches wallets or page scripts.
- Remote code — **No.** All JavaScript is in the package. The extension only sends and receives JSON from its own backend.

**Data usage (check these):**
- Web history — yes: the domain (origin only) of pages visited is sent to check it for phishing, if site warnings are on.
- Website content — yes: when the user chats with the pet, the page title and up to 4000 characters of visible text are sent so it can answer.
- Everything else (PII, health, financial and payment, authentication, personal communications, location, user activity) — no.

**Certify:** not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used to determine creditworthiness or for lending.

**Submit steps:**
1. Go to the Chrome Web Store Developer Dashboard (chrome.google.com/webstore/devconsole), pay the one-time $5 fee if this is a new account, verify the contact email.
2. **New item** → upload `mochi-extension.zip`.
3. **Store listing:** name, short + long description above, category, language; upload the 128 icon (from the package), `promo-440x280.png` as small promo tile, the three 1280×800 screenshots.
4. **Privacy practices:** single purpose, permission justifications, remote code "No", data usage as above, privacy policy URL, the three certifications.
5. **Distribution:** Public, all regions.
6. **Submit for review.** Broad host access usually means an in-depth review (days, sometimes 1–3 weeks). Reply to reviewer mail from the dashboard.

---

## Microsoft Edge Add-ons

- **Category:** Productivity
- **Privacy policy URL:** `https://<domain>/privacy` (required — the extension sends data to a server)
- **Search terms (max 7):** solana, memecoin, rug check, phishing, crypto safety, pump.fun, pixel pet

**Submit steps:**
1. Partner Center (partner.microsoft.com/dashboard/microsoftedge) → enrol in the Edge program (free) → **Create new extension**.
2. **Packages:** upload `mochi-extension.zip` (same as Chrome).
3. **Availability:** Public, all markets.
4. **Properties:** category Productivity, privacy policy URL, website URL, support contact; "does this extension access personal information": **Yes** (domains of visited pages; page text when the user chats).
5. **Store listings → English:** description (long description above), short description, `logo-300.png` as store logo, screenshots (1280×800), search terms.
6. **Submit** with notes for certification (same text as the AMO reviewer notes below). Review is usually up to 7 business days.

---

## Firefox Add-ons (AMO)

The Firefox zip is transformed at pack time: `background.scripts` instead of `service_worker`,
`browser_specific_settings.gecko` with `id: mochi@mochipet`, `strict_min_version: 128.0`,
`host_permissions` for all http/https sites, and `data_collection_permissions`
(`required: browsingActivity`, `optional: websiteContent`). The AMO linter may warn that `data_collection_permissions`
is only read from Firefox 140; older versions ignore it, that is fine.

- **Name / summary (≤250 chars) / description:** as above.
- **Categories:** Privacy & Security; Other
- **License:** MIT (or whatever the repo uses)
- **Privacy policy:** paste the privacy section from `README.md` or link `https://<domain>/privacy`.
- **Support site:** `https://<domain>/`

**Notes for reviewers:**
> No build step, no minification, no remote code: the package is the source. The pet talks only to the backend URL in
> settings (default https://<domain>). Coin scans send the token address. Site checks send only the origin of the page
> and two booleans (wallet button / seed field present). Chat sends page title and up to 4000 chars of visible text,
> only when the user sends a message. Nothing runs in the page world and wallets are never touched.
> To test: open https://pump.fun/coin/7GUnr7krtQhJwd6ASY2VUprd9t4c64zcgCsjdmZepump,
> hover a coin link, click "sniff?".

**Submit steps:**
1. addons.mozilla.org/developers → **Submit a New Add-on** → **On this site** (listed).
2. Upload `mochi-extension-firefox.zip`; choose Firefox (desktop). Wait for the automatic validation and fix any errors.
3. "Do you need to submit source code?" → **No** (nothing is generated or minified).
4. Fill the listing: name, summary, description, categories, support site, license, privacy policy; add the screenshots.
5. Add the reviewer notes above → **Submit version**. Listed add-ons are signed after review.

---

## Privacy practices — short answers (any store)

| question | answer |
|---|---|
| Does it collect personal data? | No names, emails, wallet addresses or account data. |
| What leaves the browser? | Token addresses you scan; the origin of sites you visit (if site warnings are on); page title/text only when you chat. |
| Where does it go? | Only to the Mochi backend URL set in settings. |
| Is it stored? | The server caches scan results by token (minutes) and site checks by domain (hours). It does not keep chat text or user keys. |
| Is it sold or shared? | No. |
| Third parties | The backend reads public data (Solana RPC, DEX data, pump.fun, X) and may send prompts to an LLM provider (OpenRouter). No user identity is attached. |
| User's own API key | Optional. Stored locally in the browser, sent as a header to the backend, not logged or stored server-side. |
| Can the user turn it off? | Yes: every feature has a switch; the pet can be hidden per site or turned off. |
