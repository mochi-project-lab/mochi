// Templated pet lines for the rule-based paths. Lowercase, short, max one emoji (we use none).
export const PERSONAS = ['chill', 'degen', 'nerd', 'mom'];
export const persona = (p) => (PERSONAS.includes(p) ? p : 'chill');
export const lang = () => 'en'; // English only
export const petName = (n) => String(n || 'Mochi').replace(/[\r\n<>]/g, '').trim().slice(0, 24) || 'Mochi';

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? '')).replace(/\s+/g, ' ').trim().toLowerCase();
const pick = (arr, seed = '') => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return arr[h % arr.length]; };

// token verdict lines. {sym} {score} {why}
const TOKEN = {
  en: {
    chill: {
      legit: ['${sym} looks clean to me, {score}/100. {why}', 'sniffed ${sym}: smells fine, {score}/100. {why}'],
      mid: ['${sym} is a mixed bag, {score}/100. {why}', 'not bad, not great. ${sym} gets {score}/100. {why}'],
      larp: ['${sym} smells like a larp, {score}/100. {why}', 'hmm, ${sym} feels empty. {score}/100. {why}'],
      danger: ['careful with ${sym}, {score}/100. {why}', 'i would stay away from ${sym}. {why}'],
    },
    degen: {
      legit: ['ser ${sym} is actually clean. {score}/100. {why}', '${sym} passes the sniff ser, {score}/100. {why}'],
      mid: ['${sym} is mid ser, {score}/100. {why}', 'coinflip territory. ${sym} {score}/100. {why}'],
      larp: ['${sym} is a larp ser. {score}/100. {why}', 'no tek, no team. ${sym} is cooked, {score}/100. {why}'],
      danger: ['ser do NOT ape ${sym}. {why}', 'rug vibes on ${sym}, {score}/100. {why}'],
    },
    nerd: {
      legit: ['${sym}: score {score}/100. {why}'],
      mid: ['${sym}: score {score}/100, inconclusive. {why}'],
      larp: ['${sym}: score {score}/100, weak fundamentals. {why}'],
      danger: ['${sym}: score {score}/100, high risk. {why}'],
    },
    mom: {
      legit: ['${sym} looks okay, sweetie. {score}/100. {why}'],
      mid: ['${sym} is so-so, dear. only money you can lose. {why}'],
      larp: ['i don\'t trust ${sym}, honey. {score}/100. {why}'],
      danger: ['please don\'t buy ${sym}, dear. {why}'],
    },
  },
};

export function tokenSay({ label, score, symbol, why, persona: p, lang: l }) {
  const sym = String(symbol || 'this coin').replace(/^\$/, '').slice(0, 16);
  const t = TOKEN[lang(l)][persona(p)][label] || TOKEN.en.chill.mid;
  return fill(pick(t, sym + label), { sym, score, why }).replace(/\$this coin/, 'this coin').slice(0, 200);
}

// site lines. kind: phishing | lookalike | seed | new_wallet | young | safe | trusted | local
const SITE = {
  en: {
    chill: {
      phishing: 'this site is on a phishing list. don\'t connect your wallet here.',
      lookalike: 'this looks like a fake {of}. close it.',
      seed: 'this page asks for a seed phrase. never type it here.',
      new_wallet: 'this domain is {age} days old. don\'t connect your wallet.',
      young: 'this domain is only {age} days old. be careful with the wallet button.',
      safe: 'nothing weird here.',
      trusted: '{domain} is legit.',
    },
    degen: {
      phishing: 'ser this is a known drainer. do NOT connect.',
      lookalike: 'ser this is a fake {of}. close the tab.',
      seed: 'ser NEVER type your seed here. this is a drainer.',
      new_wallet: 'ser this domain is {age} days old. do NOT connect your wallet.',
      young: 'ser this domain is {age} days old. careful.',
      safe: 'looks fine ser.',
      trusted: '{domain} is legit ser.',
    },
    nerd: {
      phishing: 'domain is on a phishing blocklist. do not connect.',
      lookalike: 'domain is {dist} edit(s) from {of}. likely impersonation.',
      seed: 'seed phrase input on an untrusted domain. do not type it.',
      new_wallet: 'domain age: {age} days, wallet connect present. do not connect.',
      young: 'domain age: {age} days. treat wallet prompts with caution.',
      safe: 'no risk signals found.',
      trusted: '{domain}: on the trusted list.',
    },
    mom: {
      phishing: 'sweetie, this site steals wallets. please leave.',
      lookalike: 'honey, this pretends to be {of}. please close it.',
      seed: 'never type your secret words here, dear. never.',
      new_wallet: 'this site is only {age} days old, dear. don\'t connect your wallet.',
      young: 'this site is only {age} days old. be careful, sweetie.',
      safe: 'this one looks fine, dear.',
      trusted: '{domain} is safe, dear.',
    },
  },
};

export const siteSay = (kind, vars, p, l) => fill(SITE[lang(l)][persona(p)][kind] || SITE.en.chill.safe, vars);

export function chatFallback(p, l, name) {
  const n = petName(name).toLowerCase();
  const open = { chill: 'my chat brain is napping', degen: 'ser my chat brain is offline', nerd: 'chat model unavailable', mom: 'i can\'t chat right now, dear' }[persona(p)];
  return `${open}. commands still work: /scan [address] to sniff a coin, /site to check this site, /name, /color, /mood, /sleep, /hide, /settings, /help.`;
}

// pet voice cleanup: one line, lowercase, at most one emoji, ≤ n chars
export function tidy(text, n = 300) {
  // lowercase voice, but keep addresses (base58, case matters), $TICKERS and @handles as written
  let t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\s+/g, ' ').trim()
    .split(/(\b[1-9A-HJ-NP-Za-km-z]{32,44}\b|\b[1-9A-HJ-NP-Za-km-z]{3,10}(?:…|\.\.\.)[1-9A-HJ-NP-Za-km-z]{3,10}\b|\$[A-Za-z0-9]{2,15}\b|@\w{2,30})/g)
    .map((part, i) => (i % 2 ? part : part.toLowerCase())).join('');
  let seen = 0;
  t = t.replace(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*️?/gu, (m) => (++seen > 1 ? '' : m))
    .replace(/\s+([.,!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  if (t.length > n) {
    const cut = t.slice(0, n);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    t = end > n / 2 ? cut.slice(0, end + 1) : cut.replace(/\s\S*$/, '') + '…';
  }
  return t;
}
