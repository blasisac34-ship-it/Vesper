// Vesper bootstrap.
import { api, store, on, loadMe, loadLibrary, toggleLike, isLiked, saveSettings, refreshPlaylists, proxied, emit } from './store.js';
import { Engine, PRESETS } from './engine.js';
import { Queue } from './queue.js';
import { Lyrics } from './lyrics.js';
import { Panel } from './panels.js';
import { NowPlaying } from './nowplaying.js';
import { palette, applyPalette } from './color.js';
import { icon, hydrateIcons, lists, resetLists, toast, menu, formDialog, fmtTime, esc, providerName } from './ui.js';
import * as V from './views.js';
import * as M from './views-me.js';
import { startArtworkHydration } from './artwork.js';
import { openOutputMenu, restoreOutput } from './output.js';
import { openAmbience, closeAmbience } from './ambience.js';
import { YouTubePlayer } from './youtube.js';
import { shareCard } from './share.js';
import { eligible, isSaved, saveOffline, removeOffline, whyNot, saveManyOffline } from './offline.js';
import { openAudioPanel } from './audio.js';
import { replayView } from './replay.js';
import { importView } from './import.js';
import { initDiscord } from './discord.js';
import { initUpdates } from './updates.js';
import { radioDirectoryView } from './radio-directory.js';

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Check for a new version on every load, and reload once when an updated worker takes control,
  // so you never keep running old code after updating Vesper.
  const hadController = !!navigator.serviceWorker.controller; let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || reloadedForUpdate) return; reloadedForUpdate = true; location.reload(); });
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch((e) => console.warn('Vesper offline shell unavailable:', e)));
}

const $ = (id) => document.getElementById(id);
const shell = $('app');
const engine = new Engine();
const queue = new Queue(engine);
const lyrics = new Lyrics(engine);
const app = { engine, queue, lyrics, actions: {}, currentPlaylist: null };
window.vesper = app; // handy for debugging and end-to-end tests
const ytPlayer = new YouTubePlayer(engine);
engine.setExternalPlayer(ytPlayer);
app.yt = ytPlayer;
queue.initLearning();
let panel, np;

// ---------- theme & motion ----------
function applyAppearance() {
  const s = store.settings;
  document.documentElement.dataset.theme = s.theme || 'dark';
  const rm = s.reducedMotion || 'system';
  if (rm === 'on') document.documentElement.dataset.motion = 'reduced'; else if (rm === 'off') document.documentElement.dataset.motion = 'full'; else delete document.documentElement.dataset.motion;
  document.querySelector('meta[name="theme-color"]').content = s.theme === 'light' ? '#ECEDF1' : '#1A1B20';
  engine.setSettings({ transition: s.transition, crossfade: s.crossfade, speed: s.speed, leveling: s.leveling, processing: s.processing, eq: s.eq, dataSaver: !!s.dataSaver });
  recolor(engine.state.track);
}

// ---------- router ----------
const ROUTES = {
  home: [V.home], search: [V.search], discover: [V.discover], charts: [V.charts, 'id'], following: [V.following], 'radio-directory': [radioDirectoryView],
  albums: [M.albums], playlists: [M.playlists], library: [M.library, 'tab'], stats: [M.stats], settings: [M.settings],
  artist: [V.artist, 'id'], 'artist-name': [V.artistByName, 'name'], album: [V.album, 'id'], playlist: [M.playlist, 'id'],
  replay: [replayView], import: [importView],
  dzplaylist: [V.dzplaylist, 'id'], session: [V.session, 'slug'], mix: [V.mix, 'kind'], radio: [V.radio, 'id'],
};
let cleanup = null, routeSeq = 0, lastHash = null;
async function route() {
  const seq = ++routeSeq;
  const [path, qs] = (location.hash.slice(2) || 'home').split('?');
  const [name, ...rest] = path.split('/');
  // #/ambience opens the full-screen Ambience Studio over the page you were on.
  if (name === 'ambience') { openAmbience(engine, queue); history.replaceState(null, '', lastHash || '#/home'); if (lastHash) return; }
  else lastHash = location.hash || '#/home';
  const r = ROUTES[name] || ROUTES.home;
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  if (r[1] && rest.length) params[r[1]] = decodeURIComponent(rest.join('/'));
  cleanup?.(); cleanup = null;
  resetLists();
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name || (name === '' && a.dataset.nav === 'home')));
  const view = $('view');
  view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
  $('main').scrollTop = 0;
  if (matchMedia('(max-width: 1180px)').matches) panel?.hide();
  try {
    // Each navigation renders into its own container, so a slow page that finishes loading after
    // you've moved on can't overwrite the page you're now on.
    const host = document.createElement('div'); host.className = 'view-page'; view.replaceChildren(host);
    const out = await r[0](params, host, app);
    if (seq === routeSeq && typeof out === 'function') cleanup = out;
  } catch (e) {
    if (seq !== routeSeq) return;
    view.innerHTML = `<div class="empty"><h2>${e.status === 404 ? 'Not found' : 'This page didn’t load'}</h2><p>${esc(e.message)}</p><button class="btn ghost" onclick="location.reload()">Try again</button></div>`;
  }
  hydrateIcons(view);
}

