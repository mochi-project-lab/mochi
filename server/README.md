# Mochi server

Node 24, zero npm dependencies. Holds all API keys; the extension never does.

## Run
```
node server/index.js          # from Mochi/  (or `node index.js` from server/)
node server/test.mjs          # smoke test against a running server (default http://localhost:4400)
```
Env comes from `server/.env` (real environment variables win). Names in `.env.example`:
`PORT`, `SOLANA_RPC_URL`, `OPENROUTER_API_KEY`, `LLM_MODEL`, `TWITTERAPI_KEY`, optional `TRUST_PROXY=1`, `SITE_URL`.

## Endpoints (shapes: ../SPEC.md)
- `GET /api/health` → `{ok, llm, version}`
- `POST /api/token` `{address, persona?, petName?}`: mint or pair address. DexScreener + pump.fun (coins-v2) + Solana RPC
  (authorities, top holders → owners, pool/dev labels, dev balance) + twitterapi.io (X) + RDAP (website age) → verdict from
  OpenRouter, or the rule-based verdict (`llm:false`) when the LLM is unavailable. Facts cached 3 min per mint.
- `POST /api/site` `{url, signals?, persona?}`: trusted list, MetaMask + Phantom phishing lists (reloaded every 6 h),
  lookalikes (homoglyphs, brand tokens, edit distance), RDAP age. Domain intel cached 6 h.
- `POST /api/chat` `{messages, page?, persona?, petName?}` → `{reply, llm}`; without LLM, a reply that lists the commands.
- Header `X-OpenRouter-Key`: the user's own key for that call (never logged or stored).

Static: `../site` at `/` (`/privacy` → `privacy.html`, `404.html` if present), `/shared/sprite.js` from `../shared`,
`/download/<file>` from `server/public-dl/` or `Mochi/dist/` (e.g. `mochi-extension.zip`).

Limits per IP per minute: token 30, site 60, chat 20. Body ≤ 64 KB. Every outbound call has a timeout (6 s, LLM 20 s).
Our OpenRouter key is skipped for 10 min after 401/402/403; twitterapi.io the same after 401/402/403/429.
Logs: one JSON line per request (method, path, status, ms), no keys.

## Files
`index.js` http + routes + chat · `token.js` coin facts + verdicts · `site.js` site checks · `domain.js` host parsing + RDAP ·
`llm.js` OpenRouter · `voice.js` persona templates · `lib.js` env, fetch, cache, limiter.
