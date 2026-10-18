// Vesper server — zero dependencies, Node 18+.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DB, checkPassword, slimTrack, publicUser } from './db.mjs';
import { ProviderError, relevance, normText, TTLCache, mapLimit, todayKey, fetchJSON, sleep } from './util.mjs';
import * as dz from './providers/deezer.mjs';
import { createLyricsService } from './lyrics.mjs';
import * as yt from './providers/youtube.mjs';
import * as it from './providers/itunes.mjs';
import * as jm from './providers/jamendo.mjs';
import * as local from './providers/local.mjs';
import * as ts from './providers/testsignal.mjs';
import { userSignals, recommend, dailyMix, dailyMixSeeds, topArtists } from './recommend.mjs';
import { computeStats } from './stats.mjs';
import { computeReplay, yearRange } from './replay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.VESPER_DATA_DIR || path.join(ROOT, 'data');
const db = new DB(process.env.DB_FILE || path.join(DATA_DIR, 'vesper.json'));
// First-run owner account. Never ship a known/default password in source code.
// On a fresh server, configure VESPER_OWNER_PASSWORD in the private .env before startup.
if (!db.data.ownerId && process.env.VESPER_OWNER_BOOTSTRAP !== 'off') {
  const ownerName = String(process.env.VESPER_OWNER_USERNAME || 'Isaac').trim();
  const ownerPassword = String(process.env.VESPER_OWNER_PASSWORD || '');
  if (!ownerPassword || ownerPassword.length < 12 || /\s/.test(ownerPassword)) {
    console.error('Vesper owner setup required: set VESPER_OWNER_PASSWORD to a private password of at least 12 characters (no spaces) in .env, then restart. No default owner password is provided.');
    process.exit(1);
  }
  let owner = db.userByName(ownerName);
  if (!owner) owner = db.newUser({ username: ownerName, password: ownerPassword, displayName: ownerName });
  owner.isOwner = true;
  owner.mustChangePassword = false;
  db.data.ownerId = owner.id;
  db.save();
  console.log(`Vesper owner account initialized for ${owner.username}. Owner permissions are stored on this account ID.`);
}
const COOKIE = 'vesper_sid';
const execFileAsync = promisify(execFile);
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';
const ytUrlCache = new Map();
const ytMatchInflight = new Map();
const ytSearchCache = new Map();
const ytMatchCache = new Map();
const ytResolveInflight = new Map();
const ytSearchInflight = new Map();

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---------- tiny router ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth: opts.auth ?? false });
};
class HttpError extends Error { constructor(status, message, code = 'error') { super(message); this.status = status; this.code = code; } }
const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
async function readRaw(req, limit) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'Request body too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readBody(req, limit = 1_500_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'Request body too large'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body'); }
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));
const setSession = (res, token) => res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${365 * 86400}${res.__secure ? '; Secure' : ''}`);
// Requests that arrive through a tunnel/reverse proxy (Tailscale Serve, Cloudflare Tunnel) carry forwarding headers.
const isRemoteRequest = (req) => !!(req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['tailscale-user-login']);
const clientIp = (req) => (isRemoteRequest(req) ? String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'x';
const clearSession = (res) => res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
const splitId = (id) => { const i = id.indexOf(':'); if (i < 1) throw new HttpError(400, 'Invalid id'); return [id.slice(0, i), id.slice(i + 1)]; };

// ---------- sources ----------
route('GET', '/api/health', () => ({ ok: true, time: new Date().toISOString(), version: APP_VERSION }));

// ---------- version & what's new ----------
const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; } })();
function changelog() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'changelog.json'), 'utf8')); } catch { return []; } }
const verNum = (v) => String(v || '0').split('.').map((x) => Number(x) || 0).reduce((a, x) => a * 1000 + x, 0);
route('GET', '/api/version', ({ user }) => {
  const seen = user?.lastSeenVersion || null;
  const all = changelog();
  // Everything released since this person last saw a version (on any device), newest first.
  const unseen = seen ? all.filter((e) => verNum(e.version) > verNum(seen) && verNum(e.version) <= verNum(APP_VERSION)) : all.filter((e) => e.version === APP_VERSION);
  return { version: APP_VERSION, seen, unseen, isAdmin: isAdmin(user) };
});
route('POST', '/api/me/seen-version', ({ user }) => { user.lastSeenVersion = APP_VERSION; db.save(); return { ok: true }; }, { auth: true });

// ---------- admin: backups and installing updates from the browser ----------
// Admin = usernames in ADMIN_USERNAMES (comma-separated), or, if unset, the first account with a sign-in.
function isAdmin(user) {
  if (!user) return false;
  // The owner identity is tied to the account ID, so changing the username won't lock it out.
  if (user.isOwner || db.data.ownerId === user.id) return true;
  // Hosted deployments must never grant admin to the first person who registers.
  if (process.env.VESPER_REQUIRE_OWNER === '1') return false;
  // At home with nobody signed up yet (just guest profiles), whoever uses Vesper can manage it.
  if (!user.username) return !process.env.VESPER_SELF_UPDATE && !process.env.ADMIN_USERNAMES && !Object.values(db.data.users).some((u) => u.username);
  const list = String(process.env.ADMIN_USERNAMES || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (list.length) return list.includes(user.username);
  const first = Object.values(db.data.users).filter((u) => u.username).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
  return first?.id === user.id;
}
const needAdmin = (user) => { if (!isAdmin(user)) throw new HttpError(403, 'Only the Vesper owner can do this.'); };
route('POST', '/api/admin/backup', ({ user }) => { needAdmin(user); const name = db.backup('manual'); if (!name) throw new HttpError(500, 'Backup failed.'); return { ok: true, name }; }, { auth: true });
route('GET', '/api/admin/status', ({ user }) => {
  needAdmin(user);
  let backups = []; try { backups = fs.readdirSync(db.backupDir).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 10); } catch {}
  return { version: APP_VERSION, users: Object.keys(db.data.users).length, backups, canSelfUpdate: !!process.env.VESPER_SELF_UPDATE, dataDir: DATA_DIR };
}, { auth: true });


// ---------- YouTube full-song search and audio ----------
// This restores the previous Vesper behavior: yt-dlp searches full-length videos and the
// server streams their audio through the normal Vesper audio engine. No YouTube Data API key
// or embedded iframe is required. Respect YouTube's terms and only stream/save content you may use.
// ---------- talking to YouTube politely ----------
// YouTube blocks computers that make too many requests ("Sign in to confirm you're not a bot").
// So: at most 2 yt-dlp jobs at a time with a short gap, results are cached, and when YouTube does
// ask for sign-in, Vesper pauses background lookups and tells the owner how to fix it.
const ytCfgFile = path.join(DATA_DIR, 'server-settings.json');
const ytCfg = (() => { try { return JSON.parse(fs.readFileSync(ytCfgFile, 'utf8')); } catch { return {}; } })();
const saveYtCfg = () => { try { fs.writeFileSync(ytCfgFile, JSON.stringify(ytCfg, null, 2)); } catch {} };
const YT_BROWSERS = ['safari', 'chrome', 'firefox', 'brave', 'edge', 'chromium', 'opera', 'vivaldi'];
const ytState = { blockedUntil: 0, lastBlock: null, lastOk: null };
let ytRunning = 0, ytLastStart = 0; const ytWaiting = [];
async function ytSlot() {
  while (ytRunning >= 2) await new Promise((r) => ytWaiting.push(r));
  const gap = 350 - (Date.now() - ytLastStart); if (gap > 0) await sleep(gap);
  ytRunning++; ytLastStart = Date.now();
}
function ytRelease() { ytRunning--; ytWaiting.shift()?.(); }
const YT_SIGNIN_MSG = 'YouTube is asking Vesper to sign in ("confirm you’re not a bot"), so full songs can’t load right now. Fix: Settings › YouTube sign-in.';
async function runYtDlp(args, timeout = 45_000, { background = false, partial = false } = {}) {
  if (background && ytState.blockedUntil > Date.now()) throw new HttpError(503, YT_SIGNIN_MSG, 'yt_signin');
  const browser = process.env.YT_DLP_BROWSER || ytCfg.browser;
  const cookieFile = process.env.YT_DLP_COOKIES || path.join(DATA_DIR, 'cookies.txt');
  if (browser && YT_BROWSERS.includes(browser)) args = ['--cookies-from-browser', browser, ...args];
  else if (fs.existsSync(cookieFile)) args = ['--cookies', cookieFile, ...args];
  if (process.env.YT_DLP_EXTRA) args = [...process.env.YT_DLP_EXTRA.split(' ').filter(Boolean), ...args];
  await ytSlot();
  try {
    const r = await execFileAsync(YT_DLP, args, { timeout, maxBuffer: 24 * 1024 * 1024, windowsHide: true });
    ytState.lastOk = Date.now(); if (ytState.blockedUntil) { ytState.blockedUntil = 0; console.log('YouTube is answering again.'); }
    return r;
  } catch (e) {
    if (e.code === 'ENOENT') throw new HttpError(503, 'Vesper needs yt-dlp installed. On your Mac, run: brew install yt-dlp', 'ytdlp_missing');
    const err = String(e.stderr || e.message || '');
    if (partial && String(e.stdout || '').trim() && !/confirm you.?re not a bot|sign in to confirm/i.test(err)) return { stdout: e.stdout, stderr: err };
    if (/confirm you.?re not a bot|sign in to confirm|HTTP Error 429|too many requests/i.test(err)) {
      ytState.blockedUntil = Date.now() + 10 * 60_000; ytState.lastBlock = new Date().toISOString();
      console.warn('YouTube asked for sign-in. Background lookups paused for 10 minutes. Set up Settings › YouTube sign-in.');
      throw new HttpError(503, YT_SIGNIN_MSG, 'yt_signin');
    }
    if (/could not (find|copy|decrypt).*cookie|cookies? database|Operation not permitted.*Cookies/i.test(err)) throw new HttpError(503, `Vesper couldn’t read ${browser || 'the browser'}’s YouTube sign-in. ${browser === 'safari' ? 'Give Terminal “Full Disk Access” in System Settings › Privacy & Security, or choose Chrome instead.' : 'Make sure that browser is installed and you’re signed in to YouTube in it.'}`, 'yt_cookies');
    if (/Video unavailable|Private video|removed|not available in your country/i.test(err)) throw new HttpError(404, 'This video isn’t available.', 'yt_unavailable');
    const detail = err.split('\n').filter((l) => /ERROR/.test(l)).slice(-1)[0]?.replace(/^ERROR:\s*/, '').slice(0, 300) || err.trim().split('\n').slice(-1)[0].slice(0, 300);
    throw new HttpError(502, `YouTube couldn’t be reached${detail ? `: ${detail}` : ''}. If this keeps happening, update yt-dlp: brew upgrade yt-dlp`, 'ytdlp_failed');
  } finally { ytRelease(); }
}
route('GET', '/api/youtube/status', ({ user }) => ({ blocked: ytState.blockedUntil > Date.now(), lastBlock: ytState.lastBlock, browser: process.env.YT_DLP_BROWSER || ytCfg.browser || null, cookieFile: fs.existsSync(process.env.YT_DLP_COOKIES || path.join(DATA_DIR, 'cookies.txt')), isAdmin: isAdmin(user), platform: process.platform }), { auth: true });
route('PUT', '/api/admin/youtube', async ({ user, body }) => {
  needAdmin(user);
  const b = String(body.browser || '');
  if (b && !YT_BROWSERS.includes(b)) throw new HttpError(400, 'Unknown browser.');
  ytCfg.browser = b || null; saveYtCfg(); ytState.blockedUntil = 0;
  if (!b) return { ok: true, browser: null };
  // Try it right away so the owner knows whether it works.
  try { await runYtDlp(['--flat-playlist', '-J', '--no-warnings', '--playlist-items', '1', 'ytsearch1:official audio'], 45_000); return { ok: true, browser: b, working: true }; }
  catch (e) { return { ok: true, browser: b, working: false, error: e.message }; }
}, { auth: true });
function cleanYtId(id) { return /^[A-Za-z0-9_-]{11}$/.test(String(id || '')) ? String(id) : null; }
function ytTrack(entry) {
  const id = cleanYtId(entry.id || entry.videoId); if (!id) return null;
  const duration = Number(entry.duration) || 0;
  const artwork = String(entry.thumbnail || entry.thumbnails?.at?.(-1)?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`).slice(0, 1000);
  const title = String(entry.title || 'Untitled').slice(0, 200);
  const artist = String(entry.channel || entry.uploader || entry.channelTitle || 'YouTube').slice(0, 120);
  const url = `https://www.youtube.com/watch?v=${id}`;
  const views = Number(entry.view_count) || 0;
  const verified = !!(entry.channel_is_verified || entry.uploader_is_verified);
  const t = { id: `yt:${id}`, videoId: id, provider: 'youtube', title, artist, channelTitle: artist, artwork, artworkSmall: artwork, thumbnail: artwork, duration, playableDuration: duration || null, preview: false, fullTrack: true, playable: true, link: url, url, views, verified };
  t.official = officialChannel(t);
  return t;
}
// ---------- telling official uploads from fakes ----------
const plainName = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s*-\s*topic$/, '').replace(/vevo$/, '').replace(/\b(official|music|records|tv)\b/g, '').replace(/[^a-z0-9]/g, '');
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// "Drake - Topic" (YouTube's auto-made official audio), "DrakeVEVO", or a verified channel.
function officialChannel(t) { return (/\s-\sTopic$/i.test(t.artist) || /vevo$/i.test(t.artist.replace(/\s+/g, ''))) && artistMatches(claimedArtist(t.title) || t.artist.replace(/\s-\sTopic$/i, ''), t.artist); }
// The artist a title claims, from "Artist - Song" or "Song by Artist".
function claimedArtist(title) { const m = String(title).match(/^(.+?)\s+[-–—]\s+/) || String(title).match(/\bby\s+(.+?)(?:\(|\[|$)/i); return m ? m[1].split(/,|&| x | feat\.?| ft\.?/i)[0].trim() : null; }
const FAKE_WORDS = /\b(type beat|ai cover|ai version|\bai\b|fan ?made|unreleased|leak(ed)?|8d audio|nightcore|sped up|slowed|reverb|bass boosted|karaoke|instrumental|cover|remake|mashup|reaction)\b/i;
// How much to trust that an upload is the real recording. wantArtist is known when matching a catalog song.
function trustScore(t, wantArtist = null, query = '') {
  const ch = plainName(t.artist), want = plainName(wantArtist || claimedArtist(t.title) || '');
  let s = 0;
  if (/\s-\sTopic$/i.test(t.artist)) s += 1.0;
  else if (/vevo$/i.test(t.artist.replace(/\s+/g, ''))) s += 0.9;
  else if (t.verified) s += 0.6;
  if (want && ch === want) s += 0.5;
  // A channel named almost like the artist ("drakee", "Drak3") is an impersonator.
  if (want && ch !== want && want.length >= 3 && editDistance(ch, want) <= 2 && !t.verified && !/topic|vevo/i.test(t.artist)) s -= 2.0;
  if (t.views) s += Math.max(-1, Math.min(1.2, (Math.log10(t.views) - 5) / 2.5)); // 100k views ≈ neutral
  if (FAKE_WORDS.test(t.title) && !FAKE_WORDS.test(query)) s -= 0.8;
  return Math.round(s * 100) / 100;
}
// Put official uploads first and drop clear fakes when a trustworthy version is in the results.
function rankYouTube(tracks, query) {
  const scored = tracks.map((t) => ({ t, s: trustScore(t, null, query) }));
  const best = Math.max(...scored.map((x) => x.s), -9), maxViews = Math.max(1, ...tracks.map((t) => t.views || 0));
  const keep = scored.filter((x) => {
    if (x.s <= -1.5) return false; // impersonating channel
    if (best >= 0.8 && x.s < 0 && (x.t.views || 0) < maxViews * 0.01) return false; // tiny re-upload next to the real one
    return true;
  });
  keep.forEach((x, i) => { x.i = i; });
  keep.sort((a, b) => (b.s >= 0.8) - (a.s >= 0.8) || a.i - b.i); // official first, otherwise YouTube's order
  return { tracks: keep.map((x) => x.t), hidden: tracks.length - keep.length };
}
async function youtubeSearch(q, count = 10, { background = false } = {}) {
  const key = `${count}:${q.toLocaleLowerCase()}`;
  const cached = ytSearchCache.get(key); if (cached && cached.expires > Date.now()) return cached.entries;
  if (ytSearchInflight.has(key)) return ytSearchInflight.get(key);
  const task = (async () => {
    const { stdout } = await runYtDlp(['--dump-single-json', '--flat-playlist', '--no-warnings', `ytsearch${count}:${q}`], 40_000, { background });
    let data; try { data = JSON.parse(stdout); } catch { throw new HttpError(502, 'yt-dlp returned unreadable search results. Update yt-dlp and retry.'); }
    const entries = (Array.isArray(data.entries) ? data.entries : [data]).filter(Boolean);
    ytSearchCache.set(key, { entries, expires: Date.now() + 5 * 60_000 });
    if (ytSearchCache.size > 250) ytSearchCache.delete(ytSearchCache.keys().next().value);
    return entries;
  })().finally(() => ytSearchInflight.delete(key));
  ytSearchInflight.set(key, task); return task;
}
function ytMatchResult(t) { return { ...t, id: t.id, videoId: t.videoId, url: t.url, link: t.url, channelTitle: t.artist, thumbnail: t.artwork, preview: false, playable: true }; }
route('GET', '/api/youtube/config', () => ({ configured: true, region: 'US', setup: null, terms: 'https://www.youtube.com/t/terms', privacy: 'https://policies.google.com/privacy', playback: 'vesper-audio' }));
route('GET', '/api/youtube/search', async ({ query, user }) => {
  const q = String(query.q || '').trim().slice(0, 160);
  if (!q) return { configured: true, tracks: [] };
  const ranked = rankYouTube((await youtubeSearch(q, 12)).map(ytTrack).filter(Boolean), q);
  const tracks = ranked.tracks.slice(0, 10);
  if (user && query.record === '1') { user.searches = [q, ...user.searches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 20); db.save(); }
  return { configured: true, tracks, hidden: ranked.hidden };
}, { auth: true });
// ---------- finding the OFFICIAL full song ----------
// Strict on purpose: a song only plays as a full track when Vesper can confirm it's the real release.
//  1. YouTube Music's "Songs" results: official label/distributor tracks only, no user uploads.
//  2. Otherwise, regular YouTube, but only the artist's own "– Topic", VEVO or verified channel.
// Every pick is double-checked against YouTube's own details: the track's credited artist (or the
// channel) must match, and its length must match the catalog length, which catches sped-up, pitched,
// AI and "fake voice" versions. If nothing passes, Vesper plays the official 30-second clip instead.
const MATCH_V = 5;
const MATCH_FILE = path.join(DATA_DIR, 'match-cache.json');
const matchStore = (() => { try { const d = JSON.parse(fs.readFileSync(MATCH_FILE, 'utf8')); return d.v === MATCH_V ? d : { v: MATCH_V, hits: {} }; } catch { return { v: MATCH_V, hits: {} }; } })();
let matchSaveT = 0;
const saveMatches = () => { clearTimeout(matchSaveT); matchSaveT = setTimeout(() => { try { const keys = Object.keys(matchStore.hits); if (keys.length > 8000) for (const k of keys.slice(0, keys.length - 8000)) delete matchStore.hits[k]; fs.writeFileSync(MATCH_FILE + '.tmp', JSON.stringify(matchStore)); fs.renameSync(MATCH_FILE + '.tmp', MATCH_FILE); } catch {} }, 1000); };
const mNorm = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(feat|ft|featuring|with)\b.*$/, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(official|audio|lyrics?|video|hd|4k|visualizer|topic|music|remaster(ed)?)\b/g, ' ').replace(/\s+/g, ' ').trim();
const mTokens = (v) => new Set(mNorm(v).split(' ').filter((x) => x.length > 1 || /\d/.test(x)));
const mOverlap = (a, b) => { const A = mTokens(a), B = mTokens(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / A.size; };
// Exact artist names only: "Drake" matches "Drake", "Drake - Topic", "DrakeVEVO" or "Drake, Wizkid",
// never "Drakee" or "Drake Fan Page".
const artistNames = (v) => String(v || '').split(/,|&|;|\/| x | feat\.?| ft\.?| and /i).map((x) => plainName(x)).filter(Boolean);
const artistMatches = (want, ...have) => {
  const w = plainName(String(want).split(/,|&| x | feat\.?| ft\.?/i)[0]); if (!w) return false;
  return have.some((h) => artistNames(h).includes(w));
};
const FAKE_VERSION = /\b(speed|sped|sped ?up|slowed|nightcore|8d|reverb|ai|cover|karaoke|instrumental|remix|edit|mashup|bass boosted|pitched|chipmunk|tiktok version|fan ?made|leak(ed)?|unreleased|type beat|live)\b/i;

// Details for up to 3 videos in ONE yt-dlp run. With a format chosen, the details also contain the
// audio stream address, which is cached so playback doesn't need another YouTube request.
async function ytDetailsMany(ids, { background = false } = {}) {
  if (!ids.length) return [];
  const { stdout } = await runYtDlp(['-j', '--skip-download', '--no-warnings', '--no-playlist', '-i', '--format', YT_FORMATS.high, ...ids.map((id) => `https://www.youtube.com/watch?v=${id}`)], 60_000, { background, partial: true });
  const out = [];
  for (const line of String(stdout).split('\n')) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line); out.push(d);
      if (d.url && cleanYtId(d.id) && allowed(d.url, AUDIO_HOSTS)) {
        const { expire, dur } = ytUrlFacts(d.url);
        const expires = expire ? Math.min(expire - 20 * 60_000, Date.now() + 5 * 3600_000) : Date.now() + 30 * 60_000;
        ytUrlCache.set(`${d.id}|high`, { url: d.url, duration: dur || d.duration || null, expires: Math.max(expires, Date.now() + 60_000) });
      }
    } catch { /* skip */ }
  }
  return out;
}
// Which kind of genuine version a video is, or why it isn't one.
//  A: the official audio (artist's track on YouTube Music / "– Topic" / credited release), right length
//  B: the official music video on the artist's own channel (can run longer: intros, outros)
//  C: a re-upload of the official audio (lyrics channels etc.): exact title and artist, exact length,
//     millions of views and no altered-version words. Same recording, just someone else's upload.
function verifyOfficial(d, want) {
  const why = [];
  const credited = [d.artist, d.creator, ...(Array.isArray(d.artists) ? d.artists : [])].filter(Boolean).join(', ');
  const name = d.track || d.title || '';
  const channel = String(d.channel || d.uploader || '');
  const topic = /\s-\sTopic$/i.test(channel), vevo = /vevo$/i.test(channel.replace(/\s+/g, ''));
  const ownChannel = artistMatches(want.artist, channel) || (vevo && artistMatches(want.artist, channel.replace(/vevo$/i, '')));
  const creditedOk = artistMatches(want.artist, credited);
  const titleOk = mOverlap(want.title, name) >= 0.6 || mOverlap(want.title, d.title) >= 0.6;
  const altered = FAKE_VERSION.test(d.title || '') && !FAKE_VERSION.test(want.title);
  const diff = want.duration && d.duration ? d.duration - want.duration : 0;
  const slack = Math.max(10, (want.duration || 0) * 0.05);
  if (!titleOk) why.push('title differs');
  if (altered) why.push('altered version');
  if (!why.length && (creditedOk || (topic && ownChannel)) && Math.abs(diff) <= slack) return { ok: true, tier: 'A', why };
  if (!why.length && ownChannel && (vevo || d.channel_is_verified || topic) && diff >= -slack && diff <= 150) return { ok: true, tier: 'B', why };
  const claims = claimedArtist(d.title || '');
  if (!why.length && claims && artistMatches(want.artist, claims) && want.duration && Math.abs(diff) <= 2 && (d.view_count || 0) >= 2_000_000) return { ok: true, tier: 'C', why };
  if (!creditedOk && !ownChannel) why.push('different artist');
  if (want.duration && d.duration && Math.abs(diff) > slack) why.push(`length ${d.duration}s vs ${want.duration}s`);
  if (!why.length) why.push('not the artist’s official upload');
  return { ok: false, why };
}
async function ytMusicSongs(q, { background = false } = {}) {
  try {
    const { stdout } = await runYtDlp(['--flat-playlist', '-J', '--no-warnings', '--playlist-items', '1:8', `https://music.youtube.com/search?q=${encodeURIComponent(q)}#songs`], 40_000, { background });
    const d = JSON.parse(stdout); return (d.entries || []).filter((e) => cleanYtId(e.id));
  } catch (e) { if (e.code === 'yt_signin' || e.code === 'yt_cookies' || e.code === 'ytdlp_missing') throw e; return []; }
}
async function findOfficial(want, { background = false } = {}) {
  const A = want.artist, T = want.title, rejected = [];
  const score = (e, from) => {
    const title = String(e.title || ''), channel = String(e.channel || e.uploader || (Array.isArray(e.artists) ? e.artists.join(', ') : '') || '');
    if (!cleanYtId(e.id) || mOverlap(T, title) < 0.6) return null;                 // a different song
    if (FAKE_VERSION.test(title) && !FAKE_VERSION.test(T)) return null;             // sped up, remix, AI, cover…
    if (e.duration && e.duration < 45) return null;
    let p = 0;
    if (artistMatches(A, channel)) p += /\s-\sTopic$/i.test(channel) ? 4 : 3;
    else if (/vevo$/i.test(channel.replace(/\s+/g, '')) && artistMatches(A, channel.replace(/vevo$/i, ''))) p += 3;
    else if (/\s-\sTopic$/i.test(channel)) p -= 3;                                  // someone else's release
    if (artistMatches(A, claimedArtist(title) || '')) p += 1;
    if (from === 'music') p += 1.5;
    if (want.duration && e.duration) p += Math.abs(e.duration - want.duration) <= 10 ? 1 : -1.5;
    p += Math.min(1, Math.log10(Number(e.view_count) || 1) / 9);
    return p > -1 ? { id: e.id, p } : null;
  };
  const tryBatch = async (entries, from) => {
    const picks = entries.map((e) => score(e, from)).filter(Boolean).sort((x, y) => y.p - x.p).slice(0, 3);
    const details = await ytDetailsMany(picks.map((x) => x.id), { background });
    const ok = [];
    for (const d of details) {
      const v = verifyOfficial(d, want);
      if (!v.ok) { rejected.push(`${d.title} (${d.channel}): ${v.why.join(', ')}`); continue; }
      const t = ytTrack({ ...d, id: d.id }); t.official = v.tier !== 'C'; t.matchTier = v.tier;
      if (d.track) t.title = d.track;
      t.artist = d.artist ? String(d.artist).split(',')[0].trim() : String(d.channel || t.artist).replace(/\s-\sTopic$/i, '').replace(/vevo$/i, '').trim() || t.artist;
      ok.push(t);
    }
    ok.sort((x, y) => ({ A: 0, B: 1, C: 2 })[x.matchTier] - ({ A: 0, B: 1, C: 2 })[y.matchTier] || (y.views || 0) - (x.views || 0));
    return ok[0] || null;
  };
  // 1) YouTube Music songs: 1 search + 1 check.  2) Only if needed, regular YouTube: 1 search + 1 check.
  let t = await tryBatch(await ytMusicSongs(`${A} ${T}`, { background }), 'music');
  if (t) return { track: t, via: 'YouTube Music' };
  t = await tryBatch(await youtubeSearch(`${A} ${T}`, 10, { background }), 'youtube');
  if (t) return { track: t, via: 'YouTube' };
  return { track: null, rejected };
}
route('GET', '/api/youtube/match', async ({ query }) => {
  const title = String(query.title || '').trim().slice(0, 160), artist = String(query.artist || '').trim().slice(0, 120);
  if (!title || !artist) throw new HttpError(400, 'A song title and artist are required to find the full version.');
  const want = { title, artist, duration: Number(query.duration) || 0 };
  const key = `${mNorm(title)}|${plainName(artist)}`;
  const hit = matchStore.hits[key];
  if (hit && (hit.track || hit.at > Date.now() - 6 * 3600_000)) {
    if (!hit.track) throw new HttpError(404, `No official full version of “${title}” is on YouTube.`, 'no_official');
    return { track: ytMatchResult(hit.track), cached: true, matchV: MATCH_V };
  }
  if (ytMatchInflight.has(key)) return ytMatchInflight.get(key);
  const task = (async () => {
    const r = await findOfficial(want, { background: query.bg === '1' }); // throws on sign-in problems, which are never cached
    matchStore.hits[key] = { track: r.track, at: Date.now() }; saveMatches();
    if (!r.track) { console.log(`No official match for ${artist} – ${title}. Rejected: ${(r.rejected || []).join(' | ') || 'no candidates'}`); throw new HttpError(404, `No official full version of “${title}” is on YouTube.`, 'no_official'); }
    return { track: ytMatchResult(r.track), cached: false, via: r.via, matchV: MATCH_V };
  })().finally(() => ytMatchInflight.delete(key));
  ytMatchInflight.set(key, task); return task;
}, { auth: true });

