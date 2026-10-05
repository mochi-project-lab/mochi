# Mochi

A small pixel pet that lives in the corner of your browser.

- **Sniffs coins.** Hover a coin on axiom, gmgn, pump.fun, dexscreener, photon, bullx, birdeye or solscan, then click "sniff?".
  The pet reads the coin and tells you if it's a larp. It checks on-chain authorities, holders (top 10, dev, bundlers,
  snipers), whether traders actually paid fees or the chart was painted by a bundle, the dev's past launches, and the
  project's X account and website. Then it gives a score.
- **Watches your back.** When a site is on a phishing list, imitates a known wallet or app, or asks for your seed
  phrase, or when a very new domain wants your wallet, the pet warns you before you connect.
- **Talks.** Use the chat box (Alt+P) and commands like `/scan`, `/site`, `/sleep`, `/name`, `/color` and `/help`.
- **Yours.** You pick its name, colour and personality (chill, degen, nerd, mom).

It never asks for keys or signatures and never touches your wallet.

## Layout

| Folder | What |
|---|---|
| `extension/` | Browser extension (Manifest V3, vanilla JS, no build step): Chrome, Edge, Brave, Arc, Firefox 128+ |
| `server/` | API the extension and site call (Node 24, zero dependencies). Holds every API key. |
| `site/` | Web app: paste a CA, pair or link and the pet checks it without installing anything |
| `shared/sprite.js` | The pet (16×16 sprite, moods, colours) |
| `scripts/` | Icon builder, extension packer, intel DB import |

## Run locally

```
cp server/.env.example server/.env   # fill in keys
node server/index.js                 # http://localhost:4400 (site + API)
node scripts/pack-extension.mjs      # builds server/public-dl/mochi-extension.zip and mochi-extension-firefox.zip
```

Load the extension: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → `extension/manifest.json` (or the firefox zip).

Optional dev history DB: `node scripts/import-dev-data.mjs <indexer.db>` builds `server/data/intel.db`
(past launches, traders' fees and painted charts per dev). Without it, the server uses pump.fun's API live.

API shapes are in [SPEC.md](SPEC.md). Store listing texts are in [extension/STORE.md](extension/STORE.md).

## Privacy

The extension sends the coin addresses you scan and the domain of the page you're on (for site checks) to the Mochi
server. Page text is sent only when you chat with the pet. Settings stay in your browser. See `site/privacy.html`.
