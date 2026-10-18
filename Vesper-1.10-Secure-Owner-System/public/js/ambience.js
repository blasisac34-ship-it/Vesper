// Ambience Studio — full-screen listening view built from the current song's real artwork.
// The visualizer is audio-reactive only when Vesper's audio engine can analyse the current source;
// otherwise it says so and shows a gentle motion that is clearly labelled as not audio-reactive.
import { store } from './store.js';
import { palette } from './color.js';
import { fmtTime, esc } from './ui.js';

const LS = 'vesper.ambience.v1';
const DEF = { glow: 0.6, blur: 48, intensity: 0.6, motion: true, viz: true, style: 'aura' };
const STYLES = [['aura', 'Aura'], ['vinyl', 'Vinyl'], ['cinema', 'Cinema'], ['minimal', 'Minimal']];
let el = null, raf = 0, engineRef = null, queueRef = null, silentSince = 0, vizState = 'off';

const reduced = () => store.settings.reducedMotion === 'on' || (store.settings.reducedMotion !== 'off' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const cfg = () => ({ ...DEF, ...(reduced() ? { motion: false } : {}), ...JSON.parse(localStorage.getItem(LS) || '{}') });
const save = (c) => localStorage.setItem(LS, JSON.stringify(c));

export function openAmbience(engine, queue) {
  engineRef = engine; queueRef = queue;
  if (!el) build();
  el.hidden = false; document.body.classList.add('ambience-open');
  apply(); setTrack(engine.state.track); sync(); loop();
  el.querySelector('[data-amb="close"]').focus();
}
export function closeAmbience() { if (!el) return; el.hidden = true; document.body.classList.remove('ambience-open'); cancelAnimationFrame(raf); raf = 0; }

function build() {
  el = document.createElement('section');
  el.className = 'amb'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Ambience Studio');
  const c = cfg();
  el.innerHTML = `<div class="amb-bg"><div class="amb-bg-img"></div><div class="amb-glow"></div></div><canvas class="amb-viz" aria-hidden="true"></canvas>
    <div class="amb-top"><button class="btn ghost sm" data-amb="close" aria-label="Exit Ambience Studio">Exit</button><span class="amb-brand">Ambience Studio</span><button class="btn ghost sm" data-amb="panel" aria-expanded="false" aria-controls="amb-panel">Customize</button></div>
    <div class="amb-main"><div class="amb-art-wrap"><img class="amb-art" alt=""></div>
      <div class="amb-info"><h2 class="amb-title">Nothing playing</h2><p class="amb-artist"></p>
        <div class="amb-progress"><span class="amb-pos">0:00</span><input type="range" class="amb-seek" min="0" max="1000" value="0" aria-label="Seek"><span class="amb-dur">0:00</span></div>
        <div class="amb-controls"><button class="amb-btn" data-amb="prev" aria-label="Previous">⏮</button><button class="amb-btn amb-play" data-amb="toggle" aria-label="Play">▶</button><button class="amb-btn" data-amb="next" aria-label="Next">⏭</button>
          <label class="amb-vol" aria-label="Volume">🔈<input type="range" class="amb-volume" min="0" max="100" aria-label="Volume"></label></div>
        <p class="amb-note" aria-live="polite"></p></div></div>
    <div class="amb-panel" id="amb-panel" hidden>
      <h3>Appearance</h3><div class="chips">${STYLES.map(([k, l]) => `<button class="chip" data-style="${k}" aria-pressed="${c.style === k}">${l}</button>`).join('')}</div>
      <label>Glow <input type="range" data-k="glow" min="0" max="1" step="0.01" value="${c.glow}"></label>
      <label>Background blur <input type="range" data-k="blur" min="0" max="90" step="1" value="${c.blur}"></label>
      <label>Intensity <input type="range" data-k="intensity" min="0" max="1" step="0.01" value="${c.intensity}"></label>
      <label class="amb-check"><input type="checkbox" data-k="motion" ${c.motion ? 'checked' : ''}> Slow artwork motion</label>
      <label class="amb-check"><input type="checkbox" data-k="viz" ${c.viz ? 'checked' : ''}> Visualizer</label>
      <p class="note amb-viz-note"></p></div>`;
  document.body.append(el);
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-amb]')?.dataset.amb;
    if (a === 'close') closeAmbience();
    if (a === 'panel') { const p = el.querySelector('.amb-panel'); p.hidden = !p.hidden; e.target.setAttribute('aria-expanded', String(!p.hidden)); }
    if (a === 'toggle') engineRef.toggle(); if (a === 'next') queueRef.next(); if (a === 'prev') queueRef.prev();
    const s = e.target.closest('[data-style]'); if (s) { const c = cfg(); c.style = s.dataset.style; save(c); el.querySelectorAll('[data-style]').forEach((x) => x.setAttribute('aria-pressed', String(x === s))); apply(); }
  });
  el.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (k) { const c = cfg(); c[k] = e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value); save(c); apply(); loop(); }
    if (e.target.classList.contains('amb-seek')) engineRef.seek((e.target.value / 1000) * (engineRef.duration || 0));
    if (e.target.classList.contains('amb-volume')) { engineRef.setVolume(e.target.value / 100); engineRef.setMuted(false); }
  });
  document.addEventListener('keydown', (e) => { if (el.hidden) return; if (e.key === 'Escape') closeAmbience(); else if (e.key === ' ' && !e.target.closest('input, button')) { e.preventDefault(); engineRef.toggle(); } });
  const on = (t, fn) => engineRef.addEventListener(t, () => { if (!el.hidden) fn(); });
  on('trackchange', () => setTrack(engineRef.state.track)); on('state', sync); on('time', time); on('volume', sync);
  document.addEventListener('visibilitychange', () => { if (!el.hidden) loop(); });
}
function apply() {
  const c = cfg();
  el.dataset.style = c.style; el.classList.toggle('amb-moving', c.motion && !reduced());
  el.style.setProperty('--amb-glow', c.glow); el.style.setProperty('--amb-blur', `${c.blur}px`); el.style.setProperty('--amb-int', c.intensity);
}
async function setTrack(t) {
  const art = t?.albumArtwork || t?.artwork || t?.artworkSmall || '';
  const img = el.querySelector('.amb-art');
  if (img.dataset.src !== art) { img.classList.remove('in'); img.dataset.src = art; if (art) { img.onload = () => img.classList.add('in'); img.src = art; } }
  el.querySelector('.amb-bg-img').style.backgroundImage = art ? `url("${art.replace(/"/g, '%22')}")` : 'none';
  el.querySelector('.amb-title').textContent = t?.title || 'Nothing playing';
  el.querySelector('.amb-artist').textContent = t?.artist || '';
  const p = art ? await palette(art).catch(() => null) : null;
  const hsl = (c, l, a = 1) => (c ? `hsl(${Math.round(c.h)} ${Math.round(Math.min(0.85, c.s + 0.15) * 100)}% ${l}% / ${a})` : null);
  el.style.setProperty('--amb-c1', hsl(p?.vivid, 58) || 'hsl(255 60% 62%)');
  el.style.setProperty('--amb-c2', hsl(p?.second, 34) || 'hsl(200 50% 30%)');
  silentSince = 0; time();
}
function sync() {
  const s = engineRef.state, playing = s.status === 'playing' || s.status === 'buffering';
  const b = el.querySelector('.amb-play'); b.textContent = playing ? '❚❚' : '▶'; b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  el.querySelector('.amb-volume').value = Math.round((engineRef.muted ? 0 : engineRef.volume) * 100);
  el.classList.toggle('amb-playing', playing);
  el.querySelector('.amb-note').textContent = s.status === 'error' ? (s.error || 'Playback error') : s.status === 'buffering' || s.status === 'loading' ? 'Loading…' : '';
  loop();
}
function time() {
  const p = engineRef.position, d = engineRef.duration || 0;
  el.querySelector('.amb-pos').textContent = fmtTime(p); el.querySelector('.amb-dur').textContent = fmtTime(d);
  if (document.activeElement !== el.querySelector('.amb-seek')) el.querySelector('.amb-seek').value = d ? (p / d) * 1000 : 0;
}
function loop() {
  cancelAnimationFrame(raf); raf = 0;
  const c = cfg(), canvas = el.querySelector('.amb-viz'), ctx = canvas.getContext('2d');
  const note = el.querySelector('.amb-viz-note');
  const fit = () => { canvas.width = canvas.clientWidth * Math.min(devicePixelRatio, 2); canvas.height = canvas.clientHeight * Math.min(devicePixelRatio, 2); };
  fit(); ctx.clearRect(0, 0, canvas.width, canvas.height);
  const canAnalyse = engineRef.graph && !engineRef.external && engineRef.analyser;
  if (!c.viz) { note.textContent = ''; return; }
  if (reduced()) { note.textContent = 'Visualizer paused because Reduce Motion is on.'; return; }
  if (!canAnalyse) note.textContent = engineRef.external ? 'This source plays in its own player, so Vesper can’t analyse its audio. The glow breathes gently instead — it isn’t reacting to the music.' : 'Audio analysis isn’t available on this device (Vesper’s audio engine is off, as it is by default on iPhone). The glow breathes gently instead — it isn’t reacting to the music.';
  const data = new Uint8Array(256);
  const draw = (now) => {
    if (el.hidden || document.hidden) { raf = 0; return; }
    if (canvas.width !== Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2))) fit();
    const w = canvas.width, h = canvas.height, k = cfg().intensity;
    ctx.clearRect(0, 0, w, h);
    const accent = getComputedStyle(el).getPropertyValue('--amb-c1').trim() || '#c7b6ff';
    let reactive = false;
    if (canAnalyse && !engineRef.paused) {
      engineRef.analyser.getByteFrequencyData(data);
      const energy = data.reduce((s, v) => s + v, 0);
      if (energy > 0) { silentSince = 0; reactive = true; } else if (!silentSince) silentSince = now; else if (now - silentSince > 2500) note.textContent = 'No audio signal is reaching the analyser for this source, so the visualizer is idle.';
      if (reactive) note.textContent = 'Visualizer is reacting to the music.';
    } else if (canAnalyse) note.textContent = 'Play a song to start the visualizer.';
    const art = el.querySelector('.amb-art').getBoundingClientRect(), cr = canvas.getBoundingClientRect(), dpr = w / cr.width;
    const cx = (art.left + art.width / 2 - cr.left) * dpr, cy = (art.top + art.height / 2 - cr.top) * dpr, R = (art.width / 2) * dpr;
    ctx.strokeStyle = accent; ctx.fillStyle = accent; ctx.lineCap = 'round';
    const style = cfg().style;
    if (reactive && (style === 'aura' || style === 'vinyl')) {
      ctx.lineWidth = 3 * dpr; const bins = 120;
      for (let i = 0; i < bins; i++) { const v = data[Math.floor(2 + (i / bins) ** 1.5 * 160)] / 255; const len = (4 + v * v * 110 * k) * dpr, ang = (i / bins) * Math.PI * 2 - Math.PI / 2; ctx.globalAlpha = 0.2 + v * 0.75; ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * (R + 10 * dpr), cy + Math.sin(ang) * (R + 10 * dpr)); ctx.lineTo(cx + Math.cos(ang) * (R + 10 * dpr + len), cy + Math.sin(ang) * (R + 10 * dpr + len)); ctx.stroke(); }
    } else if (reactive) {
      const bins = 64, bw = w / bins;
      for (let i = 0; i < bins; i++) { const v = data[Math.floor(2 + (i / bins) ** 1.4 * 150)] / 255; const bh = v * v * h * 0.28 * (0.4 + k); ctx.globalAlpha = 0.15 + v * 0.5; ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh); }
    } else if (!canAnalyse) {
      // Honest fallback: a slow breathing halo, not driven by audio.
      const b = 0.5 + 0.5 * Math.sin(now / 1800); ctx.globalAlpha = 0.12 + 0.12 * b * k; ctx.lineWidth = (6 + 10 * b * k) * dpr; ctx.beginPath(); ctx.arc(cx, cy, R + 18 * dpr, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
}
void esc;
