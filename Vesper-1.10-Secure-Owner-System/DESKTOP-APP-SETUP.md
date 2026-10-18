# Vesper desktop app and sharing

This project now includes an Electron desktop-app wrapper. It can be built into a macOS DMG/ZIP, Windows installer, or Linux AppImage.

## Build on your own computer

1. Install Node.js 18.17 or newer.
2. Unzip this project and open Terminal/PowerShell in the project folder.
3. Run `npm install`.
4. Test the normal web version with `npm start` and open `http://localhost:5177`.
5. Build the installer for the computer you are using:
   - macOS: `npm run dist:mac`
   - Windows: `npm run dist:win`
   - Linux: `npm run dist:linux`
6. Installer files appear in `release/`.

The desktop wrapper starts a local Vesper backend by default. Its database and artwork cache are stored in the operating system's Vesper app-data folder, not inside the install directory, so reinstalling/updating the app does not intentionally wipe the local user's saved account data. Back up that folder before major updates anyway.

## Let friends use the same Vesper service

A local desktop build is local to that computer. It does not automatically share data with friends. To share one service across computers and iPhones:

1. Deploy the Node server and `public/` files to a persistent host with HTTPS.
2. Configure persistent storage for `data/vesper.json` and `data/artwork-cache.json` (or set `VESPER_DATA_DIR`). Never use ephemeral storage for the database.
3. In the installed desktop app's user-data folder, create a text file named `server-url.txt` containing only the shared HTTPS base URL, e.g. `https://vesper.your-domain.example`.
4. On iPhone, open that same HTTPS URL in Safari and choose Share → Add to Home Screen.

The same server URL means everyone connects to the same service. Account sign-in and server-side permissions still apply. Do not expose the local server directly to the internet or put secrets in frontend files.

## Updating and preserving data

Ship a new installer for each desktop release and increment `package.json`'s version. The current project has a web service-worker update mechanism; this wrapper does not yet implement silent automatic installer updates or a release changelog dialog. Keep the database in persistent app data or persistent host storage. Never delete the `data` directory during deployment.

## Transition limitation in the current player

The current implementation deliberately uses YouTube's official embedded player for YouTube tracks. Crossfades/DJ transitions do not work for those tracks. Smooth/DJ transitions are only available for tracks played through Vesper's Web Audio engine. On iPhone, enabling audio processing may affect background/Lock Screen playback.
