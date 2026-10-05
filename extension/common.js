// Shared defaults and helpers. Loaded by the service worker (importScripts), content script, popup and options.
(function (root) {
  const DEFAULTS = {
    enabled: true,
    petName: 'Mochi',
    color: 'mint',
    persona: 'chill',
    features: {
      sniffChip: true,     // "sniff?" chip when hovering a coin on memescopes
      autoScan: false,     // scan right away on hover instead of showing the chip
      siteWarnings: true,  // check each site and warn when it looks risky
      idleSleep: true,     // pet falls asleep when you're away
      offerScan: true,     // offer a scan when you open a coin page
    },
    sleepMinutes: 10,
    backend: 'http://localhost:4400',
    orKey: '',
    hiddenSites: [],
    extraHosts: [],
    pos: null,          // {right, bottom} in px
    minimized: false,
  };

  const PERSONAS = {
    chill: 'friendly and short. the default.',
    degen: 'trenches slang: ser, larp, aped, cooked. no cringe.',
    nerd: 'dry, numbers first.',
    mom: 'caring and protective. will tell you to log off.',
  };

  const MEMESCOPES = [
    'axiom.trade', 'gmgn.ai', 'pump.fun', 'dexscreener.com', 'photon-sol.tinyastro.io',
    'bullx.io', 'neo.bullx.io', 'birdeye.so', 'solscan.io',
  ];

  function hostMatches(host, list) {
    host = String(host || '').toLowerCase();
    return list.some((d) => {
      d = String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      return d && (host === d || host.endsWith('.' + d));
    });
  }

  // Merge stored settings over defaults (one level deep for features).
  function withDefaults(s) {
    s = s || {};
    const out = Object.assign({}, DEFAULTS, s);
    out.features = Object.assign({}, DEFAULTS.features, s.features || {});
    if (!Array.isArray(out.hiddenSites)) out.hiddenSites = [];
    if (!Array.isArray(out.extraHosts)) out.extraHosts = [];
    out.lang = 'en'; // English only; an old stored lang is ignored
    return out;
  }

  function cleanBackend(u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    return /^https?:\/\/[^\s]+$/i.test(u) ? u : DEFAULTS.backend;
  }

  root.PetCommon = { DEFAULTS, PERSONAS, MEMESCOPES, hostMatches, withDefaults, cleanBackend };
})(typeof globalThis !== 'undefined' ? globalThis : this);
