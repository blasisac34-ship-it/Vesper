# Vesper Following and UI Polish

This update builds on the full-track fast update.

- Removes preview/full badges and confusing short-clip wording from normal song rows, the player, Now Playing, queue, search, and provider settings.
- Keeps internal source metadata needed for matching and playback. When Vesper cannot find a playable full-length match, it skips the track rather than playing a short clip.
- Makes Follow/Unfollow update immediately in the UI and optimistically updates shared library state; failed requests roll back and show an error.
- Adds a Popular on this album section when the catalog supplies popularity rank data, without changing the original album track order.
- Expands Following with newest songs drawn from up to eight of the newest recent releases, plus a newest albums/singles shelf. Release-track lookups are capped and parallelized to limit added wait time.

Validation: Node syntax checks passed and `npm test` passed 13/13 tests. Live provider responses and real playback were not end-to-end tested here.
