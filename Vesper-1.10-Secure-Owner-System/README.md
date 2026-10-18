# Vesper

A personal music player that runs on your Mac and in your phone's browser. It searches real catalogs, plays what those catalogs legally allow, blends songs with a real crossfade engine, shows synced lyrics, and puts your music on the phone's Lock Screen.

## Quick start (Mac)

1. Install **Node.js LTS** (version 18.17 or newer) from <https://nodejs.org>. Nothing else needs installing — Vesper has no npm dependencies.
2. Unzip Vesper anywhere, for example in your Documents folder.
3. Open **Terminal** (Cmd+Space, type “Terminal”).
4. Type `cd ` (with a space), drag the **vesper** folder into the Terminal window, and press Return.
5. Type `npm start` and press Return.
6. Open <http://localhost:5177> in your browser. Type your name and choose **Continue**.

This runs Vesper with Node.js directly, so macOS doesn’t need to open an unsigned app and won’t show a security warning. Vesper never asks you to turn off macOS protections.

No internet? Search for **test signal** to try the player with the built-in offline test tones.

To stop Vesper, press `Ctrl+C` in Terminal or close the window. Next time, repeat steps 3–6.

## Use it on your phone

1. Keep Vesper running on your Mac. The Terminal shows a line like `On your phone: http://192.168.1.20:5177`.
2. Open that address in Safari or Chrome on a phone on the **same Wi-Fi**.
3. In Settings on the Mac, choose **Add sign-in** to give your profile a username and password, then sign in with it on the phone to share your library. (Or start a separate guest profile on the phone.)
4. Optional: Safari's Share button → **Add to Home Screen** for an app-like icon.

When you lock the phone, the current song's title, artist, artwork and play/pause/next/previous controls appear on the Lock Screen, and headphone buttons work. See [Lock Screen notes](#lock-screen-notes) for platform caveats.

## Music sources

| Source | Setup | What plays |
|---|---|---|
| **Deezer** | None | 30-second previews of almost any commercial song. Also powers artists, albums, related artists, radio, charts and recommendations. |
| **Apple (iTunes)** | None | 30-second previews. Also powers the United States Top 50 (Apple Music Top Songs feed). |
| **Jamendo** | Free client ID in `.env` | **Full-length** independent Creative Commons music. You won't find major-label songs here. |
| **My music folder** | `MUSIC_DIR` in `.env` | **Full-length** playback of your own files. `.lrc` files next to songs give synced lyrics. |
| **Test signals** | None | Synthesized tones at known tempos for checking the player. Not music. |

Every song shows a **Preview** or **Full** badge, and the player says which source is playing.

### Why most popular songs are previews

Full-track streaming of commercial music is only available to third-party apps through each service's own player, and each requires accounts Vesper can't create for you:

- **Spotify** — Web Playback SDK: a Spotify developer app, OAuth sign-in, and Spotify Premium for every listener. Audio plays inside Spotify's SDK, so Vesper's crossfades, leveling and visualizer can't process it.
- **Apple Music** — MusicKit JS: Apple Developer Program membership ($99/year), a signed developer token, and an Apple Music subscription per listener.

Spotify and Apple Music full-track integrations are not built yet. Use YouTube streaming and local downloads only for content you are authorized to access and save, and respect applicable copyright law and source-site terms.

### Optional setup

1. Copy `.env.example` to `.env` (in Terminal: `cp .env.example .env`).
2. **Jamendo**: create an app at <https://devportal.jamendo.com>, copy the **Client ID** into `JAMENDO_CLIENT_ID=`.
3. **Your music**: set `MUSIC_DIR=~/Music/YourFolder`.
4. Restart Vesper. Settings → Music sources shows each source's status.

## Features

**Tempo detection (1.7).** When Vesper’s Web Audio processing is available, it listens to a lightweight spectral summary of the audio already playing and estimates BPM after enough rhythmic material has played. Results are cached locally for up to 200 tracks. It does not download extra audio, make extra YouTube requests, or upload audio. On iPhone, with processing disabled, or on music without a clear beat, BPM may remain unknown. This is a tempo estimate, not guaranteed beat-grid/downbeat detection.

**Background preparation (1.6).** Vesper quietly pre-matches selected onboarding artists, the first tracks of Home mixes, top catalog search results, and uncached songs in Liked Songs/playlists. Preparation is serialized, uses the existing YouTube cooldown and concurrency limits, and shows per-song status. See [VESPER-1.6-UPDATE.md](VESPER-1.6-UPDATE.md).


**Playback and transitions.** Two audio decks run through the Web Audio API. Six presets:

