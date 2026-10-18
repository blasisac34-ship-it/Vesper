# Vesper — Personal Mix Update

## Changes
- Removed the in-app lyrics translation endpoint and translation UI; lyrics toolbar is branded simply “Lyrics”.
- Artist onboarding remains a required step for account registration: choose at least one artist from genre groups or search, then create the account. Provider-backed selections are submitted with registration and persisted; name-only picks are resolved and followed by the client.
- Added Mood-to-Mix on Home. Enter a mood/description or select a preset. The server searches real Deezer tracks/playlists, then expands the mix using related-artist recommendations.
- Song rows and search suggestions now display source artwork where available and a generated cover-art fallback when artwork is absent or fails to load.
- Liked Songs uses a four-cover collage on the Playlists page; playlist artwork takes precedence when a custom cover exists. Daily Mix artwork uses up to four track covers.
- Bumped service worker shell cache to v8 to prevent old lyric controls from remaining cached.

## Limitations
Mood mixes use provider search and related-artist data, not an audio emotion model. Artist onboarding's starter catalog is curated; use search for artists not included.
