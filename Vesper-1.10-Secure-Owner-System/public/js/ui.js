// Rendering helpers shared by every view.
import { isLiked, store } from './store.js';
import { artistPhoto, collectionCover } from './artwork.js';
import { isSaved } from './offline.js';
import { coverFallback } from './cover.js';
export { coverFallback } from './cover.js';

const S = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const F = (d) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${d}</svg>`;
export const ICONS = {
  home: S('<path d="M4 10.5 12 4l8 6.5V20h-5.5v-6h-5v6H4z"/>'),
  search: S('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  compass: S('<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  chart: S('<path d="M5 20V11M10 20V5M15 20v-7M20 20V8"/>'),
  users: S('<circle cx="9" cy="8.5" r="3.5"/><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 14.8c1.4.9 2.3 2.6 2.5 5.2"/>'),
  disc: S('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/>'),
  list: S('<path d="M4 6h11M4 11h11M4 16h7"/><path d="M18 18.5a2 2 0 1 1-2-2 2 2 0 0 1 2 2Zm0 0V8l3-1"/>'),
  library: S('<path d="M5 4v16M9.5 4v16"/><path d="m14 4.5 4.8 15"/>'),
  stats: S('<path d="M4 19h16"/><path d="M6.5 15l4-5 3.5 3 4.5-6.5"/>'),
  settings: S('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2"/><circle cx="12" cy="12" r="6.6"/>'),
  play: F('<path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2Z"/>'),
  pause: F('<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>'),
  next: F('<path d="M5 6.2v11.6a.9.9 0 0 0 1.4.75L15 12.75a.9.9 0 0 0 0-1.5L6.4 5.45A.9.9 0 0 0 5 6.2Z"/><rect x="16.5" y="5" width="2.6" height="14" rx="1"/>'),
  prev: F('<path d="M19 6.2v11.6a.9.9 0 0 1-1.4.75L9 12.75a.9.9 0 0 1 0-1.5l8.6-5.8A.9.9 0 0 1 19 6.2Z"/><rect x="4.9" y="5" width="2.6" height="14" rx="1"/>'),
  shuffle: S('<path d="M3 7h3.5c4.5 0 6.5 10 11 10H21M3 17h3.5c1.6 0 2.8-1.2 3.8-2.8M14 9.6C15 8 16.2 7 17.5 7H21"/><path d="m18.5 4.5 2.5 2.5-2.5 2.5M18.5 14.5 21 17l-2.5 2.5"/>'),
  repeat: S('<path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7H20M20 13v1.5A2.5 2.5 0 0 1 17.5 17H4"/><path d="m17 4 3 3-3 3M7 20l-3-3 3-3"/>'),
  repeatOne: S('<path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7H20M20 13v1.5A2.5 2.5 0 0 1 17.5 17H4"/><path d="m17 4 3 3-3 3M7 20l-3-3 3-3"/><path d="M11.5 10.5 12.5 10v4" stroke-width="1.6"/>'),
  heart: S('<path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10Z"/>'),
  heartFill: F('<path d="M12 20.3c-.2 0-8.3-4.6-8.3-10.8A4.9 4.9 0 0 1 12 6.3a4.9 4.9 0 0 1 8.3 3.2c0 6.2-8.1 10.8-8.3 10.8Z"/>'),
  queue: S('<path d="M4 6h16M4 11h16M4 16h9"/><path d="M16.5 14.5v5l4-2.5z" fill="currentColor"/>'),
  lyrics: S('<path d="M5 5.5h14a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-7l-4.5 3.5V16H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z"/><path d="M8 9.5h8M8 12.5h5"/>'),
  volume: S('<path d="M4 9.5h3l5-4v13l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>'),
  mute: S('<path d="M4 9.5h3l5-4v13l-5-4H4z"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/>'),
  more: F('<circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  close: S('<path d="m6 6 12 12M18 6 6 18"/>'),
  down: S('<path d="m6 9 6 6 6-6"/>'),
  drag: S('<path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" stroke-width="3"/>'),
  blend: S('<path d="M3 17c4 0 6-10 10-10M11 17c4 0 6-10 10-10"/>'),
  radio: S('<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>'),
  replay: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/><path d="M3.5 9.5 3.6 5.6 7 7"/>'),
  eq: S('<path d="M6 4v16M12 4v16M18 4v16"/><rect x="4" y="13" width="4" height="3" rx="1" fill="currentColor"/><rect x="10" y="7" width="4" height="3" rx="1" fill="currentColor"/><rect x="16" y="11" width="4" height="3" rx="1" fill="currentColor"/>'),
  expand: S('<path d="M9 4H4v5M15 20h5v-5M4 4l6 6M20 20l-6-6"/>'),
  headphones: S('<path d="M3.5 13v-1a8.5 8.5 0 0 1 17 0v1"/><rect x="3" y="12" width="4" height="7" rx="1.5"/><rect x="17" y="12" width="4" height="7" rx="1.5"/><path d="M17 20c-1 1-2.5 1.5-5 1.5"/>'),
};
export const icon = (n) => `<i data-icon="${n}">${ICONS[n] || ''}</i>`;
export function hydrateIcons(root = document) { root.querySelectorAll('i[data-icon]:empty').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon] || ''; }); }

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const attr = esc;
export function fmtTime(s) { if (!Number.isFinite(s) || s < 0) return '0:00'; s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; }
export function fmtLong(ms) { const m = Math.round(ms / 60000); if (m < 60) return `${m} min`; const h = Math.floor(m / 60); return `${h} hr ${m % 60} min`; }
export const year = (d) => (d ? String(d).slice(0, 4) : '');
export const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const PROV = { deezer: 'Deezer', itunes: 'Apple', jamendo: 'Jamendo', local: 'My files', test: 'Test signal', youtube: 'YouTube' };
export const providerName = (p) => PROV[p] || p;

// Registry of track lists rendered on screen, so delegated click handlers can find them.
export const lists = new Map();
let listSeq = 0;
export function registerList(tracks, ctx = {}) { const id = `l${++listSeq}`; lists.set(id, { tracks, ...ctx }); return id; }
export function resetLists() { lists.clear(); }

export function artistLink(t) {
  if (!t.artist) return '';
  if (t.artistId && /^(dz|jma|ita):/.test(t.artistId)) return `<a href="#/artist/${encodeURIComponent(t.artistId)}">${esc(t.artist)}</a>`;
  if (t.provider === 'local' || t.provider === 'test') return esc(t.artist);
  return `<a href="#/artist-name/${encodeURIComponent(t.artist)}">${esc(t.artist)}</a>`;
}
export function albumLink(t) {
  if (!t.album) return '';
  if (t.albumId && /^(dz|jmc|itc):/.test(t.albumId)) return `<a href="#/album/${encodeURIComponent(t.albumId)}">${esc(t.album)}</a>`;
  return esc(t.album);
}

export function trackRow(t, i, listId, opts = {}) {
  const playable = t.playable !== false;
  const badges = [];
  if (t.explicit) badges.push('<span class="badge e" title="Explicit">E</span>');
  if (isSaved(t.id)) badges.push('<span class=\"badge full\" title=\"Saved on this device for offline listening\">Offline</span>');
  if (t.provider === 'youtube') badges.push(t.official ? '<span class="badge full" title="From the artist’s official channel">Official</span>' : '<span class="badge yt" title="Full-length audio matched from YouTube and played through Vesper’s audio engine.">YouTube</span>');
  else if (['local', 'jamendo', 'test'].includes(t.provider) || t.fullTrack === true) badges.push('<span class="badge full" title="Full-length audio">Full</span>');
  else if (t.noFullMatch || ((t.preview) && store.settings?.fullViaYouTube === false)) badges.push(`<span class="badge" title="${t.matchNote ? t.matchNote.replace(/"/g, '&quot;') : '30-second preview from the provider'}">Preview</span>`);
  if (opts.badges !== false && opts.showSource) badges.push(`<span class="badge" title="Music source">${esc(providerName(t.provider))}</span>`);
  let lead = `<span class="r-n">${opts.rank ? `<span class="rank">${i + 1}</span>` : i + 1}</span>`;
  const move = opts.movement ? movement(t) : '';
  const sub = opts.hideAlbum ? artistLink(t) : [artistLink(t), albumLink(t)].filter(Boolean).join(', ');
  const cover = t.albumArtwork || t.artworkSmall || t.artwork || coverFallback(t);
  return `<div class="row${playable ? '' : ' unplayable'}" data-tid="${attr(t.id)}" data-list="${listId}" data-idx="${i}" ${playable ? '' : `title="${attr(t.unplayableReason || 'Not playable')}"`}>
    <div class="r-idx">${lead}<button class="r-play" data-act="play-row" aria-label="Play ${attr(t.title)}" ${playable ? '' : 'disabled'}>${icon('play')}</button></div>
    <img class="r-art" src="${attr(cover)}" alt="Album cover for ${attr(t.album || t.title)}" loading="lazy" onerror="this.onerror=null;this.src='${coverFallback(t)}'">
    <div class="r-meta"><span class="r-title">${esc(t.title)}</span><span class="r-sub">${sub}</span>${t.reason ? `<span class="r-reason">${esc(t.reason)}</span>` : ''}${!playable ? `<span class="r-reason">${esc(t.unplayableReason || 'Not playable')}</span>` : ''}</div>
    <div class="r-badges">${move}${badges.join('')}</div>
    <span class="dur">${t.duration ? fmtTime(t.duration) : ''}</span>
    <button class="icon-btn r-like${isLiked(t.id) ? ' liked' : ''}" data-act="like" aria-label="${isLiked(t.id) ? 'Remove from' : 'Add to'} Liked Songs">${icon(isLiked(t.id) ? 'heartFill' : 'heart')}</button>
    <button class="r-add-playlist" data-act="add-playlist-row" aria-label="Add ${attr(t.title)} to a playlist" title="Add to playlist">${icon('plus')}<span class="r-add-label">Playlist</span></button>
    <button class="icon-btn" data-act="track-menu" aria-label="More options for ${attr(t.title)}">${icon('more')}</button>
  </div>`;
}
function movement(t) {
  if (t.previous === undefined) return '';
  if (t.previous === null) return '<span class="move new" title="New since last snapshot">New</span>';
  const d = t.previous - t.position;
  if (d === 0) return '<span class="move same" title="No change">–</span>';
  return d > 0 ? `<span class="move up" title="Up ${d} from #${t.previous}">▲${d}</span>` : `<span class="move down" title="Down ${-d} from #${t.previous}">▼${-d}</span>`;
}
export function trackList(tracks, ctx = {}, opts = {}) {
  if (!tracks?.length) return opts.empty || '<p class="note">Nothing here yet.</p>';
  const id = registerList(tracks, ctx);
  return `<div class="rows" data-list-root="${id}">${tracks.map((t, i) => trackRow(t, i, id, opts)).join('')}</div>`;
}

