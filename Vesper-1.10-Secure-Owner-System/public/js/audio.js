// Audio settings dialog: 10-band EQ, Bass/Mid/Treble, presets, leveling, live spectrum.
import { store, saveSettings } from './store.js';
import { esc, attr, toast, formDialog, confirmDialog } from './ui.js';
import { BANDS, BAND_LABELS, PRESETS, effectiveGains } from './eq.js';

export function openAudioPanel(engine) {
  const d = document.getElementById('audio-dialog');
  const caps = engine.capabilities;
  let eq = structuredClone(store.settings.eq || { enabled: false, preset: 'flat', bands: BANDS.map(() => 0), bass: 0, mid: 0, treble: 0 });
  let userPresets = structuredClone(store.settings.eqPresets || []);
  let raf = 0, saveT = 0;
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => saveSettings({ eq }).catch((e) => toast(e.message, { error: true })), 300); };
  const apply = () => { engine.setEQ(eq); persist(); drawStatic(); };
  const fmt = (v) => `${v > 0 ? '+' : ''}${Number(v).toFixed(1).replace('.0', '')}`;

  function render() {
    const presetChips = [...Object.entries(PRESETS).map(([k, p]) => [k, p.label]), ...userPresets.map((p) => [`user:${p.id}`, p.name]), ['custom', 'Custom']];
    const isUser = eq.preset.startsWith('user:');
    d.innerHTML = `<div class="audio-head"><h2 style="margin:0">Audio</h2><button class="icon-btn" data-a="close" aria-label="Close">✕</button></div>
      ${caps.eq ? '' : `<div class="notice">${esc(caps.reason || 'Audio processing is off.')} The equalizer, leveling and spectrum need it.</div>`}
      <div id="eq-wrap" class="${!caps.eq ? 'eq-disabled' : eq.enabled ? '' : 'eq-off'}">
        <div class="setting" style="padding-top:4px"><div class="s-text"><div class="s-title">Equalizer</div><div class="s-desc">Shapes the sound of everything Vesper plays through its own audio engine. Choosing a preset or moving a slider turns it on.</div></div><label class="switch"><input type="checkbox" data-a="enabled" ${eq.enabled ? 'checked' : ''} ${caps.eq ? '' : 'disabled'} aria-label="Equalizer on"></label></div>
        <canvas class="eq-graph" id="eq-graph" aria-label="Equalizer curve and live spectrum" role="img"></canvas>
        <div class="chips eq-presets" role="radiogroup" aria-label="Presets">${presetChips.map(([k, l]) => `<button class="chip" role="radio" data-preset="${attr(k)}" aria-checked="${eq.preset === k}" aria-pressed="${eq.preset === k}">${esc(l)}</button>`).join('')}</div>
        <div class="eq-bands">${BANDS.map((f, i) => `<label class="eq-band"><span class="db" id="db${i}">${fmt(eq.bands[i])}</span><input type="range" min="-12" max="12" step="0.5" value="${eq.bands[i]}" data-band="${i}" aria-label="${BAND_LABELS[i]} hertz band, decibels"><span>${BAND_LABELS[i]}</span></label>`).join('')}</div>
        <div class="eq-macros">${['bass', 'mid', 'treble'].map((k) => `<label for="m-${k}">${k === 'mid' ? 'Midrange' : k[0].toUpperCase() + k.slice(1)}</label><input id="m-${k}" type="range" min="-12" max="12" step="0.5" value="${eq[k]}" data-macro="${k}"><output id="o-${k}">${fmt(eq[k])} dB</output>`).join('')}</div>
        <div class="actions"><button class="btn sm ghost" data-a="save">Save as preset</button>${isUser ? '<button class="btn sm ghost" data-a="rename">Rename</button><button class="btn sm ghost" data-a="delete">Delete preset</button>' : ''}<button class="btn sm ghost" data-a="reset">Reset</button></div>
      </div>
      <div class="setting"><div class="s-text"><div class="s-title">Volume leveling</div><div class="s-desc">Evens out loudness between songs (−9 to +6 dB). A limiter always guards against clipping, including when the equalizer boosts.</div></div><label class="switch"><input type="checkbox" data-a="leveling" ${store.settings.leveling ? 'checked' : ''} ${caps.leveling ? '' : 'disabled'} aria-label="Volume leveling"></label></div>
      <p class="source-note">Applies to Jamendo tracks, your own files, previews and test signals. YouTube videos play inside YouTube’s own player, so Vesper can’t process them.</p>`;
    loop();
  }
  function drawStatic(spec) {
    const c = d.querySelector('#eq-graph'); if (!c) return;
    const W = c.width = c.clientWidth * devicePixelRatio, H = c.height = c.clientHeight * devicePixelRatio, x = c.getContext('2d');
    x.clearRect(0, 0, W, H);
    const fx = (f) => (Math.log10(f / 20) / Math.log10(20000 / 20)) * W, y = (db) => H / 2 - (db / 12) * (H / 2 - 8);
    if (spec) { // live spectrum behind the curve
      const sr = engine.ctx.sampleRate, n = spec.length;
      x.fillStyle = 'rgba(255,255,255,.10)';
      for (let i = 2; i < n; i++) { const f = (i * sr) / (2 * n); if (f < 20 || f > 20000) continue; const h = (spec[i] / 255) * H; x.fillRect(fx(f), H - h, Math.max(1, fx((i + 1) * sr / (2 * n)) - fx(f)), h); }
    }
    x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W, H / 2); x.stroke();
    const freqs = Array.from({ length: 160 }, (_, i) => 20 * (1000 ** (i / 159)));
    const resp = engine.eqResponse(freqs) || (() => { const g = effectiveGains(eq); return freqs.map((f) => { let k = 0; for (let i = 1; i < BANDS.length; i++) if (f >= BANDS[i]) k = i; return g[k]; }); })();
    x.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#C7B6FF'; x.lineWidth = 2.5 * devicePixelRatio; x.beginPath();
    freqs.forEach((f, i) => { const yy = y(Math.max(-12, Math.min(12, resp[i]))); i ? x.lineTo(fx(f), yy) : x.moveTo(fx(f), yy); }); x.stroke();
  }
  const reduced = () => store.settings.reducedMotion === 'on' || (store.settings.reducedMotion !== 'off' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function loop() {
    cancelAnimationFrame(raf);
    if (!d.open || !caps.eq || reduced() || document.hidden) { drawStatic(); return; }
    const spec = new Uint8Array(engine.analyser.frequencyBinCount);
    const tick = () => { if (!d.open) return; engine.frequencyData(spec); drawStatic(spec); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  }
  // Adjusting anything turns the equalizer on (without re-rendering mid-drag).
  const ensureOn = () => { if (!eq.enabled && caps.eq) { eq.enabled = true; d.querySelector('#eq-wrap').className = ''; const sw = d.querySelector('[data-a="enabled"]'); if (sw) sw.checked = true; } };
  d.oninput = (e) => {
    const b = e.target.dataset.band, m = e.target.dataset.macro;
    if (b !== undefined || m) ensureOn();
    if (b !== undefined) { eq.bands[b] = Number(e.target.value); d.querySelector(`#db${b}`).textContent = fmt(eq.bands[b]); if (eq.preset !== 'custom') { eq.preset = 'custom'; d.querySelectorAll('[data-preset]').forEach((x) => { x.setAttribute('aria-checked', String(x.dataset.preset === 'custom')); x.setAttribute('aria-pressed', String(x.dataset.preset === 'custom')); }); } apply(); }
    if (m) { eq[m] = Number(e.target.value); d.querySelector(`#o-${m}`).textContent = `${fmt(eq[m])} dB`; apply(); }
  };
  d.onchange = async (e) => {
    const a = e.target.dataset.a;
    if (a === 'enabled') { eq.enabled = e.target.checked; apply(); render(); }
    if (a === 'leveling') saveSettings({ leveling: e.target.checked }).catch((err) => toast(err.message, { error: true }));
  };
  d.onclick = async (e) => {
    const p = e.target.closest('[data-preset]');
    if (p) {
      const k = p.dataset.preset;
      if (k.startsWith('user:')) eq.bands = [...userPresets.find((u) => `user:${u.id}` === k).bands];
      else if (PRESETS[k]) eq.bands = [...PRESETS[k].bands];
      eq.preset = k; if (!eq.enabled && caps.eq) eq.enabled = true; apply(); render(); return;
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    try {
      if (a === 'close') d.close();
      if (a === 'reset') { eq = { ...eq, preset: 'flat', bands: BANDS.map(() => 0), bass: 0, mid: 0, treble: 0 }; apply(); render(); }
      if (a === 'save') {
        d.close();
        const v = await formDialog('Save equalizer preset', [{ name: 'name', label: 'Preset name', required: true, value: '' }], 'Save preset');
        if (v?.name?.trim()) { const id = Math.random().toString(36).slice(2, 10); userPresets.push({ id, name: v.name.trim().slice(0, 30), bands: [...eq.bands] }); eq.preset = `user:${id}`; await saveSettings({ eqPresets: userPresets, eq }); toast(`Saved “${v.name.trim()}”`); }
        d.showModal(); render();
      }
      if (a === 'rename') {
        const cur = userPresets.find((u) => `user:${u.id}` === eq.preset); d.close();
        const v = await formDialog('Rename preset', [{ name: 'name', label: 'Preset name', required: true, value: cur.name }], 'Rename');
        if (v?.name?.trim()) { cur.name = v.name.trim().slice(0, 30); await saveSettings({ eqPresets: userPresets }); }
        d.showModal(); render();
      }
      if (a === 'delete') {
        const cur = userPresets.find((u) => `user:${u.id}` === eq.preset); d.close();
        if (await confirmDialog('Delete preset?', `“${cur.name}” will be removed.`, 'Delete')) { userPresets = userPresets.filter((u) => u !== cur); eq.preset = 'custom'; await saveSettings({ eqPresets: userPresets, eq }); }
        d.showModal(); render();
      }
    } catch (err) { toast(err.message, { error: true }); }
  };
  d.onclose = () => cancelAnimationFrame(raf);
  d.showModal(); render();
}
