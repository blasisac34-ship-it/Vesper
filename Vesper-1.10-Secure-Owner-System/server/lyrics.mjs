// Lyrics from several free sources, tried in order until one has the song:
//   1. LRCLIB exact match (synced)   2. LRCLIB search (synced)   3. NetEase Cloud Music (synced)
//   4. Lyrics.ovh (plain text)
// Every source is checked against the song's artist and length so the wrong song isn't shown.
// Found lyrics are saved to disk, so a song only has to be found once and keeps working if a
// source goes down later. None of these are licensed lyrics providers: fine for personal use.
import fs from 'node:fs';
import { fetchJSON, normText } from './util.mjs';

const clean = (t) => String(t || '').replace(/\s*[([](feat|ft|with|prod)\.?[^)\]]*[)\]]/gi, '').replace(/\s+-\s+(.*remaster.*|.*version|radio edit|live.*|mono|stereo)$/i, '').trim();
const mainArtist = (a) => String(a || '').split(/,|&| x | feat\.?| ft\.?| and /i)[0].trim();
const same = (a, b) => normText(a) === normText(b);
const titleOk = (want, got) => { const w = normText(clean(want)), g = normText(clean(got)); return !!w && !!g && (w === g || g.startsWith(w) || w.startsWith(g)); };
const durOk = (want, got, slack = 6) => !want || !got || Math.abs(want - got) <= slack;
const hasLines = (s) => typeof s === 'string' && s.trim().split('\n').filter((l) => l.trim()).length >= 3;

// NetEase lyrics often start with credit lines ("作词 : …", "Composer: …"); drop them.
function tidyLrc(lrc) {
  return String(lrc || '').split('\n').filter((l) => {
    const text = l.replace(/^(\[\d+:\d+(?:\.\d+)?\])+/, '').trim();
    return !/^(作词|作曲|编曲|制作人|混音|母带|录音|和声|吉他|贝斯|鼓|弦乐|监制|出品|发行|词|曲|lyrics?|composer|producer|written by|arranger|mixing|mastering|recording)\s*[:：]/i.test(text);
  }).join('\n').trim();
}

const SOURCES = [
  {
    name: 'LRCLIB',
    async find({ title, artist, album, duration }) {
      const opts = { ttl: 24 * 3600_000, provider: 'LRCLIB', retries: 2 };
      const base = 'https://lrclib.net/api';
      try {
        const r = await fetchJSON(`${base}/get?artist_name=${encodeURIComponent(mainArtist(artist))}&track_name=${encodeURIComponent(clean(title))}${album ? `&album_name=${encodeURIComponent(album)}` : ''}${duration ? `&duration=${Math.round(duration)}` : ''}`, opts);
        if (r?.instrumental) return { instrumental: true };
        if (hasLines(r?.syncedLyrics) || hasLines(r?.plainLyrics)) return { synced: r.syncedLyrics || null, plain: r.plainLyrics || null };
      } catch (e) { if (e.status !== 404) throw e; }
      for (const q of [`track_name=${encodeURIComponent(clean(title))}&artist_name=${encodeURIComponent(mainArtist(artist))}`, `q=${encodeURIComponent(`${mainArtist(artist)} ${clean(title)}`)}`]) {
        const list = await fetchJSON(`${base}/search?${q}`, opts).catch((e) => { if (e.status === 404) return []; throw e; });
        const ok = (Array.isArray(list) ? list : []).filter((x) => titleOk(title, x.trackName) && same(mainArtist(artist), mainArtist(x.artistName)) && durOk(duration, x.duration));
        const best = ok.find((x) => hasLines(x.syncedLyrics)) || ok.find((x) => hasLines(x.plainLyrics));
        if (best) return { synced: best.syncedLyrics || null, plain: best.plainLyrics || null };
      }
      return null;
    },
  },
  {
    name: 'NetEase Cloud Music',
    async find({ title, artist, duration }) {
      const headers = { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' };
      const opts = { ttl: 24 * 3600_000, provider: 'NetEase', retries: 1, headers };
      const s = await fetchJSON(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(`${clean(title)} ${mainArtist(artist)}`)}&type=1&limit=10`, opts);
      const songs = s?.result?.songs || [];
      const hit = songs.find((x) => titleOk(title, x.name) && (x.artists || []).some((a) => same(a.name, mainArtist(artist))) && durOk(duration, (x.duration || 0) / 1000, 5));
      if (!hit) return null;
      const l = await fetchJSON(`https://music.163.com/api/song/lyric?id=${hit.id}&lv=1&kv=1&tv=-1`, opts);
      const lrc = tidyLrc(l?.lrc?.lyric);
      if (!hasLines(lrc)) return null;
      if (/^\[\d+:\d+/m.test(lrc) && !/纯音乐|instrumental/i.test(lrc.slice(0, 200))) return { synced: lrc, plain: null };
      return /纯音乐/.test(lrc) ? { instrumental: true } : { synced: null, plain: lrc.replace(/^(\[[^\]]*\])+/gm, '') };
    },
  },
  {
    name: 'Lyrics.ovh',
    async find({ title, artist }) {
      const r = await fetchJSON(`https://api.lyrics.ovh/v1/${encodeURIComponent(mainArtist(artist))}/${encodeURIComponent(clean(title))}`, { ttl: 24 * 3600_000, provider: 'Lyrics.ovh', retries: 1 }).catch((e) => { if (e.status === 404) return null; throw e; });
      const text = String(r?.lyrics || '').replace(/^Paroles de la chanson.*\n/i, '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
      return hasLines(text) ? { synced: null, plain: text } : null;
    },
  },
];

export function createLyricsService(file) {
  let store = {}; try { store = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new */ }
  let t = 0;
  const save = () => { clearTimeout(t); t = setTimeout(() => { try { const keys = Object.keys(store); if (keys.length > 6000) for (const k of keys.slice(0, keys.length - 6000)) delete store[k]; fs.writeFileSync(`${file}.tmp`, JSON.stringify(store)); fs.renameSync(`${file}.tmp`, file); } catch { /* best effort */ } }, 1500); };
  const keyOf = (title, artist) => `${normText(clean(title))}|${normText(mainArtist(artist))}`;
  return {
    async get(song) {
      const key = keyOf(song.title, song.artist), cached = store[key];
      if (cached?.found) return { ...cached.found, cached: true };
      if (cached && !cached.found && Date.now() - cached.at < 12 * 3600_000) return { unavailable: true, reason: 'No lyrics found for this song in any lyrics source.' };
      const problems = [];
      for (const src of SOURCES) {
        try {
          const r = await src.find(song);
          if (r) {
            const found = r.instrumental ? { instrumental: true, source: src.name } : { synced: r.synced || null, plain: r.plain || null, source: `${src.name} (community lyrics)` };
            store[key] = { found, at: Date.now() }; save();
            return found;
          }
        } catch (e) { problems.push(`${src.name}: ${e.message}`); }
      }
      // Only remember "not found" when every source actually answered; outages are retried next time.
      if (!problems.length) { store[key] = { found: null, at: Date.now() }; save(); return { unavailable: true, reason: 'No lyrics found for this song in any lyrics source.' }; }
      return { unavailable: true, reason: problems.length === SOURCES.length ? 'The lyrics services can’t be reached right now. Vesper will try again next time you play this song.' : 'No lyrics found for this song (some lyrics services were unreachable, so Vesper will check again later).' };
    },
  };
}
export { tidyLrc, titleOk };
