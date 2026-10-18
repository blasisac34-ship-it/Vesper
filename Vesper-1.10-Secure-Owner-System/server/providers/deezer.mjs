// Deezer public API adapter.
// Capabilities: search (tracks/artists/albums/playlists), artist/album/playlist metadata,
// related artists, artist radio, charts, new releases, genre radios, BPM + gain on track detail.
// Playback: 30-second previews only. Full tracks are NOT available through this API.
import { fetchJSON, Limiter, ProviderError, sleep } from '../util.mjs';

const API = 'https://api.deezer.com';
const limiter = new Limiter(4, 45, 5000); // Deezer allows ~50 requests / 5 s

export const info = {
  id: 'deezer', name: 'Deezer', fullTracks: false, needsKey: false,
  capabilities: ['search', 'artists', 'albums', 'playlists', 'related', 'radio', 'charts', 'new-releases', 'bpm', 'preview-playback', 'seek', 'speed'],
  limitation: 'Catalog metadata source; Vesper looks for a playable full-length match when available.',
};

async function dz(path, ttl = 10 * 60_000, opts = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const d = await fetchJSON(API + path, { ttl, limiter, provider: 'Deezer', ...opts });
    if (d && d.error) {
      if (d.error.code === 4) { await sleep(1200 * (attempt + 1)); opts = { ...opts, noCache: true }; continue; } // quota
      if (d.error.code === 800) throw new ProviderError('Deezer', 'Not found on Deezer', 404, 'not_found');
      throw new ProviderError('Deezer', d.error.message || 'Deezer error', 502);
    }
    return d;
  }
  throw new ProviderError('Deezer', 'Deezer rate limit reached. Try again in a few seconds.', 429, 'rate_limited');
}

export function mapTrack(t, album) {
  const al = t.album || album || {};
  const ar = t.artist || {};
  return {
    id: `dz:${t.id}`, provider: 'deezer',
    title: t.title, artist: ar.name, artistId: ar.id ? `dz:${ar.id}` : null,
    album: al.title || null, albumId: al.id ? `dz:${al.id}` : null,
    artwork: al.cover_xl || al.cover_big || null, artworkSmall: al.cover_medium || al.cover || null,
    duration: t.duration || null, preview: true, playableDuration: 30,
    playable: !!t.preview && t.readable !== false,
    unplayableReason: t.preview ? null : 'Deezer has no preview for this track.',
    explicit: !!t.explicit_lyrics, bpm: t.bpm > 0 ? t.bpm : null, rank: t.rank || null,
    releaseDate: t.release_date || al.release_date || null, genre: null,
    link: t.link || null,
  };
}
export function mapAlbum(a) {
  return {
    id: `dz:${a.id}`, provider: 'deezer', title: a.title,
    artist: a.artist?.name || null, artistId: a.artist ? `dz:${a.artist.id}` : null,
    artwork: a.cover_xl || a.cover_big || null, artworkSmall: a.cover_medium || null,
    releaseDate: a.release_date || null, recordType: a.record_type || 'album',
    trackCount: a.nb_tracks ?? null, duration: a.duration ?? null,
    genre: a.genres?.data?.[0]?.name || null, label: a.label || null, explicit: !!a.explicit_lyrics,
  };
}
export function mapArtist(a) {
  return { id: `dz:${a.id}`, provider: 'deezer', name: a.name, artwork: a.picture_xl || a.picture_big || null, artworkSmall: a.picture_medium || null, fans: a.nb_fan ?? null, albumCount: a.nb_album ?? null };
}
export function mapPlaylist(p) {
  return { id: `dzp:${p.id}`, provider: 'deezer', title: p.title, description: p.description || '', artwork: p.picture_xl || p.picture_big || null, artworkSmall: p.picture_medium || null, creator: p.user?.name || p.creator?.name || 'Deezer', trackCount: p.nb_tracks ?? null };
}

const q = (s) => encodeURIComponent(s);
export const searchTracks = async (s, limit = 25) => (await dz(`/search?q=${q(s)}&limit=${limit}`, 5 * 60_000)).data.map((t) => mapTrack(t));
export const searchArtists = async (s, limit = 10) => (await dz(`/search/artist?q=${q(s)}&limit=${limit}`, 5 * 60_000)).data.map(mapArtist);
export const searchAlbums = async (s, limit = 12) => (await dz(`/search/album?q=${q(s)}&limit=${limit}`, 5 * 60_000)).data.map(mapAlbum);
export const searchPlaylists = async (s, limit = 10) => (await dz(`/search/playlist?q=${q(s)}&limit=${limit}`, 30 * 60_000)).data.map(mapPlaylist);

