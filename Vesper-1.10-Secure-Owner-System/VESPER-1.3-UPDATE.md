# Vesper 1.3 — Only real songs, lyrics that show up

## Why the fake One Dance still played
1.2 ranked normal YouTube search results and played the best one. A popular re-upload titled "Drake - One Dance" can look official by its title and view count while being a sped-up, pitched or AI copy. On top of that, songs already matched (in your queue, likes or playlists) kept the old fake video.

## What 1.3 does instead
A full song only plays after it passes every check:
1. It comes from **YouTube Music's Songs results** (released tracks), or from the artist's own **"– Topic" / VEVO / verified channel**. Random uploader channels are never used.
2. YouTube's own credits for the track list the **exact artist name** ("Drake", not "Drakee" or "Drake Fan Page").
3. The **length matches** the official catalog length (within about 10 seconds). Sped-up, slowed, pitched and most AI copies fail this.
4. Titles marked sped up / slowed / nightcore / AI / cover / remix / karaoke / live / leak are rejected unless that's the song you picked.

If nothing passes, Vesper plays the **official 30-second clip** and says so, rather than gambling on a fake. Matches are saved on the server, so each song is checked once.

Songs matched by older versions are **checked again automatically** the next time they play, so fakes already in your likes, playlists or queue get replaced.

The YouTube search tab still shows regular YouTube videos you pick yourself; only the artist's Topic/VEVO channels get the Official badge there.

## Lyrics from several sources
Order tried: your own .lrc files → lyrics Vesper already found → **LRCLIB** (exact, then search) → **NetEase Cloud Music** (synced) → **Lyrics.ovh** (plain text). Each result is checked against the artist and length so you don't get the wrong song's lyrics. Credit lines (writer, producer) are removed.
- Found lyrics are **saved on the server**, so they load instantly next time, even if a service is down.
- If a service is down (like the LRCLIB 503 you saw), Vesper tries the others, retries once while the song plays, and checks again next time. Outages aren't remembered as "no lyrics".
- These are community lyrics sources, fine for personal use, not licensed for public distribution.

## Updating
Mac copy: stop Vesper, unzip, copy your `data` folder (and `.env`) in, `npm start`. On a server set up with HOSTING.md: Settings › Your Vesper server › Install an update.

Keep yt-dlp current (`brew upgrade yt-dlp` on the Mac; the server script updates it daily). The new matcher uses YouTube Music search, which needs a recent yt-dlp.

## Tested
- Simulated YouTube with a popular fake upload ("Drake - One Dance", uploader channel, wrong length) and a look-alike AI release ("Drakee – Topic"): both rejected, the real "Drake – Topic" release chosen. A song with no official version falls back to the clip. Repeat requests are served from the saved match.
- Lyrics: credit lines removed, wrong-song results rejected, outages reported without caching "not found".
- 20/20 unit tests.
- Not tested here: live YouTube, LRCLIB, NetEase and Lyrics.ovh (no internet in the build environment). If a song still sounds wrong, send me its name and artist; the server log lists why each candidate was rejected.
