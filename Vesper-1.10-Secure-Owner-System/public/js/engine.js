// Vesper audio engine.
// Two <audio> "decks" routed through Web Audio (when enabled) so we can crossfade, filter,
// level loudness and visualise. Playback state always comes from the media elements' real events.
import { analyze, tempoCompatible, TempoTracker } from './analysis.js';
import { BANDS, effectiveGains, preampDb, bandTypes } from './eq.js';

export const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_MOBILE = IS_IOS || /Android/i.test(navigator.userAgent);

export const PRESETS = {
  smooth: { label: 'Smooth', desc: 'An even, equal-power crossfade. You choose the length.' },
  seamless: { label: 'Seamless', desc: 'No fade. Trims silence between songs for a near-gapless flow.' },
  dj: { label: 'DJ', desc: 'Blend length snapped to whole beats when tempo is known, with a bass swap on the outgoing song.' },
  cinematic: { label: 'Cinematic', desc: 'A long, slow blend; the outgoing song gets softer and darker as it fades.' },
  minimal: { label: 'Minimal', desc: 'A brief 1.5-second blend.' },
  off: { label: 'Off', desc: 'Each song plays to its very end, then the next one starts.' },
};
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

class Deck {
  constructor(engine, i) {
    this.e = engine; this.i = i;
    this.el = document.createElement('audio');
    this.el.preload = 'auto';
    this.el.setAttribute('playsinline', '');
    this.el.preservesPitch = true; this.el.webkitPreservesPitch = true;
    document.getElementById('decks').append(this.el);
    this.track = null; this.prep = null;
    for (const ev of ['play', 'pause', 'playing', 'waiting', 'stalled', 'ended', 'error', 'ratechange', 'durationchange', 'loadedmetadata', 'seeked']) this.el.addEventListener(ev, (e) => engine.onDeckEvent(this, e));
    this.el.addEventListener('timeupdate', () => engine.onTime(this));
  }
  connect(ctx, dest) {
    this.src = ctx.createMediaElementSource(this.el);
    this.tempoAnalyser = ctx.createAnalyser(); this.tempoAnalyser.fftSize = 2048; this.tempoAnalyser.smoothingTimeConstant = 0;
    this.src.connect(this.tempoAnalyser); // analysis-only tap; audio is not duplicated or sent anywhere
    this.tempoBytes = new Uint8Array(this.tempoAnalyser.frequencyBinCount);
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'allpass';
    this.norm = ctx.createGain();
    this.fade = ctx.createGain(); this.fade.gain.value = 0;
    this.src.connect(this.filter).connect(this.norm).connect(this.fade).connect(dest);
  }
  get active() { return this.e.active === this; }
  setFade(v, at = 0.02) {
    if (this.fade) { const t = this.e.ctx.currentTime; this.fade.gain.cancelScheduledValues(t); this.fade.gain.setValueAtTime(this.fade.gain.value, t); this.fade.gain.linearRampToValueAtTime(v, t + at); }
    else this.el.volume = v * this.e.outVolume();
  }
  resetFilter() { if (!this.filter) return; const t = this.e.ctx.currentTime; this.filter.frequency.cancelScheduledValues(t); this.filter.type = 'allpass'; this.filter.frequency.setValueAtTime(1000, t); }
}

export class Engine extends EventTarget {
  constructor() {
    super();
    this.settings = { transition: 'smooth', crossfade: 6, speed: 1, leveling: true, processing: 'auto' };
    this.eq = null;
    this.decks = [new Deck(this, 0), new Deck(this, 1)];
    this.active = this.decks[0];
    this.ctx = null; this.graph = false; this.unlocked = false;
    this.volume = Number(localStorage.getItem('vesper.volume') ?? 0.8); this.muted = false;
    this.state = { status: 'idle', track: null, position: 0, duration: 0, error: null, transition: null };
    this.next = null; this.plan = null; this.transition = null;
    this.prepCache = new Map();
    this.external = false; this.yt = null; this.extPos = 0; this.extDur = 0; this.loadToken = 0;
    this.session = null; this.failures = 0;
    this.tempoCache = this.readTempoCache();
    this.repeatOne = false;
    setInterval(() => this.tick(), 100);
  }

