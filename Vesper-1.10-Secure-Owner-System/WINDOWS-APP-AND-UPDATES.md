# Vesper Windows app, updates, and saved data

## What is included

- Electron desktop wrapper for a standalone Vesper window.
- Windows NSIS installer configuration with Start Menu and Desktop shortcuts.
- Update checks using `electron-updater` and GitHub Releases. Users are prompted before downloading an update and before restarting to install it.
- A first-launch / once-per-version “What’s New” dialog. Edit `desktop/changelog.json` for release notes.
- The local database and artwork cache live in Electron's per-user app-data directory, separate from the installed program. The NSIS uninstall option is configured not to remove app data.

## Important: this is source, not a compiled Windows installer

Windows `.exe` installers should be built on Windows or with the included GitHub Actions workflow. This ZIP is source code; no signed, tested `.exe` is bundled.

## Configure automatic updates once

1. Create a GitHub repository for this project and push the source.
2. In `package.json`, replace `YOUR_GITHUB_USERNAME` with the repository owner's GitHub username or organization. Keep `repo` matching the repository name (`vesper`, or change it to your actual repository name).
3. Keep GitHub Actions enabled. The workflow `.github/workflows/release-windows.yml` builds Windows installers when you push a version tag like `v1.0.1`. It publishes release assets to GitHub Releases.
4. Before each release, update `version` in `package.json` and update `desktop/changelog.json` with that exact version and the new changes. Commit and push, then tag that commit with the matching version, e.g. `v1.9.1`.
5. Once the release is published, installed apps can check for it. Users choose whether to download and restart.

The first version needs to be installed by sharing the initial installer. Later releases are offered through the updater. GitHub Releases must be publicly reachable for this default configuration; a private repository may need additional updater authentication setup.

## Preserve data

The desktop app stores its database under Electron's `userData/data` folder and sets `VESPER_DATA_DIR` for its local backend. App updates do not replace that folder. Back up user data before major releases. If the app is configured to connect to a shared cloud server via `server-url.txt`, accounts and playlists belong to that server instead; keep its storage persistent and backed up.

## Shared cloud service vs local desktop mode

By default, each installation starts a local Vesper backend, so each user's data is local to that computer. To make friends share the same accounts/playlists/service while your computer is off, deploy the backend separately to a persistent cloud host, then put its HTTPS URL in each user's `server-url.txt` inside the app's user-data folder. That cloud deployment is a separate step and has not been performed by this source package.

## Build manually on Windows

Install Node.js 22, open PowerShell in the project folder, then run:

```powershell
npm install
npm test
npm run dist:win
```

The installer is written to `release/`.
