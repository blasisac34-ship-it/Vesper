// Sends "Listening to" status to Discord through the desktop app. Does nothing in a browser.
import { store, on } from './store.js';

export function initDiscord(engine) {
  const bridge = window.vesperDesktop?.discord; if (!bridge) return;
  let enabled = false, last = '';
  const apply = () => {
    const want = !!store.settings?.discordPresence;
    if (want !== enabled) { enabled = want; bridge.enable(want).catch(() => {}); last = ''; }
    if (enabled) update();
  };
  const update = () => {
    if (!enabled) return;
    const s = engine.state, t = s.track;
    const playing = t && ['playing', 'buffering'].includes(s.status) && !t.isTest;
    if (!playing) { if (last !== 'clear') { last = 'clear'; bridge.clear(); } return; }
    const dur = engine.duration || t.duration || 0, rate = engine.rate || 1;
    const start = Date.now() - (engine.position || 0) * 1000 / rate;
    const key = `${t.id}|${Math.round(start / 3000)}`; // only resend when the song or position really changes
    if (key === last) return;
    last = key;
    bridge.set({ title: t.title, artist: t.artist, album: t.album || '', artwork: t.albumArtwork || t.artwork || '', start, end: dur ? start + dur * 1000 / rate : 0 });
  };
  engine.addEventListener('state', update);
  engine.addEventListener('position', () => { last = ''; update(); });
  on((what) => { if (what === 'settings' || what === 'user') apply(); });
  apply();
}
