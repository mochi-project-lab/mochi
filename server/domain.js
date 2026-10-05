// Domain helpers shared by /api/token (coin website) and /api/site: hostname parsing, registrable domain, RDAP age.
import { domainToUnicode } from 'node:url';
import { fetchJson, TTLCache, cached } from './lib.js';

const TWO_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'or', 'ne', 'go']);

export function hostOf(input) {
  if (!input || typeof input !== 'string') return null;
  let s = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return { protocol: u.protocol, host: u.hostname.toLowerCase().replace(/\.$/, '') };
  } catch { return null; }
}

export const isIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || /^\[.*\]$/.test(h);
export const isLocal = (h) => h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.');

// registrable domain: last two labels, three for co.uk-style suffixes
export function baseDomain(host) {
  const p = host.split('.').filter(Boolean);
  if (p.length <= 2) return p.join('.');
  const tld = p[p.length - 1], sld = p[p.length - 2];
  if (tld.length === 2 && TWO_LEVEL.has(sld)) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}

export const unicode = (host) => { try { return domainToUnicode(host) || host; } catch { return host; } };

const rdapCache = new TTLCache(24 * 3600_000, 3000);
// → {ageDays, registrar, created} ; nulls when RDAP has nothing for the TLD or times out
export const rdap = cached(rdapCache, async (domain) => {
  const r = await fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { accept: 'application/rdap+json, application/json' }, timeout: 6000 });
  if (!r.ok || !r.data || typeof r.data !== 'object') return { ageDays: null, registrar: null, created: null, error: r.status || r.error };
  const ev = (r.data.events || []).find((e) => /registration/i.test(e.eventAction || ''));
  const created = ev?.eventDate ? Date.parse(ev.eventDate) : NaN;
  const reg = (r.data.entities || []).find((e) => (e.roles || []).includes('registrar'));
  const fn = reg?.vcardArray?.[1]?.find((v) => v[0] === 'fn')?.[3] || null;
  return {
    ageDays: Number.isFinite(created) ? Math.max(0, Math.floor((Date.now() - created) / 86_400_000)) : null,
    registrar: fn ? String(fn).slice(0, 80) : null,
    created: Number.isFinite(created) ? new Date(created).toISOString() : null,
  };
}, (v) => (v.error === 404 ? 6 * 3600_000 : v.error ? 5 * 60_000 : undefined));