export async function track(id, { fresh = false } = {}) {
  const t = await dz(`/track/${id}`, fresh ? 0 : 10 * 60_000, fresh ? { noCache: true } : {});
  return { ...mapTrack(t), gain: t.gain ?? null, isrc: t.isrc || null, _preview: t.preview };
}
export async function album(id) {
  const a = await dz(`/album/${id}`, 60 * 60_000);
  return { album: { ...mapAlbum(a), contributors: (a.contributors || []).map((c) => ({ name: c.name, role: c.role })) }, tracks: (a.tracks?.data || []).map((t) => ({ ...mapTrack(t, a), genre: a.genres?.data?.[0]?.name || null })) };
}
export async function artist(id) {
  const [a, top, albums, related] = await Promise.all([
    dz(`/artist/${id}`, 60 * 60_000),
    dz(`/artist/${id}/top?limit=10`, 60 * 60_000),
    dz(`/artist/${id}/albums?limit=100`, 60 * 60_000),
    dz(`/artist/${id}/related?limit=12`, 60 * 60_000).catch(() => ({ data: [] })),
  ]);
  const all = albums.data.map(mapAlbum).sort((x, y) => (y.releaseDate || '').localeCompare(x.releaseDate || ''));
  return {
    artist: mapArtist(a),
    top: top.data.map((t) => mapTrack(t)),
    albums: all.filter((x) => x.recordType === 'album'),
    eps: all.filter((x) => x.recordType === 'ep'),
    singles: all.filter((x) => x.recordType === 'single'),
    compilations: all.filter((x) => x.recordType === 'compile'),
    related: related.data.map(mapArtist),
  };
}
export const artistInfo = async (id) => mapArtist(await dz(`/artist/${id}`, 7 * 24 * 3600_000));
export const artistTop = async (id, n = 10) => (await dz(`/artist/${id}/top?limit=${n}`, 60 * 60_000)).data.map((t) => mapTrack(t));
export const related = async (id, n = 10) => (await dz(`/artist/${id}/related?limit=${n}`, 60 * 60_000)).data.map(mapArtist);
export const artistRadio = async (id) => (await dz(`/artist/${id}/radio?limit=40`, 30 * 60_000)).data.map((t) => mapTrack(t));
export const artistAlbums = async (id) => (await dz(`/artist/${id}/albums?limit=50`, 60 * 60_000)).data.map(mapAlbum);
export async function playlist(id) {
  const p = await dz(`/playlist/${id}`, 30 * 60_000);
  return { playlist: { ...mapPlaylist(p), link: p.link }, tracks: (p.tracks?.data || []).map((t) => mapTrack(t)) };
}
// genreId 0 = Deezer's worldwide chart
export async function chart(genreId = 0, kind = 'tracks', limit = 50) {
  const d = await dz(`/chart/${genreId}/${kind}?limit=${limit}`, 30 * 60_000);
  const map = kind === 'tracks' ? (t) => mapTrack(t) : kind === 'albums' ? mapAlbum : kind === 'artists' ? mapArtist : mapPlaylist;
  return d.data.map(map);
}
export const newReleases = async (limit = 30) => (await dz(`/editorial/0/releases?limit=${limit}`, 60 * 60_000)).data.map(mapAlbum);
export const genres = async () => (await dz('/genre', 24 * 3600_000)).data.filter((g) => g.id !== 0).map((g) => ({ id: g.id, name: g.name, artwork: g.picture_xl || g.picture_big }));
export async function genreRadios() {
  const d = await dz('/radio/genres', 24 * 3600_000);
  return d.data.flatMap((g) => (g.radios || []).map((r) => ({ id: `dzr:${r.id}`, title: r.title, genre: g.title, artwork: r.picture_xl || r.picture_big, artworkSmall: r.picture_medium })));
}
export const radioTracks = async (id) => (await dz(`/radio/${id}/tracks?limit=40`, 15 * 60_000)).data.map((t) => mapTrack(t));

// Server-side resolution of the preview URL. Deezer preview URLs are signed and expire,
// so we always fetch a fresh one when (re)starting playback.
export async function audioUrl(pid, { fresh = false } = {}) {
  const t = await track(pid, { fresh });
  if (!t._preview) throw new ProviderError('Deezer', 'Deezer has no preview for this track.', 404, 'no_preview');
  return t._preview;
}
