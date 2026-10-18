// API access + shared app state.
export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { 'x-vesper': '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try { res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal, credentials: 'same-origin' }); }
  catch (e) { if (e.name === 'AbortError') throw e; const err = new Error('Can’t reach the Vesper server. Is it still running?'); err.status = 0; throw err; }
  const data = await res.json().catch(() => ({ error: `Unexpected response (${res.status})` }));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; e.code = data.code; throw e; }
  return data;
}
// Same-origin image URL (needed for colour extraction and lock-screen artwork).
export const proxied = (u) => (!u ? null : u.startsWith('/') ? u : `/api/img?u=${encodeURIComponent(u)}`);

const subs = new Set();
export const on = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const emit = (what, data) => subs.forEach((fn) => { try { fn(what, data); } catch (e) { console.error(e); } });

export const store = {
  user: null,
  lib: { likes: new Map(), albums: new Map(), artists: new Map(), sessions: new Map(), playlists: [], local: [] },
  get settings() { return this.user?.settings || {}; },
};

export async function loadMe() {
  try { store.user = (await api('/me')).user; } catch (e) { if (e.status === 401) store.user = null; else throw e; }
  return store.user;
}
export async function loadLibrary() {
  const d = await api('/me/library');
  const L = store.lib;
  L.likes = new Map(d.likes.map((t) => [t.id, t]));
  L.albums = new Map(d.albums.map((a) => [a.id, a]));
  L.artists = new Map(d.artists.map((a) => [a.id, a]));
  L.sessions = new Map(d.sessions.map((s) => [s.id, s]));
  L.playlists = d.playlists; L.local = d.local;
  emit('library');
}
export const isLiked = (id) => store.lib.likes.has(id);
export async function toggleLike(track) {
  const liked = isLiked(track.id);
  if (liked) store.lib.likes.delete(track.id); else store.lib.likes.set(track.id, { ...track, likedAt: new Date().toISOString() });
  emit('likes', track.id);
  try {
    if (liked) await api(`/me/likes/${encodeURIComponent(track.id)}`, { method: 'DELETE' });
    else await api(`/me/likes/${encodeURIComponent(track.id)}`, { method: 'PUT', body: { track } });
  } catch (e) { // roll back
    if (liked) store.lib.likes.set(track.id, track); else store.lib.likes.delete(track.id);
    emit('likes', track.id); throw e;
  }
  return !liked;
}
export async function toggleSaved(kind, obj) { // kind: albums | artists | sessions
  const key = kind === 'sessions' ? obj.slug : obj.id;
  const has = store.lib[kind].has(key);
  const previous = store.lib[kind].get(key);
  if (has) store.lib[kind].delete(key);
  else store.lib[kind].set(key, { ...obj, ...(kind === 'sessions' ? { slug: key } : {}), savedAt: new Date().toISOString() });
  emit('library');
  try {
    if (has) await api(`/me/${kind}/${encodeURIComponent(key)}`, { method: 'DELETE' });
    else { const body = kind === 'albums' ? { album: obj } : kind === 'artists' ? { artist: obj } : { session: obj }; const r = await api(`/me/${kind}/${encodeURIComponent(key)}`, { method: 'PUT', body }); store.lib[kind].set(key, r.item); }
    emit('library');
    return !has;
  } catch (e) {
    if (has) store.lib[kind].set(key, previous); else store.lib[kind].delete(key);
    emit('library');
    throw e;
  }
}
export async function saveSettings(patch) {
  const prev = { ...store.user.settings };
  Object.assign(store.user.settings, patch);
  emit('settings', patch);
  try { store.user = (await api('/me', { method: 'PATCH', body: { settings: patch } })).user; }
  catch (e) { store.user.settings = prev; emit('settings', prev); throw e; }
}
export async function refreshPlaylists() {
  const d = await api('/me/library');
  store.lib.playlists = d.playlists;
  emit('library');
}
