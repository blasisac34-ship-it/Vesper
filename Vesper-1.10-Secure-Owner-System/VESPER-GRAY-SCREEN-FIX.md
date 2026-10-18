# Vesper Gray Screen Fix

## Fixes
- Guarded artist search results against missing/null artist objects and names so the sign-in/onboarding view cannot crash while rendering a tile.
- Filtered malformed artist-search results before rendering them.
- Fixed the service worker response caching race by cloning responses immediately before caching and awaiting the cache write. Bumped the shell cache to `vesper-shell-v9` so old broken cached scripts are replaced.

## Install
1. Stop the current Vesper server with Control+C.
2. Extract this ZIP to a new folder.
3. Preserve/copy your existing `.env` and `data` folder into the new project folder; do not replace existing user data with empty copies.
4. Run `npm start` from the new project folder.
5. Open `http://localhost:5177` and hard-refresh with Command+Shift+R.

A `401 Unauthorized` from `/api/me` is expected when no user session is signed in; it should display the sign-in screen. The null artist crash was the error that stopped that screen from rendering.