// Small, cache-aware candidate list for polite background preparation. This sends only catalog
// metadata (never audio) and excludes tracks already matched on disk, so they aren't re-queried.
route('GET', '/api/youtube/prewarm-candidates', ({ user }) => {
  const source = [
    ...Object.values(user.library.likes || {}).sort((a, b) => (b.likedAt || '').localeCompare(a.likedAt || '')),
    ...db.playlistsOf(user.id).flatMap((p) => p.tracks || []),
  ];
  const seen = new Set(), tracks = [];
  for (const t of source) {
    if (!t || !t.title || !t.artist || !/^(dz|it):/.test(String(t.id || '')) || t.playable === false) continue;
    const key = `${mNorm(t.title)}|${plainName(t.artist)}`;
    if (!key || key === '|' || seen.has(key)) continue;
    seen.add(key);
    const hit = matchStore.hits[key];
    if (hit?.track) continue; // positive match is durable on disk; never match it again
    if (hit && hit.at > Date.now() - 6 * 3600_000) continue; // recent negative result is cached too
    if (t.youtubeMatched && Number(t.matchV) === MATCH_V) continue;
    tracks.push({ id: t.id, title: String(t.title).slice(0, 160), artist: String(t.artist).slice(0, 120), duration: Number(t.sourceDuration || t.duration) || 0, sourceDuration: Number(t.sourceDuration || t.duration) || undefined, provider: t.provider || (/^it:/.test(t.id) ? 'itunes' : 'deezer'), preview: true, playable: true });
  }
  return { tracks, count: tracks.length };
}, { auth: true });
route('GET', '/api/youtube/resolve', async ({ query }) => {
  const raw = String(query.url || '').trim();
  const match = raw.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  const id = cleanYtId(match?.[1] || raw);
  if (!id) throw new HttpError(400, 'Paste a valid YouTube video link.');
  const videoUrl = `https://www.youtube.com/watch?v=${id}`;
  const { stdout } = await runYtDlp(['--dump-single-json', '--no-warnings', '--no-playlist', videoUrl], 35_000);
  let entry; try { entry = JSON.parse(stdout); } catch { throw new HttpError(502, 'yt-dlp returned unreadable video details. Update yt-dlp and retry.'); }
  let track = ytTrack({ ...entry, id });
  if (!track) throw new HttpError(404, 'Could not resolve that YouTube video.');
  return { track };
}, { auth: true });

