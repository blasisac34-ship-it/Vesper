// Vesper Replay: listening recaps computed only from playback events this app recorded.
// Counting rules (documented in README and shown in the recap):
//   - A "listen" is ≥ 30 s of actual playback for a full track, or ≥ 15 s of a 30-second preview.
//   - Shorter plays are "brief starts": they are counted separately and never feed top lists.
//   - Listening time comes from measured playback (seeking forward does not add time).
//   - Previews and full tracks are reported separately. Nothing is imported or estimated.
import { normText } from './util.mjs';

const DAY = 86400_000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
export const isListen = (e) => (e.track.preview ? e.ms >= 15_000 : e.ms >= 30_000);
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(); const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
function tops(events) {
  const artists = new Map(), tracks = new Map(), albums = new Map(), genres = new Map();
  let genreMs = 0, ms = 0;
  for (const e of events) {
    const t = e.track; ms += e.ms;
    const ak = normText(t.artist);
    const a = artists.get(ak) || { name: t.artist, artistId: t.artistId || null, artwork: t.artworkSmall || t.artwork || null, ms: 0, listens: 0 }; a.ms += e.ms; a.listens++; artists.set(ak, a);
    const tr = tracks.get(t.id) || { track: t, ms: 0, listens: 0 }; tr.ms += e.ms; tr.listens++; tracks.set(t.id, tr);
    if (t.album) { const k = `${ak}|${normText(t.album)}`; const al = albums.get(k) || { title: t.album, artist: t.artist, albumId: t.albumId || null, artwork: t.artwork || null, ms: 0, listens: 0 }; al.ms += e.ms; al.listens++; albums.set(k, al); }
    if (t.genre) { genres.set(t.genre, (genres.get(t.genre) || 0) + e.ms); genreMs += e.ms; }
  }
  return {
    artists: [...artists.values()].sort((a, b) => b.ms - a.ms),
    tracks: [...tracks.values()].sort((a, b) => b.listens - a.listens || b.ms - a.ms),
    albums: [...albums.values()].sort((a, b) => b.ms - a.ms),
    genres: [...genres.entries()].map(([name, m]) => ({ name, ms: m })).sort((a, b) => b.ms - a.ms),
    genreCoverage: ms ? genreMs / ms : 0,
  };
}

export function computeReplay(history, fromMs, toMs, { label = null } = {}) {
  const all = history.filter((e) => e.track.provider !== 'test');
  const inRange = all.filter((e) => { const t = Date.parse(e.at); return t >= fromMs && t < toMs; });
  const listens = inRange.filter(isListen);
  const brief = inRange.length - listens.length;
  const T = tops(listens);
  const ms = inRange.reduce((s, e) => s + e.ms, 0); // all real playback time, including brief starts
  const listenMs = listens.reduce((s, e) => s + e.ms, 0);
  const full = listens.filter((e) => !e.track.preview), prev = listens.filter((e) => e.track.preview);

  const months = new Map(), weekdays = new Array(7).fill(0), hours = new Array(24).fill(0), weeks = new Map(), days = new Map();
  for (const e of inRange) {
    const d = new Date(e.at);
    months.set(e.at.slice(0, 7), (months.get(e.at.slice(0, 7)) || 0) + e.ms);
    weekdays[d.getDay()] += e.ms; hours[d.getHours()] += e.ms;
    const w = isoWeek(d); weeks.set(w, (weeks.get(w) || 0) + e.ms);
    const k = dayKey(e.at); days.set(k, (days.get(k) || 0) + e.ms);
  }
  // Longest streak of consecutive days with at least one listen, inside the period.
  const listenDays = [...new Set(listens.map((e) => dayKey(e.at)))].sort();
  let best = { days: 0, from: null, to: null }, run = 0, start = null, prevDay = null;
  for (const d of listenDays) {
    if (prevDay && Date.parse(d) - Date.parse(prevDay) === DAY) run++; else { run = 1; start = d; }
    if (run > best.days) best = { days: run, from: start, to: d };
    prevDay = d;
  }
  const biggestDay = [...days.entries()].sort((a, b) => b[1] - a[1])[0] || null;

  // Discoveries: artists whose first-ever recorded listen falls inside the period.
  const firstEver = new Map();
  for (const e of all.filter(isListen)) { const k = normText(e.track.artist); if (!firstEver.has(k)) firstEver.set(k, Date.parse(e.at)); }
  const discoveries = T.artists.filter((a) => { const f = firstEver.get(normText(a.name)); return f >= fromMs && f < toMs; }).slice(0, 8);
  const hadEarlier = all.some((e) => Date.parse(e.at) < fromMs);

  // Taste change: compare halves of the period, only with enough data to mean something.
  let tasteShift = null;
  const mid = fromMs + (Math.min(toMs, Date.now()) - fromMs) / 2;
  const h1 = listens.filter((e) => Date.parse(e.at) < mid), h2 = listens.filter((e) => Date.parse(e.at) >= mid);
  if (h1.length >= 20 && h2.length >= 20) {
    const share = (evs) => { const m = new Map(), tot = evs.reduce((s, e) => s + e.ms, 0); for (const e of evs) { const k = normText(e.track.artist); m.set(k, { name: e.track.artist, s: (m.get(k)?.s || 0) + e.ms / tot }); } return m; };
    const a = share(h1), b = share(h2);
    const delta = [...new Set([...a.keys(), ...b.keys()])].map((k) => ({ name: (b.get(k) || a.get(k)).name, change: (b.get(k)?.s || 0) - (a.get(k)?.s || 0) }));
    tasteShift = { rising: delta.filter((x) => x.change > 0.03).sort((x, y) => y.change - x.change).slice(0, 3), fading: delta.filter((x) => x.change < -0.03).sort((x, y) => x.change - y.change).slice(0, 3) };
  }
  // Milestones that are plain facts.
  const milestones = [];
  if (listens.length) milestones.push({ kind: 'first', text: `First listen: ${listens[0].track.title} by ${listens[0].track.artist}`, at: listens[0].at });
  for (const n of [100, 500, 1000, 5000]) if (listens.length >= n) milestones.push({ kind: 'count', text: `Listen number ${n.toLocaleString('en-US')}: ${listens[n - 1].track.title}`, at: listens[n - 1].at });
  if (T.tracks[0]?.listens >= 10) milestones.push({ kind: 'repeat', text: `${T.tracks[0].track.title} reached ${T.tracks[0].listens} listens` });

  return {
    label, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), generatedAt: new Date().toISOString(),
    totals: { ms, listenMs, listens: listens.length, fullListens: full.length, previewListens: prev.length, briefStarts: brief, uniqueTracks: T.tracks.length, uniqueArtists: T.artists.length, activeDays: days.size },
    topTracks: T.tracks.slice(0, 50), topArtists: T.artists.slice(0, 10), topAlbums: T.albums.slice(0, 5),
    genres: T.genreCoverage >= 0.5 ? T.genres.slice(0, 5) : [], genreCoverage: T.genreCoverage,
    byMonth: [...months.entries()].sort().map(([k, v]) => ({ key: k, ms: v })),
    byWeek: [...weeks.entries()].sort().map(([k, v]) => ({ key: k, ms: v })),
    byWeekday: weekdays, byHour: hours,
    longestStreak: best, biggestDay: biggestDay && { date: biggestDay[0], ms: biggestDay[1] },
    discoveries, discoveriesMeaningful: hadEarlier, tasteShift, milestones,
  };
}
export const yearRange = (y) => [Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1)];
