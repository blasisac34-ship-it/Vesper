// Recommendation engine.
// Signals actually used: Deezer related-artist graph, artist top tracks, Deezer artist radio,
// Deezer BPM (when Deezer reports it), Deezer popularity rank, and the user's own likes, skips,
// plays, "less like this" / "more like this" / "avoid artist" feedback.
// Not used (not available from these providers): mood, valence, energy, vocal/instrumental detection.
import * as dz from './providers/deezer.mjs';
import { normText, mapLimit, seededShuffle, todayKey } from './util.mjs';


const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const clamp = (x, a = -1, b = 1) => Math.max(a, Math.min(b, x));
const CALM_WORDS = /\b(acoustic|piano|unplugged|stripped|ballad|lullaby|sleep|slowed|ambient|orchestral|interlude|reverb)\b/i;
const HYPE_WORDS = /\b(remix|club|extended mix|edit|hype|dance|bass boosted|sped up|vip|bootleg|festival)\b/i;
// A rough, explainable energy score from data these sources really provide: tempo relative to the
// reference, Deezer's loudness (gain: more negative = louder master), and version words in the title.
export function energyOf(t, refBpm, refGain) {
  let e = 0, known = false;
  if (t.bpm && refBpm) {
    let b = t.bpm; // treat half/double-time readings as the same feel
    if (b > refBpm * 1.6) b /= 2; else if (b < refBpm / 1.6) b *= 2;
    e += clamp((b - refBpm) / 18); known = true;
  }
  if (t.gain != null && refGain != null) { e += 0.6 * clamp((refGain - t.gain) / 4); known = true; }
  const title = String(t.title || '');
  if (CALM_WORDS.test(title)) { e -= 0.5; known = true; }
  if (HYPE_WORDS.test(title)) { e += 0.35; known = true; }
  return known ? Math.round(e * 100) / 100 : null;
}
async function seedDetails(seed) {
  try {
    const dzId = [seed.sourceId, seed.id].find((x) => typeof x === 'string' && x.startsWith('dz:'));
    if (dzId) { const t = await dz.track(dzId.slice(3)); return { bpm: t.bpm || seed.bpm || null, gain: t.gain ?? null }; }
    if (!seed.title || !seed.artist) return seed.bpm ? { bpm: seed.bpm, gain: null } : null;
    const found = await dz.searchTracks(`artist:"${seed.artist}" track:"${String(seed.title).replace(/"/g, '')}"`, 3);
    const hit = found.find((x) => normText(x.artist) === normText(seed.artist)) || found[0];
    if (!hit) return seed.bpm ? { bpm: seed.bpm, gain: null } : null;
    const t = await dz.track(hit.id.slice(3));
    return { bpm: t.bpm || seed.bpm || null, gain: t.gain ?? null };
  } catch { return seed.bpm ? { bpm: seed.bpm, gain: null } : null; }
}

const nameToDz = new Map();
async function deezerArtistId(track) {
  if (track.artistId?.startsWith('dz:')) return track.artistId.slice(3);
  if (!track.artist) return null;
  const key = normText(track.artist);
  if (nameToDz.has(key)) return nameToDz.get(key);
  const found = await dz.searchArtists(track.artist, 5).catch(() => []);
  const best = found.find((a) => normText(a.name) === key) || null;
  const id = best ? best.id.slice(3) : null;
  nameToDz.set(key, id);
  return id;
}

