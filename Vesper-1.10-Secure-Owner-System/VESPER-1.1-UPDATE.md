# Vesper 1.1 — Lyrics search, lyric cards, playlist import, Discord, iPhone polish

Everything from the previous version is kept. Your `data/` folder (profiles, playlists, history) works as-is.

## How to update
1. Stop Vesper (Ctrl+C in Terminal).
2. Copy your old `data/` folder (and `.env`, if you made one) into this new folder.
3. Run `npm start` as usual. On iPhone, reload the page once; the app updates itself.

## Fixes
- **Wrong song length (e.g. a 3-minute song showing 7:00).** iPhone Safari can misread the length of streamed YouTube audio, sometimes as double. Vesper now uses the length the stream itself states. If a song still ends earlier than shown, Vesper corrects the display.
- **Slow switching between songs.** YouTube streams were only remembered for 65 seconds, so the next song had to be looked up again (several seconds) when the current one ended. They're now kept until shortly before YouTube expires them (hours). The next two songs in Up Next are found and readied in the background, and a song starts getting ready the moment you press its row. Readying downloads no audio.
- **Calmer / More upbeat did nothing in Autoplay.** Songs upgraded to full YouTube versions lost their Deezer tempo info. Vesper now keeps the original Deezer ID and scores energy from tempo, Deezer's loudness value and version words in titles (acoustic, piano, remix, club…). It works even when the starting song has no tempo, and songs that clearly go the other way are left out. Choosing a direction while songs are loading no longer gets overwritten by the old request.
- **Lyrics section.** Removed the "Time synced / Word synced" label, the "Find match" button and the timing explanation text.

## New
- **Find a song by its lyrics.** Search › **Lyrics**, type a line you remember. In "All sources", a search of 4+ words also shows lyric matches. Each result shows the matching line. Uses LRCLIB (the same free lyrics library Vesper already uses).
- **Lyrics card.** In lyrics, tap **Share**, tap up to 4 lines, then **Share card**. You get a story-size image in the cover's colours, via the share sheet (or a download on desktop).
- **Import a playlist.** Library or Playlists › **Import playlist**.
  - Spotify: go to exportify.net, sign in, press Export on a playlist, choose the .csv.
  - Apple Music: on the Mac, Music app › select playlist › File › Library › Export Playlist… (text file). iPhone can't export.
  - Or paste a list, one per line: `Artist - Song` or `Song by Artist`.
  - Songs are matched through Deezer by title, artist and length. Songs that can't be found are listed at the end.
- **Data saver** (Settings › Playback). Full songs at lower quality: about 22 MB/hour instead of about 60 MB. Applies from the next song.
- **Discord status** (desktop app only). See below.

## iPhone layout
- Mini player: artwork, song and artist, play, next. Tap it for Now Playing.
- Song rows: no big Playlist button, so titles fit. Like and Add to playlist are in the ••• menu.
- Search source filters are one swipeable row.
- Now Playing: title on one line with Like and •••; bottom row is Lyrics, Output, Up next, Equalizer. More like this / Less like this / Add to playlist are in •••. Speed and transition are in Settings.
- Bigger touch targets in lyrics and the Autoplay direction buttons.
- Desktop layout is unchanged.

## Does it use a lot of data?
At home on Wi-Fi, music streams from your Mac to your phone over Wi-Fi: no mobile data. Mobile data is only used when you're away from home (e.g. over Tailscale). Roughly 60 MB/hour normally, about 22 MB/hour with Data saver. Previews (30-second clips) are about 0.5 MB each.

## Discord status setup (one time, about 2 minutes)
Discord only shows a status for a registered app, so you need a free app ID:
1. Go to https://discord.com/developers/applications and sign in.
2. **New Application**, name it **Vesper** (this name appears as "Listening to Vesper"), create it.
3. Copy the **Application ID** from the General Information page.
4. Make a text file named `discord-client-id.txt` containing just that number. Settings › Playback shows exactly which folder to put it in.
5. Restart the Vesper desktop app and turn on **Show what I'm listening to on Discord**.

Discord needs to be open on the same computer. It shows the song, artist, album cover and time left, and clears when you pause. Updates are limited to Discord's allowed rate. Browsers and iPhone can't talk to Discord, so the switch only appears in the desktop app.

You can also set `VESPER_DISCORD_CLIENT_ID` as an environment variable instead of the file.

## Testing
- `npm test`: 19/19 unit tests pass (new: energy score for Calmer/More upbeat).
- Server checked with a stand-in for yt-dlp: each song is resolved once and reused, Data saver requests the smaller stream, the real length is reported.
- Length correction checked in the browser for a doubled length, a correct length and an early end. Playback and seeking still work.
- Import parser checked with an Exportify CSV, an Apple Music UTF-16 export and a pasted list.
- Discord connection checked against a simulated Discord.
- Browser suites: the same few older checks fail as in the previous version (outdated test expectations); no new failures. The one check that looked for the removed "Line-by-line" text was updated.

Not tested here (no internet or devices in the build environment): real YouTube streams, LRCLIB and Deezer responses, a physical iPhone, and real Discord. If the song length or switching still looks off on your phone, say so with the song name.
