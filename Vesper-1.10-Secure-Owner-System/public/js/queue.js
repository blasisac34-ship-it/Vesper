// Up Next. Items carry an origin: 'manual' (Play next / Add to queue), 'context' (album, playlist,
// chart...) or 'auto' (Autoplay continuation). Manual items always play before context items.
import { api, store, on } from './store.js';

let keySeq = 0;
const MATCH_V = 5; // must match server/server.mjs MATCH_V
const entry = (track, origin) => ({ key: `q${Date.now().toString(36)}${++keySeq}`, track, origin });

export class Queue extends EventTarget {
  constructor(engine) {
    super();
    this.e = engine;
    this.history = []; this.current = null; this.items = [];
    this.context = null; // { name, href, tracks }
    this.shuffle = false; this.repeat = 'off'; this.autoMode = 'same';
    this.autoBusy = false; this.autoNote = null;
    this.resolveCache = new Map(); this.resolveToken = 0;
    // Background matching is deliberately serialized and slow to avoid looking like a bot.
    this.prewarmQueue = []; this.prewarmPending = new Set(); this.prewarmDone = new Set();
    this.prewarmActive = false; this.prewarmPauseUntil = 0; this.prewarmTimer = null;
    this.prewarmMax = 3000; this.prewarmGapMs = 2200;
    engine.addEventListener('advanced', (ev) => this.onAdvanced(ev.detail.track));
    engine.addEventListener('ended', () => this.next({ auto: true }));
    engine.addEventListener('error', (ev) => this.onError(ev.detail));
    engine.addEventListener('next-failed', (ev) => { this.items = this.items.filter((i) => i.track.id !== ev.detail.track.id); this.changed(); this.emit('skipped-unplayable', ev.detail); });
  }
  get autoplay() { return store.settings.autoplay !== false; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  changed() { this.syncNext(); this.persist(); this.emit('change'); }

  upcoming() {
    if (this.items.length) return this.items[0].track;
    if (this.repeat === 'all' && this.context?.tracks.length) return this.context.tracks[0];
    return null;
  }
  needsFullTrack(track) {
    if (!track || track.noFullMatch) return false;
    // Songs matched by an older version of Vesper are checked again with the strict official matcher.
    if (track.youtubeMatched && track.matchV !== MATCH_V) return true;
    return track.preview === true || ['deezer', 'itunes', 'dz', 'it'].includes(track.provider) || /^(dz|it):/.test(track.id || '');
  }
  resolveTrack(track, { background = false } = {}) {
    if (!this.needsFullTrack(track)) return Promise.resolve(track);
    if (this.resolveCache.has(track.id)) return this.resolveCache.get(track.id);
    // Use the catalog length (not a matched video's length) so altered versions can be spotted.
    const catalogDuration = track.sourceDuration || (track.youtubeMatched ? '' : track.duration) || '';
    const q = new URLSearchParams({ title: track.title || '', artist: track.artist || '', duration: catalogDuration, ...(background ? { bg: '1' } : {}) });
    // A stalled provider lookup must never leave the player in Loading forever.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35_000);
    const task = api(`/youtube/match?${q}`, { signal: controller.signal }).then(({ track: yt }) => ({
      ...track, id: yt.id, sourceId: track.sourceId || track.id, sourceDuration: catalogDuration || undefined, matchV: MATCH_V, official: true, provider: 'youtube', videoId: yt.videoId, link: yt.url || yt.link,
      preview: false, fullTrack: true, playable: true, playableDuration: undefined,
      duration: yt.duration || track.duration, albumArtwork: track.albumArtwork || track.artwork || track.artworkSmall || null, artwork: track.artwork || yt.thumbnail || yt.artwork,
      artworkSmall: track.artworkSmall || yt.thumbnail || yt.artwork,
      youtubeMatched: true,
    })).catch((e) => {
      // No official full version: play the official 30-second clip rather than a possibly fake upload.
      if ((e.code === 'no_official' || e.status === 404) && store.settings.noFullFallback === 'clip') {
        const back = track.youtubeMatched && track.sourceId ? { ...track, id: track.sourceId, provider: /^it:/.test(track.sourceId) ? 'itunes' : 'deezer', preview: true, playableDuration: 30, duration: track.sourceDuration || null, youtubeMatched: false, videoId: undefined } : track;
        if (!back.preview && back.provider === 'youtube') { this.resolveCache.delete(track.id); throw e; }
        return { ...back, noFullMatch: true, matchNote: 'No official full version found, so this is the official 30-second clip.' };
      }
      this.resolveCache.delete(track.id);
      if (e.name === 'AbortError') throw new Error('Finding a full-length version took too long. Try this song again.');
      if (e.code === 'no_official') { const x = new Error(`No full version of “${track.title}” is on YouTube, so it was skipped.`); x.code = 'no_official'; throw x; }
      throw e;
    }).finally(() => {
      clearTimeout(timeout);
      if (this.resolveCache.size > 300) this.resolveCache.delete(this.resolveCache.keys().next().value);
    });
    this.resolveCache.set(track.id, task);
    return task;
  }
  replaceTrack(oldTrack, newTrack) {
    if (!oldTrack || !newTrack) return;
    if (this.current?.id === oldTrack.id) this.current = newTrack;
    this.items = this.items.map((it) => it.track.id === oldTrack.id ? { ...it, track: newTrack } : it);
    if (this.context?.tracks) this.context.tracks = this.context.tracks.map((t) => t.id === oldTrack.id ? newTrack : t);
  }
  // Stable per-recording key prevents duplicate background work when the same song appears
  // in Search, Liked Songs, a playlist and a Home mix.
  prewarmKey(track) {
    const clean = (v) => String(v || '').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    return `${clean(track?.title)}|${clean(track?.artist)}`;
  }
  // Queue tracks for quiet, low-rate matching. Every match uses bg=1, shares the existing
  // in-flight/cache path, and asks the server to cache the stream URL without downloading audio.
  prewarmTracks(tracks, { priority = false } = {}) {
    const added = [];
    for (const track of tracks || []) {
      const alreadyMatched = !!(track?.youtubeMatched && Number(track.matchV) === MATCH_V && (track.provider === 'youtube' || /^yt:/.test(track.id || '')));
      if (!track || track.playable === false || (!alreadyMatched && !this.needsFullTrack(track))) continue;
      const key = this.prewarmKey(track);
      if (!key || key === '|' || this.prewarmPending.has(key) || this.prewarmDone.has(key)) continue;
      if (this.prewarmQueue.length >= this.prewarmMax) break;
      const item = { key, track, alreadyMatched, rowId: track.prewarmSourceId || track.id };
      this.prewarmPending.add(key); added.push(item);
      this.emit('prewarm-state', { track: { id: item.rowId, title: track.title, artist: track.artist }, status: 'queued' });
    }
    if (priority) this.prewarmQueue.unshift(...added); else this.prewarmQueue.push(...added);
    this.runPrewarmQueue();
    return added.length;
  }
  async runPrewarmQueue() {
    if (this.prewarmActive || !this.prewarmQueue.length) return;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    if (this.prewarmPauseUntil > Date.now()) {
      clearTimeout(this.prewarmTimer);
      this.prewarmTimer = setTimeout(() => this.runPrewarmQueue(), this.prewarmPauseUntil - Date.now() + 1000);
      return;
    }
    this.prewarmActive = true;
    try {
      while (this.prewarmQueue.length) {
        if (this.prewarmPauseUntil > Date.now()) break;
        const item = this.prewarmQueue.shift();
        this.emit('prewarm-state', { track: { id: item.rowId, title: item.track.title, artist: item.track.artist }, status: 'preparing' });
        try {
          const resolved = item.alreadyMatched ? item.track : await this.resolveTrack(item.track, { background: true });
          if (resolved.noFullMatch) {
            this.prewarmDone.add(item.key);
            this.emit('prewarm-state', { track: { id: item.rowId, title: item.track.title, artist: item.track.artist }, status: 'unavailable', fallback: true });
          } else if (resolved.provider === 'youtube' || /^yt:/.test(resolved.id || '')) {
            const info = await this.e.prefetch(resolved);
            if (info?.error) { const err = new Error(info.error); err.code = info.code; throw err; }
            this.prewarmDone.add(item.key);
            this.emit('prewarm-state', { track: { id: item.rowId, title: item.track.title, artist: item.track.artist }, status: 'ready' });
          } else {
            this.prewarmDone.add(item.key);
            this.emit('prewarm-state', { track: { id: item.rowId, title: item.track.title, artist: item.track.artist }, status: 'unavailable', fallback: true });
          }
        } catch (err) {
          if (['yt_signin', 'yt_cookies', 'ytdlp_missing'].includes(err.code)) {
            this.prewarmQueue.unshift(item);
            this.prewarmPauseUntil = Date.now() + (err.code === 'yt_signin' ? 10 * 60_000 : 60_000);
            this.emit('prewarm-state', { track: { id: item.rowId, title: item.track.title, artist: item.track.artist }, status: 'paused' });
            clearTimeout(this.prewarmTimer);
            this.prewarmTimer = setTimeout(() => this.runPrewarmQueue(), this.prewarmPauseUntil - Date.now() + 1000);
            break;
          }
          if (err.code === 'no_official') {
            this.prewarmDone.add(item.key);
            this.emit('prewarm-state', { track: { id: item.rowId, title: item.track.title, artist: item.track.artist }, status: 'unavailable' });
          } else {
            this.emit('prewarm-state', { track: { id: item.rowId, title: item.track.title, artist: item.track.artist }, status: 'failed' });
          }
        } finally {
          // Keep paused work marked pending; all other work can be re-enqueued after transient errors.
          if (!(this.prewarmPauseUntil > Date.now() && this.prewarmQueue[0] === item)) this.prewarmPending.delete(item.key);
        }
        if (this.prewarmPauseUntil <= Date.now() && this.prewarmQueue.length) await wait(this.prewarmGapMs);
      }
    } finally {
      this.prewarmActive = false;
      if (this.prewarmQueue.length && this.prewarmPauseUntil <= Date.now()) this.runPrewarmQueue();
    }
  }
  warm(track) { this.prewarmTracks([track], { priority: true }); }
  syncNext() {
    this.e.repeatOne = this.repeat === 'one';
    if (this.repeat === 'one') { this.e.prepareNext(null); return; }
    const next = this.upcoming();
    if (!next) { this.e.prepareNext(null); return; }
    if (!this.needsFullTrack(next)) { this.e.prepareNext(next); return; }
    // Never let a preview reach the audio engine. Resolve the next song in the background
    // while the current track plays, then warm its stream before the transition point.
    this.e.prepareNext(null);
    this.resolveTrack(next, { background: true }).then((resolved) => {
      if (!this.items.some((it) => it.track.id === next.id) && this.upcoming()?.id !== next.id) return;
      this.replaceTrack(next, resolved);
      this.changed();
    }).catch((e) => {
      if (e.code === 'yt_signin' || e.code === 'yt_cookies' || e.code === 'offline' || e.status === 0) return; // try again when it's actually its turn
      this.items = this.items.filter((it) => it.track.id !== next.id);
      this.emit('play-error', { track: next, message: e.message || 'No full version found. Skipped.' });
      this.changed();
    });
  }

  // Start playing a list from index i.
  playList(tracks, i = 0, ctx = {}) {
    const list = tracks.filter((t) => t.playable !== false && (store.settings.explicit !== false || !t.explicit));
    const first = tracks[i]?.playable !== false ? tracks[i] : list[0];
    if (!first) return false;
    this.context = { name: ctx.name || null, href: ctx.href || null, tracks: list.slice(0, 1000) };
    let rest = list.slice(list.indexOf(first) + 1);
    if (this.shuffle) rest = shuffle(rest);
    if (this.repeat === 'all' && !this.shuffle) rest = rest.concat(list.slice(0, list.indexOf(first)));
    this.items = [...this.items.filter((x) => x.origin === 'manual'), ...rest.map((t) => entry(t, 'context'))];
    this.setCurrent(first, 'user');
    return true;
  }
  playOne(track, ctx = {}) { return this.playList([track], 0, ctx); }
  setCurrent(track, reason = 'user', opts = {}) {
    if (!opts.skipHistory && this.current) { this.history.push(this.current); if (this.history.length > 60) this.history.shift(); }
    const token = ++this.resolveToken;
    const canTransition = reason === 'user' && opts.play !== false && this.e.state.status === 'playing' && this.e.state.track?.id !== track.id && !opts.disableTransition;
    this.current = track;
    if (this.needsFullTrack(track)) {
      this.e.set({ status: 'loading', track, position: opts.at || 0, duration: track.duration || 0, error: null, transition: null });
      this.changed();
      this.resolveTrack(track).then((resolved) => {
        if (token !== this.resolveToken) return;
        this.replaceTrack(track, resolved);
        this.current = resolved;
        if (resolved.noFullMatch && reason === 'user') this.emit('notice', { message: resolved.matchNote });
        if (canTransition) this.e.playWithTransition(resolved, { reason, at: opts.at || 0, force: true });
        else this.e.load(resolved, { reason, play: opts.play !== false, at: opts.at || 0 });
        this.changed();
        this.ensureAuto();
      }).catch((e) => {
        if (token !== this.resolveToken) return;
        if (e.code === 'yt_signin' || e.code === 'yt_cookies' || e.code === 'ytdlp_missing') {
          this.e.set({ status: 'error', track, error: e.message });
          this.emit('youtube-blocked', { message: e.message }); this.changed(); return;
        }
        this.items = this.items.filter((it) => it.track.id !== track.id);
        this.current = null;
        this.e.set({ status: 'error', track, error: `Full version unavailable: ${e.message}` });
        this.emit('play-error', { track, message: `Could not find a playable full-length version; skipped this song. ${e.message}` });
        this.changed();
        if (this.items.length || this.autoplay) this.next({ auto: true });
      });
      return;
    }
    if (canTransition) this.e.playWithTransition(track, { reason, at: opts.at || 0 });
    else this.e.load(track, { reason, play: opts.play !== false, at: opts.at || 0 });
    this.changed();
    this.ensureAuto();
  }

  playNext(tracks) { this.items.splice(0, 0, ...[].concat(tracks).map((t) => entry(t, 'manual'))); this.changed(); }
  add(tracks) { const n = this.items.findIndex((x) => x.origin !== 'manual'); const at = n < 0 ? this.items.length : n; this.items.splice(at, 0, ...[].concat(tracks).map((t) => entry(t, 'manual'))); this.changed(); }
  remove(key) { this.items = this.items.filter((x) => x.key !== key); this.changed(); }
  move(from, to) { if (from === to || from < 0 || from >= this.items.length) return; const [it] = this.items.splice(from, 1); this.items.splice(Math.max(0, Math.min(to, this.items.length)), 0, it); if (it.origin === 'auto') it.origin = 'manual'; this.changed(); }
  clear() { this.items = []; this.changed(); }
  jump(key) { const i = this.items.findIndex((x) => x.key === key); if (i < 0) return; const [it] = this.items.splice(i, 1); this.items.splice(0, i); this.setCurrent(it.track, 'user'); }

  async next({ auto = false } = {}) {
    if (!this.items.length && this.repeat === 'all' && this.context?.tracks.length) this.items = (this.shuffle ? shuffle(this.context.tracks) : this.context.tracks).map((t) => entry(t, 'context'));
    if (!this.items.length && this.autoplay) await this.ensureAuto(true);
    const it = this.items.shift();
    if (!it) { if (auto) { this.e.stop(); this.emit('end-of-queue'); } this.changed(); return; }
    this.setCurrent(it.track, auto ? 'auto' : 'user');
  }
  prev() {
    if (this.e.position > 3 || !this.history.length) { this.e.seek(0); return; }
    if (this.current) this.items.unshift(entry(this.current, 'manual'));
    const previous = this.history.pop();
    this.setCurrent(previous, 'user', { skipHistory: true });
  }
  // Engine finished a planned transition into items[0].
  onAdvanced(track) {
    if (this.current) { this.history.push(this.current); if (this.history.length > 60) this.history.shift(); }
    if (this.items[0]?.track.id === track.id) this.items.shift();
    else if (this.repeat === 'all' && this.context?.tracks[0]?.id === track.id) this.items = (this.shuffle ? shuffle(this.context.tracks) : this.context.tracks).slice(1).map((t) => entry(t, 'context'));
    this.current = track;
    this.changed();
    this.ensureAuto();
  }
  onError({ track, message, consecutive, code }) {
    if (code === 'yt_signin' || code === 'yt_cookies' || code === 'ytdlp_missing') { this.emit('youtube-blocked', { message }); return; }
    this.emit('play-error', { track, message });
    if (consecutive >= 3) { this.emit('stopped-after-errors'); return; }
    if (track?.id === this.current?.id) setTimeout(() => { if (this.e.state.status === 'error') this.next({ auto: true }); }, 1400);
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    const manual = this.items.filter((x) => x.origin === 'manual');
    const ctx = this.items.filter((x) => x.origin === 'context');
    const auto = this.items.filter((x) => x.origin === 'auto');
    let ordered = ctx;
    if (this.shuffle) ordered = shuffle(ctx);
    else if (this.context) { const pos = new Map(this.context.tracks.map((t, i) => [t.id, i])); const cur = pos.get(this.current?.id) ?? -1; ordered = ctx.slice().sort((a, b) => ((pos.get(a.track.id) ?? 1e9) - cur + 1e6) % 1e6 - ((pos.get(b.track.id) ?? 1e9) - cur + 1e6) % 1e6); }
    this.items = [...manual, ...ordered, ...auto];
    this.changed();
  }
  cycleRepeat() { this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat]; this.changed(); }