export function userSignals(u) {
  const s = { likedArtists: new Set(), followedArtists: new Set(), likedTracks: new Set(), recent: new Map(), skips: new Map(), artistSkips: new Map(), artistPlays: new Map(), avoid: new Set(), less: new Set(), lessArtists: new Set(), moreArtists: new Set(), knownArtists: new Set() };
  if (!u) return s;
  for (const a of Object.values(u.feedback.avoidArtists)) s.avoid.add(normText(a.name));
  for (const a of Object.values(u.library?.artists || {})) { const name = normText(a.name); if (name) { s.followedArtists.add(name); s.knownArtists.add(name); } }
  for (const t of Object.values(u.feedback.less)) { s.less.add(t.id); if (t.artist) s.lessArtists.add(normText(t.artist)); }
  for (const t of Object.values(u.feedback.more)) if (t.artist) s.moreArtists.add(normText(t.artist));
  if (!u.settings.historyForRecs) return s;
  for (const t of Object.values(u.library.likes)) { s.likedTracks.add(t.id); s.likedArtists.add(normText(t.artist)); }
  const now = Date.now();
  for (const e of u.history) {
    const a = normText(e.track.artist);
    s.knownArtists.add(a);
    s.artistPlays.set(a, (s.artistPlays.get(a) || 0) + 1);
    if (e.skipped) { s.skips.set(e.track.id, (s.skips.get(e.track.id) || 0) + 1); s.artistSkips.set(a, (s.artistSkips.get(a) || 0) + 1); }
    if (now - Date.parse(e.at) < 3 * 86400_000) s.recent.set(e.track.id, (s.recent.get(e.track.id) || 0) + 1);
  }
  return s;
}

