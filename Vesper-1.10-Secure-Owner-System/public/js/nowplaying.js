// Full-screen Now Playing.
import { store, saveSettings, isLiked, proxied } from './store.js';
import { icon, esc, attr, fmtTime, artistLink, albumLink, providerName, hydrateIcons, menu } from './ui.js';
import { PRESETS } from './engine.js';

const MODES = [['minimal', 'Minimal'], ['ambient', 'Ambient'], ['immersive', 'Immersive'], ['visualizer', 'Visualizer'], ['lyrics', 'Lyrics']];

export class NowPlaying {
  constructor({ engine, queue, lyrics, actions }) {
    Object.assign(this, { engine, queue, lyrics, actions });
    this.el = document.getElementById('np');
    this.open = false; this.raf = 0; this.artUrl = null; this.nextSignature = ''; 
    this.el.innerHTML = `
      <div class="np-bg"><div class="layer"></div><div class="layer"></div></div>
      <canvas class="np-canvas"></canvas>
      <div class="np-inner"><div class="np-grab" aria-hidden="true"></div>
        <div class="np-top">
          <button class="icon-btn" data-act="np-close" aria-label="Close Now Playing">${icon('down')}</button>
          <div class="ctx" id="np-ctx"></div>
          <button class="text-btn" data-act="np-mode" id="np-mode-btn">Ambient</button>
        </div>
        <div class="np-stage" id="np-stage">
          <div class="np-art" id="np-art"><img alt=""><img alt=""></div>
          <div class="np-lyrics" id="np-lyrics" hidden></div>
        </div>
        <div class="np-bottom">
          <div class="np-meta"><div><div class="np-title" id="np-title"></div><div class="np-artist" id="np-artist"></div></div>
            <div class="np-actions"><button class="icon-btn" data-act="like-current" id="np-like" aria-label="Like">${icon('heart')}</button><button class="icon-btn" data-act="add-current-to-playlist" aria-label="Add to a playlist" title="Add to playlist">${icon('plus')}</button><button class="icon-btn" data-act="feedback-more-current" aria-label="More like this" title="More like this">${icon('radio')}</button><button class="icon-btn" data-act="feedback-less-current" aria-label="Less like this" title="Less like this">−</button><button class="icon-btn" data-act="np-track-menu" aria-label="More options">${icon('more')}</button></div></div>
          <div class="np-progress"><span class="time" id="np-pos">0:00</span><input type="range" class="seek" id="np-seek" min="0" max="1000" value="0" aria-label="Seek"><span class="time" id="np-dur">0:00</span></div>
          <div class="np-next-preview" id="np-next-preview" hidden aria-live="polite"></div>
          <div class="np-row">
            <button class="icon-btn" data-act="shuffle" id="np-shuffle" aria-label="Shuffle">${icon('shuffle')}</button>
            <button class="icon-btn" data-act="prev" aria-label="Previous">${icon('prev')}</button>
            <button class="play-btn" data-act="toggle" id="np-play" aria-label="Play">${icon('play')}</button>
            <button class="icon-btn" data-act="next" aria-label="Next">${icon('next')}</button>
            <button class="icon-btn" data-act="repeat" id="np-repeat" aria-label="Repeat">${icon('repeat')}</button>
          </div>
          <div class="np-tools">
            <button class="text-btn" data-act="speed-menu" id="np-speed">1×</button>
            <button class="text-btn" data-act="transition-menu" id="np-trans">Smooth</button>
            <button class="text-btn np-tool" data-act="np-lyrics-toggle" aria-label="Lyrics">${icon('lyrics')}<span>Lyrics</span></button>
            <button class="text-btn np-tool" data-act="output-menu" aria-label="Audio output">${icon('headphones')}<span>Output</span></button>
            <button class="text-btn np-tool" data-act="np-queue" aria-label="Up next">${icon('queue')}<span>Up next</span></button>
            <button class="text-btn np-tool" data-act="audio-panel" aria-label="Equalizer">${icon('eq')}<span>Equalizer</span></button>
          </div>
          <div class="np-transition" id="np-transition" aria-live="polite"></div>
        </div>
      </div>`;
    this.$ = (id) => this.el.querySelector(`#${id}`);
    this.layers = [...this.el.querySelectorAll('.np-bg .layer')];
    this.arts = [...this.el.querySelectorAll('#np-art img')];
    this.canvas = this.el.querySelector('canvas');
    this.lyricsDetach = this.lyrics.attach(this.$('np-lyrics'));
    const seek = this.$('np-seek');
    seek.addEventListener('input', () => { this.scrubbing = true; this.$('np-pos').textContent = fmtTime((seek.value / 1000) * this.engine.duration); seek.style.setProperty('--fill', `${seek.value / 10}%`); });
    seek.addEventListener('change', () => { this.engine.seek((seek.value / 1000) * this.engine.duration); this.scrubbing = false; });
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); });
    document.addEventListener('visibilitychange', () => this.loop());
    // Swipe down to close on touch screens.
    let y0 = null, dy = 0;
    this.el.addEventListener('touchstart', (e) => { if (e.target.closest('input, .np-lyrics, .np-tools')) return; y0 = e.touches[0].clientY; dy = 0; this.el.classList.add('dragging'); this.el.classList.remove('settle'); }, { passive: true });
    this.el.addEventListener('touchmove', (e) => { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); this.el.style.transform = `translateY(${dy}px)`; }, { passive: true });
    this.el.addEventListener('touchend', () => { if (y0 === null) return; y0 = null; this.el.classList.remove('dragging'); this.el.classList.add('settle'); if (dy > 110) { this.el.style.transform = `translateY(100%)`; setTimeout(() => { this.el.classList.remove('settle'); this.el.hidden = true; this.open = false; this.el.style.transform = ''; }, 260); } else this.el.style.transform = ''; });
  }
  get mode() { return store.settings.artworkMode || 'ambient'; }

  show() {
    if (this.open) return;
    const go = () => { this.el.hidden = false; this.el.style.transform = ''; this.open = true; this.render(); this.loop(); this.el.querySelector('[data-act="np-close"]').focus(); };
    if (document.startViewTransition && !this.reduced()) document.startViewTransition(go);
    else { go(); if (!this.reduced()) { this.el.classList.remove('anim-in'); void this.el.offsetWidth; this.el.classList.add('anim-in'); } }
  }
  hide() {
    if (!this.open) return;
    const go = () => { this.el.hidden = true; this.open = false; cancelAnimationFrame(this.raf); this.raf = 0; };
    if (document.startViewTransition && !this.reduced()) document.startViewTransition(go); else go();
    document.querySelector('[data-act="np-open"]')?.focus();
  }
  reduced() { const m = store.settings.reducedMotion; return m === 'on' || (m !== 'off' && matchMedia('(prefers-reduced-motion: reduce)').matches); }

  setTrack(track) {
    const art = track?.albumArtwork || track?.artworkSmall || track?.artwork || null;
    if (art === this.artUrl) return;
    this.artUrl = art;
    const [a, b] = this.arts[0].classList.contains('on') ? this.arts : [this.arts[1], this.arts[0]];
    if (art) { b.onload = () => { b.classList.add('on'); a.classList.remove('on'); }; b.src = art; } else { a.classList.remove('on'); b.classList.remove('on'); }
    const [la, lb] = this.layers[0].classList.contains('on') ? this.layers : [this.layers[1], this.layers[0]];
    lb.style.backgroundImage = art ? `url("${proxied(art)}")` : 'none'; lb.classList.add('on'); la.classList.remove('on');
  }
  render() {
    const s = this.engine.state, t = s.track;
    this.el.dataset.mode = this.mode;
    this.el.classList.toggle('yt', t?.provider === 'youtube' && this.engine.external);
    this.el.classList.toggle('playing', s.status === 'playing');
    this.$('np-mode-btn').textContent = MODES.find((m) => m[0] === this.mode)?.[1] || 'Ambient';
    const lyr = this.mode === 'lyrics';
    this.$('np-lyrics').hidden = !lyr;
    if (!t) { this.$('np-title').textContent = 'Nothing playing'; this.$('np-artist').textContent = ''; return; }
    this.setTrack(t);
    this.$('np-title').textContent = t.title;
    this.$('np-artist').innerHTML = `<span>${[artistLink(t), albumLink(t)].filter(Boolean).join(', ')}</span><span class="note">${esc(providerName(t.provider))}${t.bpm > 0 ? ` · ${Math.round(t.bpm)} BPM${t.bpmSource ? ' · detected' : ''}` : (this.engine.trackCaps?.graph ? ' · BPM analysing…' : '')}</span>`;
    const ctx = this.queue.context?.name;
    this.$('np-ctx').textContent = ctx ? `Playing from ${ctx}` : '';
    const liked = isLiked(t.id);
    const lk = this.$('np-like'); lk.innerHTML = icon(liked ? 'heartFill' : 'heart'); lk.classList.toggle('liked', liked); lk.setAttribute('aria-label', liked ? 'Remove from Liked Songs' : 'Add to Liked Songs');
    this.$('np-play').innerHTML = icon(s.status === 'playing' || s.status === 'buffering' ? 'pause' : 'play');
    this.$('np-play').setAttribute('aria-label', s.status === 'playing' ? 'Pause' : 'Play');
    this.$('np-play').classList.toggle('busy', s.status === 'loading' || s.status === 'buffering');
    this.$('np-shuffle').setAttribute('aria-pressed', String(this.queue.shuffle));
    this.$('np-repeat').innerHTML = icon(this.queue.repeat === 'one' ? 'repeatOne' : 'repeat');
    this.$('np-repeat').classList.toggle('on', this.queue.repeat !== 'off');
    this.$('np-speed').textContent = `${this.engine.settings.speed}×`;
    this.$('np-trans').textContent = `Transition: ${PRESETS[this.engine.settings.transition]?.label || 'Smooth'}`;
    const tr = s.transition;
    this.$('np-transition').textContent = tr ? `${tr.kind === 'seamless' ? 'Seamless join' : `${PRESETS[tr.preset]?.label} blend, ${tr.fade.toFixed(1)} s`}${tr.note ? ` (${tr.note})` : ''}${tr.tempo?.out && tr.tempo?.in ? `. Tempo ${Math.round(tr.tempo.out)} → ${Math.round(tr.tempo.in)} BPM${tr.tempo.compatible ? ', compatible' : ''}` : ''}` : (s.error || '');
    this.time();
    this.updateNextPreview();
    hydrateIcons(this.el);
  }
  time() {
    if (!this.open || this.scrubbing) return;
    const p = this.engine.position, d = this.engine.duration || 0;
    this.$('np-pos').textContent = fmtTime(p); this.$('np-dur').textContent = fmtTime(d);
    const v = d ? (p / d) * 1000 : 0; const sk = this.$('np-seek'); sk.value = v; sk.style.setProperty('--fill', `${v / 10}%`);
    this.updateNextPreview();
  }
  updateNextPreview() {
    const el = this.$('np-next-preview'); if (!el) return;
    const duration = this.engine.duration || 0; const remaining = duration - this.engine.position;
    const next = this.queue.upcoming();
    const visible = !!next && this.engine.state.status === 'playing' && remaining > 0 && remaining <= 20;
    el.hidden = !visible;
    if (!visible) { this.nextSignature = ''; return; }
    const signature = `${next.id}|${Math.floor(remaining)}|${next.title}`;
    // Refresh the countdown once per second and when the next track changes.
    if (this.nextSignature === signature) return;
    this.nextSignature = signature;
    const art = next.albumArtwork || next.artworkSmall || next.artwork || '';
    el.innerHTML = `<span class="np-next-kicker">UP NEXT · ${Math.ceil(remaining)}s left</span><span class="np-next-track">${art ? `<img src="${attr(art)}" alt="">` : ''}<span><b>${esc(next.title)}</b><small>${esc(next.artist || 'Unknown artist')}</small></span></span>`;
  }
  modeMenu(anchor) {
    const caps = this.engine.capabilities;
    menu(anchor, [
      { head: 'Artwork' },
      ...MODES.map(([k, label]) => ({ label, checked: this.mode === k, disabled: k === 'visualizer' && !caps.visualizer, title: 'Needs audio processing (Settings)', fn: () => saveSettings({ artworkMode: k }).then(() => { this.render(); this.loop(); const mini = document.getElementById('p-ambience'); if (mini) mini.textContent = label; }) })),
      { note: 'Motion is generated from the cover image. Official animated covers aren’t available from these music sources.' },
    ]);
  }

  // Animation loop runs only while visible, not hidden by the OS, and when motion is allowed.
  loop() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    const ctx = this.canvas.getContext('2d');
    const W = () => (this.canvas.width = this.canvas.clientWidth * devicePixelRatio), H = () => (this.canvas.height = this.canvas.clientHeight * devicePixelRatio);
    W(); H(); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.open || document.hidden || this.reduced()) return;
    const viz = this.mode === 'visualizer' && this.engine.capabilities.visualizer;
    const parts = this.mode === 'immersive' ? Array.from({ length: 34 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8, v: 0.00012 + Math.random() * 0.0004, a: 0.15 + Math.random() * 0.35 })) : [];
    if (!viz && !parts.length) return;
    const data = new Uint8Array(256);
    const draw = () => {
      if (!this.open || document.hidden) { this.raf = 0; return; }
      const w = this.canvas.width, h = this.canvas.height;
      if (w !== this.canvas.clientWidth * devicePixelRatio) W();
      ctx.clearRect(0, 0, w, h);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--art-accent').trim() || '#C7B6FF';
      if (viz) {
        this.engine.frequencyData(data);
        const art = this.$('np-art').getBoundingClientRect(), cr = this.canvas.getBoundingClientRect();
        const cx = (art.left + art.width / 2 - cr.left) * devicePixelRatio, cy = (art.top + art.height / 2 - cr.top) * devicePixelRatio;
        const R = (art.width / 2) * devicePixelRatio * 1.04, k = Number(store.settings.visualizerIntensity ?? 0.6);
        const bins = 96;
        ctx.strokeStyle = accent; ctx.lineCap = 'round'; ctx.lineWidth = 3 * devicePixelRatio;
        for (let i = 0; i < bins; i++) {
          const v = data[Math.floor(2 + (i / bins) ** 1.4 * 150)] / 255;
          const len = (6 + v * v * 90 * k) * devicePixelRatio;
          const ang = (i / bins) * Math.PI * 2 - Math.PI / 2;
          ctx.globalAlpha = 0.25 + v * 0.7;
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); ctx.lineTo(cx + Math.cos(ang) * (R + len), cy + Math.sin(ang) * (R + len)); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      for (const p of parts) {
        p.y -= p.v * (this.engine.paused ? 0.2 : 1); if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        ctx.globalAlpha = p.a; ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(p.x * w, p.y * h, p.r * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  }
}
export { MODES };
void attr;
