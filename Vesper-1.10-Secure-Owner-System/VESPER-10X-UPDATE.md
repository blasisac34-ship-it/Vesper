# Vesper — Smart Mix, Transitions, Playlists & Mobile Update

## What changed

1. **Smarter Smart Mix feedback** — Now Playing has direct “More like this” and “Less like this” controls that save recommendation feedback to the user's profile.
2. **Album artwork consistency** — Album artwork is preferred in the player, Now Playing, ambient colors and Media Session metadata. When a provider only supplies a video thumbnail, Vesper keeps it labelled as ordinary artwork instead of pretending it is an official album cover.
3. **Transitions when choosing a new song** — When Web Audio is available and a song is already playing, manually choosing another song now prepares the new track on the second audio deck and blends into it using the selected transition preset. If processing is unavailable or the preset is Off, playback safely falls back to a normal switch.
4. **Following / new releases** — The existing Following page remains the artist-release hub, with newest tracks/releases and filter/sort controls for followed artists.
5. **Now Playing and playlist workflow** — The plus action is now a clearly labelled “Playlist” button on every track row (including mobile). Adding a song is separate from Liked Songs. Adding to a playlist checks for duplicate track IDs and offers to add only new songs. Existing queue drag/drop, lyrics, fullscreen Now Playing and keyboard shortcuts remain available; More/Less recommendation controls are now one tap away.
6. **Installable mobile shell** — Added a service worker to cache the app shell and static UI assets, so the interface can open offline after its first successful load. API requests and streaming audio remain online features; offline caching does not make the music catalog or streams available without a connection.

## Validation

Run `npm test` and JavaScript syntax checks. Live transitions depend on Web Audio being available and need playback testing with real provider streams on the target Mac/browser.
