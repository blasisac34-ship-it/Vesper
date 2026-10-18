# Vesper Discovery Diversity + Glass UI Update

This is an additive update based on the current Vesper project. Existing features and the Mood-to-Mix recommendation flow are preserved.

## Discovery diversity
- Discover remembers track IDs it has already surfaced for a specific seed song and recommendation mode in browser local storage.
- Repeated Discover requests send those IDs to the recommendation engine, which down-ranks previously shown tracks so fresh candidates rise to the top.
- Mood-to-Mix remembers previously shown track IDs per normalized mood prompt and down-ranks them on subsequent builds, including refreshes.
- The memory is capped at 300 track IDs per key. It is only a recommendation-diversity signal; it does not delete library items or alter playlists.
- If a catalog has too few fresh candidates, repeats may still appear rather than returning a broken or empty mix.

## Glass styling
- Adds a subtle iOS-inspired translucent material to the side rail, right panel, player, controls, chips, Mood-to-Mix form, and loading surface.
- Uses backdrop blur, saturation, soft edge highlights, and restrained shadows, with a light-theme variant and reduced-motion handling.
- Keeps the existing layout, navigation, controls, artwork, and accent-color behavior.

## Validation
- `node --check public/js/views.js`
- `node --check server/recommend.mjs`
- `node --check server/server.mjs`
- `npm test` — all 18 existing tests passed.

The glass effect and real-world recommendation variety should still be visually/playback-tested in the app. Results depend on the provider's available catalog; no recommendation system can guarantee every refresh returns 30 never-before-seen songs.
