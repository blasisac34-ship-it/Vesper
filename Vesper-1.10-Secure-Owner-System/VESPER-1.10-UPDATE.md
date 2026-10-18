# Vesper 1.10 — Secure owner setup

- Removed the predictable built-in owner password from the server code and documentation.
- A fresh server now requires `VESPER_OWNER_PASSWORD` to be configured privately before it will create the owner account. Use a unique password with at least 12 characters and no spaces.
- The Linux hosting installer prompts for the owner username and password without displaying the password, then writes it to `/opt/vesper/.env` with restrictive permissions.
- Owner permissions remain tied to the account ID, not the username. Existing account data is preserved.
- Updated the service-worker cache to refresh web assets.

**Security note:** if an older version was ever pushed to a public GitHub repository, the previous starter password may still exist in Git history or downloaded ZIPs. Change it immediately; deleting it from the latest files alone does not remove it from history.

See [OWNER-SYSTEM-SETUP.md](OWNER-SYSTEM-SETUP.md) for deployment instructions.