// Get a song ready before it plays: resolves the stream now (cached for hours) and reports its
// real length, which is more reliable than what some browsers compute from the audio itself.
route('GET', '/api/audio-prepare/:id', async ({ params, query }) => {
  const [p, pid] = splitId(params.id);
  if (p !== 'yt') return { ready: true, duration: null };
  const videoId = cleanYtId(pid); if (!videoId) throw new HttpError(400, 'Invalid YouTube video ID.');
  const r = await resolveYtAudio(videoId, query.q === 'low' ? 'low' : 'high');
  return { ready: true, duration: r.duration };
}, { auth: true });

route('GET', '/api/sources', () => ({
  providers: [
    { ...dz.info, status: 'ready' },
    { ...it.info, status: 'ready' },
    { ...jm.info, status: jm.configured() ? 'ready' : 'needs-key', setup: 'Get a free client ID at devportal.jamendo.com and set JAMENDO_CLIENT_ID in .env, then restart.' },
    { ...local.info, status: local.configured() ? 'ready' : 'not-configured', ...local.status(), setup: 'Set MUSIC_DIR in .env to a folder of your own music files, then restart.' },
    { ...ts.info, status: ts.enabled() ? 'ready' : 'disabled' },
    { id: 'youtube', name: 'YouTube', fullTracks: true, needsKey: false, status: 'ready', setup: 'Install or update yt-dlp with: brew install yt-dlp' , limitation: 'Full-length audio is streamed through Vesper’s player using yt-dlp; availability can change when YouTube changes its delivery system.' },
  ],
  notIntegrated: [
    { name: 'Spotify', needs: 'Spotify Web Playback SDK: a Spotify developer app, OAuth login, and Spotify Premium for every listener. Audio plays inside Spotify’s SDK, so Vesper’s crossfade engine cannot process it.' },
    { name: 'Apple Music (full tracks)', needs: 'MusicKit JS: Apple Developer Program membership, a signed developer token, and an Apple Music subscription per listener.' },
  ],
}));

// ---------- auth ----------
// Simple per-IP rate limit for sign-in/sign-up attempts (10 per 10 minutes).
const authHits = new Map();
function authLimit(req) {
  const ip = clientIp(req), now = Date.now();
  const list = (authHits.get(ip) || []).filter((t) => now - t < 600_000);
  if (list.length >= 10) throw new HttpError(429, 'Too many sign-in attempts. Wait a few minutes and try again.', 'rate_limited');
  list.push(now); authHits.set(ip, list);
}
route('POST', '/api/auth/guest', async ({ req, body, res }) => {
  if (isRemoteRequest(req) && process.env.ALLOW_REMOTE_GUESTS !== '1') throw new HttpError(403, 'Guest profiles can only be created on your home network. Sign in with your username and password (create the account at home first).', 'remote_guest');
  const u = db.newUser({ displayName: String(body.displayName || 'Listener').trim() || 'Listener' });
  setSession(res, db.createSession(u.id));
  return { user: publicUser(u) };
});
route('POST', '/api/auth/register', async ({ req, body, res, user }) => {
  authLimit(req);
  const username = String(body.username || '').trim(), password = String(body.password || '');
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, 'Usernames are 3–32 letters, numbers, dots, dashes or underscores.');
  if (password.length < 8) throw new HttpError(400, 'Use a password of at least 8 characters.');
  if (db.userByName(username)) throw new HttpError(409, 'That username is taken.');
  let u = user;
  if (u && u.guest) db.setCredentials(u, username, password); // upgrade the guest profile, keeping its library
  else u = db.newUser({ username, password, displayName: String(body.displayName || username) });
  if (body.displayName) u.displayName = String(body.displayName).slice(0, 40);
  if (Array.isArray(body.favoriteArtists)) {
    for (const a of body.favoriteArtists.slice(0, 100)) {
      const id = String(a?.id || ''); const name = String(a?.name || '').trim();
      if (!name || !/^(dz|jma|ita):[A-Za-z0-9_-]+$/.test(id)) continue;
      u.library.artists[id] = { id, name: name.slice(0, 160), artwork: typeof a.artwork === 'string' ? a.artwork.slice(0, 1000) : null, artworkSmall: typeof a.artworkSmall === 'string' ? a.artworkSmall.slice(0, 1000) : null, followedAt: new Date().toISOString() };
    }
    db.save();
  }
  setSession(res, db.createSession(u.id));
  return { user: publicUser(u) };
});
route('POST', '/api/auth/login', async ({ req, body, res }) => {
  authLimit(req);
  const u = db.userByName(String(body.username || ''));
  if (!u || !checkPassword(u, String(body.password || ''))) throw new HttpError(401, 'Username or password is incorrect.');
  setSession(res, db.createSession(u.id));
  return { user: publicUser(u) };
});
route('PUT', '/api/me/credentials', ({ req, body, user }) => {
  authLimit(req);
  const currentPassword = String(body.currentPassword || '');
  if (!checkPassword(user, currentPassword)) throw new HttpError(401, 'Your current password is incorrect.');
  const username = String(body.username || user.username || '').trim();
  const password = String(body.newPassword || '');
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, 'Usernames are 3–32 letters, numbers, dots, dashes or underscores.');
  const existing = db.userByName(username);
  if (existing && existing.id !== user.id) throw new HttpError(409, 'That username is already taken.');
  if (password && password.length < 8) throw new HttpError(400, 'Use a new password of at least 8 characters.');
  if (!password && username.toLowerCase() === user.username) throw new HttpError(400, 'Enter a new username or a new password.');
  db.setCredentials(user, username, password || currentPassword);
  user.mustChangePassword = false;
  db.save();
  return { user: publicUser(user) };
}, { auth: true });
route('POST', '/api/auth/logout', ({ req, res }) => { db.endSession(cookies(req)[COOKIE]); clearSession(res); return { ok: true }; });
route('GET', '/api/me', ({ user, req, res }) => {
  // Keep people signed in: every visit pushes the cookie's expiry another year out.
  const token = cookies(req)[COOKIE]; if (token) setSession(res, token);
  return { user: publicUser(user) };
}, { auth: true });
route('PATCH', '/api/me', ({ user, body }) => {
  if (typeof body.displayName === 'string' && body.displayName.trim()) user.displayName = body.displayName.trim().slice(0, 40);
  if (body.avatar === null || (typeof body.avatar === 'string' && body.avatar.startsWith('data:image/') && body.avatar.length < 400_000)) user.avatar = body.avatar;
  if (Array.isArray(body.favoriteGenres)) user.profile.favoriteGenres = body.favoriteGenres.slice(0, 12).map(String);
  if (body.settings && typeof body.settings === 'object') {
    const s = body.settings, cur = user.settings;
    const pick = (k, ok) => { if (k in s && ok(s[k])) cur[k] = s[k]; };
    pick('theme', (v) => ['dark', 'light'].includes(v));
    pick('transition', (v) => ['smooth', 'seamless', 'dj', 'cinematic', 'minimal', 'off'].includes(v));
    pick('crossfade', (v) => Number.isFinite(v) && v >= 1 && v <= 12);
    pick('speed', (v) => [0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].includes(v));
    pick('artworkMode', (v) => ['minimal', 'ambient', 'immersive', 'visualizer', 'lyrics'].includes(v));
    pick('visualizerIntensity', (v) => Number.isFinite(v) && v >= 0 && v <= 1);
    pick('reducedMotion', (v) => ['system', 'on', 'off'].includes(v));
    pick('processing', (v) => ['auto', 'on', 'off'].includes(v));
    pick('lyricsSource', (v) => ['lrclib', 'off'].includes(v));
    pick('noFullFallback', (v) => ['skip', 'clip'].includes(v));
    for (const k of ['autoplay', 'leveling', 'explicit', 'recordHistory', 'historyForRecs', 'youtubeAck', 'smartShuffle', 'fullViaYouTube', 'discordPresence', 'dataSaver']) pick(k, (v) => typeof v === 'boolean');
    const db12 = (v) => Number.isFinite(v) && v >= -12 && v <= 12;
    if (s.eq && typeof s.eq === 'object') {
      const e = s.eq, c = { ...cur.eq };
      if (typeof e.enabled === 'boolean') c.enabled = e.enabled;
      if (typeof e.preset === 'string' && e.preset.length <= 40) c.preset = e.preset;
      if (Array.isArray(e.bands) && e.bands.length === 10 && e.bands.every(db12)) c.bands = e.bands.map((x) => Math.round(x * 2) / 2);
      for (const k of ['bass', 'mid', 'treble']) if (db12(e[k])) c[k] = Math.round(e[k] * 2) / 2;
      cur.eq = c;
    }
    if (Array.isArray(s.eqPresets)) {
      if (s.eqPresets.length > 20) throw new HttpError(400, 'You can save up to 20 equalizer presets.');
      cur.eqPresets = s.eqPresets.map((p) => {
        const name = String(p?.name || '').trim().slice(0, 30);
        if (!name || !/^[\w-]{1,24}$/.test(String(p.id || '')) || !Array.isArray(p.bands) || p.bands.length !== 10 || !p.bands.every(db12)) throw new HttpError(400, 'Invalid equalizer preset.');
        return { id: String(p.id), name, bands: p.bands.map(Number) };
      });
    }
  }
  db.save();
  return { user: publicUser(user) };
}, { auth: true });
route('DELETE', '/api/me', ({ user, res }) => { db.deleteUser(user.id); clearSession(res); return { ok: true }; }, { auth: true });

// ---------- search ----------
const PREF = { local: 4, test: 0, jamendo: 3, deezer: 2, itunes: 1 };
route('GET', '/api/search', async ({ query, user }) => {
  const q = String(query.q || '').trim().slice(0, 200);
  if (!q) return { tracks: [], artists: [], albums: [], playlists: [], errors: [] };
  const source = query.source || 'all';
  const errors = [];
  const wrap = (name, p) => p.catch((e) => { if (!(e.code === 'not_configured' && source === 'all')) errors.push({ provider: name, message: e.message }); return []; });
  const want = (s) => source === 'all' || source === s;
  const [dzT, itT, jmT, artists, albums, playlists] = await Promise.all([
    want('deezer') ? wrap('Deezer', dz.searchTracks(q, 25)) : [],
    want('itunes') ? wrap('Apple', it.searchTracks(q, 20)) : [],
    want('jamendo') && jm.configured() ? wrap('Jamendo', jm.searchTracks(q, 15)) : (source === 'jamendo' ? wrap('Jamendo', jm.searchTracks(q)) : []),
    want('deezer') ? wrap('Deezer', dz.searchArtists(q, 8)) : [],
    want('deezer') ? wrap('Deezer', dz.searchAlbums(q, 10)) : [],
    want('deezer') ? wrap('Deezer', dz.searchPlaylists(q, 8)) : [],
  ]);
  const lc = want('local') ? local.search(q) : [];
  const tst = want('test') && ts.enabled() ? ts.search(q) : [];
  // Score by text relevance plus the provider's own ordering, then de-duplicate the same
  // recording across providers, keeping the version with the best playback (full > preview).
  const scored = [];
  for (const [list, w] of [[dzT, 0.3], [itT, 0.25], [jmT, 0.2], [lc, 0.35], [tst, 0.1]]) list.forEach((t, i) => scored.push({ t, s: relevance(q, t) + w * (1 - i / Math.max(1, list.length)) }));
  scored.sort((a, b) => b.s - a.s);
  const seen = new Map();
  for (const { t, s } of scored) {
    const key = `${normText(t.title).replace(/ (feat|ft) .*/, '')}|${normText(t.artist)}`;
    const cur = seen.get(key);
    if (!cur) { seen.set(key, { t, s, alt: [] }); continue; }
    const better = (t.playable && !cur.t.playable) || (t.playable === cur.t.playable && (PREF[t.provider] || 0) > (PREF[cur.t.provider] || 0));
    if (better) { cur.alt.push(cur.t.provider); cur.t = t; } else cur.alt.push(t.provider);
  }
  let tracks = [...seen.values()].map(({ t, alt }) => ({ ...t, alsoOn: [...new Set(alt)] }));
  if (user && !user.settings.explicit) tracks = tracks.filter((t) => !t.explicit);
  const rankA = artists.map((a, i) => ({ a, s: relevance(q, { name: a.name }) + 0.3 * (1 - i / 8) + Math.log10((a.fans || 0) + 10) * 0.04 })).sort((x, y) => y.s - x.s).map((x) => x.a);
  if (user && query.record === '1') { user.searches = [q, ...user.searches.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, 20); db.save(); }
  return { tracks: tracks.slice(0, 40), artists: rankA, albums, playlists, errors: [...new Map(errors.map((e) => [e.provider, e])).values()] };
});
route('GET', '/api/suggest', async ({ query }) => {
  const q = String(query.q || '').trim();
  if (q.length < 2) return { suggestions: [] };
  const t = await dz.searchTracks(q, 6).catch(() => []);
  const a = await dz.searchArtists(q, 3).catch(() => []);
  return { suggestions: [...a.map((x) => ({ kind: 'artist', text: x.name, id: x.id, artwork: x.artworkSmall })), ...t.map((x) => ({ kind: 'track', text: `${x.title} — ${x.artist}`, query: `${x.title} ${x.artist}`, artwork: x.artworkSmall }))].slice(0, 8) };
});
route('GET', '/api/me/searches', ({ user }) => ({ searches: user.searches }), { auth: true });
route('DELETE', '/api/me/searches', ({ user }) => { user.searches = []; db.save(); return { ok: true }; }, { auth: true });

// ---------- metadata ----------
route('GET', '/api/track/:id', async ({ params }) => {
  const [p, pid] = splitId(params.id);
  if (p === 'dz') { const t = await dz.track(pid); delete t._preview; return { track: t }; }
  if (p === 'ts') { const t = ts.tracks.find((x) => x.id === params.id); if (!t) throw new HttpError(404, 'Not found'); return { track: t }; }
  if (p === 'lc') { const e = local.get(pid); if (!e) throw new HttpError(404, 'Not found'); return { track: e.track }; }
  if (p === 'it') return { track: it.mapTrack(await it.lookupOne(pid)) };
  throw new HttpError(404, 'Unknown track source');
});

