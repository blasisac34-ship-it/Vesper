# Vesper 1.9 — Owner account and desktop releases

## Owner login

- This release used a starter owner password. Do not rely on it for a public deployment; use the hardened first-run setup in Vesper 1.10 and rotate any password that may have been published.
- Existing profiles, playlists, likes, listening history and settings are not overwritten. If an `Isaac` account already exists, it is marked as owner without resetting its password.
- The owner identity is stored on the account ID, so changing the username does not remove owner access.
- In Settings → Account → Change sign-in, enter the current password, choose a username and optionally a new password. Passwords are stored as scrypt hashes.
- **Security:** change the starter password before exposing a server to the internet. For a hosted deployment, set `VESPER_OWNER_USERNAME` and a unique private `VESPER_OWNER_PASSWORD` (12+ characters, no spaces) in the server `.env` before first startup. Do not commit `.env`.

## Owner tools

Settings → Your Vesper server shows version, account count, backup status, backup/download actions and server update controls when self-updating is enabled by the server setup.

## Windows desktop EXE and automatic updates

This is still source code, not a compiled installer. See `WINDOWS-APP-AND-UPDATES.md`. The project has an Electron Windows NSIS installer and GitHub Actions workflow; the repository owner in `package.json` must be changed from `YOUR_GITHUB_USERNAME` to the actual GitHub owner before publishing releases. Build on Windows or use GitHub Actions with a version tag. The installer is named `Vesper-Setup-<version>-<arch>.exe`.

## Preservation

The version number and service-worker cache were bumped. Existing app data remains outside the install folder; do not delete the Vesper user-data directory during updates.