- **Smooth** — equal-power crossfade, 1–12 seconds.
- **Seamless** — no fade; silence at the end and start of songs is trimmed so they join closely.
- **DJ** — blend length snapped to 16 (or 8, or 4) beats at the outgoing song's tempo, with a bass swap (high-pass filter) on the outgoing song.
- **Cinematic** — long S-curve blend; the outgoing song is gradually low-passed.
- **Minimal** — 1.5-second blend.
- **Off** — each song plays to its very end; no overlap.

Before a song plays, Vesper decodes it (previews, test signals, and full tracks up to 8 minutes on desktop) and measures tempo, loudness, leading/trailing silence and natural fade-out. Transitions shorten automatically for short songs and songs that already fade out. A limiter prevents clipping during overlaps. Volume leveling evens out loudness (−9 to +6 dB). Playback speed is 0.75×–2× with pitch preserved.

**Tempo honesty.** Tempo comes from Deezer's data when Deezer has it, otherwise from Vesper's own estimate. Beat *phase* (exact downbeat alignment) and musical key are not detected, so Vesper doesn't claim beat-matching or key-matching — DJ mode aligns blend *length* to beats only.

**Now Playing.** Full-screen view laid out in separate regions (artwork, title and artist with a Preview/Full badge, like/save, progress, controls, tools). Artwork is sized from the space left after everything else is placed, so it never covers text or controls, on screens from an iPhone SE with Safari toolbars to desktop, and in landscape. Swipe down to close on phones. It has with five modes: Minimal, Ambient (slowly drifting blurred cover), Immersive (slow zoom with floating particles), Visualizer (frequency ring around the cover) and Lyrics. All motion is generated from the cover image; these sources don't provide official animated covers. Colours across the app follow the current cover, with contrast checked for readability. Motion stops when hidden and respects Reduce Motion.

**Lyrics.** Synced lyrics highlight and scroll with the song, with the active line gently scaled and glowing in the cover’s colour. When a source provides word timestamps (enhanced LRC), each word lights up as it’s sung; otherwise timing is line by line, and the page says which. Fullscreen lyrics live in Now Playing’s Lyrics mode; the side panel is the compact view; tap a line to jump there. Seeking re-syncs immediately. Sources: your `.lrc` files, then LRCLIB. For 30-second previews, lyrics show unsynced, because a preview is a clip from somewhere inside the song and can't be matched to the timings.

**Discovery.** Start from any song in Discover and get a session built from Deezer's related-artist graph, artist radio, Deezer tempo data, and your likes, skips and feedback. Steer it with *Keep the same vibe*, *Make it calmer*, *Make it more upbeat* (both use tempo, so they only work when Deezer knows the seed's tempo), *Explore something new* and *Hidden gems*. Every recommended song shows why it was picked. Song menus offer *More like this*, *Less like this* and *Don't recommend this artist*. Home builds Daily Mixes, Discover, Hidden Gems, New Music for You, Your Most Replayed and Recently Discovered from your listening. Vocal/instrumental and mood filters aren't offered because these sources don't supply that data.

**Up Next.** Your own additions always play first, then the album or list you started, then Autoplay suggestions that keep the feel of what's been playing. Drag to reorder (mouse, touch, or arrow keys on the handle), remove, clear, play next, shuffle, repeat all/one. Refreshing Autoplay never removes songs you added. The queue is restored when you reopen Vesper.

**Charts.** United States Top 50 (Apple Music), Worldwide Top 50, Top Albums, US Top Albums, Top Artists, New Releases (Deezer), and ten genre charts. Each shows its source and update time. Position changes are computed from Vesper's own daily snapshots, so they appear after you've opened a chart on two different days. "Fastest rising" uses the same snapshots. Nothing is invented.

**Library.** Liked songs, saved albums, followed artists (with a Following page of their releases from the last 6 months, plus filtering and sorting by name, recently followed or newest release; follows use Deezer’s stable artist IDs so same-name artists stay separate), playlists, recently played, saved sessions, and your music folder. Playlists support renaming, descriptions, custom covers, reordering, removing, duplicating, sorting, searching, and sharing with other profiles on the same server.

**Equalizer and audio.** Open it with the sliders icon in the player, the Equalizer button in Now Playing, or Settings. Ten peaking bands (31 Hz–16 kHz, ±12 dB), Bass/Midrange/Treble controls layered on top, presets (Flat, Bass Boost, Treble Boost, Vocal, Pop, Rock, Electronic, Custom), and up to 20 of your own presets you can save, rename and delete. The panel draws the equalizer’s real frequency response over a live spectrum. A pre-gain lowers the level by most of the largest boost and a limiter catches anything left, so boosts don’t clip. The equalizer runs once on the master output, so it’s never applied twice during crossfades. Settings are saved to your profile. It works on everything Vesper plays itself (previews, Jamendo, your files); it needs audio processing, which is off by default on iPhone.

