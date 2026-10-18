# Vesper owner system — secure online setup

## Your setup
- **Hosting:** one always-on online server. Friends and your desktop connect to the same HTTPS address. Your Mac does not need to stay on.
- **Accounts:** you own the server; friends create their own accounts and have separate libraries, playlists and listening history. They do not get owner permissions just by registering.
- **Owner identity:** the server stores the owner account ID in its database. Changing the owner username does not remove owner permissions.

## Fresh Linux hosting install
1. Upload and extract this Vesper project on your cloud Linux server.
2. Run `sudo bash deploy/setup-server.sh your-domain.example.com you@example.com`.
3. The installer asks for the owner username (default `Isaac`) and privately prompts for a unique password. Use at least 12 characters with no spaces. The password is saved only in `/opt/vesper/.env` on the server; it is not written into the source files.
4. Open `https://your-domain.example.com`, sign in as the owner, and verify **Settings → Your Vesper server**.
5. Share the HTTPS address with friends. They should create accounts with username and password; guest accounts are disabled for remote users by default.

## Existing deployment
- Back up `/var/lib/vesper` before updating. The account/owner identity and user data are stored there and must not be deleted.
- If the current deployment used a password that was ever committed to a public repository, treat it as exposed and change it immediately in **Settings → Account → Change sign-in**.
- For an existing server with an owner already recorded, do not delete the database or reset `ownerId`. Configure `VESPER_OWNER_USERNAME` / `VESPER_OWNER_PASSWORD` only as required by the server's first-run bootstrap. Existing passwords are not reset when an existing account is promoted to owner.

## Keep source public safely
A public repository may contain application code, but never commit `.env`, owner passwords, tokens, or database files. `.env` is ignored by Git. The hosted server sets `VESPER_REQUIRE_OWNER=1`, so the first person to register never receives admin rights. The server-side owner role is not granted by a client request or by a user choosing a username.

## Important
This patch hardens owner bootstrap; it does not deploy a cloud server or create a domain automatically. You still need to run the hosting installer on your cloud provider. Test the owner login and make a backup before inviting people.
