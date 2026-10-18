# Vesper full-track and faster queue update

## What changed

- Chart, search, and autoplay tracks that are preview-only are resolved to a matching YouTube version before playback. If a match cannot be found, Vesper skips the preview instead of playing a 30-second clip.
- YouTube searches are cached for 10 minutes and concurrent identical searches share the same request.
- Full-version matches are cached for 12 hours for this running server process.
- The next queued YouTube track is resolved and its stream is prepared while the current song plays, reducing the wait between songs.
- Stream URL resolution is shared between concurrent requests and cached briefly, so the same song is not resolved repeatedly.
- Lyrics continue to use the selected track's title and artist; synced lyrics display when the lyrics source has timing data.
- Existing shuffle, repeat, queue, chart ordering, and autoplay flow are retained.

## Important limits

The first play of a song that has not been matched or prepared yet can still take a few seconds because Vesper must search and prepare a source. Network speed, YouTube availability, region restrictions, and changes to YouTube can affect playback. This is not guaranteed to switch in zero seconds.

The app is still a Node-backed web app/PWA, not a packaged native iPhone app. A phone build needs a reachable HTTPS backend or a different supported streaming provider. iOS may also restrict background playback and autoplay depending on how the app is installed and launched.

Only play or save audio you have permission to use and follow the source service's terms. The YouTube audio resolver is an experimental dependency and can stop working when the upstream service changes.
