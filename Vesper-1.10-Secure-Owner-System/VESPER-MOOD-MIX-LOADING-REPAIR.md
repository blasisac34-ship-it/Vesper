# Vesper — Correct-Base Mood-to-Mix & Loading Repair

This patch is based on the user's `Vesper-Desktop-App-Updates-Setup(1).zip` project. It intentionally preserves the existing app, Mood-to-Mix recommendation algorithm, artwork and artist onboarding, YouTube integration, desktop packaging, updater configuration, service worker, settings, and other modules.

## Targeted changes

- Full-length YouTube match requests now time out after 35 seconds and report a useful retry message instead of leaving track selection in a loading state indefinitely.
- Mood-to-Mix requests have a 60-second limit and display a slow-search hint after 12 seconds.
- When refreshing Mood-to-Mix, the last successful mix remains visible until a new mix is ready. If a request fails or times out, the old mix is retained and the error is shown alongside it.

## Validation

- `node --check public/js/queue.js`
- `node --check public/js/views.js`
- `npm test` — all 18 existing unit tests passed.

## Limitations

This package was not tested against live provider services or in a running browser. The current app's existing YouTube-player crossfade limitation is unchanged; this patch addresses stuck loading and preserves the current Mood-to-Mix behavior rather than claiming to redesign the recommendation system.