const resolvedArtist = new TTLCache(500);
async function resolveDeezerByName(kind, name, extra = '') {
  const key = `${kind}|${normText(name)}|${normText(extra)}`;
  if (resolvedArtist.get(key)) return resolvedArtist.get(key);
  let id = null;
  if (kind === 'artist') { const r = await dz.searchArtists(name, 5); id = (r.find((a) => normText(a.name) === normText(name)) || r[0])?.id; }
  else { const r = await dz.searchAlbums(`${extra} ${name}`, 8); id = (r.find((a) => normText(a.title) === normText(name) && normText(a.artist) === normText(extra)) || r.find((a) => normText(a.title) === normText(name)) || r[0])?.id; }
  if (!id) throw new HttpError(404, `Couldn’t find this ${kind} on Deezer.`);
  resolvedArtist.set(key, id, 24 * 3600_000);
  return id;
}
route('GET', '/api/artist/:id', async ({ params }) => {
  let [p, pid] = splitId(params.id);
  if (p === 'jma') return { ...(await jm.artistTracks(pid)), albums: [], eps: [], singles: [], related: [], provider: 'jamendo' };
  if (p === 'ita') { const a = await it.lookupOne(pid); return { redirect: await resolveDeezerByName('artist', a.artistName) }; }
  if (p !== 'dz') throw new HttpError(404, 'Artist pages are available for Deezer and Jamendo artists.');
  return { ...(await dz.artist(pid)), provider: 'deezer' };
});
route('GET', '/api/artist-by-name', async ({ query }) => {
  const name = String(query.name || '').trim();
  if (!name) throw new HttpError(400, 'Artist name is required.');
  const results = await dz.searchArtists(name, 5);
  const artist = results.find((a) => normText(a.name) === normText(name)) || results[0];
  if (!artist) throw new HttpError(404, `Couldn’t find artist ${name}.`);
  return { redirect: artist.id, artist };
});
route('GET', '/api/artist-top/:id', async ({ params, query }) => {
  const [provider, id] = splitId(params.id);
  if (provider !== 'dz') throw new HttpError(404, 'Top tracks are available for Deezer artists.');
  const limit = Math.max(1, Math.min(5, Number(query.limit) || 2));
  return { tracks: await dz.artistTop(id, limit) };
});
route('GET', '/api/album/:id', async ({ params }) => {
  const [p, pid] = splitId(params.id);
  if (p === 'jmc') return await jm.albumTracks(pid);
  if (p === 'itc') { const a = await it.lookupOne(pid); return { redirect: await resolveDeezerByName('album', a.collectionName, a.artistName) }; }
  if (p !== 'dz') throw new HttpError(404, 'Album pages are available for Deezer and Jamendo albums.');
  const r = await dz.album(pid);
  const more = r.album.artistId ? (await dz.artistAlbums(r.album.artistId.slice(3)).catch(() => [])).filter((a) => a.id !== r.album.id).slice(0, 8) : [];
  return { ...r, more };
});
route('GET', '/api/dzplaylist/:id', async ({ params }) => dz.playlist(splitId(params.id)[1]));
route('GET', '/api/radio/:id', async ({ params }) => {
  const [p, pid] = splitId(params.id);
  if (p === 'dzr') return { tracks: await dz.radioTracks(pid) };
  if (p === 'dz') return { tracks: await dz.artistRadio(pid) }; // artist radio
  throw new HttpError(404, 'Unknown radio');
});
route('GET', '/api/genre-radios', async () => ({ radios: await dz.genreRadios() }));

