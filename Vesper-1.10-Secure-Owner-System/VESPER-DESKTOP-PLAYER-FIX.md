# Vesper Desktop Player Fix

## What's fixed
- Moved floating action menus into Vesper's dedicated top-level menu layer to avoid stacking/overlay problems.
- Made the playlist chooser refresh the current library before showing the available playlists.
- Added explicit click handling and helpful error messages for Add to Playlist and song options.
- Added a plus button beside the heart in the bottom desktop player bar so the currently playing song can be added to a playlist without opening Now Playing.
- Disabled the mini-player add button until a song is playing.
- Bumped the service-worker cache version so browsers stop reusing stale JS/CSS after installing this update.

## Install
1. Stop the existing Vesper server with Control+C.
2. Extract this ZIP to a new folder.
3. Preserve your existing `.env` and `data` folder; do not overwrite them with empty copies.
4. Start from the extracted project folder using `npm start`.
5. Open `http://localhost:5177` and hard-refresh with Cmd+Shift+R if the old UI remains.

## Validation
The JavaScript syntax checks and 13 unit tests pass. A live browser test of the Mac UI and audio playback has not been performed in this environment.