**Vesper Replay.** Your recap for any year, prepared automatically once a year ends and kept even if you later clear your history (you can delete saved recaps). Also “so far this year” and custom date ranges. Animated story cards cover listening minutes, top songs and artists, albums and genres (only when most plays have that data), time of day and weekday, month by month, longest streak, biggest day, artists new to you, how your taste shifted, plain-fact milestones, and an “honest numbers” card. Share as an image you choose where to send; recaps are otherwise private. Counting rules: a listen is ≥ 30 s of a full track or ≥ 15 s of a preview; shorter plays are “brief starts” that never reach top lists; time counts only while audio plays (skipping ahead adds nothing); previews and full tracks are reported separately; test signals are excluded; nothing is imported.

**Listening stats.** Listening time, plays, top artists, songs and albums, genres (with how much of your listening has genre data), activity by day or month, time of day, streaks, most replayed and recently discovered artists, for 7 days, 30 days, this month, this year or all time. Only plays recorded by Vesper count. You can turn history recording off, keep it out of recommendations, or clear it.

**Owner account.** On a fresh hosted deployment, configure `VESPER_OWNER_USERNAME=Isaac` and a unique `VESPER_OWNER_PASSWORD` (12+ characters, no spaces) in the server’s private `.env` before starting Vesper. There is no default password. The account is created with owner permissions on first startup; the owner can view server status, back up data and manage supported server updates. Existing profiles and data are not overwritten. See [VESPER-1.10-UPDATE.md](VESPER-1.10-UPDATE.md).

**Accounts.** Guest profiles, or username and password (hashed with scrypt). Sign-in attempts are rate-limited. **Export my data** in Settings downloads your profile, library, playlists, history and recaps as JSON. Each person's library, playlists and history are only readable by them; shared playlists are read-only to others. Delete your profile from Settings.

**Keyboard.** Space play/pause, ←/→ seek 5 s, Shift+←/→ previous/next, / search, Q up next, L lyrics, M mute, F Now Playing.

## Windows desktop app and automatic updates

See [WINDOWS-APP-AND-UPDATES.md](WINDOWS-APP-AND-UPDATES.md) for building the Windows `.exe` installer and publishing GitHub releases so installed desktop apps can update. A compiled installer is not included in this source ZIP.

## Lock Screen notes

- **iPhone/iPad:** Safari shows title, artist, artwork and controls via the Media Session API. iOS can suspend Web Audio when the screen locks, so on iOS Vesper turns audio processing **off by default** — songs keep playing locked, but crossfades, leveling and the visualizer are disabled (songs switch directly, with silence trimmed). You can turn processing on in Settings to try it.
- **Animated Lock Screen artwork** is not possible from a website; the Lock Screen shows the static cover.
- **Android Chrome** and desktop browsers show media controls in their own notification or media hub.
- If controls don't appear when connecting over plain `http://` to your Mac's IP, that's a browser restriction on non-secure origins; it works on `localhost`, and over HTTPS (e.g. a reverse proxy or tunnel).
- This hasn't been tested on a physical phone yet.

## Licensing notes

