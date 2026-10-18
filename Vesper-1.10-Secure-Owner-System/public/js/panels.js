// Right panel: Up Next and Lyrics.
import { store } from './store.js';
import { esc, attr, icon, registerList, hydrateIcons } from './ui.js';

const AUTO_MODES = [['same', 'Same vibe'], ['calmer', 'Calmer'], ['upbeat', 'More upbeat'], ['explore', 'Something new']];

export class Panel {
  constructor({ queue, engine, lyrics, shell }) {
    Object.assign(this, { queue, engine, lyrics, shell });
    this.body = document.getElementById('panel-body');
    this.body.style.position = 'relative';
    this.tab = localStorage.getItem('vesper.panelTab') || 'queue';
    this.detachLyrics = null;
    queue.addEventListener('change', () => { if (this.tab === 'queue') this.render(); });
    this.body.addEventListener('click', (e) => this.onClick(e));
    this.initDrag();
  }
  show(tab) {
    if (tab) this.tab = tab;
    localStorage.setItem('vesper.panelTab', this.tab);
    this.shell.classList.remove('panel-hidden'); this.shell.classList.add('panel-open');
    localStorage.setItem('vesper.panel', 'open');
    this.render();
  }
  hide() { this.shell.classList.add('panel-hidden'); this.shell.classList.remove('panel-open'); localStorage.setItem('vesper.panel', 'hidden'); }
  get visible() { return !this.shell.classList.contains('panel-hidden') && (this.shell.classList.contains('panel-open') || matchMedia('(min-width: 1181px)').matches); }
  render() {
    document.querySelectorAll('.panel-tabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === this.tab)));
    this.detachLyrics?.(); this.detachLyrics = null;
    if (this.tab === 'lyrics') { this.body.innerHTML = ''; this.detachLyrics = this.lyrics.attach(this.body); return; }
    const q = this.queue, cur = q.current;
    const listId = registerList(q.items.map((x) => x.track), { name: 'Up next', queue: true });
    const manual = q.items.map((x, i) => ({ ...x, i })).filter((x) => x.origin === 'manual');
    const ctx = q.items.map((x, i) => ({ ...x, i })).filter((x) => x.origin === 'context');
    const auto = q.items.map((x, i) => ({ ...x, i })).filter((x) => x.origin === 'auto');
    const item = (x) => `<div class="q-item" data-key="${attr(x.key)}" data-i="${x.i}" data-list="${listId}" data-idx="${x.i}" data-tid="${attr(x.track.id)}">
      <span class="drag" data-drag tabindex="0" role="button" aria-label="Reorder ${attr(x.track.title)}: drag, or use arrow keys" title="Drag to reorder">${icon('drag')}</span>
      <img src="${attr(x.track.artworkSmall || x.track.artwork || '')}" alt="" loading="lazy">
      <button style="text-align:left;min-width:0" data-q="jump" aria-label="Play ${attr(x.track.title)} now"><div class="r-title" style="font-size:14px">${esc(x.track.title)}</div><div class="r-sub" style="font-size:12.5px">${esc(x.track.artist)} </div></button>
      <button class="icon-btn" data-act="track-menu" aria-label="More options">${icon('more')}</button></div>`;
    let h = '';
    if (cur) h += `<div class="q-head">Now playing</div><div class="q-item current"><span></span><img src="${attr(cur.artworkSmall || cur.artwork || '')}" alt=""><div style="min-width:0"><div class="r-title" style="font-size:14px">${esc(cur.title)}</div><div class="r-sub" style="font-size:12.5px">${esc(cur.artist)}</div></div><span></span></div>`;
    else h += '<div class="empty" style="padding:24px 6px"><h2 style="font-size:20px">Nothing queued</h2><p>Play a song, or use “Add to queue” from any song’s menu.</p></div>';
    if (manual.length) h += `<div class="q-head"><span>Next in queue</span><button class="text-btn" data-q="clear">Clear</button></div>${manual.map(item).join('')}`;
    if (ctx.length) h += `<div class="q-head"><span>Next from ${esc(q.context?.name || 'this list')}</span>${manual.length ? '' : '<button class="text-btn" data-q="clear">Clear</button>'}</div>${ctx.map(item).join('')}`;
    const autoplay = store.settings.autoplay !== false;
    h += `<div class="q-head"><span>Autoplay</span><label class="switch" title="Autoplay"><input type="checkbox" data-q="autoplay" ${autoplay ? 'checked' : ''} aria-label="Autoplay similar songs"></label></div>`;
    if (autoplay) {
      h += `<div class="q-auto"><div class="chips" role="group" aria-label="Autoplay direction">${AUTO_MODES.map(([k, l]) => `<button class="chip" data-q="mode" data-mode="${k}" aria-pressed="${q.autoMode === k}">${l}</button>`).join('')}<button class="chip" data-q="regen">Refresh</button></div>${q.autoBusy ? '<span class="note">Finding songs…</span>' : ''}${q.autoNote ? `<span class="note">${esc(q.autoNote)}</span>` : ''}</div>`;
      h += auto.map(item).join('');
      if (auto.length) h += '<p class="source-note" style="padding:0 6px">Autoplay picks keep the feel of what you’ve been playing. Your own queue always plays first, and Refresh never removes songs you added.</p>';
    } else h += '<p class="note" style="padding:0 6px">When your queue ends, playback stops.</p>';
    if (q.history.length) h += `<div class="q-head">Recently played</div>${q.history.slice(-8).reverse().map((t) => `<div class="q-item" style="opacity:.7"><span></span><img src="${attr(t.artworkSmall || t.artwork || '')}" alt="" loading="lazy"><div style="min-width:0"><div class="r-title" style="font-size:14px">${esc(t.title)}</div><div class="r-sub" style="font-size:12.5px">${esc(t.artist)}</div></div><span></span></div>`).join('')}`;
    this.body.innerHTML = h;
    hydrateIcons(this.body);
  }
  async onClick(e) {
    const b = e.target.closest('[data-q]'); if (!b) return;
    const q = this.queue;
    if (b.dataset.q === 'jump') q.jump(b.closest('.q-item').dataset.key);
    if (b.dataset.q === 'clear') q.clear();
    if (b.dataset.q === 'mode') q.regenerate(b.dataset.mode);
    if (b.dataset.q === 'regen') q.regenerate();
    if (b.dataset.q === 'autoplay') { const { saveSettings } = await import('./store.js'); await saveSettings({ autoplay: b.checked }); if (b.checked) q.ensureAuto(true); else { q.items = q.items.filter((x) => x.origin !== 'auto'); q.changed(); } }
  }
  // Pointer-based drag so it works with mouse and touch.
  initDrag() {
    let drag = null;
    this.body.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('[data-drag]'); if (!h) return;
      const row = h.closest('.q-item'); e.preventDefault();
      drag = { row, from: Number(row.dataset.i), over: null };
      row.classList.add('dragging'); h.setPointerCapture(e.pointerId);
    });
    this.body.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.q-item[data-i]');
      this.body.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
      if (el && el !== drag.row) { el.classList.add('drop-before'); drag.over = Number(el.dataset.i); }
      const r = this.body.getBoundingClientRect();
      if (e.clientY < r.top + 40) this.body.scrollTop -= 8; else if (e.clientY > r.bottom - 40) this.body.scrollTop += 8;
    });
    const end = () => {
      if (!drag) return;
      const { from, over } = drag; drag.row.classList.remove('dragging'); drag = null;
      this.body.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
      if (over !== null && over !== from) this.queue.move(from, over > from ? over - 1 : over);
    };
    this.body.addEventListener('pointerup', end); this.body.addEventListener('pointercancel', end);
    // Keyboard reordering on the handle
    this.body.addEventListener('keydown', (e) => {
      const h = e.target.closest('[data-drag]'); if (!h || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); const i = Number(h.closest('.q-item').dataset.i); this.queue.move(i, i + (e.key === 'ArrowUp' ? -1 : 1));
      requestAnimationFrame(() => this.body.querySelector(`.q-item[data-i="${i + (e.key === 'ArrowUp' ? -1 : 1)}"] [data-drag]`)?.focus());
    });
  }
}
