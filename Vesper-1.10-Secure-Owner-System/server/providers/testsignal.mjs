// Offline test catalog. These are synthesized test signals (pads + click track), NOT real songs.
// They exist so playback, transitions, BPM analysis and lyric sync can be tested with no network
// and no credentials. Disable with TEST_CATALOG=off.

export const info = {
  id: 'test', name: 'Test signals (offline)', fullTracks: true, needsKey: false,
  capabilities: ['search', 'full-playback', 'seek', 'speed', 'crossfade', 'synced-lyrics'],
  limitation: 'Synthesized test tones for checking the player. Not music.',
};
export const enabled = () => (process.env.TEST_CATALOG || 'on') !== 'off';

const DEFS = [
  { n: 1, bpm: 84, root: 220.0, hue: 248, dur: 42 },
  { n: 2, bpm: 100, root: 196.0, hue: 330, dur: 40 },
  { n: 3, bpm: 120, root: 246.9, hue: 28, dur: 44 },
  { n: 4, bpm: 128, root: 174.6, hue: 170, dur: 38 },
  { n: 5, bpm: 92, root: 207.7, hue: 205, dur: 41 },
  { n: 6, bpm: 140, root: 261.6, hue: 52, dur: 36 },
];
const LEAD_SILENCE = 0.6, TAIL_SILENCE = 0.8;

export const tracks = DEFS.map((d) => ({
  id: `ts:${d.n}`, provider: 'test',
  title: `Test signal ${d.n} (${d.bpm} BPM)`, artist: 'Vesper test signal', artistId: null,
  album: 'Test catalog', albumId: null,
  artwork: `/api/test/art/${d.n}.svg`, artworkSmall: `/api/test/art/${d.n}.svg`,
  duration: d.dur, preview: false, playableDuration: d.dur, playable: true, unplayableReason: null,
  explicit: false, genre: 'Test signal', bpm: d.bpm, releaseDate: null, isTest: true,
}));

const cache = new Map();
export function wav(n) {
  if (cache.has(n)) return cache.get(n);
  const d = DEFS.find((x) => x.n === Number(n));
  if (!d) return null;
  const sr = 22050, len = Math.round(d.dur * sr);
  const data = new Float32Array(len);
  const beat = 60 / d.bpm;
  const chord = [1, 1.25, 1.5, 2]; // major chord-ish intervals
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    if (t < LEAD_SILENCE || t > d.dur - TAIL_SILENCE) continue;
    const tt = t - LEAD_SILENCE;
    const bar = Math.floor(tt / (beat * 4)) % 4;
    const shift = [1, 0.8909, 0.7491, 0.8409][bar]; // simple progression
    let pad = 0;
    for (const c of chord) pad += Math.sin(2 * Math.PI * d.root * shift * c * t) * 0.07;
    const bt = tt % beat; // click/kick on every beat
    const kick = bt < 0.14 ? Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-bt * 40)) * bt) * Math.exp(-bt * 22) * 0.75 : 0;
    const hb = (tt + beat / 2) % beat;
    const hat = hb < 0.03 ? (Math.random() * 2 - 1) * Math.exp(-hb * 140) * 0.12 : 0;
    let env = 1;
    const playLen = d.dur - LEAD_SILENCE - TAIL_SILENCE;
    if (tt < 1.2) env = tt / 1.2;
    if (tt > playLen - 3.5) env = Math.max(0, (playLen - tt) / 3.5); // natural fade-out
    data[i] = (pad + kick + hat) * env;
  }
  const buf = Buffer.alloc(44 + len * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + len * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(len * 2, 40);
  for (let i = 0; i < len; i++) buf.writeInt16LE(Math.max(-1, Math.min(1, data[i])) * 32767 | 0, 44 + i * 2);
  cache.set(n, buf);
  return buf;
}

export function art(n) {
  const d = DEFS.find((x) => x.n === Number(n));
  if (!d) return null;
  const h = d.hue;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><radialGradient id="g" cx="30%" cy="28%" r="90%"><stop offset="0" stop-color="hsl(${h} 75% 62%)"/><stop offset=".55" stop-color="hsl(${(h + 30) % 360} 60% 34%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360} 50% 12%)"/></radialGradient></defs><rect width="600" height="600" fill="url(#g)"/>${Array.from({ length: 9 }, (_, i) => `<circle cx="300" cy="300" r="${40 + i * 30}" fill="none" stroke="hsl(${h} 80% 85% / ${0.32 - i * 0.03})" stroke-width="2"/>`).join('')}<text x="44" y="548" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="700" fill="hsl(${h} 30% 96%)">TEST ${d.n}</text><text x="44" y="580" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="hsl(${h} 30% 90% / .8)">${d.bpm} BPM signal</text></svg>`;
}

// Timed placeholder lines so lyric sync can be verified. Clearly not real lyrics.
export function lrc(n) {
  const d = DEFS.find((x) => x.n === Number(n));
  if (!d) return null;
  const lines = [];
  for (let t = 2, i = 1; t < d.dur - 2; t += 4, i++) {
    const mm = String(Math.floor(t / 60)).padStart(2, '0'), ss = (t % 60).toFixed(2).padStart(5, '0');
    if (Number(n) === 2) { // word-timed (enhanced LRC) placeholder lines
      const words = ['Word', 'timed', 'test', 'line', String(i)];
      const tag = (x) => `<${String(Math.floor(x / 60)).padStart(2, '0')}:${(x % 60).toFixed(2).padStart(5, '0')}>`;
      lines.push(`[${mm}:${ss}]${words.map((w, k) => `${tag(t + k * 0.6)}${w}`).join(' ')}`);
    } else lines.push(`[${mm}:${ss}]Test lyric line ${i}, timed at ${t} seconds`);
  }
  return lines.join('\n');
}

export function search(q) {
  const s = q.toLowerCase();
  if (!/(test|signal|tone|bpm|vesper)/.test(s)) return [];
  return tracks;
}