- **Lyrics:** LRCLIB is a free, community-contributed database, not a licensed lyrics provider. Fine for personal use; replace it with a licensed provider (e.g. Musixmatch's commercial API) before distributing this app. You can turn it off in Settings.
- **Previews and metadata** from Deezer and Apple are for promotional/personal use under their terms. Review them before any public or commercial use.
- **Jamendo** tracks carry individual Creative Commons licences, linked from each track.

## Project structure

```
server/
  server.mjs          HTTP server, routes, auth, audio streaming (Range), image proxy
  db.mjs              JSON-file database with atomic writes
  recommend.mjs       Recommendation engine and Daily Mixes
  stats.mjs           Listening statistics
  util.mjs            Caching, rate limiting, retries, relevance scoring
  providers/          deezer, itunes, jamendo, local (ID3/.lrc), testsignal
public/
  index.html, css/app.css
  js/main.js          Router, player bar, actions, Media Session, shortcuts
  js/engine.js        Audio engine: decks, transitions, leveling, logging
  js/analysis.js      Tempo, loudness, silence and fade-out analysis
  js/queue.js         Up Next and Autoplay
  js/lyrics.js, lrc.js, color.js, nowplaying.js, panels.js, views.js, views-me.js, ui.js, store.js
tests/
  unit.test.mjs       Node unit tests (no browser needed)
  e2e.py              Browser end-to-end tests (Playwright + Chromium)
data/                 Created on first run: your profiles, playlists and history
```

Provider audio URLs are resolved on the server and streamed through `/api/audio/:id`, so signed URLs never reach the browser and expired Deezer links are refreshed automatically. API calls are cached and rate-limited per provider.

## Tests

```
npm test                       # 13 unit tests: tempo, silence/fade, LRC + word timing, ID3, stats, Replay rules, EQ, isolation
python3 tests/e2e.py URL       # 55 browser checks: playback, queue, transitions, lyrics, persistence, accounts
python3 tests/e2e_v2.py URL    # 30 browser checks: layout at 6 screen sizes, badges, EQ effect on audio, word lyrics, Replay
```

**Listening tests (by ear).** Play two songs you know with each transition preset and listen for clicks, gaps or doubled audio; skip and seek during a crossfade (the old song should stop within a fraction of a second). Turn on Bass Boost, then Treble Boost, on a full track: the change should be obvious but not distorted. Switch Volume leveling on and compare a quiet and a loud song.

The browser suites need Python with Playwright (`pip install playwright && playwright install chromium`). It uses the offline test signals, so it covers playback, pause, seek, next/previous, queue editing, crossfade/DJ/Off transitions, lyric sync, artwork and Lock Screen metadata, persistence across reloads, navigation without interruption, mobile layout, error display, accounts and data isolation.

**Not covered by automated tests:** live Deezer, Apple, Jamendo and LRCLIB responses (the tests ran without internet; the integrations follow those services' documented APIs and their error handling is tested), and real phone Lock Screen behaviour.

## Troubleshooting

- **"Couldn't reach Deezer/Apple"** — check your internet connection. Each source fails independently; others keep working.
- **A song says Preview but won't play** — some songs have no preview in your region. Vesper shows the reason and skips it.
- **Phone can't connect** — same Wi-Fi as the Mac? macOS may ask to allow incoming connections for `node`; choose Allow. Check that `HOST=0.0.0.0`.
- **Port already in use** — set a different `PORT` in `.env`.
- **Start over** — stop Vesper and delete the `data/` folder.

## What's not done

- Community features: public profiles, publishing and liking collections, following users, featured collections. Playlists can already be shared with other profiles on the same Vesper server; anything beyond your home network needs hosting (see below).
- Optional local AI (natural-language mixes, explanations, taste summaries). Recommendations today are rule-based and explain themselves without AI.
- Official animated album artwork (no accessible source).
- Beat-phase alignment and key detection for transitions.
- Artist biographies and concert dates (needs a provider like Songkick or Bandsintown).
- Push notifications for new releases (they appear on the Following page instead).
- Importing listening history from other services.
- Reading tags from non-MP3 files (M4A, FLAC and others fall back to file and folder names).

### About hosting

Vesper runs on your Mac and serves devices on the same Wi-Fi. To use it away from home or with friends elsewhere, it would need to run on an always-on server with HTTPS (a small cloud VM or a home server behind a secure tunnel). Community features are deliberately not built until that’s decided, because public sharing needs that hosting, plus moderation and stronger rate limiting.


## Set up YouTube (full-length songs)

Vesper restores the earlier full-song workflow: it uses `yt-dlp` on the Mac to find full-length YouTube videos and streams the audio through Vesper’s normal player and queue. A YouTube Data API key is not required, and YouTube results do not intentionally fall back to 30-second catalog previews just because an API key is missing.

1. Install Homebrew if needed, then run `brew install yt-dlp` in Terminal.
2. If it is already installed, update it with `brew upgrade yt-dlp`.
3. Restart Vesper completely so the server can use the updated executable.
4. In Search, choose YouTube and search for a song. To turn a Deezer or Apple preview into a full song, leave **Full songs via YouTube** enabled in Settings.

If Vesper says `yt-dlp` is missing, make sure the command works in Terminal with `yt-dlp --version`. If Homebrew installed it somewhere unusual, set `YT_DLP_PATH` in `.env` to the full path of the executable and restart.

YouTube may change its delivery system, so keep `yt-dlp` current. Stream access can still fail for unavailable, restricted, or removed videos. Use only content you are authorized to access and respect applicable copyright law and YouTube’s terms.

## Use Vesper away from home
See `REMOTE-ACCESS.md` for a free, private Tailscale setup with HTTPS.


## Desktop app builds

See `DESKTOP-APP-SETUP.md` for building the Electron desktop app and connecting it to a shared HTTPS Vesper server. A local desktop instance keeps its own data; friends share the same playlists and accounts only when all devices connect to the same hosted server.

## New in 1.1
Lyrics search, shareable lyric cards, playlist import (Spotify via Exportify, Apple Music export, pasted lists), Discord status in the desktop app, Data saver, correct song lengths, faster song changes, working Calmer / More upbeat, and a cleaner iPhone layout. See `VESPER-1.1-UPDATE.md`, including the Discord setup steps.


## Global live radio directory (Vesper 1.8)

The Radio section uses the community-maintained Radio Browser directory to list popular stations and search a much wider international catalog. Filter by country, language, or genre, and sort by recent listening activity or community votes. Station stream uptime and regional availability are controlled by each broadcaster; the directory cannot guarantee every station works everywhere.
