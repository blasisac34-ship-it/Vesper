# Vesper 1.5 — Full songs working again

## What happened
Your Terminal showed `Sign in to confirm you’re not a bot`. YouTube had started refusing Vesper's requests from your Mac's internet connection. Everything else followed from that:
- searches came back empty ("No official match … no candidates"),
- streams failed, which the browser reports as "This audio format or source isn't supported",
- Vesper kept skipping to the next song, which made more requests and made the block worse.

Part of the cause was Vesper 1.4 itself: to find the official version it could make up to 15 YouTube requests per song, plus it prepared two songs ahead. That much traffic looks like a bot.

## Fixes
- **Far fewer requests.** Finding a song now takes 2 YouTube requests (worst case 4), down from up to 15. Checking the official version also fetches its stream, so pressing play needs no extra request. At most 2 requests run at once, with a short gap, and only the next song is prepared ahead.
- **YouTube sign-in (Settings › YouTube sign-in).** If YouTube asks "are you a bot?", choose a browser where you're signed in to YouTube. Vesper (through yt-dlp) uses that browser's YouTube login. Your password is never seen.
  1. Open **Chrome** (easiest) and sign in to YouTube. A spare Google account is best.
  2. In Vesper: **Settings › YouTube sign-in › Chrome**. It tests right away and shows "✓ Working".
  3. macOS may ask to allow access to "Chrome Safe Storage" in your keychain. Choose **Always Allow**.
  - Safari works too, but Terminal needs **Full Disk Access** (System Settings › Privacy & Security).
- **When YouTube blocks**, Vesper says so clearly with a **Fix it** button, pauses background lookups for 10 minutes, and stops instead of skipping through your queue.
- **No previews.** Songs with no full version on YouTube are **skipped** with a short note. If you'd rather hear the 30-second clip, change **Settings › When a song has no full version**. "Preview" badges no longer appear on songs.
- Fixed a yt-dlp warning: an outdated option Vesper was passing has been removed.
- Songs that failed while blocked are checked again (failures caused by the block were never saved).

## Lyrics bar and desktop
- The lyrics bar is a small **frosted-glass pill tinted with the song's colours**, like iOS, instead of a black bar.
- **Bug fixed:** with lyrics turned off ("Ambient"), the lyrics box still showed, squeezed under the artwork. That's what made the Mac/PC view look broken.
- Desktop Lyrics mode: artwork on the left, large lyrics on the right, centred on wide screens.

## Updating
Copy your `data` folder (and `.env`) into the new folder, `npm start`, then run `brew upgrade yt-dlp`. If songs still don't load, set up **Settings › YouTube sign-in**.

On a cloud server (HOSTING.md) there's no browser, so use the `cookies.txt` method from HOSTING.md instead.

## Tested
- Simulated YouTube's "not a bot" block: one request, then a clear message; background lookups paused; choosing a browser fixed it and the official release was found with 2 requests; playback needed no extra request.
- Lyrics bar and layout on phone and desktop screenshots; 20/20 unit tests.