// ---------- player bar ----------
let scrubbing = false;
let selectedOutputDevice = null;
let outputDeviceLabel = 'System audio';
function prettyDeviceLabel(label) {
  const clean = String(label || '').replace(/^default\s*[-:]\s*/i, '').trim();
  if (!clean || /^(default|communications?)$/i.test(clean)) return '';
  return clean.replace(/\s*\([^)]*(?:audio|bluetooth|coreaudio)[^)]*\)\s*/ig, '').trim() || clean;
}
async function refreshOutputDevice() {
  const button = $('p-device'), labelEl = $('p-device-label');
  if (!button || !labelEl) return;
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.() || [];
    const outputs = devices.filter((d) => d.kind === 'audiooutput');
    const labelled = outputs.map((d) => ({ device: d, label: prettyDeviceLabel(d.label) })).filter((x) => x.label);
    const defaultOutput = labelled.find((x) => /^default\b/i.test(x.device.label));
    const onlyOutput = labelled.length === 1 ? labelled[0] : null;
    const knownHeadphone = labelled.find((x) => /airpods|beats|sony|headphones?|headset|bose|jabra|sennheiser|bluetooth|qc[0-9]|wh-[0-9]/i.test(x.label));
    outputDeviceLabel = selectedOutputDevice?.routed ? selectedOutputDevice.label : defaultOutput?.label || onlyOutput?.label || (knownHeadphone ? `Available: ${knownHeadphone.label}` : 'System audio');
    if (!labelled.length && !selectedOutputDevice?.routed) outputDeviceLabel = 'System audio';
  } catch { outputDeviceLabel = selectedOutputDevice?.label || 'System audio'; }
  labelEl.textContent = outputDeviceLabel;
  button.title = outputDeviceLabel === 'System audio'
    ? 'The browser does not expose the active output device name. Click to check available options.'
    : `Audio output: ${outputDeviceLabel}. Click to change or refresh.`;
  button.setAttribute('aria-label', `Audio output: ${outputDeviceLabel}`);
}
async function chooseOutputDevice() {
  if (!navigator.mediaDevices?.selectAudioOutput) {
    await refreshOutputDevice();
    toast(outputDeviceLabel === 'System audio'
      ? 'Your browser hides the active audio-device name. Check macOS Control Center → Sound to see whether headphones are selected.'
      : `Vesper can see ${outputDeviceLabel}. The active output is controlled by macOS unless this browser supports output routing.`, { ms: 5200 });
    return;
  }
  try {
    const device = await navigator.mediaDevices.selectAudioOutput();
    selectedOutputDevice = { id: device.deviceId, label: prettyDeviceLabel(device.label) || 'Selected audio device', routed: false };
    if (engine.ctx && typeof engine.ctx.setSinkId === 'function') {
      await engine.ctx.setSinkId(device.deviceId);
      selectedOutputDevice.routed = true;
      toast(`Vesper audio output: ${selectedOutputDevice.label}`);
    } else {
      toast(`${selectedOutputDevice.label} detected. This browser can't route Vesper's processed audio directly; use macOS Control Center → Sound to select the output.`, { ms: 5200 });
    }
    await refreshOutputDevice();
  } catch (err) {
    if (err?.name !== 'NotAllowedError' && err?.name !== 'AbortError') toast(err.message || 'Could not read audio output devices.', { error: true });
  }
}
navigator.mediaDevices?.addEventListener?.('devicechange', refreshOutputDevice);
window.addEventListener('focus', refreshOutputDevice);
refreshOutputDevice();
function renderPlayer() {
  const s = engine.state, t = s.track;
  const playing = s.status === 'playing' || s.status === 'buffering';
  $('p-play').innerHTML = icon(playing ? 'pause' : 'play'); $('p-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('p-play').classList.toggle('busy', s.status === 'loading' || s.status === 'buffering');
  const badge = $('p-badge'); badge.hidden = true; badge.textContent = ''; badge.title = '';
  if (t) {
    $('p-art').src = t.albumArtwork || t.artworkSmall || t.artwork || ''; $('p-art').alt = `Album cover for ${t.album || t.title}`;
    if (['playing', 'paused', 'ended'].includes(s.status) && (t.fullTrack === true || t.youtubeMatched === true || ['youtube', 'local', 'jamendo'].includes(t.provider))) { badge.hidden = false; badge.className = 'badge full'; badge.textContent = 'Full'; badge.title = 'Full-length audio source is ready'; }
    $('p-title').textContent = t.title; $('p-title').href = t.albumId && /^(dz|jmc):/.test(t.albumId) ? `#/album/${encodeURIComponent(t.albumId)}` : '#';
    $('p-artist').textContent = t.artist || ''; $('p-artist').href = t.artistId && /^(dz|jma):/.test(t.artistId) ? `#/artist/${encodeURIComponent(t.artistId)}` : (t.artist && !['local', 'test'].includes(t.provider) ? `#/artist-name/${encodeURIComponent(t.artist)}` : '#');
    const liked = isLiked(t.id);
    $('p-like').innerHTML = icon(liked ? 'heartFill' : 'heart'); $('p-like').classList.toggle('liked', liked);
    $('p-add-playlist').disabled = false; $('p-add-playlist').title = `Add ${t.title} to a playlist`; $('p-add-playlist').setAttribute('aria-label', `Add ${t.title} to a playlist`);
    document.title = `${t.title} — ${t.artist} | Vesper`;
  } else { $('p-title').textContent = 'Nothing playing'; $('p-artist').textContent = ''; $('p-add-playlist').disabled = true; $('p-add-playlist').title = 'Play a song first'; $('p-add-playlist').setAttribute('aria-label', 'Play a song first to add it to a playlist'); document.title = 'Vesper'; }
  const tr = s.transition;
  const status = s.status === 'loading' ? 'Loading…' : s.status === 'buffering' ? 'Buffering…' : s.status === 'error' ? s.error : tr ? (tr.kind === 'seamless' ? 'Joining seamlessly' : `${PRESETS[tr.preset]?.label} blend, ${tr.fade.toFixed(1)} s${tr.note ? ` (${tr.note})` : ''}`) : s.error ? s.error : '';
  $('p-status').textContent = status;
  $('p-shuffle').setAttribute('aria-pressed', String(queue.shuffle));
  $('p-repeat').innerHTML = icon(queue.repeat === 'one' ? 'repeatOne' : 'repeat'); $('p-repeat').classList.toggle('on', queue.repeat !== 'off');
  $('p-repeat').setAttribute('aria-label', `Repeat: ${queue.repeat === 'all' ? 'all' : queue.repeat === 'one' ? 'one song' : 'off'}`);
  $('p-speed').textContent = `${engine.settings.speed}×`;
  $('p-ambience').textContent = ({ minimal: 'Minimal', ambient: 'Ambient', immersive: 'Immersive', visualizer: 'Visualizer', lyrics: 'Lyrics' })[store.settings.artworkMode || 'ambient'] || 'Ambient';
  $('p-ambience').setAttribute('aria-label', `Now Playing ambience: ${$('p-ambience').textContent}. Change ambience`);
  $('p-mute').innerHTML = icon(engine.muted || engine.volume === 0 ? 'mute' : 'volume');
  const vol = $('p-vol'); vol.value = Math.round(engine.volume * 100); vol.style.setProperty('--fill', `${vol.value}%`);
  renderTime();
  np?.open && np.render();
  document.querySelectorAll('.row.playing').forEach((r) => r.classList.remove('playing'));
  if (t) document.querySelectorAll(`.row[data-tid="${CSS.escape(t.id)}"]`).forEach((r) => r.classList.add('playing'));
}
function renderTime() {
  if (scrubbing) return;
  const p = engine.position, d = engine.duration || 0;
  $('p-pos').textContent = fmtTime(p); $('p-dur').textContent = fmtTime(d);
  const v = d ? (p / d) * 1000 : 0; const sk = $('p-seek'); sk.value = v; sk.style.setProperty('--fill', `${v / 10}%`);
  np?.time();
}

// ---------- colour atmosphere ----------
let atmosFlip = false, colorFor = null;
async function recolor(track) {
  const art = track?.albumArtwork || track?.artworkSmall || track?.artwork;
  colorFor = art;
  const pal = art ? await palette(art) : null;
  if (colorFor !== art) return;
  const c = applyPalette(pal, store.settings.theme || 'dark');
  const [a, b] = document.querySelectorAll('.atmos > div');
  const target = atmosFlip ? a : b, other = atmosFlip ? b : a; atmosFlip = !atmosFlip;
  if (c) { target.style.setProperty('--g1', c.g1); target.style.setProperty('--g2', c.g2); target.classList.add('on'); other.classList.remove('on'); }
  else { a.classList.remove('on'); b.classList.remove('on'); }
}

// ---------- Lock Screen / system media controls (Media Session API) ----------
const MS = 'mediaSession' in navigator;
function updateMediaMetadata(t) {
  if (!MS || !t) return;
  const art = t.albumArtwork || t.artworkSmall || t.artwork;
  const src = art ? new URL(proxied(art), location.href).href : null;
  const type = src?.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg';
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: t.album || '', artwork: src ? [{ src, sizes: '600x600', type }] : [] });
}
function updatePositionState() {
  if (!MS || !navigator.mediaSession.setPositionState) return;
  const d = engine.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: engine.rate || 1, position: Math.min(engine.position, d) }); } catch { /* ignore invalid state */ }
}
if (MS) {
  const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* unsupported action */ } };
  set('play', () => engine.play()); set('pause', () => engine.pause()); set('stop', () => engine.pause());
  set('previoustrack', () => queue.prev()); set('nexttrack', () => queue.next());
  set('seekto', (d) => { engine.seek(d.seekTime); updatePositionState(); });
  set('seekbackward', (d) => { engine.seek(engine.position - (d.seekOffset || 10)); updatePositionState(); });
  set('seekforward', (d) => { engine.seek(engine.position + (d.seekOffset || 10)); updatePositionState(); });
}

