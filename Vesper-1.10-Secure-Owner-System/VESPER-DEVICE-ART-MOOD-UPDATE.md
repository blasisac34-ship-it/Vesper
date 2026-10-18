# Vesper — Device, Artwork & Mood Mix Update

## Changes

- Favorite-artist onboarding now lazily resolves real provider artist portraits for curated starter artists, with cached portrait URLs between rerenders and a graceful initials fallback when a portrait is unavailable.
- Album tiles, artist tiles, session tiles, song rows and mix cards consistently show provider artwork when available, and use Vesper's generated cover artwork when an image is missing or fails to load.
- Listening-session cards now request and cache actual artwork from matching public playlists.
- Daily Mix cards use up to four different song covers in a 2×2 collage, seeded from the artist's listening history or top tracks.
- Added an output-device indicator to the desktop player. It displays the device name when the browser exposes it, responds to device-change/focus events, and offers the browser's audio-output picker where supported. Browsers may hide the currently active system output name; macOS Control Center remains authoritative in that case.
- Mood-to-Mix no longer seeds a mix from loose track-search matches. It searches for a matching playlist/genre, filters common type-beat/instrumental uploads unless requested, and falls back to the user's liked tracks/followed artists. If no reliable seeds exist, it asks for a clearer mood instead of playing a song that merely shares words with the prompt.
- Bumped the service-worker cache to v10.

## Verification

- JavaScript syntax checks pass for the changed modules.
- `npm test`: 15 tests passed.
- ZIP integrity check performed after packaging.
- Live browser and provider behavior still need to be checked on the user's Mac; audio-device labels depend on browser permissions and platform support.
