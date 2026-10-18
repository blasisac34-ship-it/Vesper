# Vesper 1.7 — Tempo detection

## What changed
- Added a lightweight live BPM estimator that reads spectral data from the existing audio graph while a song plays. It does not fetch or buffer more audio.
- Full-length streams can now gain a BPM estimate during playback instead of being permanently marked unknown because pre-analysis was skipped.
- Added a small local cache (up to 200 track IDs, refreshed on use) so a known estimate can appear next time without re-analysis. It is stored in this browser profile and does not change account data, playlists, sign-in, or server database files.
- Now Playing displays the BPM when known and indicates when analysis is underway.
- Bumped app version to 1.7.0, added What's New notes, and updated the service-worker shell cache to `vesper-shell-v20`.

## Important limits
- BPM is estimated from the audio actually playing; it may take 10–20 seconds or more and can remain unknown for ambient, sparse, irregular, or noisy music.
- The live analyser uses Vesper's Web Audio graph. If audio processing is disabled or unavailable (including the default iPhone path), live detection cannot run; provider/local-file BPM metadata can still be used.
- BPM is not the same as exact downbeat or beat-grid detection. DJ transitions still require suitable beat-phase data and may use their existing fallback.
- No extra audio download, upload, YouTube lookup, cookie/sign-in change, or data migration was added.

## Validation
Run `npm test` for the project unit tests. Live BPM accuracy depends on the device, browser, track, and playback conditions and should be tested with real songs; the unit suite does not prove live accuracy for every genre.
