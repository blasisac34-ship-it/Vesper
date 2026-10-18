# Vesper — Playlist, Full Badge & Search Mix Update

## Changes
- Added a one-tap plus button on each song row to add that song to an existing playlist or create a playlist. This is separate from Liked Songs.
- Restored the compact **Full** badge for tracks known to have a full-length source, including resolved YouTube matches. The mini-player shows Full after a supported full-length source is ready.
- Track art now prefers `albumArtwork` when available, then catalog artwork, then the provider thumbnail.
- Selecting a song from regular Search plays only that song first. Autoplay then builds a recommendation mix rather than continuing down the search results list.
- Selecting a YouTube search result also starts a one-song seed mix rather than queuing every result from the search.
- Existing transition settings are preserved; crossfade/blend behavior applies according to the user's chosen transition preset and engine capabilities.

## Validation
- `node --check` passed for changed JavaScript files.
- `npm test` passed all 13 unit tests.
- Real provider responses, album art matching, and live playback still need end-to-end testing on the user's Mac.
