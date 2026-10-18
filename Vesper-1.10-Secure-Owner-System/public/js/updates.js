// Update notes and live updates. The version and its notes come from the server, so every device
// (phones, desktop app, browsers) shows "What's new" once per person, then marks it seen.
import { api } from './store.js';
import { esc, toast } from './ui.js';

let loadedVersion = null;
export async function initUpdates(engine) {
  try {
    const v = await api('/version');
    loadedVersion = v.version;
    if (v.unseen?.length) showWhatsNew(v);
  } catch { /* offline: try again later */ }
  // Notice when the server has been updated while the app is open.
  const check = async () => {
    if (document.hidden) return;
    try {
      const v = await api('/version');
      if (loadedVersion && v.version !== loadedVersion) {
        loadedVersion = v.version;
        navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
        if (engine.paused) location.reload(); // nothing playing: just load the new version
        else toast(`Vesper ${v.version} is ready.`, { action: { label: 'Refresh', fn: () => location.reload() }, ms: 15000 });
      }
    } catch { /* ignore */ }
  };
  setInterval(check, 10 * 60_000);
  document.addEventListener('visibilitychange', check);
}
function showWhatsNew(v) {
  const d = document.createElement('dialog'); d.className = 'whatsnew';
  const entries = v.unseen.slice(0, 5);
  d.innerHTML = `<form method="dialog"><h2>What’s new in Vesper ${esc(v.version)}</h2>
    ${entries.map((e) => `${entries.length > 1 ? `<h3>${esc(e.title || `Vesper ${e.version}`)}</h3>` : ''}<ul>${(e.changes || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`).join('')}
    <p class="note">Your playlists, likes and history are kept with every update.</p>
    <div class="actions"><button class="btn primary" value="ok">Got it</button></div></form>`;
  document.body.append(d);
  d.addEventListener('close', () => { d.remove(); api('/me/seen-version', { method: 'POST', body: {} }).catch(() => {}); });
  d.showModal();
}