export function tile({ href, art, title, sub, round = false, play = null, mix = null, typeTitle = null, collage = null, coverKey = null, artist = null }) {
  const artHtml = artist ? artistPhoto(artist) : collectionCover({ art, tiles: collage, key: coverKey, title });
  return `<a class="tile${round ? ' round' : ''}" href="${attr(href)}"><div class="tile-art">${artHtml}${typeTitle ? `<span class="tile-type">${esc(typeTitle)}</span>` : ''}${play ? `<button class="tile-play" data-act="${play.act}" data-id="${attr(play.id)}" aria-label="Play ${attr(title)}">${icon('play')}</button>` : ''}</div><div class="tile-title">${esc(title)}</div>${sub ? `<div class="tile-sub">${esc(sub)}</div>` : ''}</a>`;
}
export const albumTile = (a) => tile({ href: `#/album/${encodeURIComponent(a.id)}`, art: a.artwork || a.artworkSmall || null, coverKey: a.artwork || a.artworkSmall ? null : (/^dz:/.test(a.id) ? `album:${a.id}` : null), title: a.title, sub: [a.artist, year(a.releaseDate)].filter(Boolean).join(', '), play: { act: 'play-album', id: a.id } });
export const artistTile = (a) => tile({ href: a.id ? `#/artist/${encodeURIComponent(a.id)}` : `#/artist-name/${encodeURIComponent(a.name)}`, artist: a, title: a.name, sub: 'Artist', round: true });

