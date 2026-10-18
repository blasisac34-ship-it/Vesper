// Persistent JSON store with atomic writes. Suitable for a personal/household server.
// Every user-owned record is keyed by user id; routes only ever read the session user's data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_SETTINGS = {
  theme: 'dark', transition: 'smooth', crossfade: 6, speed: 1, autoplay: true,
  leveling: true, processing: 'auto', artworkMode: 'ambient', visualizerIntensity: 0.6,
  reducedMotion: 'system', explicit: true, lyricsSource: 'lrclib',
  recordHistory: true, historyForRecs: true, youtubeAck: false, smartShuffle: true, fullViaYouTube: true, discordPresence: false, dataSaver: false, noFullFallback: 'skip',
  eq: { enabled: false, preset: 'flat', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 0, mid: 0, treble: 0 },
  eqPresets: [],
};
const HISTORY_CAP = 25_000;

export class DB {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.data = { users: {}, sessions: {}, playlists: {}, snapshots: {}, replays: {} };
    this.backupDir = path.join(path.dirname(file), 'backups');
    if (fs.existsSync(file)) {
      try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
      catch (e) {
        const bad = `${file}.corrupt-${Date.now()}`; fs.copyFileSync(file, bad);
        // Never start empty over real data: fall back to the newest good backup.
        const restored = this.restoreLatestBackup();
        console.error(`Database unreadable; saved a copy to ${bad}. ${restored ? `Restored ${restored}.` : 'No backup found.'}`);
        if (!restored) throw new Error(`Vesper's data file is damaged and no backup was found. Your data was copied to ${bad}; Vesper will not start empty over it.`);
      }
    }
    this.timer = null;
    // Write pending changes before the process stops (updates, restarts, Ctrl+C).
    const stop = (sig) => { try { this.flush(); } catch (e) { console.error('Could not save on exit:', e.message); } if (sig) process.exit(0); };
    process.once('beforeExit', () => stop(false));
    this.backup('startup');
    setInterval(() => this.backup('daily'), 24 * 3600_000).unref();
  }
  // ---- backups: data/backups/vesper-<date>-<reason>.json, newest 20 kept ----
  backup(reason = 'manual') {
    try {
      if (reason !== 'startup') this.flush(); // write pending changes first, so the backup is current
      if (!fs.existsSync(this.file)) return reason === 'startup' ? null : (this.flush(), this.backup(reason));
      fs.mkdirSync(this.backupDir, { recursive: true });
      const name = `vesper-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${reason}.json`;
      fs.copyFileSync(this.file, path.join(this.backupDir, name));
      const all = fs.readdirSync(this.backupDir).filter((f) => /^vesper-.*\.json$/.test(f)).sort();
      for (const f of all.slice(0, Math.max(0, all.length - 20))) fs.unlinkSync(path.join(this.backupDir, f));
      return name;
    } catch (e) { console.error('Backup failed:', e.message); return null; }
  }
  restoreLatestBackup() {
    try {
      const all = fs.readdirSync(this.backupDir).filter((f) => /^vesper-.*\.json$/.test(f)).sort().reverse();
      for (const f of all) {
        try { const d = JSON.parse(fs.readFileSync(path.join(this.backupDir, f), 'utf8')); this.data = { ...this.data, ...d }; return f; } catch { /* try older */ }
      }
    } catch { /* no backups folder */ }
    return null;
  }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 250);
  }
  flush() {
    clearTimeout(this.timer);
    const tmp = `${this.file}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, JSON.stringify(this.data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
  }

  // ---- users & auth ----
  newUser({ username = null, password = null, displayName }) {
    const id = crypto.randomUUID();
    const u = {
      id, username: username ? username.toLowerCase() : null, displayName: (displayName || 'Listener').slice(0, 40),
      avatar: null, createdAt: new Date().toISOString(), guest: !username,
      settings: { ...DEFAULT_SETTINGS }, profile: { favoriteGenres: [] },
      library: { likes: {}, albums: {}, artists: {}, sessions: {} },
      history: [], searches: [], feedback: { avoidArtists: {}, less: {}, more: {} },
    };
    if (password) Object.assign(u, hashPassword(password));
    this.data.users[id] = u;
    this.save();
    return u;
  }
  userByName(username) { const n = username.toLowerCase(); return Object.values(this.data.users).find((u) => u.username === n) || null; }
  user(id) { const u = this.data.users[id]; if (u) u.settings = { ...DEFAULT_SETTINGS, ...u.settings }; return u || null; }
  setCredentials(u, username, password) { u.username = username.toLowerCase(); u.guest = false; Object.assign(u, hashPassword(password)); this.save(); }
  createSession(uid) { const token = crypto.randomBytes(32).toString('base64url'); this.data.sessions[token] = { uid, created: Date.now() }; this.save(); return token; }
  sessionUser(token) { const s = token && this.data.sessions[token]; return s ? this.user(s.uid) : null; }
  endSession(token) { delete this.data.sessions[token]; this.save(); }
  deleteUser(uid) {
    delete this.data.users[uid];
    for (const [k, s] of Object.entries(this.data.sessions)) if (s.uid === uid) delete this.data.sessions[k];
    for (const [k, p] of Object.entries(this.data.playlists)) if (p.owner === uid) delete this.data.playlists[k];
    delete this.data.replays[uid];
    this.save();
  }

  // ---- playlists ----
  playlistsOf(uid) { return Object.values(this.data.playlists).filter((p) => p.owner === uid).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  // Returns the playlist only if the viewer owns it or it is public.
  playlistFor(id, uid) { const p = this.data.playlists[id]; if (!p) return null; if (p.owner !== uid && p.privacy !== 'public') return null; return p; }
  ownedPlaylist(id, uid) { const p = this.data.playlists[id]; return p && p.owner === uid ? p : null; }
  createPlaylist(uid, { name, description = '', privacy = 'private', tracks = [], artwork = null }) {
    const id = crypto.randomBytes(9).toString('base64url');
    const now = new Date().toISOString();
    const p = { id, owner: uid, name: (name || 'New playlist').slice(0, 100), description: description.slice(0, 500), privacy: privacy === 'public' ? 'public' : 'private', artwork, tracks: tracks.map(slimTrack).filter(Boolean), createdAt: now, updatedAt: now };
    this.data.playlists[id] = p; this.save(); return p;
  }

  // ---- history ----
  addEvent(u, ev) { u.history.push(ev); if (u.history.length > HISTORY_CAP) u.history.splice(0, u.history.length - HISTORY_CAP); this.save(); }

  // ---- chart snapshots (to compute movement honestly from our own observations) ----
  snapshot(chartId, ids) {
    const day = new Date().toISOString().slice(0, 10);
    const list = (this.data.snapshots[chartId] ||= []);
    const last = list[list.length - 1];
    if (last && last.date === day) last.ids = ids; else list.push({ date: day, ids });
    if (list.length > 60) list.splice(0, list.length - 60);
    this.save();
    const prev = list.length > 1 ? list[list.length - 2] : null;
    return prev;
  }
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, passHash: crypto.scryptSync(pw, salt, 32).toString('hex') };
}
export function checkPassword(u, pw) {
  if (!u?.passHash) return false;
  const h = crypto.scryptSync(pw, u.salt, 32);
  return crypto.timingSafeEqual(h, Buffer.from(u.passHash, 'hex'));
}

// Only keep the fields we need to render and replay a track.
const KEEP = ['official', 'sourceId', 'sourceDuration', 'matchV', 'noFullMatch', 'matchNote', 'channel', 'ytFetchedAt', 'ytLimited', 'ytReduced', 'videoId', 'youtubeMatched', 'fullTrack', 'albumArtwork', 'downloadable', 'unplayableReason', 'link', 'id', 'provider', 'title', 'artist', 'artistId', 'album', 'albumId', 'artwork', 'artworkSmall', 'duration', 'preview', 'playableDuration', 'playable', 'explicit', 'genre', 'bpm', 'releaseDate', 'isTest'];
export function slimTrack(t) {
  if (!t || typeof t.id !== 'string' || !/^[a-z]{2,3}:[\w-]{1,64}$/.test(t.id)) return null;
  const o = {};
  for (const k of KEEP) if (t[k] !== undefined) o[k] = typeof t[k] === 'string' ? t[k].slice(0, 500) : t[k];
  return o;
}
export const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, guest: u.guest, isOwner: !!u.isOwner, mustChangePassword: !!u.mustChangePassword, settings: u.settings, profile: u.profile, createdAt: u.createdAt });
