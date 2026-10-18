// YouTube provider — search and metadata via the official YouTube Data API v3.
// Playback happens ONLY in YouTube's official IFrame player in the browser. Vesper never downloads,
// proxies, extracts or caches YouTube audio or video; there is deliberately no audioUrl() here.
import { ProviderError, TTLCache } from '../util.mjs';

export const info = {
  id: 'youtube', name: 'YouTube', fullTracks: true, needsKey: false, externalPlayer: false,
  capabilities: ['search', 'full-track-audio', 'seek', 'speed'],
  unsupported: [],
  limitation: 'Full-length audio is resolved by local yt-dlp and streamed through Vesper’s normal player. Availability may change when YouTube changes its delivery system.',
};

const test = () => process.env.VESPER_TEST === '1';
const API = () => (test() && process.env.YOUTUBE_API_BASE) || 'https://www.googleapis.com/youtube/v3';
const OEMBED = () => (test() && process.env.YOUTUBE_OEMBED_BASE) || 'https://www.youtube.com/oembed';
export const key = () => process.env.YOUTUBE_API_KEY || '';
export const configured = () => !!key();
export const region = () => (process.env.YOUTUBE_REGION || 'US').toUpperCase().slice(0, 2);
export const iframeApiUrl = () => (test() && process.env.YOUTUBE_IFRAME_API_URL) || 'https://www.youtube.com/iframe_api';
export const STORAGE_DAYS = 30; // refresh or remove stored YouTube API data after this many days
export const SETUP = 'YouTube search needs a YouTube Data API key. Add YOUTUBE_API_KEY to the .env file in the Vesper folder and restart Vesper (see README, “Set up YouTube”). You can still paste a YouTube link to play a specific video.';

const cache = new TTLCache(300);
// Calls the Data API and turns Google's error reasons into plain-language messages.
async function call(path, params, ttl = 30 * 60_000) {
  if (!configured()) throw new ProviderError('YouTube', SETUP, 501, 'not_configured');
  const qs = new URLSearchParams({ ...params, key: key() });
  const url = `${API()}/${path}?${qs}`;
  const hit = cache.get(url); if (hit) return hit;
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(12_000) }); }
  catch (e) { throw new ProviderError('YouTube', `Couldn’t reach YouTube: ${e.cause?.code || e.message}`, 503, 'unreachable'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
    if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(reason)) throw new ProviderError('YouTube', 'This API key has used up its YouTube search quota for today. It resets at midnight Pacific time. You can still play videos already in your playlists or paste a link.', 429, 'quota');
    if (/keyInvalid|API_KEY_INVALID|badRequest/i.test(reason) || /API key not valid/i.test(body?.error?.message || '')) throw new ProviderError('YouTube', 'YouTube rejected the API key. Check YOUTUBE_API_KEY in your .env file and that the key is allowed to use “YouTube Data API v3”.', 401, 'bad_key');
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason)) throw new ProviderError('YouTube', 'The YouTube Data API v3 isn’t enabled for this key’s Google Cloud project. Enable it in the Google Cloud Console, then try again in a minute.', 401, 'api_disabled');
    if (/forbidden|ipRefererBlocked|PERMISSION_DENIED/i.test(reason)) throw new ProviderError('YouTube', 'YouTube refused the request. If you restricted the key by IP address, make sure it matches this Mac’s public IP.', 403, 'forbidden');
    throw new ProviderError('YouTube', `YouTube responded ${res.status}${reason ? ` (${reason})` : ''}.`, 502);
  }
  if (ttl) cache.set(url, body, ttl);
  return body;
}

export function parseDuration(iso) { // ISO 8601, e.g. PT3M45S, PT1H2M, P1DT2H
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso || '');
  if (!m) return null;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Math.round(Number(m[4] || 0));
}
export const cleanChannel = (c) => (c || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Best guess at artist/song from a video title, used only to look up lyrics. Never shown as fact.
export function guessSong(title, channel) {
  let t = decode(title).replace(/[([{][^)\]}]*(official|video|audio|lyric|visuali[sz]er|hd|4k|mv|m\/v|remaster|live at|explicit)[^)\]}]*[)\]}]/gi, '').replace(/\s+/g, ' ').trim();
  const parts = t.split(/\s+[-–—|]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').replace(/\s+(ft|feat)\.?\s.*$/i, '').trim() };
  return { artist: cleanChannel(channel), title: t.replace(/\s+(ft|feat)\.?\s.*$/i, '').trim() };
}

