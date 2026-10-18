// Discord "Listening to" status over Discord's local RPC socket. No dependencies, nothing is
// sent anywhere except the Discord app running on this computer. Needs a Discord application ID.
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function socketPaths() {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  const dirs = [base, path.join(base, 'app/com.discordapp.Discord'), path.join(base, 'snap.discord'), '/tmp'];
  return dirs.flatMap((d) => Array.from({ length: 10 }, (_, i) => path.join(d, `discord-ipc-${i}`)));
}
function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8); head.writeInt32LE(op, 0); head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

class DiscordPresence {
  constructor() { this.clientId = null; this.sock = null; this.ready = false; this.enabled = false; this.pending = null; this.retry = null; this.lastSent = 0; this.timer = null; this.error = null; }
  configure(clientId) { this.clientId = /^\d{17,20}$/.test(String(clientId || '').trim()) ? String(clientId).trim() : null; }
  status() { return { enabled: this.enabled, configured: !!this.clientId, connected: this.ready, error: this.error }; }
  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) { this.clear(); this.disconnect(); }
    else this.connect();
    return this.status();
  }
  connect() {
    if (!this.enabled || !this.clientId || this.sock || this.connecting) return;
    this.connecting = true;
    const paths = socketPaths().filter((p) => process.platform === 'win32' || fs.existsSync(p));
    const tryNext = (i) => {
      if (i >= paths.length) { this.connecting = false; this.error = 'Discord isn’t running on this computer.'; this.scheduleRetry(); return; }
      const s = net.createConnection(paths[i]);
      s.once('error', () => { s.destroy(); tryNext(i + 1); });
      s.once('connect', () => {
        s.removeAllListeners('error'); this.connecting = false;
        this.sock = s; let buf = Buffer.alloc(0);
        s.on('data', (d) => {
          buf = Buffer.concat([buf, d]);
          while (buf.length >= 8) {
            const op = buf.readInt32LE(0), len = buf.readInt32LE(4); if (buf.length < 8 + len) break;
            let msg = null; try { msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch {}
            buf = buf.subarray(8 + len);
            if (op === OP.PING) s.write(encode(OP.PONG, msg));
            else if (op === OP.CLOSE) { this.error = msg?.message || 'Discord closed the connection.'; this.disconnect(); this.scheduleRetry(); }
            else if (msg?.evt === 'READY') { this.ready = true; this.error = null; if (this.pending !== null) this.flush(); }
            else if (msg?.evt === 'ERROR') this.error = msg.data?.message || 'Discord rejected the status.';
          }
        });
        s.on('close', () => { this.sock = null; this.ready = false; this.scheduleRetry(); });
        s.on('error', () => {});
        s.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
      });
    };
    tryNext(0);
  }
  scheduleRetry() { clearTimeout(this.retry); if (this.enabled) this.retry = setTimeout(() => this.connect(), 15000); }
  disconnect() { clearTimeout(this.retry); try { this.sock?.destroy(); } catch {} this.sock = null; this.ready = false; }
  // Discord allows about 5 updates per 20 seconds; keep only the newest and send at most every 4 s.
  set(activity) { this.pending = activity; this.schedule(); }
  clear() { this.pending = false; this.schedule(); }
  schedule() {
    if (!this.enabled) return;
    if (!this.sock) { this.connect(); return; }
    if (!this.ready || this.timer) return;
    const wait = Math.max(0, 4000 - (Date.now() - this.lastSent));
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, wait);
  }
  flush() {
    if (!this.ready || !this.sock || this.pending === null) return;
    const a = this.pending; this.pending = null; this.lastSent = Date.now();
    this.sock.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', nonce: String(Date.now()) + Math.random(), args: { pid: process.pid, activity: a ? this.toActivity(a) : null } }));
  }
  toActivity(a) {
    const clip = (s, n) => { s = String(s || '').trim(); return s.length < 2 ? (s + '  ').slice(0, 2) : s.slice(0, n); };
    const act = { type: 2, details: clip(a.title, 128), state: clip(a.artist ? `by ${a.artist}` : 'Vesper', 128), instance: false };
    if (a.start && a.end) act.timestamps = { start: Math.floor(a.start), end: Math.floor(a.end) };
    const img = /^https:\/\//.test(a.artwork || '') && String(a.artwork).length < 256 ? a.artwork : null;
    act.assets = { large_image: img || 'vesper', large_text: clip(a.album || a.title, 128) };
    return act;
  }
}
module.exports = { DiscordPresence };