// ---------- Global live-radio directory (Radio Browser community directory) ----------
const RADIO_BROWSER = 'https://de1.api.radio-browser.info';
const radioStationUrls = new Map();
function radioStation(s) {
  const stream = String(s?.url_resolved || s?.url || '').trim();
  const id = String(s?.stationuuid || '').trim();
  if (!id || !stream || !/^https?:\/\//i.test(stream)) return null;
  // Remember only URLs returned by the radio directory; audio requests cannot supply arbitrary URLs.
  radioStationUrls.set(id, stream);
  if (radioStationUrls.size > 5000) radioStationUrls.delete(radioStationUrls.keys().next().value);
  return {
    id: `rb:${id}`, stationId: id, provider: 'radio', title: String(s.name || 'Radio station').slice(0, 200),
    artist: [s.country, s.language].filter(Boolean).join(' · '), country: s.country || '', countryCode: s.countrycode || '',
    language: s.language || '', tags: String(s.tags || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8),
    homepage: s.homepage || '', artwork: /^https:\/\//i.test(s.favicon || '') ? s.favicon : null,
    bitrate: Number(s.bitrate) || null, codec: s.codec || '', duration: 0, playableDuration: 0, fullTrack: true,
    streamUrl: stream, bpm: null
  };
}
async function radioDirectory(url, ttl = 5 * 60_000) {
  return fetchJSON(url, { ttl, retries: 1, provider: 'Radio Browser', headers: { 'User-Agent': 'Vesper/1.7 (radio directory; personal music player)' } });
}
route('GET', '/api/radio-stations/top', async ({ query }) => {
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
  const order = query.order === 'votes' ? 'topvote' : 'topclick';
  const raw = await radioDirectory(`${RADIO_BROWSER}/json/stations/${order}/${limit}`, 10 * 60_000);
  return { stations: raw.map(radioStation).filter(Boolean), source: 'Radio Browser', order };
});
route('GET', '/api/radio-stations/search', async ({ query }) => {
  const q = new URLSearchParams();
  const name = String(query.q || '').trim().slice(0, 100);
  const country = String(query.country || '').trim().slice(0, 80);
  const tag = String(query.tag || '').trim().slice(0, 80);
  const language = String(query.language || '').trim().slice(0, 80);
  if (name) q.set('name', name);
  if (country) q.set('country', country);
  if (tag) q.set('tag', tag);
  if (language) q.set('language', language);
  q.set('hidebroken', 'true'); q.set('order', 'clickcount'); q.set('reverse', 'true');
  q.set('limit', String(Math.max(1, Math.min(100, Number(query.limit) || 50))));
  q.set('offset', String(Math.max(0, Math.min(100000, Number(query.offset) || 0))));
  const raw = await radioDirectory(`${RADIO_BROWSER}/json/stations/search?${q}`, 3 * 60_000);
  return { stations: raw.map(radioStation).filter(Boolean), source: 'Radio Browser' };
});
route('GET', '/api/radio-stations/filters', async () => {
  const [countries, tags, languages] = await Promise.all([
    radioDirectory(`${RADIO_BROWSER}/json/countries?order=stationcount&reverse=true`, 6 * 3600_000),
    radioDirectory(`${RADIO_BROWSER}/json/tags?order=stationcount&reverse=true`, 6 * 3600_000),
    radioDirectory(`${RADIO_BROWSER}/json/languages?order=stationcount&reverse=true`, 6 * 3600_000)
  ]);
  return {
    countries: countries.filter(x => x.name && Number(x.stationcount) > 0).slice(0, 250).map(x => ({ name: x.name, count: Number(x.stationcount) || 0, code: x.iso_3166_1 || '' })),
    tags: tags.filter(x => x.name && Number(x.stationcount) > 0).slice(0, 150).map(x => ({ name: x.name, count: Number(x.stationcount) || 0 })),
    languages: languages.filter(x => x.name && Number(x.stationcount) > 0).slice(0, 150).map(x => ({ name: x.name, count: Number(x.stationcount) || 0 }))
  };
});


// ---------- charts ----------
const GENRES = [[132, 'Pop'], [116, 'Rap & Hip Hop'], [152, 'Rock'], [85, 'Alternative'], [165, 'R&B'], [113, 'Dance'], [106, 'Electro'], [197, 'Latin'], [84, 'Country'], [129, 'Jazz']];
const CHARTS = [
  { id: 'us-top', title: 'United States Top 50', kind: 'tracks', source: 'Apple Music Top Songs, USA (Apple RSS)', schedule: 'Updated by Apple; see timestamp' },
  { id: 'global-top', title: 'Worldwide Top 50', kind: 'tracks', source: 'Deezer worldwide chart', schedule: 'Updated by Deezer' },
  { id: 'rising', title: 'Fastest rising', kind: 'tracks', source: 'Computed by this app from its own daily chart snapshots', schedule: 'Needs two days of snapshots' },
  { id: 'top-albums', title: 'Top Albums', kind: 'albums', source: 'Deezer worldwide chart' },
  { id: 'us-albums', title: 'US Top Albums', kind: 'albums', source: 'Apple Music, USA (Apple RSS)' },
  { id: 'top-artists', title: 'Top Artists', kind: 'artists', source: 'Deezer worldwide chart' },
  { id: 'new-releases', title: 'New Releases', kind: 'albums', source: 'Deezer editorial' },
  ...GENRES.map(([g, n]) => ({ id: `genre-${g}`, title: `${n}`, kind: 'tracks', source: `Deezer ${n} chart`, genre: true })),
];
function withMovement(chartId, items) {
  const prev = db.snapshot(chartId, items.map((x) => x.id));
  return { items: items.map((x, i) => { const pp = prev ? prev.ids.indexOf(x.id) : -1; return { ...x, position: i + 1, previous: prev ? (pp >= 0 ? pp + 1 : null) : undefined }; }), comparedTo: prev?.date || null };
}
route('GET', '/api/charts', () => ({ charts: CHARTS }));
route('GET', '/api/charts/:id', async ({ params }) => {
  const c = CHARTS.find((x) => x.id === params.id);
  if (!c) throw new HttpError(404, 'Unknown chart');
  let items, updated = null;
  if (c.id === 'us-top') { const r = await it.usTopSongs(50); items = r.tracks; updated = r.updated; }
  else if (c.id === 'us-albums') { const r = await it.usTopAlbums(50); items = r.albums; updated = r.updated; }
  else if (c.id === 'global-top') items = await dz.chart(0, 'tracks', 50);
  else if (c.id === 'top-albums') items = await dz.chart(0, 'albums', 50);
  else if (c.id === 'top-artists') items = await dz.chart(0, 'artists', 50);
  else if (c.id === 'new-releases') return { chart: c, items: await dz.newReleases(40), fetchedAt: new Date().toISOString() };
  else if (c.genre) items = await dz.chart(Number(c.id.split('-')[1]), 'tracks', 50);
  else if (c.id === 'rising') {
    const out = [];
    for (const src of ['global-top', 'us-top']) {
      const snaps = db.data.snapshots[src] || [];
      if (snaps.length < 2) continue;
      const [a, b] = snaps.slice(-2);
      b.ids.forEach((id, i) => { const before = a.ids.indexOf(id); out.push({ id, gain: before < 0 ? 51 - (i + 1) : before - i, now: i + 1, before: before < 0 ? null : before + 1, src, date: a.date }); });
    }
    const top = out.filter((x) => x.gain > 0).sort((x, y) => y.gain - x.gain).slice(0, 30);
    if (!top.length) return { chart: c, items: [], message: 'Fastest rising needs chart snapshots from at least two different days. Open the US and Worldwide charts today and again tomorrow.', fetchedAt: new Date().toISOString() };
    const [g, u] = await Promise.all([dz.chart(0, 'tracks', 50).catch(() => []), it.usTopSongs(50).then((r) => r.tracks).catch(() => [])]);
    const all = new Map([...g, ...u].map((t) => [t.id, t]));
    return { chart: c, items: top.filter((x) => all.has(x.id)).map((x, i) => ({ ...all.get(x.id), position: i + 1, rise: x.gain, chartNow: x.now, chartBefore: x.before, risingSource: x.src === 'us-top' ? 'US Top 50' : 'Worldwide Top 50' })), comparedTo: top[0]?.date, fetchedAt: new Date().toISOString() };
  }
  const m = withMovement(c.id, items);
  return { chart: c, items: m.items, comparedTo: m.comparedTo, updated, fetchedAt: new Date().toISOString() };
});

// ---------- recommendations, mixes, sessions ----------
// ---------- Mood-to-Mix 2.0 ----------
// Builds a coherent mix: interprets the prompt, finds catalog playlists that genuinely match it,
// uses the ARTISTS in those playlists as the definition of the mood's sound, then ranks candidates
// by mood fit + the listener's real taste signals. Never uses loose track-title keyword matches.
const MOOD_GENRES = [
  [/r\s*&?\s*b|rnb|rhythm and blues|neo.?soul|\bsoul\b/, 'R&B'], [/melodic rap|hip.?hop|\brap\b|trap|drill/, 'hip hop'], [/indie|dream.?pop|bedroom pop|shoegaze/, 'indie'],
  [/k.?pop/, 'K-pop'], [/\bpop\b/, 'pop'], [/rock|metal|punk|grunge/, 'rock'], [/electronic|edm|house|techno|\bdance\b|dnb|drum and bass/, 'electronic'],
  [/country|folk|acoustic|americana/, 'acoustic'], [/jazz/, 'jazz'], [/classical|piano|orchestral/, 'classical'], [/lo.?fi|ambient/, 'lofi'],
  [/latin|reggaeton/, 'latin'], [/afrobeats?|amapiano/, 'afrobeats'],
];
const MOOD_WORDS = [
  [/late.?night|after.?hours|midnight|night drive|nocturnal/, 'late night', 'low'], [/sad|heartbreak|cry|melanchol|lonely/, 'sad', 'low'],
  [/chill|calm|relax|soft|mellow|peaceful|sleep/, 'chill', 'low'], [/dreamy|hazy|ethereal/, 'dreamy', 'low'], [/romantic|love|sensual/, 'love', 'mid'],
  [/focus|study|work|concentrat/, 'focus', 'low'], [/nostalg|throwback|2000s|2010s|90s/, 'throwback', 'mid'], [/happy|sunny|feel.?good|upbeat/, 'feel good', 'high'],
  [/confident|swagger|boss|main character/, 'confident', 'high'], [/hype|workout|gym|party|turn up|energy|energetic/, 'hype', 'high'], [/dark|moody|gritty/, 'dark', 'mid'],
];
const JUNK_RE = /\b(type beat|beat tape|instrumental( version)?|prod(?:uced)?\.? by|free beat|karaoke|8d audio|slowed|sped up|nightcore|reverb(ed)?|ringtone|cover by|tribute|in the style of|backing track|playlist|mix 20\d\d|1 hour|10 hours)\b/i;
function interpretMood(text) {
  const lower = text.toLowerCase();
  const genre = MOOD_GENRES.find(([re]) => re.test(lower))?.[1] || null;
  const moods = MOOD_WORDS.filter(([re]) => re.test(lower));
  const energyWord = /\b(slow|low.?energy|quiet|gentle)\b/.test(lower) ? 'low' : /\b(fast|high.?energy|loud|intense)\b/.test(lower) ? 'high' : null;
  const energy = energyWord || (moods.length ? moods.map((m) => m[2]).sort((a, b) => ['low', 'mid', 'high'].indexOf(a) - ['low', 'mid', 'high'].indexOf(b))[Math.floor(moods.length / 2)] : 'mid');
  const melodic = /melodic|smooth|vocal|singing/.test(lower);
  const likeArtist = (text.match(/\b(?:like|similar to|in the vibe of)\s+([A-Za-z0-9 .&'$-]{2,40})/i)?.[1] || '').trim() || null;
  return { genre, moods: moods.map((m) => m[1]), energy, melodic, likeArtist, allowBeats: /\b(beat|beats|instrumental|producer|production|lofi|lo-fi)\b/i.test(lower) };
}
route('POST', '/api/mood-mix', async ({ body, user }) => {
  const mood = String(body.mood || '').trim().slice(0, 120);
  if (mood.length < 2) throw new HttpError(400, 'Tell Vesper a little about the mood you want.');
  const intent = interpretMood(mood);
  const familiar = Math.max(0, Math.min(1, Number(body.familiar ?? 0.5)));
  const energyPref = body.energy === undefined ? null : Math.max(0, Math.min(1, Number(body.energy)));
  if (energyPref !== null) intent.energy = energyPref < 0.34 ? 'low' : energyPref > 0.66 ? 'high' : 'mid';
  const used = [];
  // 1. Catalog playlists that match genre + mood in their TITLE (descriptions are too noisy).
  const moodPhrase = intent.moods.slice(0, 2).join(' ');
  const queries = [...new Set([
    [intent.melodic && intent.genre === 'hip hop' ? 'melodic rap' : intent.genre, moodPhrase].filter(Boolean).join(' '),
    intent.genre && moodPhrase ? `${moodPhrase} ${intent.genre}` : null,
    intent.genre || moodPhrase || mood,
  ].filter(Boolean))].slice(0, 3);
  const found = (await Promise.all(queries.map((q) => dz.searchPlaylists(q, 10).catch(() => [])))).flat();
  const need = [...(intent.genre ? normText(intent.genre).split(' ') : []), ...normText(moodPhrase).split(' ')].filter((w) => w.length > 1);
  const scored = [...new Map(found.map((p) => [p.id, p])).values()].map((p) => {
    const words = new Set(normText(p.title).split(' '));
    const hits = need.filter((w) => words.has(w) || [...words].some((x) => x.startsWith(w) && w.length > 3)).length;
    const genreHit = !intent.genre || normText(intent.genre).split(' ').every((w) => words.has(w) || (intent.genre === 'hip hop' && (words.has('rap') || words.has('hiphop'))) || (intent.genre === 'R&B' && (words.has('rnb') || words.has('r'))));
    return { p, score: genreHit ? hits + Math.min(0.3, Math.log10((p.trackCount || 0) + 1) / 10) : -1 };
  }).filter((x) => x.score >= Math.max(1, need.length * 0.5) && (x.p.trackCount || 0) >= 10).sort((a, b) => b.score - a.score).slice(0, 2);
  const catalog = [];
  for (const { p } of scored) { const r = await dz.playlist(p.id.slice(4)).catch(() => null); if (r) { catalog.push(...r.tracks); used.push(`Deezer playlist “${p.title}”`); } }
  // 2. The mood's sound = artists that recur in matching playlists.
  const moodArtists = new Map();
  for (const t of catalog) { const k = normText(t.artist); moodArtists.set(k, (moodArtists.get(k) || 0) + 1); }
  if (intent.likeArtist) {
    const id = await resolveDeezerByName('artist', intent.likeArtist).catch(() => null);
    if (id) { const rel = await dz.related(id.slice(3), 10).catch(() => []); moodArtists.set(normText(intent.likeArtist), 5); for (const a of rel) moodArtists.set(normText(a.name), (moodArtists.get(normText(a.name)) || 0) + 2); used.push(`artists related to ${intent.likeArtist}`); }
  }
  // 3. Personal signals (only what actually exists).
  const sig = userSignals(user);
  const followed = Object.values(user.library.artists || {}).filter((a) => a.name);
  const liked = Object.values(user.library.likes || {}).filter((t) => t?.playable !== false && t.provider !== 'test');
  const tops = topArtists(user, 120, 10);
  const recentIds = new Set(user.history.slice(-60).map((e) => e.track.id));
  const seenIds = new Set((Array.isArray(body.seen) ? body.seen : []).slice(0, 500).map(String));
  const coherent = (artist) => !moodArtists.size || moodArtists.has(normText(artist));
  const personalArtists = [...followed.map((a) => ({ name: a.name, id: a.id })), ...tops.map((a) => ({ name: a.name, id: a.track?.artistId }))].filter((a, i, arr) => arr.findIndex((b) => normText(b.name) === normText(a.name)) === i);
  const onMoodPersonal = personalArtists.filter((a) => coherent(a.name)).slice(0, 5);
  const familiarPool = [];
  for (const t of liked) if (coherent(t.artist)) familiarPool.push({ ...t, _src: 'liked' });
  for (const a of onMoodPersonal) { if (!a.id?.startsWith('dz:')) continue; for (const t of await dz.artistTop(a.id.slice(3), 6).catch(() => [])) familiarPool.push({ ...t, _src: 'artist', _artistName: a.name }); }
  if (familiarPool.length) used.push(`${new Set(familiarPool.map((t) => normText(t.artist))).size} of your artists that fit this mood`);
  // 4. Discoveries: catalog tracks + related-artist recommendations seeded by on-mood favourites.
  let recTracks = [];
  const seeds = [...familiarPool.slice(0, 2), ...catalog.slice(0, 2)].filter(Boolean);
  if (seeds.length) recTracks = (await recommend({ seeds, mode: intent.energy === 'low' ? 'calmer' : intent.energy === 'high' ? 'upbeat' : 'same', user, limit: 30, exclude: seeds.map((t) => t.id), allowExplicit: user.settings.explicit }).catch(() => ({ tracks: [] }))).tracks;
  // 5. Score, filter, dedupe.
  const cands = new Map();
  const add = (t, base, kind) => {
    if (!t?.id || t.playable === false || t.provider === 'test' || (!user.settings.explicit && t.explicit)) return;
    if (!intent.allowBeats && JUNK_RE.test(`${t.title} ${t.artist} ${t.album || ''}`)) return;
    if (sig.avoid.has(normText(t.artist)) || sig.less.has(t.id) || (sig.skips.get(t.id) || 0) >= 2) return;
    const a = normText(t.artist);
    let s = base + (moodArtists.get(a) ? Math.min(1, 0.35 + 0.15 * moodArtists.get(a)) : 0);
    if (sig.likedArtists.has(a)) s += 0.35 * (0.5 + familiar);
    if (followed.some((f) => normText(f.name) === a)) s += 0.3 * (0.5 + familiar);
    if (kind === 'discovery' && !sig.knownArtists.has(a)) s += 0.4 * (1.5 - familiar);
    if (kind === 'familiar') s += 0.5 * familiar;
    if (recentIds.has(t.id)) s -= body.refresh ? 2 : 0.4;
    if (seenIds.has(t.id)) s -= 2.25; // across refreshes, strongly prefer tracks not shown in earlier mixes
    if (!coherent(t.artist) && kind !== 'catalog') s -= 0.8;
    const key = `${normText(t.title).replace(/ (feat|ft|with) .*/, '')}|${a}`;
    const prev = cands.get(key);
    if (!prev || prev.s < s) cands.set(key, { t, s, kind });
  };
  for (const t of catalog) add(t, 1.0, 'catalog');
  for (const t of familiarPool) add(t, 0.9, 'familiar');
  for (const t of recTracks) add(t, 0.7, 'discovery');
  let ranked = [...cands.values()].sort((a, b) => b.s - a.s);
  if (body.refresh) { for (const c of ranked) c.s += Math.random() * 0.5; ranked.sort((a, b) => b.s - a.s); } // refresh: reshuffle near-equal picks
  // 6. Sequence: max 2 per artist, no back-to-back artist, familiar/discovery interleaved by preference.
  const per = new Map(), fam = [], disc = [];
  for (const c of ranked) { const a = normText(c.t.artist); if ((per.get(a) || 0) >= 2) continue; per.set(a, (per.get(a) || 0) + 1); (c.kind === 'familiar' || sig.knownArtists.has(a) ? fam : disc).push(c); }
  const out = []; const want = 28; const famShare = 0.2 + familiar * 0.6;
  while (out.length < want && (fam.length || disc.length)) {
    const takeFam = fam.length && (!disc.length || out.filter((c) => c.kind === 'familiar' || sig.knownArtists.has(normText(c.t.artist))).length / Math.max(1, out.length) < famShare);
    const pool = takeFam ? fam : disc;
    const i = pool.findIndex((c) => !out.length || normText(c.t.artist) !== normText(out[out.length - 1].t.artist));
    out.push(pool.splice(i < 0 ? 0 : i, 1)[0]);
  }
  if (!out.length) throw new HttpError(404, `I couldn’t find music that clearly fits “${mood}”. Try naming a genre (R&B, melodic rap, indie, pop…) or an artist, like “late-night melodic rap like Drake”.`);
  const reasonFor = (c) => c.kind === 'familiar' ? (c.t._src === 'liked' ? 'A song you liked that fits this mood' : `From ${c.t._artistName || c.t.artist}, an artist you follow or play`) : c.kind === 'catalog' ? 'From a playlist matching this mood' : (c.t.reason || 'Related to artists that fit this mood');
  const tracks = out.map((c) => { const { _src, _artistName, ...t } = c.t; return { ...t, reason: reasonFor(c) }; });
  const tiles = [...new Set(tracks.map((t) => t.albumArtwork || t.artwork || t.artworkSmall).filter(validArt))].slice(0, 4);
  const famCount = out.filter((c) => c.kind === 'familiar').length;
  return { mood, intent: { genre: intent.genre, moods: intent.moods, energy: intent.energy }, title: `Mood mix: ${mood}`, tracks, artworkTiles: tiles,
    note: `${tracks.length} songs${tracks.length < 15 ? ' (only songs that clearly fit — a shorter mix instead of filler)' : ''}. ${famCount} familiar, ${tracks.length - famCount} discoveries. Built from ${used.length ? used.join(', ') : 'related-artist data'}. Type-beat, instrumental and re-upload versions are filtered out${intent.allowBeats ? ' (except beats, since you asked)' : ''}.` };
}, { auth: true });
route('POST', '/api/recs', async ({ body, user }) => {
  const seeds = (Array.isArray(body.seeds) ? body.seeds : []).map(slimTrack).filter(Boolean).filter((t) => t.provider !== 'test');
  if (!seeds.length) return { tracks: [], note: 'Recommendations need a real song or artist to start from. Test signals have no related music.' };
  return recommend({ seeds, mode: String(body.mode || 'same'), user, limit: Math.min(50, Number(body.limit) || 30), exclude: Array.isArray(body.exclude) ? body.exclude.slice(0, 500) : [], seen: Array.isArray(body.seen) ? body.seen.slice(0, 500) : [], allowExplicit: user ? user.settings.explicit : true, sessionSkips: Array.isArray(body.sessionSkips) ? body.sessionSkips.slice(0, 30).map(String) : [], sessionLikes: Array.isArray(body.sessionLikes) ? body.sessionLikes.slice(0, 30).map(String) : [] });
}, { auth: true });

const SESSIONS = [
  { slug: 'late-night', title: 'Late Night Listening', mood: 'Slow and hushed, for after midnight', query: 'late night chill' },
  { slug: 'sunday-morning', title: 'Sunday Morning', mood: 'Warm acoustic songs for a slow start', query: 'sunday morning acoustic' },
  { slug: 'indie-discovery', title: 'Indie Discovery', mood: 'Newer indie worth knowing', query: 'indie discovery' },
  { slug: 'deep-focus', title: 'Deep Focus', mood: 'Instrumental music that stays out of the way', query: 'deep focus instrumental' },
  { slug: 'nostalgia', title: 'Nostalgia', mood: 'Songs from the 2000s', query: '2000s nostalgia' },
  { slug: 'emotional-reset', title: 'Emotional Reset', mood: 'Sad songs for when you need them', query: 'sad songs' },
  { slug: 'dreamy-indie', title: 'Dreamy Indie', mood: 'Hazy bedroom pop and dream pop', query: 'bedroom pop dreamy' },
  { slug: 'new-music-friday', title: 'New Music Friday', mood: 'This week’s new releases', query: 'new music friday' },
  { slug: 'quiet-moments', title: 'Quiet Moments', mood: 'Soft piano and ambient', query: 'peaceful piano' },
  { slug: 'main-character', title: 'Main Character Energy', mood: 'Big, cinematic, confident', query: 'main character' },
  { slug: 'after-hours', title: 'After Hours', mood: 'Late-night R&B', query: 'after hours rnb' },
  { slug: 'fresh-finds', title: 'Fresh Finds', mood: 'Emerging artists', query: 'fresh finds' },
  { slug: 'sad-indie', title: 'Sad Indie', mood: 'Melancholy indie', query: 'sad indie', mix: true },
  { slug: 'happy', title: 'Happy Mix', mood: 'Bright and upbeat', query: 'happy hits', mix: true },
  { slug: 'chill', title: 'Chill', mood: 'Easygoing', query: 'chill hits', mix: true },
  { slug: 'focus', title: 'Focus', mood: 'Steady and calm', query: 'focus music', mix: true },
  { slug: 'workout', title: 'Workout', mood: 'High tempo', query: 'workout hits', mix: true },
  { slug: 'late-night-mix', title: 'Late Night Mix', mood: 'Night drive', query: 'night drive', mix: true },
];
const sessionsArtCache = new TTLCache(40);
route('GET', '/api/sessions', async () => {
  const sessions = await Promise.all(SESSIONS.map(async (session) => {
    const cached = sessionsArtCache.get(session.slug);
    if (cached) return { ...session, ...cached };
    const playlists = await dz.searchPlaylists(session.query, 6).catch(() => []);
    const pick = playlists.filter((p) => (p.trackCount || 0) >= 8).sort((a, b) => (b.trackCount || 0) - (a.trackCount || 0))[0] || playlists[0];
    const art = pick?.artwork || pick?.artworkSmall || null;
    const result = art ? { artwork: art, artworkSmall: pick.artworkSmall || art } : {};
    sessionsArtCache.set(session.slug, result, 6 * 60 * 60_000);
    return { ...session, ...result };
  }));
  return { sessions };
});
route('GET', '/api/sessions/:slug', async ({ params, user }) => {
  const s = SESSIONS.find((x) => x.slug === params.slug);
  if (!s) throw new HttpError(404, 'Unknown session');
  const pls = await dz.searchPlaylists(s.query, 10);
  const pick = pls.slice(0, 6).filter((p) => (p.trackCount || 0) >= 15).sort((a, b) => (b.trackCount || 0) - (a.trackCount || 0))[0] || pls[0];
  if (!pick) throw new HttpError(404, 'Deezer returned no playlist for this session.');
  const { playlist, tracks } = await dz.playlist(pick.id.slice(4));
  let list = tracks.filter((t) => t.playable);
  if (user) {
    const avoid = new Set(Object.values(user.feedback.avoidArtists).map((a) => normText(a.name)));
    list = list.filter((t) => !avoid.has(normText(t.artist)) && !user.feedback.less[t.id] && (user.settings.explicit || !t.explicit));
  }
  return { session: s, source: { title: playlist.title, creator: playlist.creator, link: playlist.link }, artwork: playlist.artwork, tracks: list.slice(0, 60) };
});

route('GET', '/api/home', async ({ user }) => {
  const sec = async (fn) => { try { return { items: await fn() }; } catch (e) { return { items: [], error: e.message }; } };
  const recentMap = new Map();
  for (let i = user.history.length - 1; i >= 0 && recentMap.size < 14; i--) { const t = user.history[i].track; if (!recentMap.has(t.id)) recentMap.set(t.id, t); }
  const tops = topArtists(user, 90, 8);
  const [trending, newReleases, favoriteArtists] = await Promise.all([
    sec(() => dz.chart(0, 'tracks', 12)),
    sec(() => dz.newReleases(14)),
    sec(async () => {
      const followed = Object.values(user.library.artists || {}).filter((a) => a.id?.startsWith('dz:'));
      const fromHistory = (await mapLimit(tops, 3, async (a) => { const id = await resolveDeezerByName('artist', a.name); const r = await dz.searchArtists(a.name, 3); return r.find((x) => x.id === id) || r[0]; })).filter(Boolean);
      const all = [...followed, ...fromHistory]; const seen = new Set();
      return all.filter((a) => { const key = a.id || normText(a.name); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 20);
    }),
  ]);
  const mixes = [];
  const mixSeeds = dailyMixSeeds(user, 28, 4);
  const usedArt = new Set();
  const dailyMixes = await Promise.all(mixSeeds.map(async (a, i) => {
    const artistHistory = user.history.filter((e) => normText(e.track.artist) === normText(a.name)).map((e) => e.track).reverse();
    let relatedTracks = artistHistory;
    if (relatedTracks.length < 4 && a.artistId?.startsWith('dz:')) relatedTracks = [...relatedTracks, ...(await dz.artistTop(a.artistId.slice(3), 8).catch(() => []))];
    const arts = [...new Set(relatedTracks.map((t) => t.albumArtwork || t.artwork || t.artworkSmall).filter(validArt))];
    const artworkTiles = [...arts.filter((x) => !usedArt.has(x)), ...arts.filter((x) => usedArt.has(x))].slice(0, 4); // prefer covers no other mix uses
    artworkTiles.forEach((x) => usedArt.add(x));
    return { kind: `daily-${i}`, title: `Daily Mix ${i + 1}`, subtitle: `${a.name} and similar`, artwork: null, artworkTiles };
  }));
  mixes.push(...dailyMixes);
  if (tops.length) mixes.push({ kind: 'discover', title: 'Discover', subtitle: 'Artists you haven’t played yet', artwork: tops[1]?.track.artwork || tops[0].track.artwork });
  if (tops.length) mixes.push({ kind: 'hidden', title: 'Hidden Gems', subtitle: 'Less-played songs near your taste', artwork: tops[2]?.track.artwork || tops[0].track.artwork });
  if (Object.keys(user.library.artists).length || tops.length) mixes.push({ kind: 'new-for-you', title: 'New Music for You', subtitle: 'Recent releases from artists you follow or play' });
  if (user.history.length >= 10) mixes.push({ kind: 'most-replayed', title: 'Your Most Replayed', subtitle: 'The songs you keep coming back to' });
  if (user.history.length >= 10) mixes.push({ kind: 'recently-discovered', title: 'Recently Discovered', subtitle: 'Artists you first played in the last 30 days' });
  return { name: user.displayName, recent: [...recentMap.values()], mixes, trending, newReleases, favoriteArtists, sessions: await Promise.all(SESSIONS.filter((s) => !s.mix).slice(0, 8).map(async (session) => {
    const cached = sessionsArtCache.get(session.slug);
    if (cached) return { ...session, ...cached };
    const playlists = await dz.searchPlaylists(session.query, 6).catch(() => []);
    const pick = playlists.filter((pl) => (pl.trackCount || 0) >= 8).sort((a, b) => (b.trackCount || 0) - (a.trackCount || 0))[0] || playlists[0];
    const art = pick?.artwork || pick?.artworkSmall || null;
    const result = art ? { artwork: art, artworkSmall: pick.artworkSmall || art } : {};
    sessionsArtCache.set(session.slug, result, 6 * 60 * 60_000);
    return { ...session, ...result };
  })), hasHistory: user.history.some((e) => e.track.provider !== 'test') };
}, { auth: true });

const mixCache = new TTLCache(200);
route('GET', '/api/mix/:kind', async ({ params, user, query }) => {
  const k = params.kind, key = `${user.id}|${k}|${todayKey()}|${user.history.length >> 4}`;
  const firstOnly = query.first === '1';
  const cached = mixCache.get(key);
  if (cached) return firstOnly ? { ...cached, tracks: (cached.tracks || []).slice(0, 1) } : cached;
  let out;
  if (k.startsWith('daily-')) out = await dailyMix(user, Number(k.split('-')[1]));
  else if (k === 'discover' || k === 'hidden') {
    const tops = topArtists(user, 60, 3);
    if (!tops.length) throw new HttpError(404, 'Play a few songs first so there is something to build this mix from.');
    const r = await recommend({ seeds: tops.map((a) => a.track), mode: k === 'discover' ? 'explore' : 'hidden', user, limit: 30, allowExplicit: user.settings.explicit });
    out = { title: k === 'discover' ? 'Discover' : 'Hidden Gems', description: k === 'discover' ? `Artists you haven’t played, related to ${tops.map((a) => a.name).join(', ')}.` : 'Less widely played songs from around your favourite artists.', tracks: r.tracks };
  } else if (k === 'new-for-you') {
    const followed = Object.values(user.library.artists).filter((a) => a.id.startsWith('dz:')).map((a) => a.id.slice(3));
    const played = await mapLimit(topArtists(user, 60, 6), 3, (a) => resolveDeezerByName('artist', a.name).then((id) => id.slice(3)));
    const ids = [...new Set([...followed, ...played.filter(Boolean)])].slice(0, 14);
    const since = Date.now() - 120 * 86400_000;
    const albums = (await mapLimit(ids, 3, (id) => dz.artistAlbums(id))).flat().filter((a) => a && Date.parse(a.releaseDate) >= since).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)).slice(0, 12);
    const tracks = (await mapLimit(albums, 3, async (a) => (await dz.album(a.id.slice(3))).tracks.slice(0, 2))).flat().filter(Boolean).map((t) => ({ ...t, reason: `New ${t.releaseDate ? `(${t.releaseDate})` : ''}` }));
    out = { title: 'New Music for You', description: 'Releases from the last 120 days by artists you follow or play often.', tracks };
  } else if (k === 'most-replayed') {
    const c = new Map(); for (const e of user.history) { if (e.skipped) continue; const x = c.get(e.track.id) || { t: e.track, n: 0 }; x.n++; c.set(e.track.id, x); }
    out = { title: 'Your Most Replayed', description: 'Songs you’ve finished most often on Vesper.', tracks: [...c.values()].filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 40).map((x) => ({ ...x.t, reason: `${x.n} plays` })) };
  } else if (k === 'recently-discovered') {
    const first = new Map(); for (const e of user.history) { const a = normText(e.track.artist); if (!first.has(a)) first.set(a, { at: e.at, tracks: new Map() }); first.get(a).tracks.set(e.track.id, e.track); }
    const since = Date.now() - 30 * 86400_000;
    out = { title: 'Recently Discovered', description: 'Artists you played for the first time in the last 30 days.', tracks: [...first.values()].filter((x) => Date.parse(x.at) >= since).flatMap((x) => [...x.tracks.values()].slice(0, 3)) };
  } else throw new HttpError(404, 'Unknown mix');
  if (!out) throw new HttpError(404, 'Not enough listening history for this mix yet.');
  mixCache.set(key, out, 30 * 60_000);
  return firstOnly ? { ...out, tracks: (out.tracks || []).slice(0, 1) } : out;
}, { auth: true });

route('GET', '/api/following', async ({ user }) => {
  const artists = Object.values(user.library.artists);
  const since = Date.now() - 180 * 86400_000;
  const albums = (await mapLimit(artists.filter((a) => a.id.startsWith('dz:')).slice(0, 40), 3, (a) => dz.artistAlbums(a.id.slice(3)).catch(() => []))).flat().filter((a) => a && a.releaseDate && Date.parse(a.releaseDate) >= since);
  const releases = [...new Map(albums.map((a) => [a.id, a])).values()].sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
  // Fetch only a handful of the newest releases for song rows: avoids a slow request fan-out.
  const newestReleases = releases.slice(0, 8);
  const latestTracks = (await mapLimit(newestReleases, 4, async (release) => {
    if (!release.id?.startsWith('dz:')) return [];
    const album = await dz.album(release.id.slice(3)).catch(() => null);
    return (album?.tracks || []).map((track) => ({ ...track, album: release.title, albumId: release.id, artist: track.artist || release.artist, artistId: track.artistId || release.artistId, releaseDate: release.releaseDate }));
  })).flat().sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || '') || Number(b.rank || 0) - Number(a.rank || 0)).slice(0, 30);
  return { artists, releases, latestTracks };
}, { auth: true });

// ---------- lyrics ----------
const lyricsService = createLyricsService(path.join(DATA_DIR, 'lyrics-cache.json'));
route('GET', '/api/lyrics/:id', async ({ params, query, user }) => {
  const [p, pid] = splitId(params.id);
  if (p === 'ts') return { synced: ts.lrc(pid), plain: null, source: 'Test signal placeholder lines (not real lyrics)' };
  if (p === 'lc') { const l = await local.lyrics(pid); if (l) return { synced: /\[\d+:\d+/.test(l) ? l : null, plain: /\[\d+:\d+/.test(l) ? null : l, source: 'Your .lrc file' }; }
  if (user?.settings.lyricsSource === 'off') return { unavailable: true, reason: 'Online lyrics are turned off in Settings.' };
  const title = String(query.title || ''), artist = String(query.artist || '');
  if (!title || !artist) return { unavailable: true, reason: 'Not enough track information to look up lyrics.' };
  return lyricsService.get({ title, artist, album: String(query.album || ''), duration: Number(query.duration) || 0 });
});

// ---------- find a song by its lyrics ----------
// LRCLIB full-text search over lyrics, then each hit is matched to a Deezer track so it plays
// like any other search result (and upgrades to the full song the usual way).
const lyricHitKey = (t, a) => `${normText(t)}|${normText(a)}`;
function lyricSnippet(text, q) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/^\[[^\]]*\]\s*/, '').trim()).filter(Boolean);
  const words = normText(q).split(' ').filter((w) => w.length > 1);
  let best = null, bestScore = 0;
  for (const l of lines) { const n = normText(l); const sc = words.filter((w) => n.includes(w)).length; if (sc > bestScore) { best = l; bestScore = sc; } }
  return best;
}
route('GET', '/api/lyrics-search', async ({ query, user }) => {
  const q = String(query.q || '').trim().slice(0, 200);
  if (q.length < 4) return { tracks: [], note: 'Type a few words from the song.' };
  if (user?.settings.lyricsSource === 'off') return { tracks: [], note: 'Online lyrics are turned off in Settings, so lyric search is unavailable.' };
  let hits;
  try { hits = await fetchJSON(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, { ttl: 6 * 3600_000, provider: 'LRCLIB', retries: 1 }); }
  catch (e) { throw new HttpError(502, `Lyric search is unavailable right now: ${e.message}`); }
  const seen = new Set(), picked = [];
  for (const h of Array.isArray(hits) ? hits : []) {
    if (!h?.trackName || !h?.artistName || h.instrumental) continue;
    const k = lyricHitKey(h.trackName, h.artistName); if (seen.has(k)) continue; seen.add(k);
    picked.push(h); if (picked.length >= 8) break;
  }
  const tracks = (await mapLimit(picked, 3, async (h) => {
    const found = await dz.searchTracks(`artist:"${h.artistName}" track:"${h.trackName}"`, 5).catch(() => []);
    const list = found.length ? found : await dz.searchTracks(`${h.artistName} ${h.trackName}`, 5).catch(() => []);
    const want = lyricHitKey(h.trackName, h.artistName);
    const t = list.find((x) => lyricHitKey(x.title, x.artist) === want)
      || list.find((x) => normText(x.artist) === normText(h.artistName) && normText(x.title).startsWith(normText(h.trackName)))
      || list.find((x) => normText(x.artist) === normText(h.artistName));
    if (!t) return null;
    const line = lyricSnippet(h.plainLyrics, q);
    return { ...t, reason: line ? `“${line.slice(0, 140)}”` : 'Lyrics match' };
  })).filter(Boolean);
  const unique = []; const ids = new Set();
  for (const t of tracks) if (!ids.has(t.id)) { ids.add(t.id); unique.push(t); }
  if (user && !user.settings.explicit) return { tracks: unique.filter((t) => !t.explicit) };
  return { tracks: unique, note: unique.length ? null : 'No songs matched those lyrics. Try a different line, or fewer words.' };
}, { auth: true });