// Turn a videos.list item into a Vesper track, including honest playability.
export function mapVideo(v, now = new Date()) {
  const sn = v.snippet || {}, cd = v.contentDetails || {}, st = v.status || {};
  const thumbs = sn.thumbnails || {};
  const R = region();
  let reason = null;
  if (st.privacyStatus === 'private') reason = 'This video is private.';
  else if (st.uploadStatus && !['processed', 'uploaded'].includes(st.uploadStatus)) reason = 'This video isn’t available.';
  else if (st.embeddable === false) reason = 'The owner doesn’t allow this video to play outside YouTube.';
  else if (cd.contentRating?.ytRating === 'ytAgeRestricted') reason = 'Age-restricted videos can only be watched on YouTube.';
  else if (cd.regionRestriction?.blocked?.includes(R) || (cd.regionRestriction?.allowed && !cd.regionRestriction.allowed.includes(R))) reason = `This video isn’t available in your region (${R}).`;
  else if (sn.liveBroadcastContent === 'upcoming') reason = 'This is a scheduled live stream that hasn’t started.';
  const live = sn.liveBroadcastContent === 'live';
  return {
    id: `yt:${v.id}`, provider: 'youtube', title: decode(sn.title), artist: cleanChannel(decode(sn.channelTitle)), channel: decode(sn.channelTitle),
    artistId: null, album: null, albumId: null,
    artwork: (thumbs.high || thumbs.medium || thumbs.default)?.url || null, artworkSmall: (thumbs.medium || thumbs.default)?.url || null,
    duration: live ? null : parseDuration(cd.duration), preview: false, playableDuration: live ? null : parseDuration(cd.duration),
    playable: !reason, unplayableReason: reason, explicit: false, genre: null, bpm: null,
    releaseDate: sn.publishedAt ? sn.publishedAt.slice(0, 10) : null, live, link: `https://www.youtube.com/watch?v=${v.id}`,
    ytFetchedAt: now.toISOString(),
  };
}

export async function videos(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const d = await call('videos', { part: 'snippet,contentDetails,status', id: ids.slice(i, i + 50).join(','), maxResults: 50 }, 10 * 60_000);
    for (const v of d.items || []) out.set(v.id, mapVideo(v));
  }
  return out; // ids missing from the map were deleted, made private, or never existed
}

// search.list costs 100 quota units; videos.list costs 1. Results are cached for 30 minutes.
export async function search(q, limit = 20) {
  const d = await call('search', { part: 'snippet', type: 'video', q, maxResults: limit, videoEmbeddable: 'true', videoSyndicated: 'true', videoCategoryId: '10', regionCode: region() });
  const ids = (d.items || []).map((x) => x.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const details = await videos(ids);
  return ids.filter((id) => details.has(id)).map((id) => details.get(id));
}

export function videoIdFrom(input) {
  const s = String(input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(u.hostname)) return null;
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1, 12).match(/^[\w-]{11}$/)?.[0] || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v').match(/^[\w-]{11}$/)?.[0] || null;
    return u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/)?.[1] || null;
  } catch { return null; }
}

