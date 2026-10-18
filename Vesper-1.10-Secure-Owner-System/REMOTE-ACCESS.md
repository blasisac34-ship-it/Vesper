# Use Vesper away from home (Tailscale)

Tailscale is a free, private network between your own devices. Vesper stays private (it is NOT put on the public internet) and your iPhone gets a real HTTPS address, which also makes the Home Screen app and Lock Screen controls work better.

## One-time setup (about 10 minutes)

1. **On your Mac:** install Tailscale from https://tailscale.com/download (or the Mac App Store) and sign in.
2. **On your iPhone:** install Tailscale from the App Store and sign in with the same account. Turn the VPN toggle on when asked.
3. **Turn on HTTPS for your tailnet:** open https://login.tailscale.com/admin/dns, enable **MagicDNS**, then enable **HTTPS Certificates**.
4. **Share Vesper inside your tailnet:** with Vesper running (`npm start`), open Terminal on the Mac and run:
   ```
   tailscale serve --bg 5177
   ```
   Tailscale prints an address like `https://your-mac.tail1234.ts.net`. That address only works on your own Tailscale devices.
5. **On your iPhone:** open that address in Safari, sign in with your Vesper **username and password**, then Share → **Add to Home Screen**.

Guest profiles can't be created through the tunnel (so a stranger with your link couldn't make one). Create your account at home first, or set `ALLOW_REMOTE_GUESTS=1` in `.env`.

To stop sharing: `tailscale serve --https=443 off`. Your Mac must be awake and running Vesper for your phone to reach it.

## What Vesper does behind a tunnel
- Session cookies are marked Secure when the connection is HTTPS.
- Sign-in rate limiting uses your phone's real address, not the tunnel's.
- YouTube's player works normally on the HTTPS address.

## Alternative: Cloudflare Tunnel
Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:5177`) gives a public HTTPS address that anyone with the link can open. Only use it with strong passwords, and prefer Tailscale for a private setup.
