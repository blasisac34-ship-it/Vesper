# Vesper 1.2

## Phone
- **Add to playlist** button sits next to the heart in Now Playing.
- **Lyrics**: the header (Share, A−, A+) stays at the top; only the lyrics scroll. Fullscreen lyrics removed.

## No more fake songs
YouTube results are checked for how official they are: the artist's "– Topic" channel (YouTube's official audio), VEVO, verified channels, view counts, and whether the channel name matches the artist. Look-alike channels (like "drakee" for Drake), tiny re-uploads next to the real song, and "sped up / AI / type beat / cover" versions (unless you searched for them) are hidden or ranked last. YouTube search says how many were hidden, and official uploads get an **Official** badge. The automatic full-song matcher uses the same checks.

## Replay
- Each story card plays one of your top songs (the top song card plays your #1, the top artist card plays their song, and so on), fading between them like a recap video. Mute button at the top. It uses 30-second clips where available to keep data low, never touches your queue and never counts as listens. Whatever you were playing pauses and resumes after.
- New last card: **Your Top Songs**, your 50 most-played songs in order. **Play** it or **Save as playlist**.

## Updates, data and hosting
- **What's new** shows once after each update, on every device, and remembers you've seen it across devices.
- Open apps notice a new version: they reload automatically if nothing is playing, otherwise show **Refresh**.
- Data: backed up daily, at startup and before every update; written to disk before every restart; restored from backup instead of starting empty if the file is ever damaged.
- Stay signed in: sign-ins don't expire and extend on each visit.
- **Run without your Mac**: Vesper can run on a free Oracle Cloud server. One setup script does everything, including HTTPS. See **HOSTING.md**.
- **Install updates from Settings** (owner only, on a hosted server): upload the new zip; data is backed up first and nobody is signed out.
- **Desktop app**: first launch asks for your server address, so your PC uses the same accounts and playlists as your phone. Or choose to run Vesper on the PC itself.

## Updating your current Mac copy
Same as before: stop Vesper, unzip, copy your `data` folder (and `.env`) into the new folder, `npm start`. When you move to a server, follow HOSTING.md.

## Tested
- 20/20 unit tests.
- Fake-upload filter with a "One Dance" example: the look-alike channel and a sped-up copy were hidden; VEVO and Topic came first.
- Browser update installed end to end: version changed, still signed in, playlists kept, backup made before the update.
- Not tested here: a real Oracle server, real YouTube from a cloud server, and a physical iPhone.
