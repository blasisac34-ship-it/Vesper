// Shared artwork renderer + hydrator for the whole app.
// - artistPhoto(): real artist portraits, resolved through /api/artwork/artists when missing.
// - collectionCover(): a collection's own cover, else a collage of up to 4 distinct track covers,
//   resolved through /api/artwork/covers when the page doesn't already have them.
// Requests are batched, de-duplicated and cached (memory + localStorage), so rendering never
// triggers repeated lookups. Neutral placeholders appear only after real lookups fail.
import { api } from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// Neutral placeholders (no initials, no fake colours): a soft silhouette and a record sleeve.
export const ARTIST_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#2a2b31"/><circle cx="60" cy="47" r="20" fill="#44454d"/><path d="M22 112c4-22 20-34 38-34s34 12 38 34" fill="#44454d"/></svg>')}`;
export const COVER_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#26272c"/><circle cx="60" cy="60" r="34" fill="#1b1c20"/><circle cx="60" cy="60" r="33" fill="none" stroke="#33343b" stroke-width="1"/><circle cx="60" cy="60" r="24" fill="none" stroke="#2e2f35" stroke-width="1"/><circle cx="60" cy="60" r="9" fill="#3a3b42"/><circle cx="60" cy="60" r="2" fill="#26272c"/></svg>')}`;

