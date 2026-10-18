// Offline listening for music you're allowed to keep: your own files and Jamendo tracks whose artists
// allow downloads. Previews and YouTube videos can't be saved. Audio is stored in the browser's
// Cache Storage on this device; the service worker serves it (with byte-range support) when you play.
export const AUDIO_CACHE = 'vesper-audio-v1';
const IDX = 'vesper.offline.v1';
const listeners = new Set();
const read = () => { try { return JSON.parse(localStorage.getItem(IDX) || '{}'); } catch { return {}; } };
const write = (o) => { localStorage.setItem(IDX, JSON.stringify(o)); listeners.forEach((f) => f()); };
export const onOfflineChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const eligible = (t) => !!t && (t.provider === 'local' || t.provider === 'test' || (t.provider === 'jamendo' && t.downloadable !== false));
export const whyNot = (t) => t?.provider === 'youtube' ? 'YouTube videos can only play in YouTube’s player, so they can’t be saved.' : t?.preview ? 'Previews can’t be saved for offline listening.' : t?.provider === 'jamendo' ? 'This artist doesn’t allow downloads.' : 'Only your own files and download-permitted Jamendo tracks can be saved.';
export const isSaved = (id) => !!read()[id];
export const savedTracks = () => Object.values(read()).sort((a, b) => b.at.localeCompare(a.at)).map((x) => x.track);
const urlFor = (t) => `/api/audio/${encodeURIComponent(t.id)}`;
export async function saveOffline(track) {
  if (!eligible(track)) throw new Error(whyNot(track));
  if (!('caches' in window)) throw new Error('This browser doesn’t support offline storage.');
  const res = await fetch(urlFor(track), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn’t download “${track.title}” (${res.status}).`);
  const blob = await res.blob();
  const cache = await caches.open(AUDIO_CACHE);
  await cache.put(urlFor(track), new Response(blob, { headers: { 'Content-Type': res.headers.get('content-type') || 'audio/mpeg', 'Content-Length': String(blob.size), 'Accept-Ranges': 'bytes' } }));
  navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict saved music
  const o = read(); const { reason, ...slim } = track; o[track.id] = { track: slim, size: blob.size, at: new Date().toISOString() }; write(o);
}
export async function removeOffline(id) { const o = read(); if (o[id]) { await caches.open(AUDIO_CACHE).then((c) => c.delete(`/api/audio/${encodeURIComponent(id)}`)).catch(() => {}); delete o[id]; write(o); } }
export async function removeAllOffline() { await caches.delete(AUDIO_CACHE).catch(() => {}); write({}); }
export async function saveManyOffline(tracks, onProgress = () => {}) {
  const list = tracks.filter(eligible).filter((t) => !isSaved(t.id)); let saved = 0, failed = 0;
  for (const [i, t] of list.entries()) { try { await saveOffline(t); saved++; } catch { failed++; } onProgress(i + 1, list.length); }
  return { saved, failed, skipped: tracks.length - tracks.filter(eligible).length, already: tracks.filter(eligible).length - list.length };
}
export async function offlineUsage() {
  const o = read(), bytes = Object.values(o).reduce((s, x) => s + (x.size || 0), 0);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  return { count: Object.keys(o).length, bytes, quota: est?.quota || null, persisted: await navigator.storage?.persisted?.().catch(() => false) };
}
