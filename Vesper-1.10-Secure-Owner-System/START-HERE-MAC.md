# Vesper — YouTube audio player (Mac)

This version plays full-length YouTube audio through Vesper's own audio player. It does not embed a YouTube video. It also has an optional download button for offline listening; only save tracks you own or have permission to download.


Open Terminal and run:

```bash
```

If Homebrew is not installed, install it from https://brew.sh/ first, then run the command above.

## 2. Start Vesper

Make sure Node.js 18.17 or newer is installed. In Terminal, type `cd ` (including the space), drag this unzipped Vesper folder into Terminal, and press Return. Then run:

```bash
npm start
```

## 3. Open and play

Open http://localhost:5177, go to **Search**, select **YouTube**, search for a song, and press its play button. The audio uses Vesper's normal bottom player and queue. Press the download icon to save content you are authorized to save for offline listening.

## Notes

- Offline downloads are stored in this Vesper folder at `data/youtube-downloads/` and play offline only on this Mac.
- Keep Vesper running in Terminal while listening. Stop it with Control+C.


Full-length songs: see README → “Set up YouTube” (yt-dlp; no YouTube API key required). Away from home: see REMOTE-ACCESS.md.