// ---------- engine wiring ----------
engine.addEventListener('state', () => {
  renderPlayer(); if (np?.open) np.render();
  if (MS) navigator.mediaSession.playbackState = engine.state.status === 'playing' || engine.state.status === 'buffering' ? 'playing' : engine.state.track ? 'paused' : 'none';
  updatePositionState();
});
engine.addEventListener('time', renderTime);
engine.addEventListener('tempo', () => { renderPlayer(); if (np?.open) np.render(); });
engine.addEventListener('transition-unavailable', (e) => toast(`Couldn’t crossfade this song: ${e.detail.reason}`, { error: true, ms: 5200 }));
engine.addEventListener('position', () => { updatePositionState(); renderTime(); });
engine.addEventListener('trackchange', (e) => { const t = e.detail; updateMediaMetadata(t); recolor(t); lyrics.load(t); renderPlayer(); });
engine.addEventListener('capabilities', () => { if (location.hash.startsWith('#/settings')) route(); });
engine.addEventListener('played', (e) => { if (store.user) api('/me/events', { method: 'POST', body: e.detail }).catch(() => {}); });
queue.addEventListener('change', renderPlayer);
queue.addEventListener('prewarm-state', (event) => {
  const { track, status } = event.detail || {};
  if (!track?.id) return;
  const rows = document.querySelectorAll(`.row[data-tid="${CSS.escape(String(track.id))}"]`);
  for (const row of rows) {
    const badges = row.querySelector('.r-badges'); if (!badges) continue;
    badges.querySelector('.prewarm-badge')?.remove();
    if (status === 'queued' || status === 'preparing' || status === 'paused') {
      const badge = document.createElement('span'); badge.className = 'badge prewarm-badge preparing';
      badge.textContent = status === 'queued' ? 'Queued' : status === 'paused' ? 'Paused' : 'Preparing…';
      badge.title = status === 'paused' ? 'Background matching is paused because YouTube needs sign-in or browser cookies.' : 'Vesper is finding and caching the official full-length version in the background.';
      badges.append(badge);
    } else if (status === 'ready') {
      const badge = document.createElement('span'); badge.className = 'badge full prewarm-badge'; badge.textContent = 'Ready';
      badge.title = 'Official match and stream details are cached; playback should start faster.'; badges.append(badge);
    } else if (status === 'unavailable') {
      const badge = document.createElement('span'); badge.className = 'badge prewarm-badge'; badge.textContent = 'No full match';
      badge.title = 'No verified full-length version was found. Vesper will follow your preview setting when you play it.'; badges.append(badge);
    }
  }
});
queue.addEventListener('youtube-blocked', (e) => toast(e.detail.message, { error: true, ms: 12000, action: { label: 'Fix it', fn: () => { location.hash = '#/settings'; setTimeout(() => document.getElementById('yt-signin')?.scrollIntoView({ behavior: 'smooth' }), 400); } } }));
queue.addEventListener('notice', (e) => toast(e.detail.message, { ms: 4500 }));
queue.addEventListener('play-error', (e) => toast(`Couldn’t play “${e.detail.track?.title}”: ${e.detail.message}`, { error: true, ms: 5000 }));
queue.addEventListener('skipped-unplayable', (e) => toast(`Skipped “${e.detail.track.title}”: ${e.detail.message}`, { error: true }));
queue.addEventListener('stopped-after-errors', () => toast('Stopped after several songs failed to play. Check your connection or the provider status in Settings.', { error: true, ms: 7000 }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { queue.persist(); const ev = engine.flushSession(); if (ev && store.user) fetch('/api/me/events', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-vesper': '1' }, body: JSON.stringify(ev) }).catch(() => {}); } });
setInterval(() => { if (!engine.paused) queue.persist(); }, 10000);

// First user gesture unlocks audio (autoplay policies), and every gesture resumes a suspended context.
const unlock = () => engine.unlock();
document.addEventListener('pointerdown', unlock, true);
document.addEventListener('keydown', unlock, true);

// Seek & volume
const seek = $('p-seek');
seek.addEventListener('input', () => { scrubbing = true; $('p-pos').textContent = fmtTime((seek.value / 1000) * engine.duration); seek.style.setProperty('--fill', `${seek.value / 10}%`); });
seek.addEventListener('change', () => { engine.seek((seek.value / 1000) * engine.duration); scrubbing = false; updatePositionState(); });
$('p-vol').addEventListener('input', (e) => { engine.setVolume(e.target.value / 100); engine.setMuted(false); e.target.style.setProperty('--fill', `${e.target.value}%`); $('p-mute').innerHTML = icon(engine.volume === 0 ? 'mute' : 'volume'); });

// ---------- actions ----------
function trackFrom(el) {
  const host = el.closest('[data-list]');
  if (!host) return null;
  const L = lists.get(host.dataset.list);
  const i = Number(host.dataset.idx);
  return L ? { list: L, i, track: L.tracks[i] } : null;
}
// Start getting a song ready the moment a finger presses its row (not while scrolling past it).
{
  let press = null;
  const go = () => { if (!press) return; const f = trackFrom(press.row); press = null; if (f?.track) queue.warm(f.track); };
  document.addEventListener('pointerdown', (e) => {
    const row = e.target.closest('.row[data-list]'); if (!row || e.target.closest('.r-more, .r-add-playlist')) return;
    clearTimeout(press?.timer); press = { row, x: e.clientX, y: e.clientY, timer: setTimeout(go, 110) };
  }, { passive: true });
  document.addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.timer); press = null; } }, { passive: true });
  document.addEventListener('pointerup', () => { if (press) { clearTimeout(press.timer); go(); } }, { passive: true });
  document.addEventListener('pointercancel', () => { clearTimeout(press?.timer); press = null; }, { passive: true });
}
app.actions.shareCollection = (title, tracks, art) => shareCard({ kind: 'playlist', title, subtitle: `${tracks.length} songs`, art: art || null, tiles: art ? null : tracks.map((t) => t.albumArtwork || t.artwork || t.artworkSmall).filter(Boolean) }).then((r) => r === 'saved' && toast('Card image saved')).catch((e) => toast(e.message, { error: true }));
app.actions.saveCollectionOffline = async (tracks, btn) => {
  const ok = tracks.filter(eligible);
  if (!ok.length) { toast('None of these songs can be saved offline: only your own files and download-permitted Jamendo tracks can.', { ms: 5000 }); return; }
  if (btn) btn.disabled = true;
  const r = await saveManyOffline(tracks, (i, n) => { if (btn) btn.textContent = `Saving ${i}/${n}…`; });
  if (btn) { btn.disabled = false; btn.textContent = 'Save offline'; }
  toast(`${r.saved} saved${r.already ? `, ${r.already} already saved` : ''}${r.failed ? `, ${r.failed} failed` : ''}${r.skipped ? `. ${r.skipped} can’t be saved (previews, YouTube or download-restricted)` : ''}.`, { ms: 6000 });
};
app.actions.saveAsPlaylist = async (name, tracks) => {
  const v = await formDialog('Save as playlist', [{ name: 'name', label: 'Name', value: name, required: true }], 'Save playlist');
  if (!v) return;
  const r = await api('/me/playlists', { method: 'POST', body: { name: v.name, tracks } });
  await refreshPlaylists();
  toast(`Saved “${r.playlist.name}”`, { action: { label: 'Open', fn: () => { location.hash = `#/playlist/${r.playlist.id}`; } } });
};
app.actions.addToPlaylistMenu = async (anchor, tracks) => {
  const add = async (pl) => {
    try {
      const detail = await api(`/playlists/${pl.id}`);
      const existing = new Set((detail.playlist.tracks || []).map((t) => t.id));
      const fresh = tracks.filter((t) => !existing.has(t.id));
      if (!fresh.length) { toast(tracks.length === 1 ? 'Already in this playlist' : 'Those songs are already in this playlist'); return; }
      const r = await api(`/me/playlists/${pl.id}/tracks`, { method: 'POST', body: { tracks: fresh } });
      await refreshPlaylists();
      toast(`Added ${r.added === 1 ? 'song' : `${r.added} songs`} to ${pl.name}`);
      if (app.currentPlaylist?.get().id === pl.id) app.currentPlaylist.set(r.playlist);
    } catch (e) { toast(e.message || 'Could not add songs to that playlist', { error: true }); }
  };
  // A real dialog is more reliable than a tiny anchored menu, especially on touch screens.
  const d = $('dialog');
  try { await refreshPlaylists(); } catch (e) { toast(`Could not load playlists: ${e.message}`, { error: true }); return; }
  const playlists = Array.isArray(store.lib.playlists) ? store.lib.playlists : [];
  d.innerHTML = `<div class="playlist-chooser"><div class="playlist-chooser-head"><div><span class="eyebrow">YOUR LIBRARY</span><h2>Add to playlist</h2><p>${tracks.length === 1 ? esc(tracks[0].title) : `${tracks.length} songs selected`}</p></div><button type="button" class="icon-btn" data-pl-close aria-label="Close">${icon('close')}</button></div><div class="playlist-chooser-list">${playlists.map((pl) => `<button type="button" class="playlist-choice" data-pl-id="${esc(pl.id)}"><span class="playlist-choice-art">${icon('list')}</span><span class="playlist-choice-copy"><b>${esc(pl.name)}</b><small>${(pl.trackCount ?? pl.tracks?.length ?? 0)} songs</small></span><span class="playlist-choice-arrow">›</span></button>`).join('')}${playlists.length ? '' : '<p class="note">You haven’t created a playlist yet. Make one below.</p>'}</div><div class="playlist-chooser-foot"><button type="button" class="btn ghost" data-pl-close>Cancel</button><button type="button" class="btn primary" data-pl-new>${icon('plus')} New playlist</button></div></div>`;
  d.querySelectorAll('[data-pl-close]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); d.close(); }));
  d.querySelectorAll('[data-pl-id]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation(); b.disabled = true; b.classList.add('busy');
    const pl = playlists.find((x) => String(x.id) === b.dataset.plId);
    if (!pl) return;
    d.close(); await add(pl);
  }));
  d.querySelector('[data-pl-new]').addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const closed = new Promise((resolve) => d.addEventListener('close', resolve, { once: true }));
    d.close();
    await closed;
    const v = await formDialog('New playlist', [{ name: 'name', label: 'Playlist name', required: true, value: tracks.length === 1 ? tracks[0].title : '' }], 'Create playlist');
    if (!v) return;
    try {
      const r = await api('/me/playlists', { method: 'POST', body: { name: v.name, tracks } });
      await refreshPlaylists(); toast(`Created “${r.playlist.name}”`, { action: { label: 'Open', fn: () => { location.hash = `#/playlist/${r.playlist.id}`; } } });
    } catch (e) { toast(e.message, { error: true }); }
  });
  d.showModal();
};
async function feedback(type, payload, msg) { try { await api('/me/feedback', { method: 'POST', body: { type, ...payload } }); toast(msg); } catch (e) { toast(e.message, { error: true }); } }
function trackMenu(anchor, info, extra = {}) {
  const t = info.track, L = info.list || {};
  const items = [
    { label: 'Play next', fn: () => { queue.playNext(t); toast('Will play next'); } },
    { label: 'Add to queue', fn: () => { queue.add(t); toast('Added to queue'); } },
    { label: 'Add to playlist…', fn: () => app.actions.addToPlaylistMenu(anchor, [t]) },
    { label: isLiked(t.id) ? 'Remove from Liked Songs' : 'Add to Liked Songs', fn: () => toggleLike(t).catch((e) => toast(e.message, { error: true })) },
    { sep: true },
    t.provider !== 'test' ? { label: 'Start song radio', fn: () => { sessionStorage.setItem('vesper.seed', JSON.stringify(t)); sessionStorage.setItem('vesper.seedMode', 'same'); location.hash = '#/discover'; if (location.hash === '#/discover') route(); } } : null,
    t.artistId?.startsWith('dz:') ? { label: 'Artist radio', href: `#/radio/${encodeURIComponent(t.artistId)}` } : null,
    t.artistId && /^(dz|jma):/.test(t.artistId) ? { label: 'Go to artist', href: `#/artist/${encodeURIComponent(t.artistId)}` } : (t.artist && !['local', 'test'].includes(t.provider) ? { label: 'Go to artist', href: `#/artist-name/${encodeURIComponent(t.artist)}` } : null),
    t.albumId && /^(dz|jmc|itc):/.test(t.albumId) ? { label: 'Go to album', href: `#/album/${encodeURIComponent(t.albumId)}` } : null,
    t.provider !== 'test' && t.provider !== 'local' ? { sep: true } : null,
    t.provider !== 'test' && t.provider !== 'local' ? { label: 'More like this', fn: () => feedback('more', { track: t }, 'Got it — more like this') } : null,
    t.provider !== 'test' && t.provider !== 'local' ? { label: 'Less like this', fn: () => { feedback('less', { track: t }, 'Got it — less like this'); } } : null,
    t.artist && t.provider !== 'test' ? { label: `Don’t recommend ${t.artist}`, fn: () => feedback('avoid-artist', { artist: t.artist }, `Won’t recommend ${t.artist}`) } : null,
  ];
  if (L.queue) items.push({ sep: true }, { label: 'Remove from queue', fn: () => queue.remove(queue.items[info.i]?.key) });
  if (L.playlistId) {
    const orig = L.indexMap ? L.indexMap[info.i] : info.i;
    const pl = app.currentPlaylist?.get();
    const reorder = async (order) => { const r = await api(`/me/playlists/${L.playlistId}`, { method: 'PATCH', body: { order } }); app.currentPlaylist?.set(r.playlist); refreshPlaylists(); };
    const idx = pl ? pl.tracks.map((_, i) => i) : [];
    items.push({ sep: true });
    if (pl && orig > 0) items.push({ label: 'Move up', fn: () => { [idx[orig - 1], idx[orig]] = [idx[orig], idx[orig - 1]]; reorder(idx); } });
    if (pl && orig < pl.tracks.length - 1) items.push({ label: 'Move down', fn: () => { [idx[orig + 1], idx[orig]] = [idx[orig], idx[orig + 1]]; reorder(idx); } });
    items.push({ label: 'Remove from this playlist', fn: () => { reorder(idx.filter((i) => i !== orig)).then(() => toast('Removed from playlist')); } });
  }
  items.push({ sep: true }, { label: 'Share card…', fn: () => shareCard({ kind: 'song', title: t.title, subtitle: [t.artist, t.album].filter(Boolean).join(' · '), art: t.albumArtwork || t.artwork || t.artworkSmall }).then((r) => r === 'saved' && toast('Card image saved')).catch((e) => toast(e.message, { error: true })) });
  if (eligible(t)) items.push(isSaved(t.id) ? { label: 'Remove offline copy', fn: () => removeOffline(t.id).then(() => { toast('Removed from this device'); route(); }) } : { label: 'Save for offline', fn: () => { toast(`Saving “${t.title}”…`); saveOffline(t).then(() => toast('Saved for offline listening')).catch((e) => toast(e.message, { error: true })); } });
  else items.push({ note: whyNot(t) });
  if (t.link) items.push({ sep: true }, { label: `Open on ${providerName(t.provider)}`, fn: () => window.open(t.link, '_blank', 'noopener') });
  if (t.playable === false) items.unshift({ note: t.unplayableReason || 'This song can’t be played from this source.' });
  menu(anchor, items);
}
function speedMenu(anchor) {
  menu(anchor, [{ head: 'Playback speed' }, ...[0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].map((v) => ({ label: `${v}×`, checked: engine.settings.speed === v, fn: () => saveSettings({ speed: v }).then(renderPlayer) })), { note: 'Pitch is preserved.' }]);
}
function transitionMenu(anchor) {
  const caps = engine.capabilities;
  menu(anchor, [{ head: 'Transition' }, ...Object.entries(PRESETS).map(([k, v]) => ({ label: v.label, checked: engine.settings.transition === k, disabled: !caps.graph && !['off', 'seamless'].includes(k), fn: () => saveSettings({ transition: k }).then(renderPlayer) })), { note: caps.graph ? PRESETS[engine.settings.transition]?.desc : caps.reason }, { label: 'Transition settings…', href: '#/settings' }]);
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  try {
    switch (act) {
      case 'play-row': { e.preventDefault(); const info = trackFrom(b); if (!info) return; if (info.list.queue) { queue.jump(queue.items[info.i]?.key); return; }
        // A song selected from Search starts its own radio/mix, not the next search result.
        if (/^Search:/i.test(info.list.name || '')) queue.playOne(info.track, { name: `Mix for ${info.track.title}` });
        else queue.playList(info.list.tracks, info.i, { name: info.list.name, href: info.list.href });
        break; }
      case 'add-playlist-row': { e.preventDefault(); e.stopPropagation(); const info = trackFrom(b); if (info?.track) await app.actions.addToPlaylistMenu(b, [info.track]); else toast('Could not identify this song. Refresh Vesper and try again.', { error: true }); break; }
      case 'like': { const info = trackFrom(b); if (!info) return; const on = await toggleLike(info.track); b.innerHTML = icon(on ? 'heartFill' : 'heart'); b.classList.toggle('liked', on); b.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} Liked Songs`); toast(on ? 'Added to Liked Songs' : 'Removed from Liked Songs'); renderPlayer(); break; }
      case 'like-current': { const t = engine.state.track; if (!t) return; const on = await toggleLike(t); toast(on ? 'Added to Liked Songs' : 'Removed from Liked Songs'); renderPlayer(); break; }
      case 'track-menu': { e.preventDefault(); e.stopPropagation(); const info = trackFrom(b); if (info?.track) trackMenu(b, info); else toast('Could not open song options. Refresh Vesper and try again.', { error: true }); break; }
      case 'np-track-menu': { e.preventDefault(); e.stopPropagation(); const t = engine.state.track; if (t) trackMenu(b, { track: t, list: {} }); else toast('Play a song first to see options.'); break; }
      case 'play-album': { e.preventDefault(); const d = await api(`/album/${encodeURIComponent(b.dataset.id)}`); if (d.redirect) { const r = await api(`/album/${encodeURIComponent(d.redirect)}`); queue.playList(r.tracks, 0, { name: r.album.title }); } else queue.playList(d.tracks, 0, { name: d.album.title, href: `#/album/${encodeURIComponent(d.album.id)}` }); break; }
      case 'toggle': if (!engine.state.track && queue.current) engine.load(queue.current); else engine.toggle(); break;
      case 'next': queue.next(); break;
      case 'prev': queue.prev(); break;
      case 'shuffle': queue.toggleShuffle(); toast(queue.shuffle ? 'Shuffle on' : 'Shuffle off'); break;
      case 'repeat': queue.cycleRepeat(); toast({ off: 'Repeat off', all: 'Repeating all', one: 'Repeating this song' }[queue.repeat]); break;
      case 'mute': engine.setMuted(!engine.muted); renderPlayer(); break;
      case 'speed-menu': speedMenu(b); break;
      case 'transition-menu': transitionMenu(b); break;
      case 'ambient-menu': np.modeMenu(b); break;
      case 'output-menu': e.preventDefault(); await openOutputMenu(b, engine); break;
      case 'retry-current': if (engine.state.track) engine.load(engine.state.track); break;
      case 'ambience-open': e.preventDefault(); openAmbience(engine, queue); break;
      case 'panel-tab': if (panel.visible && panel.tab === b.dataset.tab && b.closest('.player')) panel.hide(); else panel.show(b.dataset.tab); break;
      case 'panel-close': panel.hide(); break;
      case 'np-open': np.show(); break;
      case 'p-meta': if (matchMedia('(max-width: 760px)').matches && !e.target.closest('#p-artist')) { e.preventDefault(); np.show(); } break;
      case 'audio-panel': openAudioPanel(engine); break;
      case 'audio-device': e.preventDefault(); e.stopPropagation(); await chooseOutputDevice(); break;
      case 'np-close': np.hide(); break;
      case 'np-mode': np.modeMenu(b); break;
      case 'np-lyrics-toggle': await saveSettings({ artworkMode: store.settings.artworkMode === 'lyrics' ? 'ambient' : 'lyrics' }); np.render(); np.loop(); break;
      case 'np-queue': np.hide(); panel.show('queue'); break;
      case 'add-current-to-playlist': e.preventDefault(); e.stopPropagation(); if (engine.state.track) await app.actions.addToPlaylistMenu(b, [engine.state.track]); else toast('Play a song first to add it to a playlist.'); break;
      case 'feedback-more-current': if (engine.state.track) feedback('more', { track: engine.state.track }, 'Smart Mix will look for more like this'); break;
      case 'feedback-less-current': if (engine.state.track) feedback('less', { track: engine.state.track }, 'Smart Mix will avoid this sound more often'); break;
      case 'new-playlist': { const v = await formDialog('New playlist', [{ name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description', type: 'textarea' }], 'Create'); if (!v) return; const r = await api('/me/playlists', { method: 'POST', body: v }); await refreshPlaylists(); location.hash = `#/playlist/${r.playlist.id}`; break; }
      case 'more-nav': menu(b, [['charts', 'Charts'], ['radio-directory', 'Radio'], ['following', 'Following'], ['albums', 'Albums'], ['playlists', 'Playlists'], ['stats', 'Listening stats'], ['replay', 'Vesper Replay'], ['settings', 'Settings']].map(([k, l]) => ({ label: l, href: `#/${k}` }))); break;
    }
  } catch (err) { toast(err.message, { error: true }); }
});

// Tap a song row to play it on touch screens; double-click on desktop.
function rowPlay(e) {
  const row = e.target.closest('.row[data-list]');
  if (!row || e.target.closest('button, a, input, select')) return;
  if (row.classList.contains('unplayable')) { const info = trackFrom(row); toast(info?.track.unplayableReason || 'This song can’t be played.', { error: true }); return; }
  row.querySelector('[data-act="play-row"]')?.click();
}
document.addEventListener('click', (e) => { if (matchMedia('(pointer: coarse), (max-width: 760px)').matches) rowPlay(e); });
document.addEventListener('dblclick', (e) => { if (!matchMedia('(pointer: coarse)').matches) rowPlay(e); });

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === ' ' && !e.target.closest('button, a')) { e.preventDefault(); engine.toggle(); }
  else if (k === 'ArrowRight' && e.shiftKey) queue.next();
  else if (k === 'ArrowLeft' && e.shiftKey) queue.prev();
  else if (k === 'ArrowRight' && !e.target.closest('[role="slider"], input')) engine.seek(engine.position + 5);
  else if (k === 'ArrowLeft' && !e.target.closest('[role="slider"], input')) engine.seek(engine.position - 5);
  else if (k === '/') { e.preventDefault(); location.hash = '#/search'; }
  else if (k === 'q' || k === 'Q') panel.show('queue');
  else if (k === 'l' || k === 'L') panel.show('lyrics');
  else if (k === 'm' || k === 'M') { engine.setMuted(!engine.muted); renderPlayer(); }
  else if (k === 'f' || k === 'F') np.open ? np.hide() : np.show();
});

