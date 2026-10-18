# Vesper 1.6 — Background preparation and faster starts

## What changed

- **Onboarding preparation.** While a new listener chooses favourite artists, Vesper fetches the top two catalog tracks for each selection through a lightweight endpoint (without downloading the artist’s full albumography). After account creation succeeds, those songs enter the background preparation queue while artist follows finish.
- **Home mixes.** After Home renders, Vesper fetches each displayed mix in sequence and queues only its first track for background preparation. The warm-up response contains only that first track, avoiding unnecessary catalog payload on iPhone.
- **Search.** The top five Deezer/Apple catalog song results are queued after results render. YouTube search results selected directly by the listener are not sent through the official-song matcher.
- **Liked Songs and playlists.** A small-metadata endpoint collects catalog tracks from the user's likes and playlists, filters out tracks already matched in `data/match-cache.json`, and returns only tracks that still need matching. No audio is downloaded.
- **Polite queue.** Client background matching uses `background: true`, processes one track at a time with a 2.2-second gap, deduplicates by title + artist, and pauses when YouTube asks for sign-in. The server's existing two-at-a-time yt-dlp limit and ten-minute block cooldown remain authoritative.
- **Visible status.** Track rows show Queued, Preparing, Ready, or No full match while preparation runs. Reduced-motion preferences are respected by the small status indicator.
- **Version consistency.** The client matcher version now matches the server (`MATCH_V = 5`), package version is `1.6.0`, and the service-worker shell cache is `vesper-shell-v19`. Desktop “What's new” has a 1.6.0 entry.

## Preserved

- No YouTube Data API key and no YouTube embed/player were added.
- The strict official-release matcher, artist/credit checks, length checks, and fake-version rejection are unchanged.
- The preview fallback remains controlled by the existing Settings option.
- Existing account data, playlists, library, history, and sign-in/session storage are not migrated or rewritten. The new endpoint only reads library metadata.
- Background preparation never downloads the audio file; it asks the existing stream-preparation endpoint to cache stream details.

## Validation

- `npm test`
- `node --check` for changed JavaScript modules
- Version parity check for client/server `MATCH_V`
- ZIP integrity check

Live YouTube availability and real browser playback still need to be checked on the target machine. Background work deliberately yields to playback and will pause if YouTube blocks requests.
