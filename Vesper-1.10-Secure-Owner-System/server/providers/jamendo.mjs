// Jamendo API v3 — independent music released under Creative Commons licences.
// Capabilities: search, artist tracks, album tracks, FULL-LENGTH streaming (licence permitting).
// Requires a free client ID from https://devportal.jamendo.com (env JAMENDO_CLIENT_ID).
import { fetchJSON, Limiter, ProviderError } from '../util.mjs';

const API = 'https://api.jamendo.com/v3.0';
const limiter = new Limiter(4, 30, 5000);
const cid = () => process.env.JAMENDO_CLIENT_ID || '';

export const info = {
  id: 'jamendo', name: 'Jamendo (Creative Commons)', fullTracks: true, needsKey: true,
  capabilities: ['search', 'full-playback', 'seek', 'speed', 'crossfade'],
  limitation: 'Independent Creative Commons catalog — you will not find major-label songs here. Check each track’s licence before any commercial use.',
};
export const configured = () => !!cid();

function need() {
  if (!cid()) throw new ProviderError('Jamendo', 'Jamendo is not configured. Add JAMENDO_CLIENT_ID to your .env file.', 501, 'not_configured');
}
const get = (path, ttl = 10 * 60_000) => { need(); return fetchJSON(`${API}${path}${path.includes('?') ? '&' : '?'}client_id=${cid()}&format=json`, { ttl, limiter, provider: 'Jamendo' }); };

function check(d) {
  if (d.headers && d.headers.status !== 'success') throw new ProviderError('Jamendo', d.headers.error_message || 'Jamendo error', d.headers.code === 5 ? 401 : 502);
  return d.results || [];
}

export function mapTrack(t) {
  return {
    id: `jm:${t.id}`, provider: 'jamendo', downloadable: t.audiodownload_allowed !== false, title: t.name, artist: t.artist_name, artistId: `jma:${t.artist_id}`,
    album: t.album_name || null, albumId: t.album_id ? `jmc:${t.album_id}` : null,
    artwork: t.album_image || t.image || null, artworkSmall: t.image || t.album_image || null,
    duration: t.duration || null, preview: false, playableDuration: t.duration || null,
    playable: !!t.audio, unplayableReason: t.audio ? null : 'Streaming is disabled for this track by its artist.',
    explicit: false, genre: t.musicinfo?.tags?.genres?.[0] || null, bpm: null,
    releaseDate: t.releasedate || null, license: t.license_ccurl || null, link: t.shareurl || null,
  };
}

export async function searchTracks(q, limit = 20) {
  return check(await get(`/tracks/?search=${encodeURIComponent(q)}&limit=${limit}&include=musicinfo&audioformat=mp32`, 5 * 60_000)).map(mapTrack);
}
export async function artistTracks(id) {
  const r = check(await get(`/artists/tracks/?id=${id}&limit=50&order=popularity_total&audioformat=mp32`, 60 * 60_000));
  if (!r.length) throw new ProviderError('Jamendo', 'Artist not found on Jamendo', 404, 'not_found');
  const a = r[0];
  return {
    artist: { id: `jma:${a.id}`, provider: 'jamendo', name: a.name, artwork: a.image || null, artworkSmall: a.image || null },
    top: (a.tracks || []).map((t) => mapTrack({ ...t, artist_id: a.id, artist_name: a.name, album_image: t.album_image || t.image })),
  };
}
export async function albumTracks(id) {
  const r = check(await get(`/albums/tracks/?id=${id}&audioformat=mp32`, 60 * 60_000));
  if (!r.length) throw new ProviderError('Jamendo', 'Album not found on Jamendo', 404, 'not_found');
  const a = r[0];
  return {
    album: { id: `jmc:${a.id}`, provider: 'jamendo', title: a.name, artist: a.artist_name, artistId: `jma:${a.artist_id}`, artwork: a.image, artworkSmall: a.image, releaseDate: a.releasedate, recordType: 'album', trackCount: a.tracks?.length || 0 },
    tracks: (a.tracks || []).map((t) => mapTrack({ ...t, artist_id: a.artist_id, artist_name: a.artist_name, album_name: a.name, album_id: a.id, album_image: a.image })),
  };
}
export async function audioUrl(pid) {
  const r = check(await get(`/tracks/?id=${pid}&audioformat=mp32`, 30 * 60_000));
  if (!r[0]?.audio) throw new ProviderError('Jamendo', 'This track is not streamable.', 404, 'no_stream');
  return r[0].audio;
}
