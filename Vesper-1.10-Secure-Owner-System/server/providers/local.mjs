// Your own music files. Point MUSIC_DIR at a folder; Vesper scans it and streams full tracks.
// Reads ID3v2 tags (MP3), embedded or folder cover art, and sidecar .lrc lyric files.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { relevance } from '../util.mjs';

export const info = {
  id: 'local', name: 'My music folder', fullTracks: true, needsKey: false,
  capabilities: ['search', 'full-playback', 'seek', 'speed', 'crossfade', 'synced-lyrics-lrc'],
  limitation: 'Tags are read from MP3 (ID3v2) files. Other formats use the file and folder names.',
};

const EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.oga', '.opus', '.webm']);
export const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.webm': 'audio/webm' };
const index = new Map(); // id -> entry
let root = null, scannedAt = null, scanning = null;

export const configured = () => !!process.env.MUSIC_DIR;
export const status = () => ({ root, count: index.size, scannedAt });

// ---- ID3v2 ----
const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
function decodeText(buf, enc) {
  if (enc === 0) return buf.toString('latin1').replace(/\0+$/, '');
  if (enc === 3) return buf.toString('utf8').replace(/\0+$/, '');
  if (enc === 1 || enc === 2) {
    let b = buf, le = enc === 1;
    if (enc === 1 && b.length >= 2) { if (b[0] === 0xfe && b[1] === 0xff) { le = false; b = b.subarray(2); } else if (b[0] === 0xff && b[1] === 0xfe) { b = b.subarray(2); } }
    if (!le) { const c = Buffer.alloc(b.length - (b.length % 2)); for (let i = 0; i + 1 < b.length; i += 2) { c[i] = b[i + 1]; c[i + 1] = b[i]; } b = c; }
    return b.toString('utf16le').replace(/\0+$/, '');
  }
  return '';
}
function termLen(buf, start, enc) { // index of terminator for encoded string
  if (enc === 1 || enc === 2) { for (let i = start; i + 1 < buf.length; i += 2) if (buf[i] === 0 && buf[i + 1] === 0) return i; return buf.length; }
  const i = buf.indexOf(0, start); return i < 0 ? buf.length : i;
}

export async function readId3(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const head = Buffer.alloc(10);
    await fh.read(head, 0, 10, 0);
    if (head.toString('latin1', 0, 3) !== 'ID3') return {};
    const ver = head[3], flags = head[5], size = syncsafe(head, 6);
    if (size > 25 * 1024 * 1024 || ver < 3 || ver > 4) return {};
    const tag = Buffer.alloc(size);
    await fh.read(tag, 0, size, 10);
    let p = 0;
    if (flags & 0x40) p = ver === 4 ? syncsafe(tag, 0) : tag.readUInt32BE(0) + 4; // extended header
    const out = {};
    while (p + 10 <= size) {
      const id = tag.toString('latin1', p, p + 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const fsz = ver === 4 ? syncsafe(tag, p + 4) : tag.readUInt32BE(p + 4);
      if (fsz <= 0 || p + 10 + fsz > size) break;
      const body = tag.subarray(p + 10, p + 10 + fsz);
      const map = { TIT2: 'title', TPE1: 'artist', TALB: 'album', TCON: 'genre', TYER: 'year', TDRC: 'year', TLEN: 'tlen', TBPM: 'bpm', TRCK: 'trackNo' };
      if (map[id]) out[map[id]] = decodeText(body.subarray(1), body[0]).split('\0')[0].trim();
      else if (id === 'APIC' && !out.picture) {
        const enc = body[0];
        const mimeEnd = body.indexOf(0, 1);
        const mime = body.toString('latin1', 1, mimeEnd) || 'image/jpeg';
        const descEnd = termLen(body, mimeEnd + 2, enc);
        const dataStart = descEnd + (enc === 1 || enc === 2 ? 2 : 1);
        out.picture = { start: 10 + p + 10 + dataStart, length: fsz - dataStart, mime: mime.includes('/') ? mime : `image/${mime.toLowerCase()}` };
      }
      p += 10 + fsz;
    }
    if (out.genre) out.genre = out.genre.replace(/^\(\d+\)/, '').trim() || null;
    return out;
  } finally { await fh.close(); }
}

function fromFilename(file) {
  const base = path.basename(file, path.extname(file)).replace(/^\d+[\s.\-_]+/, '');
  const m = base.split(/\s+-\s+/);
  return m.length >= 2 ? { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() } : { title: base.trim() };
}

async function walk(dir, files = [], depth = 0) {
  if (depth > 8) return files;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return files; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, files, depth + 1);
    else if (EXT.has(path.extname(e.name).toLowerCase())) files.push(full);
  }
  return files;
}

export async function scan() {
  if (!configured()) return status();
  if (scanning) return scanning;
  scanning = (async () => {
    root = path.resolve(process.env.MUSIC_DIR.replace(/^~(?=$|\/)/, process.env.HOME || '~'));
    index.clear();
    const files = await walk(root);
    for (const file of files) {
      const rel = path.relative(root, file);
      const id = crypto.createHash('sha1').update(rel).digest('hex').slice(0, 16);
      let tags = {};
      if (path.extname(file).toLowerCase() === '.mp3') { try { tags = await readId3(file); } catch { tags = {}; } }
      const fn = fromFilename(file);
      const dir = path.dirname(file);
      let cover = null;
      if (!tags.picture) for (const c of ['cover.jpg', 'cover.png', 'folder.jpg', 'front.jpg', 'Cover.jpg', 'Folder.jpg', 'AlbumArt.jpg']) if (fs.existsSync(path.join(dir, c))) { cover = path.join(dir, c); break; }
      const lrc = file.replace(/\.[^.]+$/, '.lrc');
      index.set(id, {
        file, tags, cover, lrc: fs.existsSync(lrc) ? lrc : null,
        track: {
          id: `lc:${id}`, provider: 'local',
          title: tags.title || fn.title, artist: tags.artist || fn.artist || 'Unknown artist', artistId: null,
          album: tags.album || (dir !== root ? path.basename(dir) : null), albumId: null,
          artwork: tags.picture || cover ? `/api/local/art/${id}` : null, artworkSmall: tags.picture || cover ? `/api/local/art/${id}` : null,
          duration: tags.tlen ? Math.round(Number(tags.tlen) / 1000) || null : null,
          preview: false, playableDuration: null, playable: true, unplayableReason: null, explicit: false,
          genre: tags.genre || null, bpm: Number(tags.bpm) > 0 ? Number(tags.bpm) : null,
          releaseDate: tags.year ? String(tags.year).slice(0, 4) : null, hasLrc: fs.existsSync(lrc),
        },
      });
    }
    scannedAt = new Date().toISOString();
    return status();
  })();
  try { return await scanning; } finally { scanning = null; }
}

export const all = () => [...index.values()].map((e) => e.track);
export const get = (id) => index.get(id);
export function search(q, limit = 30) {
  return all().map((t) => ({ t, s: relevance(q, t) })).filter((x) => x.s > 0.2).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.t);
}
export async function lyrics(id) {
  const e = index.get(id);
  if (!e?.lrc) return null;
  return fsp.readFile(e.lrc, 'utf8');
}