  // ---------- setup ----------
  wantsGraph() { const p = this.settings.processing; return p === 'on' || (p === 'auto' && !IS_IOS); }
  // Must be called from inside a user gesture (click/keydown) at least once.
  unlock() {
    if (this.unlocked) { this.ctx?.resume?.(); return; }
    this.unlocked = true;
    if (this.wantsGraph()) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'playback' });
        this.master = this.ctx.createGain();
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -1.5; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.2;
        this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512; this.analyser.smoothingTimeConstant = 0.82;
        // One processing chain on the master bus: decks → master → 10-band EQ → pre-gain → limiter → analyser.
        this.eqNodes = BANDS.map((f, i) => { const b = this.ctx.createBiquadFilter(); b.type = bandTypes(i); b.frequency.value = f; b.Q.value = 1.1; b.gain.value = 0; return b; });
        this.preamp = this.ctx.createGain();
        let node = this.master;
        for (const b of this.eqNodes) { node.connect(b); node = b; }
        node.connect(this.preamp).connect(this.limiter).connect(this.analyser).connect(this.ctx.destination);
        this.applyEQ();
        for (const d of this.decks) { d.connect(this.ctx, this.master); d.el.volume = 1; }
        this.active.fade.gain.value = 1;
        this.graph = true;
        this.applyVolume();
      } catch (e) { console.warn('Web Audio unavailable; using basic playback', e); this.graph = false; this.ctx = null; }
    }
    // Prime both elements inside the gesture so later programmatic play() calls are allowed (iOS).
    for (const d of this.decks) { if (!d.el.src) { d.el.src = SILENT_WAV; d.el.play().then(() => d.el.pause()).catch(() => {}); } }
    this.ctx?.resume?.();
    this.emit('capabilities');
  }
  // What applies to the CURRENT track (YouTube plays in its own player, outside Vesper's audio engine).
  get trackCaps() {
    if (this.external) return { graph: false, crossfade: false, visualizer: false, leveling: false, eq: false, speed: true, external: true, reason: 'This YouTube video plays in YouTube’s own player, so Vesper’s equalizer, crossfades, leveling and visualizer don’t apply to it.' };
    return this.capabilities;
  }
  // ---------- YouTube: official external player ----------
  setExternalPlayer(p) { this.yt = p; }
  async loadExternal(track, { play = true, at = 0, reason = 'user' } = {}) {
    const token = ++this.loadToken;
    this.cancelTransition(); this.endSession(reason === 'user' ? 'skip' : 'end');
    for (const d of this.decks) if (d.track && !d.el.paused) this.stopDeck(d, 0.12); // no overlap with Vesper audio
    this.next = null; this.plan = null; this.external = true; this.extPos = at; this.extDur = track.duration || 0;
    this.set({ status: 'loading', track, position: at, duration: this.extDur, error: null, transition: null });
    this.emit('trackchange', track);
    if (!this.yt) { this.fail(track, new Error('The YouTube player isn’t available.')); return; }
    const autoplay = play && !document.hidden; // never start a YouTube video while the page is hidden
    try { await this.yt.load(track.id.slice(3), { autoplay, at }); }
    catch (e) { if (token === this.loadToken) { if (e.code === 'declined') { this.external = false; this.yt.hide(); this.set({ status: 'idle', error: e.message }); this.emit('external-declined', { track }); } else this.fail(track, e); } return; }
    if (token !== this.loadToken) return;
    this.startSession(track); this.session.lastCt = at;
    if (!autoplay) this.set({ status: 'paused', error: play ? 'YouTube videos don’t start in the background. Press play.' : null });
  }
  onExternal(type, data) {
    if (!this.external) return;
    if (type === 'time') {
      const s = this.session;
      if (s && data.playing) { const dt = data.t - s.lastCt; if (dt > 0 && dt < 1.5) s.ms += (dt / (this.yt?.rate || 1)) * 1000; s.lastCt = data.t; }
      this.extPos = data.t; this.state.position = data.t;
      if (data.d && Math.abs(data.d - this.extDur) > 0.5) { this.extDur = data.d; this.set({ duration: data.d }); }
      this.emit('time', data.t);
    } else if (type === 'state') {
      if (data === 'playing') { this.failures = 0; this.set({ status: 'playing', error: null }); }
      else if (data === 'buffering') this.set({ status: 'buffering' });
      else if (data === 'paused') this.set({ status: 'paused' });
      else if (data === 'cued') this.set({ status: 'paused', error: this.state.error || 'Press play to start the video.' });
      else if (data === 'ended') {
        if (this.repeatOne) { this.endSession('end'); this.startSession(this.state.track); this.session.lastCt = 0; this.yt.seek(0); this.yt.play(); return; }
        this.endSession('end'); this.set({ status: 'ended' }); this.emit('ended', { track: this.state.track });
      }
    } else if (type === 'error') this.fail(this.state.track, Object.assign(new Error(data.message), { code: data.code }));
    else if (type === 'rate') this.emit('position');
  }
  leaveExternal() { if (this.external) { this.external = false; this.yt?.stop(); } }
  closeExternal() { if (!this.external) return; this.endSession('skip'); this.leaveExternal(); this.set({ status: 'idle', track: null, error: null }); this.emit('state', this.state); }
  get capabilities() {
    return { graph: this.graph, crossfade: this.graph, visualizer: this.graph, leveling: this.graph, eq: this.graph, speed: true, reason: this.graph ? null : (IS_IOS ? 'On iPhone and iPad, crossfades are off so audio keeps playing on the Lock Screen. Turn on audio processing in Settings to try them.' : 'Audio processing is off.') };
  }
  // Equalizer: gains are applied with a short ramp so changes never click.
  setEQ(eq) { this.eq = eq; this.applyEQ(); }
  applyEQ() {
    if (!this.eqNodes) return;
    const g = effectiveGains(this.eq), t = this.ctx.currentTime;
    this.eqNodes.forEach((b, i) => b.gain.setTargetAtTime(g[i], t, 0.03));
    this.preamp.gain.setTargetAtTime(10 ** (preampDb(g) / 20), t, 0.03);
  }
  eqResponse(freqs) { // dB response of the live filter chain, for drawing the curve
    if (!this.eqNodes) return null;
    const f = new Float32Array(freqs), mag = new Float32Array(f.length), ph = new Float32Array(f.length), out = new Float32Array(f.length);
    for (const b of this.eqNodes) { b.getFrequencyResponse(f, mag, ph); for (let i = 0; i < f.length; i++) out[i] += 20 * Math.log10(mag[i]); }
    return out;
  }
  setSettings(s) {
    const prev = this.settings;
    this.settings = { ...this.settings, ...s };
    if (s.speed !== undefined && s.speed !== prev.speed) this.setRate(s.speed);
    if (s.leveling !== undefined) for (const d of this.decks) this.applyNorm(d);
    if (s.eq) this.setEQ(s.eq);
    if (s.transition !== undefined || s.crossfade !== undefined) this.plan = null;
  }

  // BPM cache is local to this browser profile; it never touches account data or sign-in.
  readTempoCache() { try { const x = JSON.parse(localStorage.getItem('vesper.tempo.v1') || '{}'); return x && typeof x === 'object' ? x : {}; } catch { return {}; } }
  saveTempo(track, bpm) {
    if (!track?.id || !Number.isFinite(bpm)) return;
    track.bpm = bpm; track.bpmSource = 'Vesper audio analysis';
    this.tempoCache[track.id] = { bpm, at: Date.now() };
    const keys = Object.keys(this.tempoCache).sort((a, b) => (this.tempoCache[b]?.at || 0) - (this.tempoCache[a]?.at || 0)).slice(0, 200);
    this.tempoCache = Object.fromEntries(keys.map((k) => [k, this.tempoCache[k]]));
    try { localStorage.setItem('vesper.tempo.v1', JSON.stringify(this.tempoCache)); } catch {}
    this.emit('tempo', { track, bpm, source: track.bpmSource });
  }
  sampleTempo(d) {
    if (!this.graph || !d?.track || d.el.paused || !d.tempoAnalyser || d.track.bpm > 0 || this.external) return;
    const cached = this.tempoCache[d.track.id];
    if (cached?.bpm > 0 && Date.now() - cached.at < 180 * 86400_000) { this.saveTempo(d.track, cached.bpm); return; }
    d.tempoTracker ||= new TempoTracker(10);
    d.tempoAnalyser.getByteFrequencyData(d.tempoBytes);
    const bpm = d.tempoTracker.pushSpectrum(d.tempoBytes);
    if (bpm) this.saveTempo(d.track, bpm);
  }
  // ---------- events ----------
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  set(patch) { Object.assign(this.state, patch); this.emit('state', this.state); }
  onDeckEvent(d, e) {
    if (this.external) return; // a YouTube video owns playback; stopped decks must not change state
    if (d.el.src === SILENT_WAV || d.el.currentSrc === SILENT_WAV) return;
    if (e.type === 'error') {
      if (!d.track) return;
      const msg = { 1: 'Playback was aborted.', 2: 'A network error interrupted the audio.', 3: 'The audio could not be decoded.', 4: 'This audio format or source isn’t supported.' }[d.el.error?.code] || 'Audio error.';
      if (d.active) this.fail(d.track, new Error(msg));
      else if (this.next?.track === d.track) { this.next = null; this.plan = null; }
      return;
    }
    if (!d.active) return;
    switch (e.type) {
      case 'playing': this.failures = 0; this.set({ status: 'playing', error: null }); break;
      case 'play': if (this.state.status !== 'loading') this.set({ status: 'playing' }); break;
      case 'pause': if (!this.transition && !d.el.ended && this.state.status !== 'loading') this.set({ status: 'paused' }); break;
      case 'waiting': case 'stalled': if (!d.el.paused) this.set({ status: 'buffering' }); break;
      case 'durationchange': case 'loadedmetadata': { const dur = this.deckDuration(d); if (dur) this.set({ duration: dur }); this.plan = null; break; }
      case 'ratechange': this.emit('position'); break;
      case 'seeked': this.emit('position'); break;
      case 'ended': this.onEnded(d); break;
    }
  }
  onTime(d) {
    if (!d.active || this.external) return;
    const s = this.session;
    if (s && !d.el.paused) {
      const ct = d.el.currentTime, delta = ct - s.lastCt;
      if (delta > 0 && delta < 1.5) s.ms += (delta / (d.el.playbackRate || 1)) * 1000;
      s.lastCt = ct;
    }
    this.state.position = d.el.currentTime;
    this.emit('time', d.el.currentTime);
    this.tick();
  }

  // ---------- preparation ----------
  // Fetch + analyse small files (previews, test signals, short tracks) so transitions can be planned
  // from real audio. Long files stream directly without analysis.
  // Ask the server to resolve a YouTube stream now (it caches it for hours) and learn its real length.
  // Downloads no audio. Safe to call repeatedly.
  prefetch(track, q = this.settings.dataSaver ? 'low' : 'high') {
    if (!track || !(track.provider === 'youtube' || /^yt:/.test(track.id || ''))) return Promise.resolve(null);
    this.infoCache ||= new Map();
    const key = `${track.id}|${q}`, hit = this.infoCache.get(key);
    if (hit && hit.at > Date.now() - 4 * 3600_000) return hit.p;
    const p = fetch(`/api/audio-prepare/${encodeURIComponent(track.id)}?q=${q}`, { credentials: 'same-origin' })
      .then(async (r) => { const j = await r.json().catch(() => ({})); return r.ok ? j : { error: j.error || `Couldn’t prepare this song (${r.status}).`, code: j.code }; })
      .catch(() => ({ error: 'Can’t reach the Vesper server.', code: 'offline' }));
    this.infoCache.set(key, { p, at: Date.now() });
    p.then((x) => { if (!x || x.error) this.infoCache.delete(key); });
    if (this.infoCache.size > 200) this.infoCache.delete(this.infoCache.keys().next().value);
    return p;
  }
  prepare(track) {
    const cacheKey = (track.provider === 'youtube' || /^yt:/.test(track.id)) && this.settings.dataSaver ? `${track.id}|low` : track.id;
    if (this.prepCache.has(cacheKey)) return this.prepCache.get(cacheKey);
    const src = `/api/audio/${encodeURIComponent(track.id)}`;
    const p = (async () => {
      // Resolve the next YouTube stream while the current song is still playing. The server
      // caches short-lived URLs and coalesces duplicate requests, reducing track-change gaps.
      if (track.provider === 'youtube' || /^yt:/.test(track.id)) {
        const q = this.settings.dataSaver ? 'low' : 'high';
        const info = await this.prefetch(track, q);
        if (info?.error) { const err = new Error(info.error); err.code = info.code; throw err; } // the real reason, not "format not supported"
        return { url: q === 'low' ? `${src}?q=low` : src, analysis: null, blob: false, duration: info?.duration || track.duration, streamDuration: info?.duration || null, quality: q };
      }
      // Data saver: don't download whole files up front just to analyse them (crossfades still work).
      const small = track.preview || track.isTest || (!this.settings.dataSaver && track.duration && track.duration <= 480 && !IS_MOBILE);
      if (!small) return { url: src, analysis: null, blob: false, duration: track.duration };
      const res = await fetch(src);
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Audio request failed (${res.status})`); }
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: res.headers.get('content-type') || 'audio/mpeg' });
      let analysis = null;
      try {
        const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const ab = await new OAC(1, 2, 22050).decodeAudioData(buf.slice(0));
        analysis = analyze(ab);
      } catch (e) { console.warn('Analysis skipped:', e.message); }
      return { url: URL.createObjectURL(blob), analysis, blob: true, duration: analysis?.duration || track.playableDuration || track.duration };
    })();
    p.catch(() => this.prepCache.delete(cacheKey));
    this.prepCache.set(cacheKey, p);
    // Keep the cache small; release blob URLs that no deck is using.
    if (this.prepCache.size > 8) {
      for (const [id, pr] of this.prepCache) {
        if (this.prepCache.size <= 8) break;
        if (this.decks.some((d) => d.track?.id === id) || id === track.id || this.next?.track.id === id) continue;
        this.prepCache.delete(id);
        pr.then((x) => x.blob && URL.revokeObjectURL(x.url)).catch(() => {});
      }
    }
    return p;
  }
  applyNorm(d) {
    if (!d.norm) return;
    const a = d.prep?.analysis;
    const g = this.settings.leveling && a ? Math.max(-9, Math.min(6, -16 - a.loudnessDb)) : 0;
    d.norm.gain.setTargetAtTime(10 ** (g / 20), this.ctx.currentTime, 0.05);
    d.levelDb = g;
  }
  outVolume() { return this.muted ? 0 : this.volume ** 2; }
  applyVolume() {
    this.yt?.setVolume(this.volume, this.muted);
    if (this.graph) this.master.gain.setTargetAtTime(this.outVolume(), this.ctx.currentTime, 0.02);
    else for (const d of this.decks) d.el.volume = d.active ? this.outVolume() : 0;
  }
  other(d = this.active) { return this.decks[1 - d.i]; }
  // The real length of what a deck is playing. Some browsers (notably Safari on iPhone) misread
  // the length of streamed AAC audio, sometimes reporting double. Prefer the length the stream
  // itself states, then the media element, but not when it disagrees wildly with the catalog.
  deckDuration(d) {
    if (!d?.track) return 0;
    const known = d.endedAt || d.prep?.streamDuration || null;
    if (known) return known;
    const el = Number.isFinite(d.el.duration) && d.el.duration > 0 ? d.el.duration : null;
    const meta = d.track.preview ? (d.prep?.duration || 30) : (d.prep?.duration || d.track.playableDuration || d.track.duration || null);
    if (el && meta && !d.prep?.blob && (el > meta * 1.35 || el < meta * 0.65)) return meta;
    return el || meta || 0;
  }
  waitReady(el, timeout = 20000) {
    if (el.readyState >= 2) return Promise.resolve();
    return new Promise((res, rej) => {
      const done = (f) => () => { clean(); f(); };
      const ok = done(res), bad = done(() => rej(new Error({ 4: 'This audio format or source isn’t supported.' }[el.error?.code] || 'The audio could not be loaded.')));
      const to = setTimeout(done(() => rej(new Error('The audio took too long to load.'))), timeout);
      const clean = () => { clearTimeout(to); el.removeEventListener('canplay', ok); el.removeEventListener('loadeddata', ok); el.removeEventListener('error', bad); };
      el.addEventListener('canplay', ok); el.addEventListener('loadeddata', ok); el.addEventListener('error', bad);
    });
  }
  assign(d, track, prep) {
    if (d.track?.id !== track.id) d.endedAt = null;
    d.track = track; d.prep = prep; d.tempoTracker = null;
    if (!(d.track.bpm > 0)) { const cached = this.tempoCache[track.id]; if (cached?.bpm > 0 && Date.now() - cached.at < 180 * 86400_000) { track.bpm = cached.bpm; track.bpmSource = 'Vesper audio analysis (saved)'; } }
    if (d.el.src !== prep.url) { d.el.src = prep.url; d.el.load(); }
    d.el.playbackRate = this.settings.speed; d.el.defaultPlaybackRate = this.settings.speed;
    d.el.preservesPitch = true;
    if (this.graph) d.el.volume = 1;
    d.resetFilter();
    this.applyNorm(d);
  }

  // ---------- transport ----------
  // Immediately switch to a track (user action or auto-advance without a planned transition).
  async load(track, { play = true, at = 0, reason = 'user' } = {}) {
    this.leaveExternal();
    const token = ++this.loadToken;
    this.cancelTransition();
    this.endSession(reason === 'user' ? 'skip' : 'end');
    const out = this.active;
    const inn = this.other();
    this.set({ status: 'loading', track, position: at, duration: track.playableDuration || track.duration || 0, error: null, transition: null });
    this.emit('trackchange', track);
    let prep;
    try { prep = await this.prepare(track); }
    catch (e) { if (token === this.loadToken) this.fail(track, e); return; }
    if (token !== this.loadToken) return;
    // Short fade on the outgoing deck to avoid a click.
    if (out.track) this.stopDeck(out, 0.12);
    if (this.next?.track.id === track.id) { this.next = null; }
    this.assign(inn, track, prep);
    try { await this.waitReady(inn.el); } catch (e) { if (token === this.loadToken) this.fail(track, e); return; }
    if (token !== this.loadToken) return;
    if (at > 0) inn.el.currentTime = at;
    this.active = inn; this.plan = null;
    if (!this.graph) this.applyVolume();
    inn.setFade(1, 0.03);
    this.set({ duration: this.deckDuration(inn) || this.state.duration });
    this.startSession(track);
    if (play) await this.play(); else this.set({ status: 'paused' });
    this.emit('prepared', { track, analysis: prep.analysis });
    this.warmNext();
  }
  // A user-selected song can crossfade immediately from the current song instead of hard-cutting.
  async playWithTransition(track, { reason = 'user', at = 0, force = false } = {}) {
    // Tracks resolved to YouTube audio use the same Vesper audio decks as other sources,
    // so they can be preloaded and crossfaded. Only a genuinely active external iframe
    // player must bypass the internal deck transition path.
    if (this.external) return this.load(track, { reason, at });
    // A search result can resolve asynchronously; make sure the desktop audio graph was
    // initialized by the first user gesture before deciding whether a crossfade is possible.
    if (!this.graph && !this.unlocked && this.wantsGraph()) this.unlock();
    const out = this.active;
    const preset = this.settings.transition;
    if (!this.graph || !out.track || out.el.paused || (!force && this.state.status !== 'playing') || preset === 'off' || preset === 'seamless-cut' || this.transition) {
      if (!this.graph && out.track && !out.el.paused && preset !== 'off' && preset !== 'seamless-cut') this.emit('transition-unavailable', { reason: this.capabilities.reason || 'Audio processing is unavailable.' });
      return this.load(track, { reason, at });
    }
    const token = ++this.loadToken;
    this.next = null; this.plan = null;
    const inn = this.other();
    this.set({ status: 'loading', track, position: at, duration: track.playableDuration || track.duration || 0, error: null, transition: null });
    let prep;
    try { prep = await this.prepare(track); }
    catch (e) { if (token === this.loadToken) this.fail(track, e); return; }
    if (token !== this.loadToken) return;
    this.assign(inn, track, prep);
    try { await this.waitReady(inn.el); }
    catch (e) { if (token === this.loadToken) this.fail(track, e); return; }
    if (token !== this.loadToken) return;
    if (at > 0) inn.el.currentTime = at;
    const dur = this.deckDuration(inn) || track.duration || 30;
    const outDur = this.deckDuration(out);
    const remaining = Math.max(0.6, outDur ? outDur - out.el.currentTime : this.settings.crossfade);
    const fade = Math.max(0.6, Math.min(preset === 'minimal' ? 1.5 : preset === 'cinematic' ? Math.max(10, this.settings.crossfade) : preset === 'dj' ? 8 : this.settings.crossfade, remaining, dur * 0.4));
    const bpmOut = out.track?.bpm || out.prep?.analysis?.bpm || null;
    const bpmIn = track.bpm || prep.analysis?.bpm || null;
    const plan = { kind: 'blend', preset, fade, inStart: Math.min(prep.analysis?.leadSilence || 0, 2), tempo: { out: bpmOut, in: bpmIn, compatible: tempoCompatible(bpmOut, bpmIn) }, note: 'song selected manually' };
    this.next = { track, prep, ready: true };
    this.startTransition(plan);
  }

  stopDeck(d, fade = 0.08) {
    if (this.graph) { d.setFade(0, fade); setTimeout(() => { if (!d.active) { d.el.pause(); d.resetFilter(); d.track = null; d.prep = null; this.warmNext(); } }, fade * 1000 + 30); }
    else { d.el.pause(); d.track = null; d.prep = null; this.warmNext(); }
  }
  async play() {
    if (this.external) { if (!document.hidden) this.yt?.play(); return; } // never start YouTube in the background
    const d = this.active;
    if (!d.track) return;
    this.ctx?.resume?.();
    try { await d.el.play(); }
    catch (e) {
      if (e.name === 'NotAllowedError') { this.set({ status: 'paused', error: 'Press play to start — your browser blocked automatic playback.' }); }
      else if (e.name !== 'AbortError') this.fail(d.track, e);
    }
  }
  pause() {
    if (this.external) { this.yt?.pause(); return; }
    if (this.transition) this.cancelTransition();
    this.active.el.pause();
  }
  toggle() { if (this.paused) this.play(); else this.pause(); }
  seek(t) {
    if (this.external) { if (!this.extDur) return; const x = Math.max(0, Math.min(t, this.extDur - 0.5)); this.yt?.seek(x); this.extPos = x; if (this.session) this.session.lastCt = x; this.emit('time', x); return; }
    const d = this.active;
    const dur = this.deckDuration(d);
    if (!d.track || !dur) return;
    if (this.transition) this.cancelTransition();
    d.el.currentTime = Math.max(0, Math.min(t, dur - 0.05));
    if (this.session) this.session.lastCt = d.el.currentTime;
    this.plan = null;
    this.emit('time', d.el.currentTime);
  }
  setRate(r) {
    if (this.external && this.yt) { this.settings.speed = r; this.yt.setRate(r); this.emit('position'); return; }
    for (const d of this.decks) { d.el.playbackRate = r; d.el.defaultPlaybackRate = r; d.el.preservesPitch = true; }
    this.settings.speed = r; this.plan = null;
    this.emit('position');
  }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); localStorage.setItem('vesper.volume', this.volume); this.applyVolume(); this.emit('volume'); }
  setMuted(m) { this.muted = m; this.applyVolume(); this.emit('volume'); }
  stop() { this.cancelTransition(); this.endSession('end'); for (const d of this.decks) d.el.pause(); this.set({ status: 'idle' }); }
  get position() { return this.external ? this.extPos : (this.active.el.currentTime || 0); }
  get duration() { if (this.external) return this.extDur; return this.deckDuration(this.active) || this.state.duration; }
  get paused() { return this.external ? !['playing', 'buffering'].includes(this.state.status) : this.active.el.paused; }
  get rate() { return this.external ? (this.yt?.rate || 1) : this.active.el.playbackRate; }

  fail(track, err) {
    this.failures++;
    this.set({ status: 'error', error: err.message });
    this.emit('error', { track, message: err.message, consecutive: this.failures, code: err.code });
  }

  // ---------- next-track preparation and transitions ----------
  prepareNext(track) {
    // YouTube-matched tracks are served through /api/audio and can use the normal decks.
    // Keep the external-player case separate: it is not blended with internal audio.
    if (this.external) { this.next = null; this.plan = null; return; }
    if (!track) { this.next = null; this.plan = null; return; }
    if (this.next?.track.id === track.id) return;
    const want = track;
    this.next = { track, prep: null, ready: false };
    this.plan = null;
    this.prepare(track).then(async (prep) => {
      if (this.next?.track !== want) return;
      this.next.prep = prep;
      await this.warmNext();
    }).catch((e) => { if (this.next?.track === want) { this.next = null; this.emit('next-failed', { track: want, message: e.message }); } });
  }

  // Actually warm the idle media element before a transition is due. A resolved URL alone
  // is not enough: YouTube stream URLs can take several seconds before the audio is playable.
  async warmNext() {
    const next = this.next;
    if (!next?.prep || this.transition || this.external || this.state.status === 'loading') return;
    const idle = this.other();
    if (idle.track && idle.track.id !== next.track.id) return; // the outgoing deck is still being cleaned up
    if (idle.track?.id !== next.track.id) this.assign(idle, next.track, next.prep);
    if (this.graph) idle.fade.gain.value = 0; else idle.el.volume = 0;
    try { await this.waitReady(idle.el, 25000); }
    catch (e) {
      if (this.next === next) { this.next = null; this.plan = null; this.emit('next-failed', { track: next.track, message: e.message }); }
      return;
    }
    if (this.next !== next || this.transition) return;
    next.ready = true;
    this.emit('next-ready', { track: next.track, analysis: next.prep.analysis });
  }

  planTransition(out, next) {
    const s = this.settings;
    let preset = s.transition;
    if (!this.graph && preset !== 'off') preset = 'seamless-cut';
    const dur = this.deckDuration(out);
    if (!dur || dur < 2) return null;
    const a = out.prep?.analysis, b = next.prep?.analysis;
    const outEnd = a ? Math.max(1, dur - Math.min(a.trailSilence, 3)) : dur;
    const inStart = b ? Math.min(b.leadSilence, 2) : 0;
    const bpmOut = out.track.bpm || a?.bpm || null, bpmIn = next.track.bpm || b?.bpm || null;
    const tempo = { out: bpmOut, in: bpmIn, compatible: tempoCompatible(bpmOut, bpmIn) };
    if (preset === 'off') return null; // play to the very end; 'ended' advances
    if (preset === 'seamless-cut') return { kind: 'cut', outEnd, fade: 0, inStart, tempo };
    if (preset === 'seamless') return { kind: 'seamless', outEnd, fade: 0.06, inStart, tempo };
    let fade = preset === 'minimal' ? 1.5 : preset === 'cinematic' ? Math.max(10, s.crossfade) : s.crossfade;
    let note = null;
    if (preset === 'dj') {
      if (bpmOut) { const beat = 60 / bpmOut; let beats = 16; while (beats * beat > 12 && beats > 4) beats /= 2; fade = beats * beat; note = `${beats} beats at ${Math.round(bpmOut)} BPM`; }
      else { fade = 8; note = 'tempo unknown, using 8 s'; }
    }
    const inDur = next.prep?.duration || next.track.playableDuration || next.track.duration || 30;
    fade = Math.min(fade, (outEnd - (out.el.currentTime || 0)) - 0.2, outEnd * 0.4, inDur * 0.4);
    if (a?.fadeOut > 1.5 && preset !== 'cinematic') fade = Math.min(fade, a.fadeOut + 2); // the song already fades itself
    if (fade < 0.4) return { kind: 'seamless', outEnd, fade: 0.06, inStart, tempo };
    // DJ: lock the blend to the beat grid when BOTH songs have a confident beat grid and compatible tempo.
    const ao = a?.endBeatOffset ?? a?.beatOffset, aConf = a?.endBeatOffset != null ? a.endBeatConfidence : a?.beatConfidence;
    if (preset === 'dj' && a?.bpm && b?.bpm && aConf >= 1.3 && b.beatConfidence >= 1.3 && ao != null && b.beatOffset != null) {
      const r = [1, 2, 0.5].map((m) => a.bpm / (b.bpm * m)).sort((x, y) => Math.abs(1 - x) - Math.abs(1 - y))[0];
      const beatOut = 60 / a.bpm, beatIn = 60 / b.bpm;
      const beats = Math.floor(fade / beatOut);
      if (Math.abs(1 - r) <= 0.08 && beats >= 4) { // ±8%, the usual DJ pitch range (pitch is preserved)
        const F = beats * beatOut, n = Math.floor((outEnd - F - ao) / beatOut), alignAt = ao + n * beatOut; // grid measured in the outro
        if (alignAt > (out.el.currentTime || 0) + 1) {
          const m = Math.max(0, Math.ceil((inStart - b.beatOffset) / beatIn));
          return { kind: 'blend', preset, outEnd: alignAt + F, fade: F, inStart: b.beatOffset + m * beatIn, tempo, alignAt, inRate: r, note: `beat-aligned, ${beats} beats at ${Math.round(a.bpm)} BPM${Math.abs(1 - r) > 0.004 ? `, tempo matched ${r > 1 ? '+' : ''}${((r - 1) * 100).toFixed(1)}%` : ''}` };
        }
      }
    }
    return { kind: 'blend', preset, outEnd, fade, inStart, tempo, note };
  }

  tick() {
    if (this.external) return;
    const d = this.active;
    this.sampleTempo(d);
    if (!d.track || d.el.paused || this.transition || this.repeatOne || this.state.status === 'loading') return;
    if (!this.next?.ready) return;
    if (!this.plan) this.plan = this.planTransition(d, this.next) || 'none';
    if (this.plan === 'none') return;
    const remaining = (this.plan.outEnd - d.el.currentTime) / (d.el.playbackRate || 1);
    if (remaining <= this.plan.fade + 0.04) this.startTransition(this.plan);
  }

  async startTransition(plan) {
    const out = this.active, inn = this.other(), next = this.next;
    if (!next?.prep) return;
    this.transition = { plan, out, inn };
    this.endSession('end', true);
    if (inn.track?.id !== next.track.id) this.assign(inn, next.track, next.prep);
    try { await this.waitReady(inn.el, 4000); } catch (e) { this.transition = null; this.next = null; this.emit('next-failed', { track: next.track, message: e.message }); return; }
    if (this.transition?.inn !== inn) return; // cancelled meanwhile
    if (plan.alignAt != null) {
      // Wait for the exact outgoing beat, then start the incoming song on its beat (timer lateness compensated).
      const rate = out.el.playbackRate || 1, wait = (plan.alignAt - out.el.currentTime) / rate;
      if (wait > 0.004 && wait < 3) await new Promise((r) => setTimeout(r, wait * 1000));
      if (this.transition?.inn !== inn) return;
      const late = Math.max(0, (out.el.currentTime - plan.alignAt) / rate);
      inn.el.playbackRate = this.settings.speed * plan.inRate;
      inn.el.currentTime = plan.inStart + late * inn.el.playbackRate;
    } else inn.el.currentTime = plan.inStart;
    if (plan.kind === 'cut') {
      out.el.pause(); this.active = inn; this.applyVolume();
    } else {
      const t0 = this.ctx.currentTime + 0.03, F = plan.fade, N = 128;
      const outC = new Float32Array(N), inC = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = i / (N - 1);
        if (plan.kind === 'seamless') { outC[i] = 1 - x; inC[i] = x; }
        else if (plan.preset === 'dj') { inC[i] = Math.sin(Math.PI / 2 * Math.min(1, x * 1.6)); outC[i] = Math.cos(Math.PI / 2 * Math.max(0, (x - 0.375) * 1.6)); }
        else if (plan.preset === 'cinematic') { const s = x * x * (3 - 2 * x); inC[i] = Math.sin(Math.PI / 2 * s); outC[i] = Math.cos(Math.PI / 2 * s); }
        else { inC[i] = Math.sin(Math.PI / 2 * x); outC[i] = Math.cos(Math.PI / 2 * x); }
      }
      outC[N - 1] = 0; inC[0] = 0; inC[N - 1] = 1;
      for (const [d, c] of [[out, outC], [inn, inC]]) { d.fade.gain.cancelScheduledValues(0); d.fade.gain.setValueAtTime(c[0], t0); d.fade.gain.setValueCurveAtTime(c, t0, F); }
      if (plan.preset === 'dj') { // bass swap: high-pass the outgoing song around the midpoint
        out.filter.type = 'highpass'; out.filter.Q.value = 0.7;
        out.filter.frequency.setValueAtTime(20, t0); out.filter.frequency.setValueAtTime(20, t0 + F * 0.35);
        out.filter.frequency.exponentialRampToValueAtTime(700, t0 + F * 0.6);
      } else if (plan.preset === 'cinematic') {
        out.filter.type = 'lowpass'; out.filter.Q.value = 0.5;
        out.filter.frequency.setValueAtTime(18000, t0); out.filter.frequency.exponentialRampToValueAtTime(600, t0 + F);
      }
      this.active = inn;
    }
    try { await inn.el.play(); } catch (e) { /* play errors surface via events */ }
    this.next = null; this.plan = null;
    this.startSession(inn.track);
    this.set({ track: inn.track, status: 'playing', duration: this.deckDuration(inn) || this.state.duration, transition: plan.kind === 'cut' ? null : { kind: plan.kind, preset: plan.preset, fade: plan.fade, note: plan.note, tempo: plan.tempo } });
    this.emit('advanced', { track: inn.track, plan });
    this.emit('trackchange', inn.track);
    const ms = plan.kind === 'cut' ? 0 : (plan.fade + 0.12) * 1000;
    clearTimeout(this.tTimer);
    this.tTimer = setTimeout(() => this.finishTransition(out), ms);
  }
  finishTransition(out) {
    if (!this.transition || this.transition.out !== out) return;
    const pl = this.transition.plan, inn = this.transition.inn;
    if (pl?.inRate && Math.abs(pl.inRate - 1) > 0.001) { // ease the tempo-matched song back to normal speed
      const from = inn.el.playbackRate, to = this.settings.speed; let k = 0;
      const iv = setInterval(() => { k++; if (inn !== this.active) return clearInterval(iv); inn.el.playbackRate = from + (to - from) * (k / 8); if (k >= 8) clearInterval(iv); }, 500);
    }
    out.el.pause(); out.resetFilter(); out.track = null; out.prep = null;
    if (out.fade) { out.fade.gain.cancelScheduledValues(0); out.fade.gain.value = 0; }
    this.transition = null;
    this.set({ transition: null });
    this.emit('transition-end');
    this.warmNext();
  }
  cancelTransition() {
    const tr = this.transition;
    if (!tr) return;
    tr.inn.el.playbackRate = this.settings.speed;
    clearTimeout(this.tTimer);
    this.transition = null;
    tr.out.setFade(0, 0.05);
    setTimeout(() => { tr.out.el.pause(); tr.out.resetFilter(); tr.out.track = null; }, 80);
    if (tr.inn.fade) { tr.inn.fade.gain.cancelScheduledValues(0); tr.inn.setFade(1, 0.05); }
    this.set({ transition: null });
  }
  onEnded(d) {
    if (this.transition) return;
    const shown = this.deckDuration(d), at = d.el.currentTime || 0;
    if (at > 5 && shown - at > 3) { d.endedAt = at; this.set({ duration: at }); }
    if (this.repeatOne) { this.endSession('end'); d.el.currentTime = 0; this.startSession(d.track); d.el.play(); return; }
    this.endSession('end');
    this.set({ status: 'ended' });
    this.emit('ended', { track: d.track });
  }

  // ---------- listening sessions (for history/stats) ----------
  startSession(track) { this.session = { track, ms: 0, lastCt: this.active.el.currentTime || 0, started: Date.now() }; }
  endSession(how, natural = false) {
    const s = this.session; this.session = null;
    if (!s || s.ms < 1000) return;
    const len = (s.track.preview ? 30 : (this.state.duration || s.track.duration || 0)) * 1000;
    const completed = how === 'end' || natural || (len > 0 && s.ms >= len * 0.9);
    const skipped = how === 'skip' && s.ms < Math.min(30_000, len * 0.5 || 30_000);
    this.emit('played', { track: s.track, ms: Math.round(s.ms), completed, skipped });
  }
  flushSession() { // e.g. page hide: report what we have without ending playback
    const s = this.session; if (!s || s.ms < 1000) return null;
    const out = { track: s.track, ms: Math.round(s.ms), completed: false, skipped: false };
    s.ms = 0; return out;
  }
  frequencyData(arr) { if (this.analyser) this.analyser.getByteFrequencyData(arr); }
}
