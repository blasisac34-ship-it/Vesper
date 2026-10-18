// Listening statistics, computed exclusively from playback events recorded by this app.
import { normText } from './util.mjs';

const DAY = 86400_000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

function rangeStart(range, now = new Date()) {
  if (range === '7d') return now.getTime() - 7 * DAY;
  if (range === '30d') return now.getTime() - 30 * DAY;
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (range === 'year') return new Date(now.getFullYear(), 0, 1).getTime();
  return 0;
}

export function computeStats(history, range = '30d', now = new Date()) {
  const start = rangeStart(range, now);
  const ev = history.filter((e) => Date.parse(e.at) >= start);
  const firstSeen = new Map(); // artist -> first play ever
  for (const e of history) { const k = normText(e.track.artist); if (!firstSeen.has(k)) firstSeen.set(k, Date.parse(e.at)); }

  const artists = new Map(), tracks = new Map(), albums = new Map(), genres = new Map();
  let ms = 0, completed = 0, skipped = 0, genreMs = 0;
  const hours = new Array(24).fill(0);
  for (const e of ev) {
    const t = e.track, m = e.ms || 0;
    ms += m; if (e.completed) completed++; if (e.skipped) skipped++;
    const ak = normText(t.artist);
    const a = artists.get(ak) || { name: t.artist, artistId: t.artistId, artwork: t.artworkSmall || t.artwork, ms: 0, plays: 0 };
    a.ms += m; a.plays++; artists.set(ak, a);
    const tr = tracks.get(t.id) || { track: t, ms: 0, plays: 0 };
    tr.ms += m; tr.plays++; tracks.set(t.id, tr);
    if (t.album) { const k = `${ak}|${normText(t.album)}`; const al = albums.get(k) || { title: t.album, artist: t.artist, albumId: t.albumId, artwork: t.artworkSmall || t.artwork, ms: 0, plays: 0 }; al.ms += m; al.plays++; albums.set(k, al); }
    if (t.genre) { genres.set(t.genre, (genres.get(t.genre) || 0) + m); genreMs += m; }
    hours[new Date(e.at).getHours()] += m;
  }

  // Activity series: daily for short ranges, monthly for year/all.
  const series = [];
  if (range === 'year' || range === 'all') {
    const months = new Map();
    for (const e of ev) { const k = e.at.slice(0, 7); months.set(k, (months.get(k) || 0) + (e.ms || 0)); }
    const first = range === 'year' ? new Date(now.getFullYear(), 0, 1) : (ev[0] ? new Date(ev[0].at) : now);
    for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= now; d.setMonth(d.getMonth() + 1)) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      series.push({ key: k, ms: months.get(k) || 0 });
    }
  } else {
    const days = new Map();
    for (const e of ev) { const k = dayKey(e.at); days.set(k, (days.get(k) || 0) + (e.ms || 0)); }
    for (let t = Math.max(start, now.getTime() - 31 * DAY); t <= now.getTime(); t += DAY) { const k = dayKey(t); series.push({ key: k, ms: days.get(k) || 0 }); }
  }

  // Streaks over all history.
  const playedDays = new Set(history.map((e) => dayKey(e.at)));
  let current = 0;
  for (let t = now.getTime(); playedDays.has(dayKey(t)); t -= DAY) current++;
  let longest = 0, run = 0, prev = null;
  for (const d of [...playedDays].sort()) { run = prev && Date.parse(d) - Date.parse(prev) === DAY ? run + 1 : 1; longest = Math.max(longest, run); prev = d; }

  const sortMs = (a, b) => b.ms - a.ms;
  return {
    range, from: start ? new Date(start).toISOString() : (history[0]?.at || null), recordingSince: history[0]?.at || null,
    totals: { ms, plays: ev.length, completed, skipped, artists: artists.size, tracks: tracks.size },
    topArtists: [...artists.values()].sort(sortMs).slice(0, 10),
    topTracks: [...tracks.values()].sort((a, b) => b.plays - a.plays || b.ms - a.ms).slice(0, 10),
    topAlbums: [...albums.values()].sort(sortMs).slice(0, 8),
    genres: [...genres.entries()].map(([name, m]) => ({ name, ms: m })).sort(sortMs).slice(0, 8),
    genreCoverage: ms ? genreMs / ms : 0,
    mostReplayed: [...tracks.values()].filter((t) => t.plays >= 3).sort((a, b) => b.plays - a.plays).slice(0, 10),
    recentlyDiscovered: [...artists.entries()].filter(([k]) => firstSeen.get(k) >= start && start > 0).map(([k, a]) => ({ ...a, firstPlay: new Date(firstSeen.get(k)).toISOString() })).sort((a, b) => b.firstPlay.localeCompare(a.firstPlay)).slice(0, 10),
    series, hours, streak: { current, longest },
  };
}