// Paste-a-link fallback that works without an API key, using YouTube's public oEmbed endpoint.
export async function resolve(input) {
  const id = videoIdFrom(input);
  if (!id) throw new ProviderError('YouTube', 'That doesn’t look like a YouTube video link.', 400, 'bad_link');
  if (configured()) {
    const d = await videos([id]);
    if (!d.has(id)) throw new ProviderError('YouTube', 'This video was removed, made private, or doesn’t exist.', 404, 'not_found');
    return d.get(id);
  }
  let res;
  try { res = await fetch(`${OEMBED()}?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { signal: AbortSignal.timeout(10_000) }); }
  catch (e) { throw new ProviderError('YouTube', `Couldn’t reach YouTube: ${e.cause?.code || e.message}`, 503, 'unreachable'); }
  if (res.status === 401 || res.status === 403) throw new ProviderError('YouTube', 'The owner doesn’t allow this video to play outside YouTube.', 403, 'not_embeddable');
  if (!res.ok) throw new ProviderError('YouTube', 'This video was removed, made private, or doesn’t exist.', 404, 'not_found');
  const o = await res.json();
  return {
    id: `yt:${id}`, provider: 'youtube', title: decode(o.title), artist: cleanChannel(decode(o.author_name)), channel: decode(o.author_name), artistId: null, album: null, albumId: null,
    artwork: o.thumbnail_url || null, artworkSmall: o.thumbnail_url || null, duration: null, preview: false, playableDuration: null,
    playable: true, unplayableReason: null, explicit: false, genre: null, bpm: null, releaseDate: null, link: `https://www.youtube.com/watch?v=${id}`,
    ytFetchedAt: new Date().toISOString(), ytLimited: true, // duration/region details unknown without an API key
  };
}

// Stored-data hygiene: refresh YouTube metadata older than STORAGE_DAYS, or reduce it to the bare
// video ID when it can't be refreshed (no key) or the video is gone.
export async function refreshStored(tracks, { now = Date.now(), fetchDetails = videos, canRefresh = configured() } = {}) {
  const stale = tracks.filter((t) => t?.provider === 'youtube' && (!t.ytFetchedAt || now - Date.parse(t.ytFetchedAt) > STORAGE_DAYS * 86400_000));
  if (!stale.length) return { refreshed: 0, removed: 0, reduced: 0 };
  const ids = [...new Set(stale.map((t) => t.id.slice(3)))];
  let details = null;
  if (canRefresh) { try { details = await fetchDetails(ids); } catch { details = null; } }
  let refreshed = 0, removed = 0, reduced = 0;
  for (const t of stale) {
    const id = t.id.slice(3);
    if (details?.has(id)) { const f = details.get(id); for (const k of ['title', 'artist', 'channel', 'artwork', 'artworkSmall', 'duration', 'playableDuration', 'playable', 'unplayableReason']) t[k] = f[k]; t.ytFetchedAt = new Date(now).toISOString(); refreshed++; }
    else {
      const gone = !!details;
      Object.assign(t, { title: gone ? 'Unavailable YouTube video' : 'YouTube video', artist: 'YouTube', channel: null, artwork: null, artworkSmall: null, ytFetchedAt: new Date(now).toISOString() });
      if (gone) { t.playable = false; t.unplayableReason = 'This YouTube video is no longer available.'; removed++; } else { t.ytReduced = true; reduced++; }
    }
  }
  return { refreshed, removed, reduced };
}

// Find the official full-length YouTube upload of a catalog song (used when a provider only has a
// 30-second preview). Requires a real title + artist match; covers, karaoke, type beats, slowed/
// sped-up and reaction uploads are rejected. Returns null when nothing trustworthy is found.
const JUNK = /\b(cover|karaoke|instrumental|type beat|8d|slowed|sped up|nightcore|reaction|reacts?|tutorial|lesson|bass boosted|1 hour|10 hours|mashup|fan made|fanmade)\b/i;
const n = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export async function match({ title, artist, duration }) {
  const nt = n(title).replace(/ (feat|ft|with) .*/, ''), na = n(artist);
  if (!nt || !na) return null;
  const found = await search(`${artist} ${title}`, 8);
  let best = null;
  for (const v of found) {
    if (!v.playable) continue;
    const vt = n(v.title), ch = n(v.channel);
    if (!vt.includes(nt)) continue;
    if (!(ch.includes(na) || vt.includes(na) || na.includes(n(v.artist)))) continue;
    if (JUNK.test(v.title) && !JUNK.test(title)) continue;
    if (/\blive\b/.test(vt) && !/\blive\b/i.test(title)) continue;
    let s = 1;
    if (/ topic$/.test(ch)) s += 0.6; if (/official audio/.test(vt)) s += 0.4; else if (/official (music )?video/.test(vt)) s += 0.2;
    if (/remix/.test(vt) && !/remix/i.test(title)) s -= 0.8;
    if (duration && v.duration) { const d = Math.abs(v.duration - duration); s += d <= 4 ? 0.6 : d <= 12 ? 0.2 : -1.2; }
    if (!best || s > best.s) best = { s, v };
  }
  return best && best.s >= 0.8 ? best.v : null;
}