// mode: same | calmer | upbeat | explore | hidden
export async function recommend({ seeds = [], mode = 'same', user = null, limit = 30, exclude = [], seen = [], allowExplicit = true, sessionSkips = [], sessionLikes = [], artistLimit = 2, excludeKeys = [] }) {
  const sSkip = new Set(sessionSkips.map(normText)), sLike = new Set(sessionLikes.map(normText)); // what you did in this listening session
  const sig = userSignals(user);
  const excludeSet = new Set(exclude);
  // Tracks shown in previous discovery refreshes are down-ranked, not permanently blocked.
  const seenSet = new Set(seen.map(String));
  const seedArtistIds = [...new Set((await mapLimit(seeds.slice(0, Math.max(3, artistLimit + 1)), 3, deezerArtistId)).filter(Boolean))].slice(0, artistLimit);
  const keyBlock = new Set(excludeKeys);
  if (!seedArtistIds.length) return { tracks: [], note: 'Could not match the seed to an artist on Deezer, so there is nothing to build recommendations from.' };

  // Seed tempo and loudness. Songs that were upgraded to full YouTube versions keep their original
  // Deezer id in sourceId; anything else is looked up on Deezer by title and artist.
  const energyModes = ['same', 'calmer', 'upbeat'];
  const seedFacts = energyModes.includes(mode) ? (await mapLimit(seeds.slice(0, 3), 3, seedDetails)).filter(Boolean) : [];
  let seedBpm = median(seedFacts.map((f) => f.bpm));
  const seedGain = median(seedFacts.map((f) => f.gain));

  const cands = new Map();
  const add = (t, weight, reason) => {
    if (!t || !t.playable || excludeSet.has(t.id) || keyBlock.has(`${normText(t.title)}|${normText(t.artist)}`)) return;
    const prev = cands.get(t.id);
    if (!prev || prev.weight < weight) cands.set(t.id, { t, weight, reason });
  };
  for (const aid of seedArtistIds) {
    const [top, rel, radio] = await Promise.all([
      dz.artistTop(aid, 10).catch(() => []), dz.related(aid, 8).catch(() => []), dz.artistRadio(aid).catch(() => []),
    ]);
    const seedName = top[0]?.artist || seeds[0]?.artist || 'this artist';
    if (mode !== 'explore') top.forEach((t, i) => add(t, 0.95 - i * 0.02, `Popular track by ${seedName}`));
    radio.forEach((t, i) => add(t, 0.78 - i * 0.004, `On ${seedName} radio (Deezer)`));
    const relTops = await mapLimit(rel.slice(0, 6), 3, (a) => dz.artistTop(a.id.slice(3), 5));
    rel.slice(0, 6).forEach((a, i) => (relTops[i] || []).forEach((t, j) => add(t, 0.88 - i * 0.04 - j * 0.03, `${a.name} is related to ${seedName} on Deezer`)));
  }

  let list = [...cands.values()];
  // Fetch tempo + loudness for the strongest candidates when the mode is about energy.
  if (energyModes.includes(mode)) {
    const top = list.sort((a, b) => b.weight - a.weight).slice(0, mode === 'same' ? 24 : 40);
    const det = await mapLimit(top, 4, (c) => dz.track(c.t.id.slice(3)).catch(() => null));
    top.forEach((c, i) => { if (det[i]) c.t = { ...c.t, bpm: det[i].bpm || c.t.bpm || null, gain: det[i].gain ?? null }; });
  }
  // Reference point: the seed when Deezer knows it, otherwise the middle of these candidates,
  // so Calmer / More upbeat still lean the right way when the seed has no tempo data.
  const refBpm = seedBpm || median(list.map((c) => c.t.bpm));
  const refGain = seedGain ?? median(list.map((c) => c.t.gain));
  for (const c of list) c.energy = energyOf(c.t, refBpm, refGain);
  const maxRank = Math.max(1, ...list.map((c) => c.t.rank || 0));
  const seedArtistNames = new Set(seeds.map((s) => normText(s.artist)));

  for (const c of list) {
    const a = normText(c.t.artist);
    let s = c.weight;
    if (seenSet.has(c.t.id)) s -= 1.35; // prefer genuinely fresh tracks on repeated Discover requests
    if (sSkip.has(normText(c.t.artist))) s -= 0.7; // skipped this artist just now
    if (sLike.has(normText(c.t.artist))) s += 0.3;
    const why = [c.reason];
    if (sig.avoid.has(a) || sig.less.has(c.t.id) || (sig.skips.get(c.t.id) || 0) >= 2) { c.score = -Infinity; continue; }
    if (!allowExplicit && c.t.explicit) { c.score = -Infinity; continue; }
    if (sig.lessArtists.has(a)) s -= 0.3;
    if (sig.moreArtists.has(a)) { s += 0.2; why.push('You asked for more like this artist'); }
    if (sig.likedArtists.has(a)) { s += 0.12; if (mode !== 'explore') why.push(`You’ve liked songs by ${c.t.artist}`); }
    if (sig.followedArtists.has(a)) { s += 0.18; if (mode !== 'explore') why.push(`You follow ${c.t.artist}`); }
    if (sig.likedTracks.has(c.t.id)) s -= 0.15; // already in their library; favour discovery
    s -= 0.35 * Math.min(2, sig.recent.get(c.t.id) || 0);
    const plays = sig.artistPlays.get(a) || 0, sk = sig.artistSkips.get(a) || 0;
    if (plays >= 4 && sk / plays > 0.6) s -= 0.25;
    if (mode === 'explore') { if (sig.knownArtists.has(a)) s -= 0.45; if (seedArtistNames.has(a)) s -= 0.6; if (!sig.knownArtists.has(a)) why.push('New to your listening'); }
    if (mode === 'hidden' && c.t.rank) { s += (1 - c.t.rank / maxRank) * 0.5; if (c.t.rank / maxRank < 0.35) why.push('Less widely played'); }
    if (mode === 'same' && refBpm && c.t.bpm) { const d = c.t.bpm - refBpm; s += 0.3 * Math.exp(-Math.abs(d) / 12); if (seedBpm && Math.abs(d) <= 6) why.push(`Similar tempo (${Math.round(c.t.bpm)} vs ${Math.round(seedBpm)} BPM)`); }
    if ((mode === 'calmer' || mode === 'upbeat') && c.energy != null) {
      const dir = mode === 'calmer' ? -1 : 1;
      s += 0.75 * dir * c.energy;
      if (dir * c.energy > 0.15) why.unshift(mode === 'calmer' ? (c.t.bpm && refBpm && c.t.bpm < refBpm - 4 ? `Calmer: ${Math.round(c.t.bpm)} BPM` : 'Calmer and softer') : (c.t.bpm && refBpm && c.t.bpm > refBpm + 4 ? `More upbeat: ${Math.round(c.t.bpm)} BPM` : 'More energy'));
    }
    c.score = s; c.why = why.slice(0, 2);
  }
  list = list.filter((c) => c.score > -Infinity).sort((a, b) => b.score - a.score);
  // Calmer / More upbeat: leave out songs that clearly go the other way, as long as enough remain.
  if (mode === 'calmer' || mode === 'upbeat') {
    const dir = mode === 'calmer' ? -1 : 1;
    const kept = list.filter((c) => c.energy == null || dir * c.energy > -0.1);
    if (kept.length >= Math.min(limit, 10)) list = kept;
  }

  // Diversity: cap per artist and avoid back-to-back same artist.
  const cap = mode === 'explore' ? 1 : 2;
  const per = new Map(), out = [];
  for (const c of list) {
    const a = normText(c.t.artist);
    if ((per.get(a) || 0) >= cap) continue;
    per.set(a, (per.get(a) || 0) + 1);
    out.push(c);
    if (out.length >= limit * 1.3) break;
  }
  for (let i = 1; i < out.length; i++) if (normText(out[i].t.artist) === normText(out[i - 1].t.artist)) { const j = out.findIndex((c, k) => k > i && normText(c.t.artist) !== normText(out[i].t.artist)); if (j > 0) [out[i], out[j]] = [out[j], out[i]]; }
  const tempoUsed = !!refBpm && energyModes.includes(mode);
  return {
    tracks: out.slice(0, limit).map((c) => ({ ...c.t, reason: c.why.join('. ') })),
    seedBpm, tempoUsed,
    note: ['calmer', 'upbeat'].includes(mode) && !list.some((c) => c.energy != null) ? 'Couldn’t get tempo or loudness for these songs, so this mix is related music without the energy change.' : null,
  };
}

