// Lyrics: fetch once per track, render into any number of containers, keep the current line in sync.
import { api } from './store.js';
import { esc } from './ui.js';
import { parseLRC } from './lrc.js';
export { parseLRC };

export class Lyrics {
  constructor(engine) {
    this.e = engine; this.track = null; this.state = { kind: 'idle' }; this.views = new Set(); this.idx = -1; this.userScroll = 0; this.fontSize = Number(localStorage.getItem('vesper.lyricsSize')) || 1; this.fullscreen = false; this.picking = false; this.picked = new Set();
    engine.addEventListener('time', () => this.sync());
    engine.addEventListener('position', () => this.sync(true));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('lyrics-fullscreen')) { document.body.classList.remove('lyrics-fullscreen'); this.fullscreen = false; } });
  }
  async load(track) {
    if (!track || (track.id === this.track?.id && !track._lyricsAlternate)) return;
    this.track = track; this.idx = -1; this.picking = false; this.picked.clear();
    this.state = { kind: 'loading' }; this.renderAll();
    const q = new URLSearchParams({ title: track.title || '', artist: track.artist || '', album: track.album || '', duration: track.sourceDuration || track.duration || '' });
    try {
      const r = await api(`/lyrics/${encodeURIComponent(track.id)}?${q}${track._lyricsAlternate ? '&alternate=1' : ''}`);
      if (this.track !== track) return;
      if (r.instrumental) this.state = { kind: 'instrumental', source: r.source };
      else if (r.unavailable) {
        this.state = { kind: 'none', reason: r.reason };
        // A lyrics service was down: quietly try again in a bit while the song plays.
        if (/reached|again/i.test(r.reason || '') && !track._lyricsRetry) setTimeout(() => { if (this.track === track) { this.track = null; this.load({ ...track, _lyricsRetry: true }); } }, 20000);
      }
      else if (r.synced && !track.preview) this.state = { kind: 'synced', lines: parseLRC(r.synced), source: r.source };
      else {
        const plain = r.plain || (r.synced ? parseLRC(r.synced).map((l) => l.text).join('\n') : '');
        this.state = { kind: 'plain', text: plain, source: r.source, previewNote: null };
      }
    } catch (e) { if (this.track === track) this.state = { kind: 'none', reason: e.message }; }
    this.renderAll();
  }
  attach(el) {
    el.classList.add('lyrics-host');
    this.views.add(el); this.render(el);
    el.addEventListener('wheel', () => { this.userScroll = Date.now(); }, { passive: true });
    el.addEventListener('touchmove', () => { this.userScroll = Date.now(); }, { passive: true });
    el.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-lyrics-act]'); if (!b) return;
      const act = b.dataset.lyricsAct;
      if (act === 'smaller' || act === 'larger') {
        this.fontSize = Math.max(.75, Math.min(1.6, this.fontSize + (act === 'larger' ? .1 : -.1)));
        localStorage.setItem('vesper.lyricsSize', String(this.fontSize)); this.applyFontSize();
      } else if (act === 'current') { this.userScroll = 0; this.sync(true); }
      else if (act === 'fullscreen') { document.body.classList.toggle('lyrics-fullscreen'); this.fullscreen = document.body.classList.contains('lyrics-fullscreen'); b.setAttribute('aria-pressed', String(this.fullscreen)); }
      else if (act === 'share') { this.picking = true; this.picked.clear(); if (this.state.kind === 'synced' && this.idx >= 0 && this.state.lines[this.idx]?.text) this.picked.add(this.idx); this.renderAll(); }
      else if (act === 'pick-cancel') { this.picking = false; this.picked.clear(); this.renderAll(); }
      else if (act === 'pick-share') this.shareCard();
    });
    return () => { el.classList.remove('lyrics-host'); this.views.delete(el); if (!this.views.size && this.fullscreen) { document.body.classList.remove('lyrics-fullscreen'); this.fullscreen = false; } };
  }
  applyFontSize() { for (const el of this.views) el.style.setProperty('--lyrics-scale', String(this.fontSize)); }
  renderAll() { for (const el of this.views) { if (!el.isConnected) this.views.delete(el); else this.render(el); } }
  render(el) {
    const s = this.state;
    if (!this.track) { el.innerHTML = '<div class="empty"><h2>Lyrics</h2><p>Play a song to see its lyrics here.</p></div>'; return; }
    if (s.kind === 'loading') { el.innerHTML = '<div class="lyrics-loading"><div class="lyrics-pulse"></div><p>Finding lyrics for this track…</p></div>'; return; }
    if (s.kind === 'none') { el.innerHTML = `<div class="lyrics-empty"><div class="lyrics-empty-mark">♫</div><h2>Lyrics not found</h2><p>${esc(s.reason || 'No matching lyrics were found for this song.')}</p></div>`; return; }
    if (s.kind === 'instrumental') { el.innerHTML = '<div class="lyrics-empty"><div class="lyrics-empty-mark">♪</div><h2>Instrumental</h2><p>This track appears to have no vocals.</p></div>'; return; }
    if (s.kind === 'plain') {
      el.innerHTML = `${this.toolbar()}<div class="lyrics-scroll"><div class="lyrics plain${this.picking ? ' picking' : ''}">${s.text.split('\n').map((l, i) => `<div class="line${l.trim() ? '' : ' gap'}${this.picked.has(i) ? ' picked' : ''}" data-pi="${i}">${esc(l)}</div>`).join('')}</div><p class="lyrics-meta">Lyrics: ${esc(s.source)}</p></div>`; this.applyFontSize();
      el.querySelector('.lyrics').addEventListener('click', (ev) => { if (!this.picking) return; const ln = ev.target.closest('.line[data-pi]'); if (ln && ln.textContent.trim()) this.togglePick(Number(ln.dataset.pi)); });
      return;
    }
    const wordLevel = s.lines.some((l) => l.words);
    el.innerHTML = `${this.toolbar()}<div class="lyrics-scroll"><div class="lyrics synced${wordLevel ? ' word-level' : ''}${this.picking ? ' picking' : ''}">${s.lines.map((l, i) => `<div class="line${l.text ? '' : ' gap'}${this.picked.has(i) ? ' picked' : ''}" data-i="${i}" data-t="${l.t}">${l.words ? l.words.map((w, k) => `<span class="w" data-wt="${w.t}">${esc(w.text.trim())}</span>${k < l.words.length - 1 ? ' ' : ''}`).join('') : (esc(l.text) || '♪')}</div>`).join('')}</div><p class="lyrics-meta">Lyrics: ${esc(s.source)}</p></div>`;
    el.querySelector('.lyrics').addEventListener('click', (ev) => {
      const ln = ev.target.closest('.line[data-t]'); if (!ln) return;
      if (this.picking) { if (ln.textContent.trim() && ln.textContent.trim() !== '♪') this.togglePick(Number(ln.dataset.i)); return; }
      this.e.seek(Number(ln.dataset.t)); this.userScroll = 0;
    });
    this.applyFontSize(); this.idx = -1; this.sync(true);
  }
  toolbar() {
    if (this.picking) return `<div class="lyrics-toolbar picking"><div class="lyrics-brand"><b>Pick up to 4 lines</b><small>${this.picked.size ? `${this.picked.size} selected` : 'Tap the lines to put on the card'}</small></div><div class="lyrics-actions"><button type="button" data-lyrics-act="pick-cancel">Cancel</button><button type="button" class="primary" data-lyrics-act="pick-share" ${this.picked.size ? '' : 'disabled'}>Share card</button></div></div>`;
    return `<div class="lyrics-toolbar"><div class="lyrics-brand"><b>Lyrics</b></div><div class="lyrics-actions"><button type="button" data-lyrics-act="share" title="Share lyrics as an image" aria-label="Share lyrics as an image">Share</button><button type="button" data-lyrics-act="smaller" title="Smaller lyrics" aria-label="Smaller lyrics">A−</button><button type="button" data-lyrics-act="larger" title="Larger lyrics" aria-label="Larger lyrics">A+</button></div></div>`;
  }
  lineTexts() { return this.state.kind === 'synced' ? this.state.lines.map((l) => l.text) : this.state.kind === 'plain' ? this.state.text.split('\n') : []; }
  async shareCard() {
    const texts = this.lineTexts(), chosen = [...this.picked].sort((a, b) => a - b).map((i) => texts[i]).filter((x) => x && x.trim());
    this.picking = false; this.picked.clear(); this.renderAll();
    if (!chosen.length || !this.track) return;
    const t = this.track;
    try { const { shareCard } = await import('./share.js'); await shareCard({ kind: 'lyric', lyricLines: chosen, title: t.title, subtitle: t.artist, art: t.albumArtwork || t.artwork }); }
    catch (e) { const { toast } = await import('./ui.js'); toast?.(e.message || 'Couldn’t create the card.'); }
  }
  togglePick(i) {
    if (this.picked.has(i)) this.picked.delete(i); else if (this.picked.size < 4) this.picked.add(i);
    for (const el of this.views) {
      el.querySelectorAll(`.line[data-i="${i}"], .line[data-pi="${i}"]`).forEach((ln) => ln.classList.toggle('picked', this.picked.has(i)));
      const tb = el.querySelector('.lyrics-toolbar.picking'); if (tb) tb.outerHTML = this.toolbar();
    }
  }
  sync(force = false) {
    if (this.picking) return; // keep the list still while choosing lines
    if (this.state.kind !== 'synced' || this.e.state.track?.id !== this.track?.id) return;
    const t = this.e.position + 0.15, L = this.state.lines;
    let lo = 0, hi = L.length - 1, i = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (L[m].t <= t) { i = m; lo = m + 1; } else hi = m - 1; }
    // Word-level highlight inside the current line (only when the source has word timestamps).
    if (L[i]?.words) for (const el of this.views) el.querySelectorAll(`.line[data-i="${i}"] .w`).forEach((w) => w.classList.toggle('sung', Number(w.dataset.wt) <= t));
    if (i === this.idx && !force) return;
    this.idx = i;
    for (const el of this.views) {
      if (!el.isConnected) continue;
      el.querySelectorAll('.line[data-i]').forEach((ln) => { const k = Number(ln.dataset.i); ln.classList.toggle('now', k === i); ln.classList.toggle('past', k < i); ln.classList.toggle('next', k === i + 1); if (k !== i) ln.querySelectorAll('.w.sung').forEach((w) => w.classList.toggle('sung', k < i)); });
      const cur = el.querySelector(`.line[data-i="${i}"]`);
      if (cur && Date.now() - this.userScroll > 3500) {
        const box = el.querySelector('.lyrics-scroll') || el;
        const top = cur.offsetTop - box.clientHeight * 0.38;
        box.scrollTo({ top, behavior: force || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    }
  }
}