  // Smart continuation: keep the mood of what's been playing.
  async ensureAuto(force = false) {
    if (!this.autoplay || (this.repeat !== 'off' && !force)) return;
    if (this.autoBusy) { if (force) this.autoPending = true; return; }
    const nonAuto = this.items.filter((x) => x.origin !== 'auto').length;
    const autos = this.items.filter((x) => x.origin === 'auto').length;
    if (!force && (nonAuto + autos >= 3)) return;
    const pool = (this.context?.tracks || []).filter((t) => t && t.provider !== 'test' && t.id !== this.current?.id);
    const fromList = shuffle(pool).slice(0, 2); // when a playlist runs out, keep its feel, like Spotify
    const seeds = [this.current, ...fromList, ...this.history.slice(-4).reverse()].filter((t) => t && t.provider !== 'test').filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i).slice(0, 3);
    if (!seeds.length) { this.autoNote = 'Autoplay needs a real song to continue from.'; this.emit('change'); return; }
    this.autoBusy = true; this.autoPending = false; this.emit('change');
    const runToken = this.autoToken = (this.autoToken || 0) + 1, runMode = this.autoMode;
    try {
      const seenTracks = [...this.history, this.current, ...this.items.map((x) => x.track)].filter(Boolean);
      const exclude = [...new Set(seenTracks.map((t) => t.id))];
      const key = (t) => `${String(t.title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${String(t.artist || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      const seenKeys = new Set(seenTracks.map(key));
      const fetchRecs = (mode) => api('/recs', { method: 'POST', body: { sessionSkips: [...(this.sessionSkips || [])], sessionLikes: [...(this.sessionLikes || [])], seeds, mode, exclude, limit: 25 } });
      let r = await fetchRecs(runMode);
      if (runToken !== this.autoToken || runMode !== this.autoMode) return; // a newer direction was chosen
      let fresh = (r.tracks || []).filter((t) => !exclude.includes(t.id) && !seenKeys.has(key(t)) && t.playable !== false);
      // If the chosen vibe has no fresh tracks, broaden discovery once rather than letting playback stop.
      if (!fresh.length && runMode !== 'explore') {
        r = await fetchRecs('explore');
        if (runToken !== this.autoToken || runMode !== this.autoMode) return;
        fresh = (r.tracks || []).filter((t) => !exclude.includes(t.id) && !seenKeys.has(key(t)) && t.playable !== false);
      }
      // Defensively deduplicate recommendations against each other as well as the listening history.
      const unique = [];
      for (const t of fresh) { const k = key(t); if (seenKeys.has(k)) continue; seenKeys.add(k); unique.push(t); }
      this.items.push(...unique.map((t) => entry(t, 'auto')));
      this.autoNote = r.note || (unique.length ? null : 'No fresh recommendations found. Try another mix direction.');
    } catch (e) { if (runToken === this.autoToken) this.autoNote = `Autoplay unavailable: ${e.message}`; }
    finally {
      this.autoBusy = false; this.changed();
      if (this.autoPending) { this.autoPending = false; this.ensureAuto(true); }
    }
  }
  async regenerate(mode = this.autoMode) {
    this.autoMode = mode;
    this.autoToken = (this.autoToken || 0) + 1; // ignore any request still running for the old direction
    this.items = this.items.filter((x) => x.origin !== 'auto');
    this.autoNote = null;
    this.changed();
    if (this.autoBusy) { this.autoPending = true; return; }
    await this.ensureAuto(true);
  }

  persist() {
    if (!store.user) return;
    const slim = (t) => t && { ...t, reason: undefined };
    try {
      localStorage.setItem(`vesper.queue.${store.user.id}`, JSON.stringify({
        current: slim(this.current), position: this.e.position || 0, history: this.history.slice(-30).map(slim),
        items: this.items.slice(0, 300).map((x) => ({ ...x, track: slim(x.track) })), context: this.context && { ...this.context, tracks: this.context.tracks.slice(0, 400) },
        shuffle: this.shuffle, repeat: this.repeat, autoMode: this.autoMode,
      }));
    } catch { /* storage full or unavailable */ }
  }
  restore() {
    try {
      const s = JSON.parse(localStorage.getItem(`vesper.queue.${store.user.id}`) || 'null');
      if (!s) return;
      Object.assign(this, { history: s.history || [], items: s.items || [], context: s.context, shuffle: !!s.shuffle, repeat: s.repeat || 'off', autoMode: s.autoMode || 'same' });
      if (s.current) { this.current = null; this.setCurrent(s.current, 'restore', { play: false, at: s.position || 0, skipHistory: true }); }
      this.changed();
    } catch { /* ignore corrupt state */ }
  }
}
export function shuffle(a) { // random order, then spread artists so the same artist rarely plays back-to-back
  const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  const key = (x) => String((x?.track || x)?.artist || '').toLowerCase();
  for (let i = 1; i < b.length; i++) if (key(b[i]) && key(b[i]) === key(b[i - 1])) { const j = b.findIndex((x, k) => k > i && key(x) !== key(b[i - 1]) && key(x) !== key(b[i + 1])); if (j > 0) [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
// Smart shuffle: slip in a few liked songs you haven't heard lately (clearly labelled), and learn
// from this session's skips and likes to steer Autoplay right away.
Queue.prototype.smartInject = async function () {
  if (store.settings.smartShuffle === false || !this.shuffle || this.context?.name === 'Liked songs') return;
  const inQueue = new Set([this.current?.id, ...this.items.map((x) => x.track.id), ...(this.context?.tracks || []).map((t) => t.id)]);
  let recent = new Set();
  try { recent = new Set((await api('/me/recent')).events.slice(0, 100).map((e) => e.track.id)); } catch { /* fine without */ }
  const liked = shuffle([...store.lib.likes.values()].filter((t) => t.playable !== false && !inQueue.has(t.id) && !recent.has(t.id)));
  const ctxIdx = this.items.map((x, i) => (x.origin === 'context' ? i : -1)).filter((i) => i >= 0);
  const n = Math.min(5, Math.floor(ctxIdx.length / 6), liked.length);
  for (let k = n - 1; k >= 0; k--) { const at = ctxIdx[Math.min(ctxIdx.length - 1, (k + 1) * 6 - 1)] + 1; this.items.splice(at, 0, { ...entry({ ...liked[k], reason: 'Smart shuffle: a liked song you haven’t heard lately' }, 'context'), smart: true }); }
  if (n) this.changed();
};
Queue.prototype.initLearning = function () {
  this.sessionSkips = new Set(); this.sessionLikes = new Set();
  this.e.addEventListener('played', (ev) => {
    const { track, skipped } = ev.detail; if (!skipped || !track?.artist) return;
    const a = track.artist.toLowerCase(); this.sessionSkips.add(a); if (this.sessionSkips.size > 20) this.sessionSkips.delete(this.sessionSkips.values().next().value);
    const before = this.items.length;
    this.items = this.items.filter((x) => !(x.origin === 'auto' && String(x.track.artist).toLowerCase() === a)); // drop queued radio picks by an artist you just skipped
    if (this.items.length !== before) { this.changed(); if (this.items.filter((x) => x.origin === 'auto').length < 3) this.ensureAuto(true); }
  });
  on((what, id) => { if (what === 'likes' && store.lib.likes.has(id)) { const t = store.lib.likes.get(id); if (t?.artist) this.sessionLikes.add(t.artist.toLowerCase()); } });
  api('/youtube/config').then((c) => { this.ytConfigured = !!c.configured; }).catch(() => { this.ytConfigured = false; });
};
{ const ts = Queue.prototype.toggleShuffle; Queue.prototype.toggleShuffle = function () { ts.call(this); if (this.shuffle) this.smartInject(); else { const n = this.items.length; this.items = this.items.filter((x) => !x.smart); if (n !== this.items.length) this.changed(); } }; }
{ const pl = Queue.prototype.playList; Queue.prototype.playList = function (...args) { const r = pl.apply(this, args); if (this.shuffle) this.smartInject(); return r; }; }