// Top artists from the user's own history in a window, by listening time.
export function topArtists(u, days = 28, n = 6) {
  const since = Date.now() - days * 86400_000;
  const m = new Map();
  for (const e of u.history) {
    if (Date.parse(e.at) < since || e.track.provider === 'test') continue;
    const k = normText(e.track.artist);
    const cur = m.get(k) || { name: e.track.artist, ms: 0, track: e.track };
    cur.ms += e.ms || 0; m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.ms - a.ms).slice(0, n);
}

export function dailyMixSeeds(u, days = 28, n = 4) {
  const played = topArtists(u, days, 12);
  const seen = new Set(played.map((a) => normText(a.name)));
  const followed = Object.values(u.library?.artists || {}).filter((a) => a.id?.startsWith('dz:') && a.name && !seen.has(normText(a.name)))
    .map((a) => ({ name: a.name, track: null, artistId: a.id, artwork: a.artwork || a.artworkSmall || null }));
  return [...played, ...followed].slice(0, n);
}

export async function dailyMix(u, i) {
  const seed = dailyMixSeeds(u, 28, 8)[i];
  if (!seed) return null;
  if (!seed.track && seed.artistId?.startsWith('dz:')) {
    const tracks = await dz.artistTop(seed.artistId.slice(3), 12).catch(() => []);
    seed.track = tracks.find((t) => t.playable) || tracks[0] || null;
  }
  if (!seed.track) return null;
  const r = await recommend({ seeds: [seed.track], user: u, limit: 30, mode: 'same', allowExplicit: u.settings.explicit });
  const mine = u.history.filter((e) => normText(e.track.artist) === normText(seed.name) && !e.skipped).map((e) => e.track);
  const uniqMine = [...new Map(mine.map((t) => [t.id, t])).values()].slice(0, 6);
  const tracks = seededShuffle([...uniqMine.map((t) => ({ ...t, reason: 'From your listening' })), ...r.tracks], `${u.id}-${todayKey()}-${i}`);
  return { title: `Daily Mix ${i + 1}`, description: `${seed.name} and music related to it. Refreshes daily.`, seedArtist: seed.name, artwork: seed.track.artwork || seed.track.albumArtwork || seed.artwork || null, tracks };
}