// ---------- playlist import (Spotify via Exportify CSV, Apple Music export, plain lists) ----------
// The browser parses the file; this matches each row to a Deezer track (title + artist, then duration).
function importScore(t, want) {
  const tokens = (v) => new Set(normText(v).replace(/\b(feat|ft|featuring|with|remaster(ed)?|\d{4} remaster|radio edit|version)\b/g, ' ').split(' ').filter((x) => x.length > 1));
  const overlap = (a, b) => { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.max(A.size, B.size); };
  const title = overlap(want.title, t.title);
  const artist = Math.max(overlap(want.artist, t.artist), normText(want.artist).includes(normText(t.artist)) && normText(t.artist) ? 1 : 0);
  const dur = want.duration && t.duration ? Math.max(0, 1 - Math.abs(want.duration - t.duration) / 30) : 0.5;
  const album = want.album && t.album ? overlap(want.album, t.album) : 0;
  return title * 0.55 + artist * 0.3 + dur * 0.1 + album * 0.05;
}
route('POST', '/api/import/match', async ({ body }) => {
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 50).map((x) => ({
    title: String(x?.title || '').trim().slice(0, 200), artist: String(x?.artist || '').trim().slice(0, 200),
    album: String(x?.album || '').trim().slice(0, 200), duration: Number(x?.duration) || 0,
  }));
  const results = await mapLimit(items, 3, async (want) => {
    if (!want.title) return { track: null };
    const mainArtist = want.artist.split(/[;,&]| feat\.? | ft\.? /i)[0].trim();
    let list = mainArtist ? await dz.searchTracks(`artist:"${mainArtist}" track:"${want.title.replace(/"/g, '')}"`, 8).catch(() => []) : [];
    if (!list.length) list = await dz.searchTracks(`${mainArtist} ${want.title}`.trim(), 8).catch(() => []);
    const ranked = list.map((t) => ({ t, s: importScore(t, { ...want, artist: want.artist || mainArtist }) })).sort((a, b) => b.s - a.s);
    const best = ranked[0];
    return best && best.s >= 0.55 ? { track: best.t, confidence: Math.round(best.s * 100) / 100 } : { track: null };
  });
  return { results };
}, { auth: true });

