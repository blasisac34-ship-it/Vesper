// Apple iTunes Search API + Apple Marketing Tools RSS feeds.
// Capabilities: track/album/artist search, lookup, US "Top Songs" chart (Apple Music most-played).
// Playback: 30-second previews only. Full Apple Music playback needs MusicKit (not implemented).
import { fetchJSON, Limiter, ProviderError } from '../util.mjs';

const limiter = new Limiter(3, 18, 60_000 / 3); // Apple suggests roughly 20 calls / minute
const SEARCH = 'https://itunes.apple.com/search';
const LOOKUP = 'https://itunes.apple.com/lookup';
const RSS = 'https://rss.applemarketingtools.com/api/v2';

export const info = {
  id: 'itunes', name: 'Apple Music catalog', fullTracks: false, needsKey: false,
  capabilities: ['search', 'preview-playback', 'us-chart', 'seek', 'speed'],
  limitation: 'Catalog metadata source; full Apple Music playback requires MusicKit and a subscriber, so Vesper looks for a playable full-length match when available.',
};

const art = (u, size) => (u ? u.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`) : null);

export function mapTrack(r) {
  return {
    id: `it:${r.trackId}`, provider: 'itunes',
    title: r.trackName, artist: r.artistName, artistId: r.artistId ? `ita:${r.artistId}` : null,
    album: r.collectionName || null, albumId: r.collectionId ? `itc:${r.collectionId}` : null,
    artwork: art(r.artworkUrl100, 600), artworkSmall: art(r.artworkUrl100, 200),
    duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : null,
    preview: true, playableDuration: 30, playable: !!r.previewUrl,
    unplayableReason: r.previewUrl ? null : 'No playable match available for this track.',
    explicit: r.trackExplicitness === 'explicit', genre: r.primaryGenreName || null,
    releaseDate: r.releaseDate ? r.releaseDate.slice(0, 10) : null, bpm: null, link: r.trackViewUrl || null,
  };
}

const get = (url, ttl = 10 * 60_000) => fetchJSON(url, { ttl, limiter, provider: 'Apple' });

export async function searchTracks(q, limit = 25) {
  const d = await get(`${SEARCH}?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}&country=US`, 5 * 60_000);
  return d.results.filter((r) => r.kind === 'song').map(mapTrack);
}

export async function lookup(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const d = await get(`${LOOKUP}?id=${chunk.join(',')}&country=US&entity=song`, 60 * 60_000);
    for (const r of d.results) if (r.wrapperType === 'track') out.set(String(r.trackId), r);
  }
  return out;
}

export async function lookupOne(id) {
  const d = await get(`${LOOKUP}?id=${id}&country=US`, 60 * 60_000);
  if (!d.results?.length) throw new ProviderError('Apple', 'Not found on Apple', 404, 'not_found');
  return d.results[0];
}

export async function audioUrl(pid) {
  const r = await lookupOne(pid);
  if (!r.previewUrl) throw new ProviderError('Apple', 'No playable match available for this track.', 404, 'no_preview');
  return r.previewUrl;
}

// Apple Music "Top Songs" (most played) for the United States. Feed reports its own `updated` time.
export async function usTopSongs(limit = 50) {
  const feed = await get(`${RSS}/us/music/most-played/${limit}/songs.json`, 30 * 60_000);
  const results = feed.feed?.results || [];
  const looked = await lookup(results.map((r) => r.id)).catch(() => new Map());
  const tracks = results.map((r) => {
    const l = looked.get(String(r.id));
    if (l) return mapTrack(l);
    return {
      id: `it:${r.id}`, provider: 'itunes', title: r.name, artist: r.artistName, artistId: r.artistId ? `ita:${r.artistId}` : null,
      album: null, albumId: null, artwork: art(r.artworkUrl100, 600), artworkSmall: art(r.artworkUrl100, 200),
      duration: null, preview: true, playableDuration: 30, playable: false,
      unplayableReason: 'No playable match available for this chart entry.', explicit: r.contentAdvisoryRating === 'Explict' || r.contentAdvisoryRating === 'Explicit',
      genre: r.genres?.[0]?.name || null, releaseDate: r.releaseDate || null,
    };
  });
  return { tracks, updated: feed.feed?.updated || null, title: feed.feed?.title || 'Top Songs' };
}

export async function usTopAlbums(limit = 50) {
  const feed = await get(`${RSS}/us/music/most-played/${limit}/albums.json`, 60 * 60_000);
  return {
    albums: (feed.feed?.results || []).map((r) => ({ id: `itc:${r.id}`, provider: 'itunes', title: r.name, artist: r.artistName, artistId: r.artistId ? `ita:${r.artistId}` : null, artwork: art(r.artworkUrl100, 600), artworkSmall: art(r.artworkUrl100, 200), releaseDate: r.releaseDate || null })),
    updated: feed.feed?.updated || null,
  };
}
