# Run Vesper for you and your friends, without your Mac

The goal: Vesper runs on a free computer in the cloud, all the time. Phones, browsers and the desktop app on your PC all connect to it. Your Mac can be off.

## How it fits together
- **The server** (one copy, in the cloud) holds everyone's accounts, playlists and history.
- **Phones**: open your server's address in Safari, then Share › Add to Home Screen. It looks and works like an app, with Lock Screen controls.
- **Your PC**: the Vesper desktop app. On first launch, type your server's address.
- **Updates**: you update the server once. Every phone, browser and desktop app gets the new version automatically and shows "What's new". Nobody is signed out and no data is touched.

## The free option: Oracle Cloud "Always Free"
Oracle gives a small server free forever (an Ampere ARM machine with up to 4 cores and 24 GB memory, or a smaller x86 one), with permanent storage. It's the only big provider whose free tier can run Vesper all day.
- Sign-up asks for a card to verify you're a real person. Always Free resources aren't charged. Stay on Always Free shapes and don't upgrade the account.
- Pick a **home region** close to you when signing up (you can't change it later). Free ARM capacity is sometimes "out of stock" in busy regions; if creating the server fails, try again later or use the smaller free x86 shape (VM.Standard.E2.1.Micro).

### 1. Create the server
1. Sign up at oracle.com/cloud/free.
2. Create a Compute instance: image **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** (1 OCPU, 6 GB is plenty) or **E2.1.Micro**. Download the SSH key it offers.
3. In the instance's **Virtual Cloud Network › Security List**, add ingress rules for TCP ports **80** and **443** from 0.0.0.0/0.
4. Note the server's **public IP address**.

### 2. Get a free web address
1. Go to duckdns.org, sign in, create a name, e.g. `tyvesper` → `tyvesper.duckdns.org`.
2. Set its IP to your server's public IP.

### 3. Install Vesper
From Terminal on your Mac:
```
scp -i ~/Downloads/your-key.key Vesper-1.6.zip ubuntu@YOUR_SERVER_IP:~
ssh -i ~/Downloads/your-key.key ubuntu@YOUR_SERVER_IP
```
Then on the server:
```
sudo apt install -y unzip && unzip Vesper-1.6.zip && cd Vesper-1.6
sudo bash deploy/setup-server.sh tyvesper.duckdns.org you@example.com
```
**Moving your current data:** before running the script, copy your Mac's `data` folder into the `Vesper-1.6` folder on the server (`scp -r -i key data ubuntu@IP:~/Vesper-1.6/`). The script moves it to `/var/lib/vesper`. Everyone keeps their accounts and playlists. People will need to sign in once on the new address (different address, different login cookie). Guest profiles can't sign in on another device, so add a sign-in to your profile on the Mac first (Settings › Add sign-in).

Open `https://tyvesper.duckdns.org`. The first profile that adds a sign-in becomes the **owner** and sees **Settings › Your Vesper server**. To choose the owner yourself, add `ADMIN_USERNAMES=yourname` to `/opt/vesper/.env` and run `sudo systemctl restart vesper`.

### 4. Friends
Send them the address. They make a profile, add a sign-in, and Add to Home Screen. Guests can only be created from your home network by default; with a hosted server, friends should use **Add sign-in** (or set `ALLOW_REMOTE_GUESTS=1` in `.env`).

## Updating
**From the app (easiest):** Settings › Your Vesper server › **Install an update** › choose the new Vesper .zip. Vesper backs up everyone's data, installs, restarts in a few seconds and every device reloads into the new version with "What's new".

**From Terminal:** `sudo bash /opt/vesper/deploy/update-server.sh ~/Vesper-x.y.zip`. It switches back automatically if the new version doesn't start.

What's protected on every update:
- Data lives in `/var/lib/vesper`, outside the app folder. Updates never replace it.
- A backup is made before each update, at every start and daily (newest 20 kept in `/var/lib/vesper/backups`).
- If the data file were ever damaged, Vesper restores the newest backup instead of starting empty.
- Changes are written to disk before every restart.
- Sign-ins don't expire; each visit extends them another year.
- The previous version is kept in `/var/lib/vesper/previous-version`.
- Owner can download a full backup any time: Settings › Your Vesper server › Download. Do this now and then and keep it somewhere safe, in case you ever lose the server itself.

**Desktop app:** it shows your server's pages, so server updates appear in it right away. The desktop app itself only needs reinstalling if its own window code changes (rare); those notes will say so.

## The honest catch: YouTube and cloud servers
Full songs come from YouTube through yt-dlp. YouTube sometimes blocks requests from cloud servers with "Sign in to confirm you're not a bot". If full songs fail on the server (previews still work), give yt-dlp cookies from a spare Google account:
1. On your Mac, in a private browser window, sign in to YouTube with a **spare** Google account (not your main one).
2. Export cookies for youtube.com in Netscape format (e.g. the "Get cookies.txt LOCALLY" extension), then close the private window without signing out.
3. Copy the file to the server: `scp -i key cookies.txt ubuntu@IP:~` then `sudo mv ~/cookies.txt /var/lib/vesper/cookies.txt && sudo chown vesper /var/lib/vesper/cookies.txt && sudo systemctl restart vesper`.
yt-dlp updates itself daily, which fixes most breakages. If YouTube still blocks the server, the fallback is to run the server on a computer at home (your PC works) with a free Cloudflare Tunnel or Tailscale for access away from home.

## Data use
Phones stream from the server, so away from Wi-Fi it uses mobile data: about 60 MB an hour, or about 22 MB an hour with **Data saver** (Settings › Playback).

## Changing the desktop app's server
Delete `server-url.txt` from the app's data folder (Windows: `%APPDATA%\Vesper`, Mac: `~/Library/Application Support/Vesper`) and reopen the app.
