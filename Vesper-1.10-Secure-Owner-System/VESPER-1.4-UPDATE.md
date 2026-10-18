# Vesper 1.4

## Why One Dance fell back to the 30-second clip
Your log showed it: Vesper only checked the first 4 versions YouTube returned, and those were a sped-up copy, two different songs also called "One Dance" and a lyrics channel. The real "Drake – Topic" release was further down and never got checked.

## Finding the real song
- Searches wider: two YouTube Music searches and three YouTube searches at once (artist + title, the artist's "– Topic" channel, and the official video).
- Throws out obvious wrong versions **before** spending time on them: different songs with the same name, someone else's "– Topic" release, and titles with speed / sped up / slowed / remix / AI / cover and so on.
- Puts the artist's own channels first, then checks up to 10 versions, three at a time, stopping as soon as the official audio turns up.
- Accepts, in this order:
  1. **Official audio**: the artist's release, right length.
  2. **Official music video** from the artist's own channel (VEVO, "– Topic" or the artist's verified channel), which can be longer because of intros.
  3. **Exact upload of the official audio**: title names the exact artist and song, length matches to within 2 seconds, and millions of views. Same recording, uploaded by someone else (often lyrics channels).
- Never accepted: other artists' channels with look-alike names, different lengths (sped up, slowed, pitched, AI), altered versions.
- Songs checked by 1.3 (including ones that fell back to the clip) are checked again automatically.

The 30-second clip is now only a last resort for songs with no genuine full version on YouTube. If you still get the clip for a song, send me the Terminal line starting with "No official match"; it lists every version and why it was turned down.

## Playlist recommendations
- Under each playlist: **Recommended**, ten songs based on what's in it (favouring songs you added recently, one per artist across the playlist). Tap **Add** to put one in the playlist, **Refresh** for different ones. It refills as you add.
- When a playlist finishes, **Autoplay** continues with songs picked from that playlist's own songs, not just the last one that played. Autoplay can be turned off in Up Next.

## Updating
Copy your `data` folder (and `.env`) into the new folder, then `npm start`. Run `brew upgrade yt-dlp` too.

## Tested
- Simulated your exact case (the 3 wrong versions first, the real release later): the wrong ones were skipped without being checked and "Drake – Topic" was chosen.
- Playlist page with the Recommended section on a phone-size screen; 20/20 unit tests.
- Not tested here: live YouTube and Deezer (no internet in the build environment).