// ---------- audio & images ----------
const AUDIO_HOSTS = [/(^|\.)googlevideo\.com$/, /(^|\.)dzcdn\.net$/, /(^|\.)deezer\.com$/, /(^|\.)apple\.com$/, /(^|\.)mzstatic\.com$/, /(^|\.)jamendo\.com$/];
const IMG_HOSTS = [/(^|\.)ytimg\.com$/, /(^|\.)dzcdn\.net$/, /(^|\.)deezer\.com$/, /(^|\.)mzstatic\.com$/, /(^|\.)jamendo\.com$/];
const allowed = (u, list) => { try { const x = new URL(u); return x.protocol === 'https:' && list.some((re) => re.test(x.hostname)); } catch { return false; } };
function serveBuffer(req, res, buf, type) {
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : buf.length - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
    if (start >= buf.length || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` }); return res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    return res.end(buf.subarray(start, end + 1));
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  res.end(buf);
}
async function serveFile(req, res, file, type) {
  const { size } = await fsp.stat(file);
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  let start = 0, end = size - 1, status = 200;
  if (range) { start = range[1] ? Number(range[1]) : size - Number(range[2]); end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1; status = 206; }
  if (start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  fs.createReadStream(file, { start, end }).pipe(res);
}
async function proxyAudio(req, res, url) {
  if (!allowed(url, AUDIO_HOSTS)) throw new HttpError(502, 'Provider returned an unexpected audio host.');
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const up = await fetch(url, { headers: req.headers.range ? { Range: req.headers.range } : {}, signal: ac.signal });
  if (up.status === 403 || up.status === 410) { up.body?.cancel(); return 'expired'; }
  if (!up.ok && up.status !== 206) throw new HttpError(502, `Audio source responded ${up.status}`);
  const h = { 'Content-Type': up.headers.get('content-type') || 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  for (const k of ['content-length', 'content-range']) if (up.headers.get(k)) h[k] = up.headers.get(k);
  res.writeHead(up.status, h);
  Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
  return 'ok';
}
// YouTube stream URLs carry their own expiry (`expire=`) and the real audio length (`dur=`).
// Cache each URL until shortly before it expires (usually ~6 hours) so the next song, replays and
// seeks start right away instead of waiting several seconds for yt-dlp every time.
const YT_FORMATS = {
  high: 'bestaudio[ext=m4a]/bestaudio',
  // Data saver: ~50 kbps AAC (about 22 MB per hour instead of ~60 MB).
  low: 'worstaudio[ext=m4a][abr>=40]/bestaudio[ext=m4a][abr<=72]/worstaudio[ext=m4a]/bestaudio[ext=m4a]/bestaudio',
};
function ytUrlFacts(u) {
  try {
    const x = new URL(u);
    const expire = Number(x.searchParams.get('expire')) * 1000 || 0;
    const dur = Number(x.searchParams.get('dur')) || null;
    return { expire, dur };
  } catch { return { expire: 0, dur: null }; }
}
async function resolveYtAudio(id, quality = 'high') {
  const q = quality === 'low' ? 'low' : 'high', key = `${id}|${q}`;
  const cached = ytUrlCache.get(key);
  if (cached && cached.expires > Date.now() + 5_000) return cached;
  if (ytResolveInflight.has(key)) return ytResolveInflight.get(key);
  const task = (async () => {
    const { stdout } = await runYtDlp(['--get-url', '--no-warnings', '--no-playlist', '--format', YT_FORMATS[q], `https://www.youtube.com/watch?v=${id}`], 45_000);
    const mediaUrl = stdout.trim().split(/\r?\n/).find((line) => /^https:\/\//.test(line));
    if (!mediaUrl || !allowed(mediaUrl, AUDIO_HOSTS)) throw new HttpError(502, 'YouTube stream could not be prepared. Update yt-dlp with: brew upgrade yt-dlp');
    const { expire, dur } = ytUrlFacts(mediaUrl);
    // Stay 20 minutes clear of the real expiry; never trust it for more than 5 hours.
    const expires = expire ? Math.min(expire - 20 * 60_000, Date.now() + 5 * 3600_000) : Date.now() + 30 * 60_000;
    const entry = { url: mediaUrl, duration: dur, expires: Math.max(expires, Date.now() + 60_000) };
    ytUrlCache.set(key, entry);
    if (ytUrlCache.size > 400) ytUrlCache.delete(ytUrlCache.keys().next().value);
    return entry;
  })().finally(() => ytResolveInflight.delete(key));
  ytResolveInflight.set(key, task); return task;
}
async function streamAudio(req, res, id, quality = 'high') {
  const [p, pid] = splitId(id);
  if (p === 'yt') {
    const videoId = cleanYtId(pid); if (!videoId) throw new HttpError(400, 'Invalid YouTube video ID.');
    const q = quality === 'low' ? 'low' : 'high';
    let result = await proxyAudio(req, res, (await resolveYtAudio(videoId, q)).url);
    if (result === 'expired') { ytUrlCache.delete(`${videoId}|${q}`); result = await proxyAudio(req, res, (await resolveYtAudio(videoId, q)).url); }
    if (result === 'expired') throw new HttpError(502, 'YouTube stream expired. Press play again to refresh it.');
    return;
  }
  if (p === 'yl') throw new HttpError(404, 'Downloaded YouTube audio is not available in this version.');
  if (p === 'ts') { const b = ts.wav(pid); if (!b) throw new HttpError(404, 'Unknown test track'); return serveBuffer(req, res, b, 'audio/wav'); }
  if (p === 'lc') { const e = local.get(pid); if (!e) throw new HttpError(404, 'File no longer in your music folder. Rescan in Settings.'); return serveFile(req, res, e.file, local.MIME[path.extname(e.file).toLowerCase()] || 'application/octet-stream'); }
  if (p === 'rb') {
    const stationUrl = radioStationUrls.get(pid);
    if (!stationUrl) throw new HttpError(404, 'This radio station expired from the directory cache. Refresh Radio and try again.');
    const safeRadioUrl = (value) => {
      let u; try { u = new URL(value); } catch { return null; }
      const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (!['https:', 'http:'].includes(u.protocol) || !host || u.username || u.password || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost') || /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\.|^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) || host === '::1' || host === '0:0:0:0:0:0:0:1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return null;
      return u;
    };
    let target = safeRadioUrl(stationUrl);
    if (!target) throw new HttpError(502, 'This station has an unsafe stream address.');
    const ac = new AbortController(); res.on('close', () => ac.abort());
    let up;
    for (let hop = 0; hop < 5; hop++) {
      up = await fetch(target, { headers: req.headers.range ? { Range: req.headers.range } : {}, signal: ac.signal, redirect: 'manual' });
      if (up.status >= 300 && up.status < 400 && up.headers.get('location')) {
        const next = safeRadioUrl(new URL(up.headers.get('location'), target).href);
        up.body?.cancel(); if (!next) throw new HttpError(502, 'Radio station redirected to an unsafe address.'); target = next; continue;
      }
      break;
    }
    if (!up || up.status >= 300 && up.status < 400) throw new HttpError(502, 'Too many redirects from this radio station.');
    if (!up.ok && up.status !== 206) throw new HttpError(502, `Radio stream responded ${up.status}`);
    const h = { 'Content-Type': up.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
    for (const k of ['content-length', 'content-range']) if (up.headers.get(k)) h[k] = up.headers.get(k);
    res.writeHead(up.status, h); if (!up.body) return res.end();
    Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res); return;
  }
  const resolve = { dz: (f) => dz.audioUrl(pid, { fresh: f }), it: () => it.audioUrl(pid), jm: () => jm.audioUrl(pid) }[p];
  if (!resolve) throw new HttpError(404, 'Unknown audio source');
  // Preview URLs are signed and can expire; refetch once with a fresh URL.
  if ((await proxyAudio(req, res, await resolve(false))) === 'expired') {
    if ((await proxyAudio(req, res, await resolve(true))) === 'expired') throw new HttpError(502, 'The provider refused the audio request (link expired or region-blocked).');
  }
}
const imgCache = new TTLCache(300);
async function proxyImage(res, url) {
  if (!allowed(url, IMG_HOSTS)) throw new HttpError(400, 'Image host not allowed');
  let hit = imgCache.get(url);
  if (!hit) {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new HttpError(502, 'Image unavailable');
    hit = { type: r.headers.get('content-type') || 'image/jpeg', buf: Buffer.from(await r.arrayBuffer()) };
    if (hit.buf.length < 3_000_000) imgCache.set(url, hit, 6 * 3600_000);
  }
  res.writeHead(200, { 'Content-Type': hit.type, 'Content-Length': hit.buf.length, 'Cache-Control': 'public, max-age=86400' });
  res.end(hit.buf);
}

// ---------- library ----------
route('GET', '/api/me/library', ({ user }) => ({
  likes: Object.values(user.library.likes).sort((a, b) => (b.likedAt || '').localeCompare(a.likedAt || '')),
  albums: Object.values(user.library.albums), artists: Object.values(user.library.artists),
  sessions: Object.values(user.library.sessions), playlists: db.playlistsOf(user.id).map(({ tracks, ...p }) => ({ ...p, trackCount: tracks.length, artwork: p.artwork || null, artworkTiles: tracks.slice(0, 4).map((t) => t.albumArtwork || t.artworkSmall || t.artwork).filter(Boolean) })),
  local: local.all(),
}), { auth: true });
const libKinds = { likes: (b) => { const t = slimTrack(b.track); if (!t) throw new HttpError(400, 'Invalid track'); return { ...t, likedAt: new Date().toISOString() }; },
  albums: (b) => ({ id: String(b.album?.id), title: String(b.album?.title || ''), artist: String(b.album?.artist || ''), artistId: b.album?.artistId || null, artwork: b.album?.artwork || null, artworkSmall: b.album?.artworkSmall || null, releaseDate: b.album?.releaseDate || null, savedAt: new Date().toISOString() }),
  artists: (b) => ({ id: String(b.artist?.id), name: String(b.artist?.name || ''), artwork: b.artist?.artwork || null, artworkSmall: b.artist?.artworkSmall || null, followedAt: new Date().toISOString() }),
  sessions: (b) => ({ id: String(b.session?.slug), slug: String(b.session?.slug), title: String(b.session?.title || ''), mood: String(b.session?.mood || ''), artwork: b.session?.artwork || null, savedAt: new Date().toISOString() }) };
route('PUT', '/api/me/:kind/:id', ({ user, params, body }) => {
  const make = libKinds[params.kind]; if (!make) return null;
  const item = make(body); if (item.id !== decodeURIComponent(params.id)) throw new HttpError(400, 'Id mismatch');
  user.library[params.kind][item.id] = item; db.save(); return { ok: true, item };
}, { auth: true });
route('DELETE', '/api/me/:kind/:id', ({ user, params }) => {
  if (!libKinds[params.kind]) return null; // let later routes (e.g. playlists) handle it
  delete user.library[params.kind][decodeURIComponent(params.id)]; db.save(); return { ok: true };
}, { auth: true });

// ---------- playlists ----------
const fullPlaylist = (p, uid) => ({ ...p, isOwner: p.owner === uid, ownerName: db.user(p.owner)?.displayName || 'Someone', customArtwork: p.artwork || null, artwork: p.artwork || p.tracks[0]?.albumArtwork || p.tracks[0]?.artworkSmall || p.tracks[0]?.artwork || null, artworkTiles: p.tracks.slice(0, 4).map((t) => t.albumArtwork || t.artworkSmall || t.artwork).filter(Boolean) });
route('GET', '/api/playlists/:id', ({ user, params }) => { const p = db.playlistFor(params.id, user.id); if (!p) throw new HttpError(404, 'Playlist not found, or it’s private.'); return { playlist: fullPlaylist(p, user.id) }; }, { auth: true });
// Recommended songs for a playlist, built from what's in it (like Spotify's "Recommended" under a playlist).
route('GET', '/api/playlists/:id/recs', async ({ user, params, query }) => {
  const p = db.playlistFor(params.id, user.id); if (!p) throw new HttpError(404, 'Playlist not found, or it’s private.');
  const tracks = p.tracks.filter((t) => t.provider !== 'test' && t.artist);
  if (!tracks.length) return { tracks: [], note: 'Add a few songs and recommendations will appear here.' };
  // Favour recently added songs, mixed with a random spread of the rest; one seed per artist.
  const recent = tracks.slice(-4).reverse(), rest = tracks.slice(0, -4).sort(() => Math.random() - 0.5);
  const seeds = [], artists = new Set();
  for (const t of [...recent, ...rest]) { const a = normText(t.artist); if (artists.has(a)) continue; artists.add(a); seeds.push(t); if (seeds.length >= 5) break; }
  const excludeKeys = tracks.map((t) => `${normText(t.title)}|${normText(t.artist)}`);
  const exclude = [...tracks.map((t) => t.sourceId || t.id), ...(String(query.skip || '').split(',').filter(Boolean).slice(0, 200))];
  const r = await recommend({ seeds, mode: 'same', user, limit: 20, exclude, excludeKeys, allowExplicit: user.settings.explicit, artistLimit: 4 });
  return { tracks: r.tracks, basedOn: seeds.slice(0, 3).map((t) => t.artist) };
}, { auth: true });
route('POST', '/api/me/playlists', ({ user, body }) => ({ playlist: fullPlaylist(db.createPlaylist(user.id, { name: String(body.name || ''), description: String(body.description || ''), privacy: body.privacy, tracks: Array.isArray(body.tracks) ? body.tracks.slice(0, 2000) : [] }), user.id) }), { auth: true });
route('PATCH', '/api/me/playlists/:id', ({ user, params, body }) => {
  const p = db.ownedPlaylist(params.id, user.id); if (!p) throw new HttpError(404, 'Playlist not found');
  if (typeof body.name === 'string' && body.name.trim()) p.name = body.name.trim().slice(0, 100);
  if (typeof body.description === 'string') p.description = body.description.slice(0, 500);
  if (['public', 'private'].includes(body.privacy)) p.privacy = body.privacy;
  if (body.artwork === null || (typeof body.artwork === 'string' && body.artwork.startsWith('data:image/') && body.artwork.length < 600_000)) p.artwork = body.artwork;
  if (Array.isArray(body.order)) { // reorder/remove by index list
    const next = body.order.map((i) => p.tracks[i]).filter(Boolean);
    if (next.length !== body.order.length) throw new HttpError(400, 'Invalid order');
    p.tracks = next;
  }
  p.updatedAt = new Date().toISOString(); db.save();
  return { playlist: fullPlaylist(p, user.id) };
}, { auth: true });
route('DELETE', '/api/me/playlists/:id', ({ user, params }) => { const p = db.ownedPlaylist(params.id, user.id); if (!p) throw new HttpError(404, 'Playlist not found'); delete db.data.playlists[p.id]; db.save(); return { ok: true }; }, { auth: true });
route('POST', '/api/me/playlists/:id/tracks', ({ user, params, body }) => {
  const p = db.ownedPlaylist(params.id, user.id); if (!p) throw new HttpError(404, 'Playlist not found');
  const add = (Array.isArray(body.tracks) ? body.tracks : []).map(slimTrack).filter(Boolean);
  if (p.tracks.length + add.length > 5000) throw new HttpError(400, 'Playlists hold up to 5,000 songs.');
  p.tracks.push(...add); p.updatedAt = new Date().toISOString(); db.save();
  return { playlist: fullPlaylist(p, user.id), added: add.length };
}, { auth: true });
route('POST', '/api/me/playlists/:id/duplicate', ({ user, params }) => {
  const p = db.playlistFor(params.id, user.id); if (!p) throw new HttpError(404, 'Playlist not found');
  return { playlist: fullPlaylist(db.createPlaylist(user.id, { name: `${p.name} (copy)`, description: p.description, tracks: p.tracks }), user.id) };
}, { auth: true });

// ---------- history, stats, feedback ----------
route('POST', '/api/me/events', ({ user, body }) => {
  if (!user.settings.recordHistory) return { recorded: false };
  const t = slimTrack(body.track); if (!t) throw new HttpError(400, 'Invalid track');
  const ms = Math.max(0, Math.min(Number(body.ms) || 0, 6 * 3600_000));
  if (ms < 1000) return { recorded: false };
  db.addEvent(user, { at: new Date().toISOString(), track: t, ms, completed: !!body.completed, skipped: !!body.skipped });
  return { recorded: true };
}, { auth: true });
route('GET', '/api/me/stats', ({ user, query }) => computeStats(user.history, ['7d', '30d', 'month', 'year', 'all'].includes(query.range) ? query.range : '30d'), { auth: true });
// ---------- Vesper Replay ----------
function replayYears(user) {
  const now = new Date(), cy = now.getUTCFullYear();
  const years = [...new Set(user.history.filter((e) => e.track.provider !== 'test').map((e) => Number(e.at.slice(0, 4))))];
  const saved = db.data.replays[user.id] || {};
  for (const y of Object.keys(saved)) if (!years.includes(Number(y))) years.push(Number(y));
  return years.sort((a, b) => b - a).map((y) => ({ year: y, status: y < cy ? 'final' : 'in-progress', saved: !!saved[y] }));
}
route('GET', '/api/me/replay', ({ user }) => {
  // Completed years are prepared automatically and kept, even if history is later cleared.
  const cy = new Date().getUTCFullYear(), store = (db.data.replays[user.id] ||= {});
  for (const y of replayYears(user)) if (y.year < cy && !store[y.year]) { store[y.year] = computeReplay(user.history, ...yearRange(y.year), { label: String(y.year) }); db.save(); }
  return { years: replayYears(user) };
}, { auth: true });
route('GET', '/api/me/replay/year/:year', ({ user, params, query }) => {
  const y = Number(params.year), cy = new Date().getUTCFullYear();
  if (!Number.isInteger(y) || y < 2000 || y > cy) throw new HttpError(400, 'Invalid year');
  const store = (db.data.replays[user.id] ||= {});
  if (y < cy) {
    if (!store[y] || query.recalculate === '1') { store[y] = computeReplay(user.history, ...yearRange(y), { label: String(y) }); db.save(); }
    return { replay: store[y], final: true };
  }
  return { replay: computeReplay(user.history, Date.UTC(y, 0, 1), Date.now() + 1, { label: `${y} so far` }), final: false };
}, { auth: true });
route('GET', '/api/me/replay/custom', ({ user, query }) => {
  const from = Date.parse(String(query.from || '')), to = Date.parse(String(query.to || ''));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new HttpError(400, 'Choose a start date before the end date.');
  return { replay: computeReplay(user.history, from, to + 86400_000, { label: 'Custom recap' }), final: false };
}, { auth: true });
route('DELETE', '/api/me/replay/year/:year', ({ user, params }) => { delete (db.data.replays[user.id] || {})[params.year]; db.save(); return { ok: true }; }, { auth: true });
route('GET', '/api/me/export', ({ user, res }) => {
  const { passHash, salt, ...u } = user;
  res.setHeader('Content-Disposition', `attachment; filename="vesper-export-${new Date().toISOString().slice(0, 10)}.json"`);
  return { exportedAt: new Date().toISOString(), profile: u, playlists: db.playlistsOf(user.id), replays: db.data.replays[user.id] || {} };
}, { auth: true });
route('GET', '/api/me/recent', ({ user }) => ({ events: user.history.slice(-100).reverse() }), { auth: true });
route('DELETE', '/api/me/history', ({ user }) => { user.history = []; db.save(); return { ok: true }; }, { auth: true });
route('POST', '/api/me/feedback', ({ user, body }) => {
  const f = user.feedback;
  if (body.type === 'avoid-artist' && body.artist) f.avoidArtists[normText(body.artist)] = { name: String(body.artist).slice(0, 200) };
  else if (body.type === 'less' || body.type === 'more') { const t = slimTrack(body.track); if (!t) throw new HttpError(400, 'Invalid track'); f[body.type][t.id] = t; delete f[body.type === 'less' ? 'more' : 'less'][t.id]; }
  else throw new HttpError(400, 'Unknown feedback type');
  db.save(); return { feedback: f };
}, { auth: true });
route('GET', '/api/me/feedback', ({ user }) => ({ feedback: user.feedback }), { auth: true });
route('DELETE', '/api/me/feedback/:type/:key', ({ user, params }) => {
  const map = { 'avoid-artist': 'avoidArtists', less: 'less', more: 'more' }[params.type];
  if (!map) throw new HttpError(400, 'Unknown feedback type');
  delete user.feedback[map][decodeURIComponent(params.key)]; db.save(); return { feedback: user.feedback };
}, { auth: true });
route('POST', '/api/local/rescan', async () => ({ status: await local.scan() }), { auth: true });

// ---------- static ----------

// ---------- Shared artwork service ----------
// One backend source of truth for artist portraits and collection covers. Results are cached on
// disk (survive restarts), simultaneous requests for the same key share one lookup, and URLs are
// validated. Artist portraits only come from an exact artist match — never from album covers.
const ART_FILE = process.env.ART_FILE || path.join(DATA_DIR, 'artwork-cache.json');
const artStore = (() => { try { return JSON.parse(fs.readFileSync(ART_FILE, 'utf8')); } catch { return { artists: {} }; } })();
let artSaveT = null;
const saveArt = () => { clearTimeout(artSaveT); artSaveT = setTimeout(() => { try { fs.mkdirSync(path.dirname(ART_FILE), { recursive: true }); fs.writeFileSync(ART_FILE, JSON.stringify(artStore)); } catch { /* cache is best-effort */ } }, 1500); };
const artInflight = new Map();
function validArt(u) { if (!u || typeof u !== 'string') return false; if (u.startsWith('data:image/')) return u.length < 900_000; try { const x = new URL(u); return x.protocol === 'https:' && !/\/images\/(artist|cover)\/\/|\/0+-0+-0+-0+\.jpg/.test(x.pathname); } catch { return u.startsWith('/api/'); } }
const DEEZER_BLANK = /\/images\/(artist|cover)\/d41d8cd98f00b204e9800998ecf8427e\//; // Deezer's "no picture" placeholder
function goodPortrait(a) { const u = a?.artwork || a?.artworkSmall; return validArt(u) && !DEEZER_BLANK.test(u) ? u : null; }
async function lookupArtistImage({ id, name }) {
  const key = id && /^dz:\d+$/.test(id) ? id : `name:${normText(name)}`;
  if (!name && !key.startsWith('dz:')) return { key, url: null };
  const hit = artStore.artists[key];
  if (hit && hit.exp > Date.now()) return { key, url: hit.url };
  if (artInflight.has(key)) return artInflight.get(key);
  const task = (async () => {
    let url = null;
    try {
      if (key.startsWith('dz:')) url = goodPortrait(await dz.artistInfo(key.slice(3)));
      if (!url && name) {
        const want = normText(name);
        const res = await dz.searchArtists(name, 6);
        const exact = res.filter((a) => normText(a.name) === want).sort((a, b) => (b.fans || 0) - (a.fans || 0))[0]; // same name → most-followed
        url = goodPortrait(exact);
      }
      artStore.artists[key] = { url, exp: Date.now() + (url ? 14 * 86400_000 : 6 * 3600_000) };
    } catch (e) { if (e.status !== 404) return { key, url: null, retry: true }; artStore.artists[key] = { url: null, exp: Date.now() + 6 * 3600_000 }; }
    saveArt();
    return { key, url };
  })();
  artInflight.set(key, task);
  try { return await task; } finally { artInflight.delete(key); }
}
route('POST', '/api/artwork/artists', async ({ body }) => {
  const list = (Array.isArray(body.artists) ? body.artists : []).slice(0, 60).map((a) => ({ id: typeof a?.id === 'string' ? a.id : null, name: String(a?.name || '').slice(0, 120) })).filter((a) => a.id || a.name);
  const out = await mapLimit(list, 4, lookupArtistImage);
  return { images: Object.fromEntries(out.filter(Boolean).map((r) => [r.key, r.url])) };
});
// Collection covers: the collection's own cover, else up to 4 distinct track/album covers from it.
const coverCache = new TTLCache(500);
const coverInflight = new Map();
const tilesFrom = (tracks) => [...new Set((tracks || []).map((t) => t?.albumArtwork || t?.artwork || t?.artworkSmall).filter(validArt))].slice(0, 4);
async function invokeRoute(method, pathname, user) { // reuse existing route handlers (mixes, sessions, …)
  for (const r of routes) { if (r.method !== method) continue; const m = pathname.match(r.re); if (!m) continue; const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); return r.handler({ params, query: {}, body: {}, user, req: { socket: {}, headers: {} }, res: { setHeader() {} } }); }
  return null;
}
async function collectionCover(key, user) {
  const [kind, ...rest] = key.split(':'); const id = rest.join(':');
  if (kind === 'playlist') { const p = db.playlistFor(id, user.id); if (!p) return null; return { art: validArt(p.artwork) ? p.artwork : null, tiles: tilesFrom(p.tracks) }; }
  if (kind === 'likes') return { art: null, tiles: tilesFrom(Object.values(user.library.likes).sort((a, b) => (b.likedAt || '').localeCompare(a.likedAt || ''))) };
  if (kind === 'recent') return { art: null, tiles: tilesFrom(user.history.slice(-80).reverse().map((e) => e.track)) };
  if (kind === 'dzplaylist') { const r = await dz.playlist(id.replace(/^dzp:/, '')); return { art: validArt(r.playlist.artwork) && !DEEZER_BLANK.test(r.playlist.artwork) ? r.playlist.artwork : null, tiles: tilesFrom(r.tracks) }; }
  if (kind === 'radio') { const r = await invokeRoute('GET', `/api/radio/${encodeURIComponent(id)}`, user); return { art: null, tiles: tilesFrom(r?.tracks) }; }
  if (kind === 'session') { const r = await invokeRoute('GET', `/api/sessions/${encodeURIComponent(id)}`, user); return { art: null, tiles: tilesFrom(r?.tracks) }; } // tracks actually in the session
  if (kind === 'mix') { const r = await invokeRoute('GET', `/api/mix/${encodeURIComponent(id)}`, user); return { art: null, tiles: tilesFrom(r?.tracks) }; }
  if (kind === 'album') { const r = await dz.album(id.replace(/^dz:/, '')); return { art: validArt(r.album.artwork) ? r.album.artwork : null, tiles: [] }; }
  return null;
}
route('POST', '/api/artwork/covers', async ({ body, user }) => {
  const keys = [...new Set((Array.isArray(body.keys) ? body.keys : []).map(String).filter((k) => /^(playlist|likes|recent|dzplaylist|radio|session|mix|album)(:[\w:.-]{0,80})?$/.test(k)))].slice(0, 40);
  const out = await mapLimit(keys, 3, async (k) => {
    const ck = `${/^(playlist|likes|recent|mix)/.test(k) ? user.id : 'all'}|${k}`;
    const hit = coverCache.get(ck); if (hit) return [k, hit];
    if (!coverInflight.has(ck)) coverInflight.set(ck, collectionCover(k, user).finally(() => setTimeout(() => coverInflight.delete(ck), 0)));
    try { const v = await coverInflight.get(ck); if (v) coverCache.set(ck, v, /^(playlist|likes|recent)/.test(k) ? 60_000 : 6 * 3600_000); return [k, v]; }
    catch { return [k, null]; }
  });
  return { covers: Object.fromEntries(out.filter(Boolean)) };
}, { auth: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };
async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const buf = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
}