export function section(title, body, link = '') { return `<section class="section"><div class="section-head"><h2>${esc(title)}</h2>${link}</div>${body}</section>`; }
export function errorNote(msg) { return `<div class="notice error">${esc(msg)}</div>`; }
export function skeletonRows(n = 6) { return `<div class="rows">${Array.from({ length: n }, () => '<div class="row"><span></span><div class="r-art skeleton"></div><div class="r-meta"><div class="skeleton" style="height:14px;width:40%;margin-bottom:6px"></div><div class="skeleton" style="height:12px;width:25%"></div></div></div>').join('')}</div>`; }
export function skeletonShelf(n = 6) { return `<div class="shelf">${Array.from({ length: n }, () => '<div class="tile"><div class="tile-art skeleton"></div><div class="skeleton" style="height:14px;width:70%"></div></div>').join('')}</div>`; }

// Toasts
export function toast(msg, { error = false, action = null, ms = 3600 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { action.fn(); el.remove(); }; el.append(b); }
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

// Popover menu: items = [{label, fn, checked, disabled, sep, head, note, href}]
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
export function menu(anchor, items) {
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu'; el.setAttribute('role', 'menu');
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { el.append(document.createElement('hr')); continue; }
    if (it.head) { const h = document.createElement('div'); h.className = 'm-head'; h.textContent = it.head; el.append(h); continue; }
    if (it.note) { const n = document.createElement('div'); n.className = 'm-note'; n.textContent = it.note; el.append(n); continue; }
    const b = document.createElement(it.href ? 'a' : 'button');
    b.setAttribute('role', it.checked !== undefined ? 'menuitemradio' : 'menuitem');
    if (it.checked !== undefined) b.setAttribute('aria-checked', String(!!it.checked));
    if (it.href) b.href = it.href;
    b.textContent = it.label;
    if (it.disabled) { b.disabled = true; if (it.title) b.title = it.title; }
    b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); it.fn?.(); });
    el.append(b);
  }
  // Keep popovers in the top-level document layer so app/Now Playing stacking contexts
  // cannot cover them, and so clicks are never swallowed by a transformed parent.
  const layer = document.getElementById('menu-layer') || document.body;
  layer.append(el);
  const mobile = matchMedia('(max-width: 760px)').matches;
  if (mobile) el.classList.add('sheet');
  else {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    el.style.top = `${r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  }
  openMenu = el;
  el.querySelector('button:not(:disabled), a')?.focus();
  el.addEventListener('keydown', (e) => {
    const f = [...el.querySelectorAll('button:not(:disabled), a')];
    const i = f.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); f[(i + 1) % f.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); f[(i - 1 + f.length) % f.length]?.focus(); }
    if (e.key === 'Escape') { closeMenu(); anchor.focus?.(); }
  });
  return el;
}
document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target) && !e.target.closest('[data-act=\"track-menu\"], [data-act=\"add-playlist-row\"], [data-act=\"np-track-menu\"], [data-act=\"add-current-to-playlist\"]')) closeMenu(); });

// Simple form dialog. fields: [{name, label, value, type, placeholder}]
export function formDialog(title, fields, submitLabel = 'Save') {
  const d = document.getElementById('dialog');
  d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${fields.map((f) => `<div class="field"><label for="f-${f.name}">${esc(f.label)}</label>${f.type === 'textarea' ? `<textarea class="input" id="f-${f.name}" name="${f.name}" placeholder="${attr(f.placeholder || '')}">${esc(f.value || '')}</textarea>` : `<input class="input" id="f-${f.name}" name="${f.name}" type="${f.type || 'text'}" value="${attr(f.value || '')}" placeholder="${attr(f.placeholder || '')}" ${f.required ? 'required' : ''}>`}</div>`).join('')}<div class="actions"><button class="btn ghost" value="cancel" type="button" data-cancel>Cancel</button><button class="btn primary" value="ok">${esc(submitLabel)}</button></div></form>`;
  return new Promise((resolve) => {
    const form = d.querySelector('form');
    let pendingResult;
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; resolve(value); };
    // Resolve only when this dialog has fully closed. This prevents a queued close event
    // from an earlier dialog from cancelling a newly opened playlist form.
    d.addEventListener('close', () => finish(pendingResult ?? null), { once: true });
    d.querySelector('[data-cancel]').onclick = () => { pendingResult = null; d.close(); };
    form.onsubmit = (e) => { e.preventDefault(); pendingResult = Object.fromEntries(new FormData(form)); d.close(); };
    d.showModal();
    d.querySelector('input, textarea')?.select();
  });
}
export function confirmDialog(title, text, okLabel = 'Delete') {
  const d = document.getElementById('dialog');
  d.innerHTML = `<h2>${esc(title)}</h2><p class="note" style="font-size:15px">${esc(text)}</p><div class="actions"><button class="btn ghost" data-no>Cancel</button><button class="btn primary" data-yes>${esc(okLabel)}</button></div>`;
  return new Promise((resolve) => {
    d.querySelector('[data-no]').onclick = () => { d.close(); resolve(false); };
    d.querySelector('[data-yes]').onclick = () => { d.close(); resolve(true); };
    d.onclose = () => resolve(false);
    d.showModal();
  });
}
