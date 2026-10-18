# Vesper — Playlist, Lyrics Pro & Playback Update

## Fixes
- Playlist selection now opens a dedicated, scrollable chooser instead of relying on a small anchored popover. The same chooser is used from song rows, the three-dot track menu, and Now Playing.
- Track popovers are mounted at the document level to avoid stacking-context issues that can place menus behind the player or Now Playing overlay.
- Playlist addition skips duplicate tracks and reports when the song is already present.
- Imported `confirmDialog` issue is avoided by the new chooser flow.

## Lyrics Pro
- Added a Lyrics toolbar with current-line jump, adjustable text size, fullscreen mode, translation-language selector, and an alternate-match lookup.
- Translation opens the selected lyric text in Google Translate in a separate tab; it does not replace lyrics inside Vesper.
- Synced word-level highlighting still depends on the lyric source supplying timestamps.
- Escape exits fullscreen lyrics.

## Playlist management
- Added drag-and-drop reorder for owned playlists while viewing custom order.
- Existing playlist cover, title, description, share/privacy, duplicate and delete actions remain.

## Playback, Smart Mix & phone experience
- Manual song selection attempts the configured crossfade after ensuring the desktop Web Audio graph has been initialized. If processing is unavailable/disabled, Vesper explains why it used a normal switch instead.
- Existing More like this / Less like this feedback remains wired to Vesper recommendations.
- Bumped the service-worker cache version and ensured the personal-view module is precached so updated UI files refresh on install/update.

## Verification
- `npm test`: 13/13 passing.
- `node --check` passed for all public JavaScript files and `server/server.mjs`.
- ZIP integrity checked before delivery.
- Live browser interaction and real audio crossfades still need testing on the user's Mac.