const LS = 'vesper.artwork.v2', TTL = 7 * 86400_000;
const mem = (() => { try { const d = JSON.parse(localStorage.getItem(LS) || '{}'); const now = Date.now(); return new Map(Object.entries(d).filter(([, v]) => v.exp > now)); } catch { return new Map(); } })();
let saveT = 0;
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(LS, JSON.stringify(Object.fromEntries([...mem].slice(-1500)))); } catch { /* storage full */ } }, 800); };
const artistKey = (a) => (a?.id && /^dz:\d+$/.test(a.id) ? a.id : `name:${norm(a?.name)}`);
const okUrl = (u) => typeof u === 'string' && (/^https:\/\//.test(u) || u.startsWith('/api/') || u.startsWith('data:image/'));

export function artistPhoto(a, cls = '') {
  const direct = [a?.artwork, a?.artworkSmall, a?.picture].find(okUrl);
  const key = artistKey(a), cached = mem.get(`a|${key}`)?.url;
  const src = direct || cached;
  return `<img class="artist-photo ${cls}" src="${esc(src || ARTIST_PLACEHOLDER)}" alt="${esc(a?.name || 'Artist')}" loading="lazy" decoding="async" data-artist-key="${esc(key)}" data-artist-id="${esc(a?.id || '')}" data-artist-name="${esc(a?.name || '')}"${src ? '' : ' data-need-artist="1"'} onerror="window.__vesperArtErr&&window.__vesperArtErr(this)">`;
}

function collageHtml(urls, title) {
  const u = [...new Set(urls.filter(okUrl))].slice(0, 4);
  if (!u.length) return '';
  if (u.length === 1) return `<img class="cover-single" src="${esc(u[0])}" alt="" loading="lazy" decoding="async" onerror="window.__vesperArtErr&&window.__vesperArtErr(this)">`;
  return `<div class="cover-collage n${u.length}" aria-label="Cover collage for ${esc(title || 'collection')}">${u.map((x) => `<img src="${esc(x)}" alt="" loading="lazy" decoding="async" onerror="window.__vesperArtErr&&window.__vesperArtErr(this)">`).join('')}</div>`;
}
// key: e.g. "session:late-night", "mix:daily-0", "playlist:abc", "dzplaylist:dzp:123", "likes"
export function collectionCover({ art = null, tiles = null, key = null, title = '' } = {}) {
  if (okUrl(art)) return `<img class="cover-single" src="${esc(art)}" alt="" loading="lazy" decoding="async" data-cover-key="${esc(key || '')}" onerror="window.__vesperArtErr&&window.__vesperArtErr(this)">`;
  const have = (tiles || []).filter(okUrl);
  const cached = key ? mem.get(`c|${key}`) : null;
  if (have.length >= 4 || (have.length && !key)) return collageHtml(have, title);
  if (cached && (cached.art || cached.tiles?.length)) return cached.art ? `<img class="cover-single" src="${esc(cached.art)}" alt="" loading="lazy">` : collageHtml(cached.tiles, title);
  if (key) return `<div class="cover-pending" data-need-cover="${esc(key)}" data-cover-title="${esc(title)}">${have.length ? collageHtml(have, title) : '<span class="skeleton cover-skel"></span>'}</div>`;
  return have.length ? collageHtml(have, title) : `<img class="cover-single" src="${COVER_PLACEHOLDER}" alt="">`;
}

// ---- batched hydration ----
const pendingArtists = new Map(), pendingCovers = new Set();
let flushT = 0;
function schedule() { clearTimeout(flushT); flushT = setTimeout(flush, 60); }
async function flush() {
  const artists = [...pendingArtists.values()].slice(0, 60); artists.forEach((a) => pendingArtists.delete(a.key));
  const covers = [...pendingCovers].slice(0, 40); covers.forEach((k) => pendingCovers.delete(k));
  if (pendingArtists.size || pendingCovers.size) schedule();
  if (artists.length) {
    try {
      const { images } = await api('/artwork/artists', { method: 'POST', body: { artists: artists.map((a) => ({ id: a.id || null, name: a.name })) } });
      for (const a of artists) { const url = images[a.key] ?? images[`name:${norm(a.name)}`] ?? null; mem.set(`a|${a.key}`, { url, exp: Date.now() + (url ? TTL : 3600_000) }); applyArtist(a.key, url); }
      persist();
    } catch { for (const a of artists) applyArtist(a.key, null, true); }
  }
  if (covers.length) {
    try {
      const { covers: res } = await api('/artwork/covers', { method: 'POST', body: { keys: covers } });
      for (const k of covers) { const v = res[k]; if (v) { mem.set(`c|${k}`, { ...v, exp: Date.now() + (/^(playlist|likes|recent)/.test(k) ? 60_000 : 6 * 3600_000) }); persist(); } applyCover(k, v); }
    } catch { for (const k of covers) applyCover(k, null); }
  }
}
function applyArtist(key, url, transient = false) {
  document.querySelectorAll(`img[data-artist-key="${CSS.escape(key)}"]`).forEach((img) => {
    delete img.dataset.needArtist; img.dataset.artistTried = '1';
    if (url) { img.src = url; img.classList.remove('is-placeholder'); } else { img.src = ARTIST_PLACEHOLDER; img.classList.add('is-placeholder'); if (transient) delete img.dataset.artistTried; }
  });
}
function applyCover(key, v) {
  document.querySelectorAll(`[data-need-cover="${CSS.escape(key)}"]`).forEach((box) => {
    const title = box.dataset.coverTitle || '';
    const existing = [...box.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    const html = v?.art ? `<img class="cover-single" src="${esc(v.art)}" alt="" loading="lazy">` : collageHtml([...existing, ...(v?.tiles || [])], title);
    box.outerHTML = html || `<img class="cover-single" src="${COVER_PLACEHOLDER}" alt="">`;
  });
}
// Broken provider URL: try the backend once (artists), otherwise drop the cell / use placeholder.
window.__vesperArtErr = (img) => {
  img.onerror = null;
  if (img.classList.contains('artist-photo')) {
    if (!img.dataset.artistTried) { img.dataset.artistTried = '1'; mem.delete(`a|${img.dataset.artistKey}`); pendingArtists.set(img.dataset.artistKey, { key: img.dataset.artistKey, id: img.dataset.artistId, name: img.dataset.artistName }); img.src = ARTIST_PLACEHOLDER; schedule(); }
    else img.src = ARTIST_PLACEHOLDER;
    return;
  }
  const collage = img.closest('.cover-collage');
  if (collage && collage.querySelectorAll('img').length > 1) { img.remove(); const n = collage.querySelectorAll('img').length; collage.className = `cover-collage n${n}`; if (n === 1) collage.outerHTML = `<img class="cover-single" src="${esc(collage.querySelector('img').src)}" alt="">`; return; }
  img.src = COVER_PLACEHOLDER;
};
let io = null;
function observe(root) {
  io ||= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue; io.unobserve(e.target); const el = e.target;
      if (el.dataset.needArtist) { const key = el.dataset.artistKey; const c = mem.get(`a|${key}`); if (c) applyArtist(key, c.url); else pendingArtists.set(key, { key, id: el.dataset.artistId, name: el.dataset.artistName }); }
      if (el.dataset.needCover) pendingCovers.add(el.dataset.needCover);
    }
    schedule();
  }, { rootMargin: '400px' });
  root.querySelectorAll?.('[data-need-artist], [data-need-cover]').forEach((el) => io.observe(el));
}
export function startArtworkHydration() {
  observe(document);
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches?.('[data-need-artist], [data-need-cover]')) observe(n.parentNode || document); else observe(n); } }).observe(document.body, { childList: true, subtree: true });
}
