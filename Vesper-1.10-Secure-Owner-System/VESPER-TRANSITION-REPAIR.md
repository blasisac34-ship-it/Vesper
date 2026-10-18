# Vesper transition repair

## What changed
- YouTube-matched full tracks no longer bypass Vesper's transition engine. They use the existing `/api/audio/:id` route and the same two audio decks as other internally streamed tracks.
- The upcoming track is now warmed on the idle deck and marked ready only after the browser reports playable audio, instead of treating a resolved stream URL as ready.
- The idle deck is warmed again after a transition or deck cleanup, avoiding a late load at the transition point.
- Updated the YouTube badge tooltip to reflect Vesper's internal audio path.
- Preserved Mood-to-Mix and all other project files.

## Validation
- `node --check public/js/engine.js`
- `node --check public/js/queue.js`
- `node --check public/js/ui.js`
- `npm test` (18/18 tests passed)

## Limitations
- Automated unit tests do not simulate real YouTube stream availability or browser audio output. Test playback in the app with two consecutive full-length tracks.
- This change uses the project's existing server-side YouTube audio resolver/proxy rather than the official embedded YouTube iframe player. Confirm this playback approach is appropriate for your distribution and applicable YouTube terms before publishing the app.
