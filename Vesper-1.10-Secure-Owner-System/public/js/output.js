// Audio-output control. Lists output devices the browser exposes and routes Vesper's audio where the
// browser allows it (AudioContext.setSinkId / HTMLMediaElement.setSinkId). A device is only reported
// as active after the browser confirms the switch.
import { menu, toast } from './ui.js';

const LS = 'vesper.outputDevice';
const clean = (l) => String(l || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*/i, '').replace(/^Default - /i, '').trim();
let confirmed = null; // { id, label } once the browser confirms routing

function canRoute(engine) {
  if (engine.graph && engine.ctx && typeof engine.ctx.setSinkId === 'function') return 'context';
  if (!engine.graph && typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype) return 'element';
  return null;
}
async function outputs() {
  const list = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => [])) || [];
  return list.filter((d) => d.kind === 'audiooutput');
}
async function route(engine, id, label) {
  const how = canRoute(engine);
  if (how === 'context') { await engine.ctx.setSinkId(id === 'default' ? '' : id); if ((engine.ctx.sinkId || 'default') !== (id === 'default' ? '' : id) && !(id === 'default' && engine.ctx.sinkId === '')) throw new Error('The browser did not confirm the switch.'); }
  else if (how === 'element') { for (const d of engine.decks) await d.el.setSinkId(id); if (engine.decks.some((d) => d.el.sinkId !== id)) throw new Error('The browser did not confirm the switch.'); }
  else throw new Error('unsupported');
  confirmed = { id, label }; localStorage.setItem(LS, JSON.stringify(confirmed)); updateButton();
  toast(`Vesper is now playing through ${label}.`);
}
export function updateButton() {
  const b = document.getElementById('p-output'); if (!b) return;
  const lbl = b.querySelector('.p-output-label');
  if (lbl) lbl.textContent = confirmed ? confirmed.label : 'Output';
  b.title = confirmed ? `Audio output: ${confirmed.label} (confirmed by the browser). Click to change.` : 'Audio output: choose headphones or speakers';
  b.setAttribute('aria-label', confirmed ? `Audio output: ${confirmed.label}` : 'Choose audio output');
}
const macHelp = 'To use headphones on a Mac: open Control Center (menu bar) → Sound, then choose your headphones. Vesper follows the system output.';
export async function openOutputMenu(anchor, engine) {
  engine.unlock?.();
  const how = canRoute(engine);
  let devs = await outputs();
  const labelled = devs.some((d) => d.label);
  const items = [{ head: 'Audio output' }];
  if (how && devs.length) {
    for (const d of devs) {
      const label = clean(d.label) || (d.deviceId === 'default' ? 'System default' : 'Unnamed output');
      items.push({ label: d.deviceId === 'default' ? `System default${d.label ? ` (${clean(d.label)})` : ''}` : label, checked: confirmed?.id === d.deviceId, fn: () => route(engine, d.deviceId, label).catch((e) => toast(e.message === 'unsupported' ? macHelp : `Couldn’t switch output: ${e.message}`, { error: e.message !== 'unsupported', ms: 6000 })) });
    }
    if (!labelled) items.push({ sep: true }, { label: 'Show device names…', fn: async () => {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); openOutputMenu(anchor, engine); }
      catch { toast('Device names stay hidden without microphone permission. Nothing is recorded; browsers only reveal device names after that permission.', { ms: 6500 }); }
    } }, { note: 'Your browser hides device names until you allow microphone access. Vesper stops the microphone immediately and never records.' });
  } else if (navigator.mediaDevices?.selectAudioOutput && how) {
    items.push({ label: 'Choose a device…', fn: async () => { try { const d = await navigator.mediaDevices.selectAudioOutput(); await route(engine, d.deviceId, clean(d.label) || 'Selected device'); } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message, { error: true }); } } });
  } else {
    items.push({ note: engine.external ? 'This video plays in YouTube’s player, which follows your system output.' : 'This browser doesn’t let websites choose an audio output.' }, { note: /iPhone|iPad/.test(navigator.userAgent) ? 'On iPhone: open Control Center, press and hold the music controls, then tap the AirPlay icon to choose headphones or a speaker.' : macHelp });
  }
  items.push({ sep: true }, { note: confirmed ? `Active in Vesper: ${confirmed.label} (confirmed).` : 'Vesper is using the system’s current output. Browsers may not reveal which device that is.' });
  if (how) items.push({ note: macHelp });
  menu(anchor, items);
}
// Re-apply a confirmed choice once audio is unlocked (only if that device still exists).
export async function restoreOutput(engine) {
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || 'null'); if (!saved || !canRoute(engine)) return updateButton();
    if ((await outputs()).some((d) => d.deviceId === saved.id)) await route(engine, saved.id, saved.label).catch(() => {});
  } catch { /* ignore */ }
  updateButton();
}
navigator.mediaDevices?.addEventListener?.('devicechange', async () => { if (confirmed && !(await outputs()).some((d) => d.deviceId === confirmed.id)) { confirmed = null; updateButton(); toast('Your selected audio output was disconnected. Vesper is using the system output.'); } });