// Side playlists
function renderSidePlaylists() {
  const el = $('side-playlists');
  const pls = store.lib.playlists;
  el.innerHTML = `<h3>Your playlists</h3>${pls.length ? pls.slice(0, 20).map((p) => `<a href="#/playlist/${p.id}">${esc(p.name)}</a>`).join('') : '<a href="#/playlists">Create a playlist</a>'}`;
}
on((what) => {
  if (what === 'library') renderSidePlaylists();
  if (what === 'settings') { applyAppearance(); renderPlayer(); np?.open && np.render(); }
  if (what === 'likes') renderPlayer();
});

// ---------- boot ----------
engine.addEventListener('capabilities', () => restoreOutput(engine));
engine.addEventListener('external-declined', () => toast('YouTube video not played. Choose Continue when asked to use YouTube’s player.'));
async function startApp() {
  $('auth').hidden = true; shell.hidden = false;
  applyAppearance();
  hydrateIcons(document);
  panel = new Panel({ queue, engine, lyrics, shell });
  np = new NowPlaying({ engine, queue, lyrics, actions: app.actions });
  if (localStorage.getItem('vesper.panel') === 'hidden') shell.classList.add('panel-hidden');
  panel.render();
  await loadLibrary().catch((e) => toast(e.message, { error: true }));
  // Server filters this down to uncached library tracks, avoiding repeat match requests.
  // Delay it slightly so app startup and the first user interaction remain responsive.
  setTimeout(async () => {
    try { const result = await api('/youtube/prewarm-candidates'); if (result.tracks?.length) queue.prewarmTracks(result.tracks); }
    catch { /* Background preparation never blocks app startup. */ }
  }, 4000);
  initDiscord(engine);
  initUpdates(engine);
  queue.restore();
  renderPlayer();
  window.addEventListener('hashchange', route);
  route();
}
startArtworkHydration();
(async function boot() {
  try {
    const u = await loadMe();
    if (u) return startApp();
  } catch (e) {
    document.body.innerHTML = `<div class="auth"><div class="auth-card"><h1>Vesper can’t reach its server</h1><p>${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">Try again</button></div></div>`;
    return;
  }
  const a = $('auth'); a.hidden = false;
  M.renderAuth(a, () => { emit('user'); startApp(); }, app);
})();
void V.fmtTime;
