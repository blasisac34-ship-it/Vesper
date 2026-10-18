# Vesper — Home Recommendations, Lyrics Pro, Artist & Album Update

## Changes
- Home now shows a **Recommended songs for you** section. If listening history exists, it seeds recommendations from recently played songs and feedback; new listeners see clearly labelled starter picks from the worldwide chart.
- Lyrics translation now opens an in-app translation panel instead of navigating to Google Translate. Users choose the source and target language. Translation uses the public MyMemory service and may be rate-limited or imperfect; English is the default source language.
- Added styled in-app translation presentation with loading/error states, close control, and responsive layout.
- Existing artist and album pages continue to provide popular tracks, latest releases, album/EP/single shelves, tracklists, release dates, and related artists where the provider supports them.

## Verification
- `node --check` for changed JS files and server source.
- `npm test` passes all 13 unit tests.
- This does not constitute live-browser playback or translation-provider end-to-end testing.
