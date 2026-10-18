// Shared helpers for the Vesper server. No third-party dependencies.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ProviderError extends Error {
  constructor(provider, message, status = 502, code = 'provider_error') {
    super(message);
    this.provider = provider;
    this.status = status;
    this.code = code;
  }
}

// Small TTL cache with insertion-order eviction.
export class TTLCache {
  constructor(max = 800) { this.m = new Map(); this.max = max; }
  get(k) {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) { this.m.delete(k); return undefined; }
    return e.v;
  }
  set(k, v, ttl) {
    if (this.m.has(k)) this.m.delete(k);
    else if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value);
    this.m.set(k, { v, exp: Date.now() + ttl });
  }
  delete(k) { this.m.delete(k); }
}

// Concurrency + sliding-window rate limiter so we stay inside provider quotas.
export class Limiter {
  constructor(concurrency = 4, perWindow = 45, windowMs = 5000) {
    this.c = concurrency; this.per = perWindow; this.win = windowMs;
    this.active = 0; this.stamps = []; this.waiters = [];
  }
  async run(fn) {
    await this.#acquire();
    try { return await fn(); } finally { this.active--; this.#next(); }
  }
  #acquire() { return new Promise((res) => { this.waiters.push(res); this.#next(); }); }
  #next() {
    if (!this.waiters.length || this.active >= this.c) return;
    const now = Date.now();
    this.stamps = this.stamps.filter((t) => now - t < this.win);
    if (this.stamps.length >= this.per) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.#next(), this.win - (now - this.stamps[0]) + 5);
      return;
    }
    this.active++; this.stamps.push(now);
    this.waiters.shift()();
    this.#next();
  }
}

const jsonCache = new TTLCache(1500);
const inflight = new Map();

// Fetch JSON with caching, de-duplication of identical in-flight requests,
// timeouts and retry on transient failures (429 / 5xx / network errors).
export async function fetchJSON(url, { ttl = 60_000, limiter, headers = {}, retries = 2, provider = 'provider', noCache = false } = {}) {
  if (!noCache) {
    const hit = jsonCache.get(url);
    if (hit !== undefined) return hit;
    if (inflight.has(url)) return inflight.get(url);
  }
  const task = (async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const doFetch = () => fetch(url, { headers: { 'User-Agent': 'Vesper/1.0 (personal music player)', Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(12_000) });
        const res = limiter ? await limiter.run(doFetch) : await doFetch();
        if (res.status === 429 || res.status >= 500) {
          lastErr = new ProviderError(provider, `${provider} responded ${res.status}`, res.status === 429 ? 429 : 502, res.status === 429 ? 'rate_limited' : 'upstream_error');
          const ra = Number(res.headers.get('retry-after'));
          await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 5000) : 600 * (attempt + 1));
          continue;
        }
        if (res.status === 404) throw new ProviderError(provider, 'Not found', 404, 'not_found');
        if (!res.ok) throw new ProviderError(provider, `${provider} responded ${res.status}`, 502, 'upstream_error');
        const data = await res.json();
        if (ttl > 0 && !noCache) jsonCache.set(url, data, ttl);
        return data;
      } catch (e) {
        if (e instanceof ProviderError && e.status === 404) throw e;
        lastErr = e instanceof ProviderError ? e : new ProviderError(provider, `Couldn't reach ${provider}: ${e.cause?.code || e.message}`, 503, 'unreachable');
        if (attempt < retries) await sleep(500 * (attempt + 1));
      }
    }
    throw lastErr;
  })();
  if (!noCache) inflight.set(url, task);
  try { return await task; } finally { inflight.delete(url); }
}

export const normText = (s) => (s || '').toString().toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Text relevance of a track (or artist/album) to a query, 0..~1.6
export function relevance(q, fields) {
  const nq = normText(q);
  if (!nq) return 0;
  const qt = nq.split(' ');
  const title = normText(fields.title || fields.name);
  const artist = normText(fields.artist);
  const hay = `${title} ${artist} ${normText(fields.album)}`;
  const words = new Set(hay.split(' '));
  let hits = 0;
  for (const t of qt) if (words.has(t) || [...words].some((w) => w.startsWith(t) && t.length > 2)) hits++;
  let s = (hits / qt.length) * 0.7;
  if (title === nq) s += 0.5; else if (title && nq.includes(title) && title.length > 3) s += 0.3; else if (title.startsWith(nq)) s += 0.25;
  if (artist && nq.includes(artist)) s += 0.25;
  if (`${title} ${artist}`.includes(nq) || `${artist} ${title}`.includes(nq)) s += 0.15;
  return s;
}

export const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);

// Deterministic shuffle (stable within a day) so mixes don't reshuffle on every load.
export function seededShuffle(arr, seedStr) {
  let h = 2166136261;
  for (const c of seedStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = undefined; } }
  }));
  return out;
}
