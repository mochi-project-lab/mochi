// OpenRouter chat completions. Our key is skipped for 10 min after 401/402/403; a caller-supplied key
// (X-OpenRouter-Key) is used for that call only and never marks ours unpaid, never logged.
import { fetchJson } from './lib.js';

const URL = 'https://openrouter.ai/api/v1/chat/completions';
let unpaidUntil = 0;
let lastError = null;

export const llmState = () => ({ ours: Boolean(process.env.OPENROUTER_API_KEY), unpaid: Date.now() < unpaidUntil, lastError });
export const llmAvailable = (userKey) => Boolean(userKey) || (Boolean(process.env.OPENROUTER_API_KEY) && Date.now() >= unpaidUntil);

// → {text} or null
export async function chat(messages, { userKey, json = false, temperature = 0.4, maxTokens = 500, timeout = 20_000 } = {}) {
  const key = userKey || process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  if (!userKey && Date.now() < unpaidUntil) return null;
  // fastest provider first (qwen: ~2.4 s vs 4–20 s by default); OpenRouter falls through to the next model on error
  const fallback = (process.env.LLM_FALLBACK_MODEL ?? 'google/gemini-2.5-flash-lite').trim();
  const body = {
    model: process.env.LLM_MODEL || 'qwen/qwen3-235b-a22b-2507',
    ...(fallback ? { models: [process.env.LLM_MODEL || 'qwen/qwen3-235b-a22b-2507', fallback] } : {}),
    provider: { sort: 'throughput' },
    messages, temperature, max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: 'json_object' };
  const r = await fetchJson(URL, {
    method: 'POST', timeout, body,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'HTTP-Referer': process.env.SITE_URL || 'http://localhost', 'X-Title': 'Mochi' },
  });
  if (!r.ok) {
    lastError = r.status ? `http ${r.status}` : r.error || 'network';
    if (!userKey && [401, 402, 403].includes(r.status)) unpaidUntil = Date.now() + 10 * 60_000;
    return null;
  }
  const text = r.data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) { lastError = 'empty'; return null; }
  lastError = null;
  return { text: text.trim() };
}

// first {...} block in a model answer (models sometimes wrap JSON in prose / fences / <think>)
export function parseJson(text) {
  if (!text) return null;
  const s = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
