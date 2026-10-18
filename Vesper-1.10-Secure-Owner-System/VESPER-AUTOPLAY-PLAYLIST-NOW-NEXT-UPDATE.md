# Vesper — Autoplay, Playlists & Now Playing Update

## Changes
- Removed translation controls from Lyrics Pro; lyrics stay in Vesper with font sizing, current-line jump, alternate matching and fullscreen.
- Fixed the shared dialog lifecycle so submitting a form returns its entered values instead of being cancelled by a queued dialog close event.
- Fixed the Add to Playlist → New playlist flow to wait for the chooser to finish closing before opening the create form; newly created playlists from this flow include the selected song(s).
- Added a four-image 2×2 cover collage for playlists without a custom cover, using up to the first four track artworks. Custom playlist covers still take priority.
- Added a Now Playing “Up next” preview during the final 20 seconds of a song, including the next track’s artwork, title, artist, and countdown.
- Improved autoplay by deduplicating recommendations by normalized title and artist as well as track ID, filtering unplayable items, and retrying with broader discovery if the selected mix has no fresh tracks.
- Bumped the service worker shell cache to v6 so the updated interface can replace cached assets.

## Verification
- JavaScript syntax checks pass.
- `npm test`: 13/13 tests pass.
- ZIP integrity check passes.
- Live browser playback, API-backed playlist creation, and real-stream next-track timing still need to be verified on the user's Mac.
