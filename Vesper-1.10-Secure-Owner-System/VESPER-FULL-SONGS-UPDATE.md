# Vesper — Official YouTube, Smart Radio, Beat-Aligned DJ, Share Cards, Offline & Remote Access

## What changed
- **Official YouTube playback (replaces yt-dlp).** All yt-dlp code is gone: no stream extraction, no audio proxying, no YouTube downloads. Search and full-version matching use the YouTube Data API (`YOUTUBE_API_KEY`). Videos play in YouTube's official IFrame player, shown in Now Playing or a docked mini player while they play, after a one-time privacy notice. When a song only has a 30-second preview, Vesper looks for its official full-length upload (exact title + artist, matching length; covers, karaoke, type beats, slowed/sped-up and reaction uploads are rejected). If there's no trustworthy match, or no API key, the preview plays and is labelled as a preview. Matches are remembered for 30 days to save quota. Stored YouTube details are refreshed or reduced to the video ID after 30 days. Paste-a-link works without a key.
- **Smart shuffle + learning radio.** Shuffle spreads artists so the same artist rarely plays twice in a row, and (optionally) slips in a few liked songs you haven't heard lately, each labelled. Skipping a song immediately removes queued Autoplay picks by that artist and steers the next picks away from it; liking a song steers toward that artist.
- **Beat-aligned DJ transitions.** Analysis now measures tempo to ±0.05 BPM and the beat grid separately in each song's intro and outro (within 2 ms on the test signals). DJ mode starts the incoming song exactly on a beat of the outgoing song's outro, tempo-matches it within ±8% (pitch preserved) during the blend, then eases back to normal speed. When either song lacks a confident beat grid or the tempos are too far apart, it falls back to a regular beat-length blend and doesn't claim alignment.
- **Share cards.** Story-size images for songs (track menu), lyric lines ("Share current line" under synced lyrics) and playlists/collections ("Share card"), styled from the artwork. They use the system share sheet when available, otherwise download.
- **Offline listening.** Save your own files and Jamendo tracks whose artists allow downloads ("Save for offline" in the song menu, "Save offline" on playlists). Saved songs play from the device first (quick starts, works offline, seeking supported) and are listed in Library → Offline with storage use. Previews and YouTube videos can't be saved.
- **Remote access.** Secure cookies over HTTPS, real client IP for sign-in rate limits behind a tunnel, guest sign-up blocked through a tunnel unless `ALLOW_REMOTE_GUESTS=1`. See `REMOTE-ACCESS.md` (Tailscale, private, HTTPS).
- **3D Headphones removed.**
- Settings: new Smart shuffle and "Full songs from YouTube" switches, plus a YouTube privacy section.

## Setup you need to do
1. YouTube API key: README → "Set up YouTube".
2. Away from home: `REMOTE-ACCESS.md`.

## Limits
- YouTube songs: the video must stay visible; no background/Lock Screen playback; EQ, crossfades and the visualizer don't apply. The free quota is about 100 searches/new matches per day.
- Beat alignment needs songs Vesper can analyse (previews, your files and Jamendo tracks up to 8 minutes on desktop). It isn't available for YouTube.
- You can delete the old `data/youtube-downloads` folder; Vesper no longer uses it.