// ---------- dispatch ----------
export const server = http.createServer(async (req, res) => {
  res.__secure = req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    if (!p.startsWith('/api/')) return await serveStatic(req, res, p);
    const user = db.sessionUser(cookies(req)[COOKIE]);
    if (user?.mustChangePassword && !((req.method === 'GET' && p === '/api/me') || (req.method === 'PUT' && p === '/api/me/credentials') || (req.method === 'POST' && p === '/api/auth/logout') || (req.method === 'GET' && p === '/api/health'))) throw new HttpError(403, 'Change the starter password before using Vesper.', 'password_change_required');
    if (req.method === 'GET' && p.startsWith('/api/audio/')) return await streamAudio(req, res, decodeURIComponent(p.slice(11)), url.searchParams.get('q'));
    if (req.method === 'GET' && p === '/api/img') return await proxyImage(res, url.searchParams.get('u') || '');
    if (req.method === 'GET' && p.startsWith('/api/test/art/')) { const s = ts.art(p.slice(14).replace('.svg', '')); if (!s) throw new HttpError(404, 'Not found'); res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }); return res.end(s); }
    if (req.method === 'GET' && p.startsWith('/api/local/art/')) {
      const e = local.get(p.slice(15)); if (!e) throw new HttpError(404, 'Not found');
      if (e.tags.picture) { const fh = await fsp.open(e.file, 'r'); const b = Buffer.alloc(e.tags.picture.length); await fh.read(b, 0, b.length, e.tags.picture.start); await fh.close(); res.writeHead(200, { 'Content-Type': e.tags.picture.mime, 'Cache-Control': 'public, max-age=3600' }); return res.end(b); }
      if (e.cover) return await serveFile(req, res, e.cover, e.cover.endsWith('.png') ? 'image/png' : 'image/jpeg');
      throw new HttpError(404, 'No artwork');
    }
    if (req.method === 'GET' && p === '/api/admin/backup-file') { needAdmin(user); db.flush(); res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="vesper-backup-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' }); return fs.createReadStream(db.file).pipe(res); }
    // Simple CSRF guard: state-changing requests must carry our custom header (blocked cross-site by CORS).
    if (req.method !== 'GET' && req.headers['x-vesper'] !== '1') throw new HttpError(403, 'Missing request header');
    if (req.method === 'POST' && p === '/api/admin/update') return send(res, 200, await installUpdate(req, user));
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = p.match(r.re); if (!m) continue;
      if (r.auth && !user) throw new HttpError(401, 'Sign in or continue as a guest first.', 'auth_required');
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      const out = await r.handler({ req, res, params, query: Object.fromEntries(url.searchParams), body, user });
      if (out === null) continue;
      if (!res.headersSent) send(res, 200, out);
      return;
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && !(e instanceof ProviderError)) console.error(e);
    if (!res.headersSent) send(res, status, { error: e.message || 'Server error', code: e.code || 'error', provider: e.provider });
    else res.destroy();
  }
});

// ---------- installing an update uploaded by the owner ----------
// Only on a server started by the deploy script (VESPER_SELF_UPDATE=1, with a service manager that
// restarts Vesper). Data lives outside the app folder there, and is backed up before anything changes.
async function installUpdate(req, user) {
  needAdmin(user);
  if (!process.env.VESPER_SELF_UPDATE) throw new HttpError(400, 'Updating from the browser only works on a server set up with deploy/setup-server.sh. On your own computer, unzip the new version and copy your data folder into it.');
  if (path.resolve(DATA_DIR).startsWith(path.resolve(ROOT) + path.sep)) throw new HttpError(400, 'Your data folder is inside the app folder, so an update could touch it. Set VESPER_DATA_DIR to a folder outside the app first.');
  const buf = await readRaw(req, 40_000_000).catch((e) => { throw e.status === 413 ? new HttpError(413, 'That file is too big for a Vesper update (over 40 MB).') : e; });
  if (buf.length < 1000 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new HttpError(400, 'That isn’t a .zip file.');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vesper-update-'));
  const zip = path.join(work, 'update.zip'); fs.writeFileSync(zip, buf);
  try { await execFileAsync('unzip', ['-q', '-o', zip, '-d', path.join(work, 'x')], { timeout: 60_000 }); }
  catch (e) { throw new HttpError(500, e.code === 'ENOENT' ? 'The server is missing “unzip”. Run: sudo apt install unzip' : `Couldn’t open the zip: ${e.message}`); }
  // Find the folder in the zip that holds Vesper.
  const find = (dir, depth = 0) => { if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'server', 'server.mjs'))) return dir; if (depth > 2) return null; for (const d of fs.readdirSync(dir, { withFileTypes: true })) if (d.isDirectory() && !d.name.startsWith('__MACOSX')) { const r = find(path.join(dir, d.name), depth + 1); if (r) return r; } return null; };
  const src = find(path.join(work, 'x'));
  if (!src) throw new HttpError(400, 'This zip doesn’t contain a Vesper version.');
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  if (pkg.name !== 'vesper') throw new HttpError(400, 'This zip isn’t a Vesper update.');
  for (const f of ['server/server.mjs', 'server/db.mjs', 'server/recommend.mjs']) {
    try { await execFileAsync(process.execPath, ['--check', path.join(src, f)], { timeout: 20_000 }); } catch { throw new HttpError(400, `The update has an error in ${f}, so it wasn’t installed. Nothing changed.`); }
  }
  const backup = db.backup(`before-${pkg.version}`);
  if (!backup) throw new HttpError(500, 'Couldn’t back up your data, so the update wasn’t installed. Nothing changed.');
  const SKIP = new Set(['data', '.env', 'node_modules', '.git', 'release', 'discord-client-id.txt', 'server-url.txt', 'cookies.txt']);
  const prev = path.join(DATA_DIR, 'previous-version'); // the service user can write here
  fs.rmSync(prev, { recursive: true, force: true });
  fs.cpSync(ROOT, prev, { recursive: true, filter: (f) => !SKIP.has(path.relative(ROOT, f).split(path.sep)[0]) });
  fs.cpSync(src, ROOT, { recursive: true, force: true, filter: (f) => !SKIP.has(path.relative(src, f).split(path.sep)[0] || '') });
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`Update to ${pkg.version} installed by ${user.username}. Restarting. Previous version kept in ${prev}.`);
  setTimeout(() => { db.flush(); process.exit(0); }, 800); // the service manager starts the new version
  return { ok: true, from: APP_VERSION, to: pkg.version, backup };
}

export function start(port = Number(process.env.PORT) || 5177, host = process.env.HOST || '0.0.0.0') {
  return new Promise((resolve) => {
    server.listen(port, host, async () => {
      const addrs = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
      console.log(`\n  Vesper is running\n  On this computer:  http://localhost:${server.address().port}`);
      for (const a of addrs) console.log(`  On your phone:     http://${a}:${server.address().port}  (same Wi-Fi)`);
      if (local.configured()) { const s = await local.scan(); console.log(`  Music folder:      ${s.root} (${s.count} files)`); }
      console.log('');
      resolve(server);
    });
  });
}
const shutdown = () => { db.flush(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start();
export { db };
