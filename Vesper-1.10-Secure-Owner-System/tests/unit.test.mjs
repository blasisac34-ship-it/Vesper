// Unit + API tests. Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze, TempoTracker } from '../public/js/analysis.js';
import { parseLRC } from '../public/js/lrc.js';
import * as ts from '../server/providers/testsignal.mjs';
import { readId3 } from '../server/providers/local.mjs';
import { computeStats } from '../server/stats.mjs';
import { DB, slimTrack, checkPassword } from '../server/db.mjs';
import { relevance } from '../server/util.mjs';

const wavBuffer = (n) => { const b = ts.wav(n), len = (b.length - 44) / 2, d = new Float32Array(len); for (let i = 0; i < len; i++) d[i] = b.readInt16LE(44 + i * 2) / 32768; return { sampleRate: 22050, length: len, numberOfChannels: 1, getChannelData: () => d }; };

test('tempo estimate is within 1% on every known-tempo test signal', () => {
  for (const t of ts.tracks) { const a = analyze(wavBuffer(Number(t.id.slice(3)))); assert.ok(a.bpm, `${t.title}: no tempo`); assert.ok(Math.abs(a.bpm - t.bpm) / t.bpm < 0.01, `${t.title}: got ${a.bpm}`); }
});
test('live tempo tracker estimates a repeating beat without downloading audio', () => {
  const tracker = new TempoTracker(10); let bpm = null;
  for (let i = 0; i < 300; i++) {
    const bins = new Uint8Array(64);
    if (i % 5 === 0) { bins[8] = 220; bins[9] = 140; bins[12] = 90; }
    bpm = tracker.pushSpectrum(bins) ?? bpm;
  }
  assert.ok(bpm, 'should estimate a clear 120 BPM pattern');
  assert.ok(Math.abs(bpm - 120) <= 8, `got ${bpm} BPM`);
});
test('no tempo reported for noise or a sustained tone', () => {
  const L = 22050 * 20; const noise = new Float32Array(L), tone = new Float32Array(L);
  for (let i = 0; i < L; i++) { noise[i] = (Math.random() * 2 - 1) * 0.3; tone[i] = Math.sin(i / 22050 * 2 * Math.PI * 330) * 0.3; }
  for (const d of [noise, tone]) assert.equal(analyze({ sampleRate: 22050, length: L, numberOfChannels: 1, getChannelData: () => d }).bpm, null);
});
test('silence trimming and fade-out detection', () => {
  const a = analyze(wavBuffer(3));
  assert.ok(Math.abs(a.leadSilence - 0.6) < 0.05); assert.ok(Math.abs(a.trailSilence - 0.8) < 0.12); assert.ok(a.fadeOut > 1.5 && a.fadeOut <= 3.6);
});
test('LRC parsing handles multiple timestamps and sorts', () => {
  const l = parseLRC('[ar:x]\n[00:05.50]second\n[00:01.00][00:09.25]first and third\nno tag');
  assert.deepEqual(l.map((x) => [x.t, x.text]), [[1, 'first and third'], [5.5, 'second'], [9.25, 'first and third']]);
});
test('ID3v2.3 tags and embedded artwork are read', async () => {
  const frame = (id, body) => { const h = Buffer.alloc(10); h.write(id, 0, 'latin1'); h.writeUInt32BE(body.length, 4); return Buffer.concat([h, body]); };
  const text = (s) => Buffer.concat([Buffer.from([3]), Buffer.from(s, 'utf8')]);
  const pic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const apic = Buffer.concat([Buffer.from([0]), Buffer.from('image/jpeg\0', 'latin1'), Buffer.from([3]), Buffer.from('\0'), pic]);
  const frames = Buffer.concat([frame('TIT2', text('We Fell in Love in October')), frame('TPE1', text('girl in red')), frame('TALB', text('chapter 1')), frame('APIC', apic)]);
  const sz = frames.length, h = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (sz >> 21) & 127, (sz >> 14) & 127, (sz >> 7) & 127, sz & 127]);
  const f = path.join(os.tmpdir(), `v-${Date.now()}.mp3`); fs.writeFileSync(f, Buffer.concat([h, frames, Buffer.alloc(64)]));
  const t = await readId3(f);
  assert.equal(t.title, 'We Fell in Love in October'); assert.equal(t.artist, 'girl in red'); assert.equal(t.album, 'chapter 1');
  assert.deepEqual(fs.readFileSync(f).subarray(t.picture.start, t.picture.start + t.picture.length), pic);
});
test('stats are computed from recorded events only', () => {
  const now = new Date('2026-10-17T20:00:00Z');
  const ev = (d, id, artist, ms, extra = {}) => ({ at: new Date(now - d * 86400000).toISOString(), track: { id, title: id, artist }, ms, ...extra });
  const s = computeStats([ev(2, 'a', 'X', 60000), ev(1, 'b', 'Y', 120000), ev(0, 'a', 'X', 90000), ev(0, 'c', 'Y', 5000, { skipped: true })], '7d', now);
  assert.equal(s.totals.plays, 4); assert.equal(s.totals.skipped, 1); assert.equal(s.totals.ms, 275000);
  assert.equal(s.topArtists[0].name, 'X'); assert.equal(s.topTracks[0].track.id, 'a'); assert.equal(s.streak.current, 3);
  assert.equal(computeStats([], 'all', now).totals.plays, 0);
});
test('playlist isolation and password hashing', () => {
  const db = new DB(path.join(os.tmpdir(), `vdb-${Date.now()}.json`));
  const a = db.newUser({ username: 'alice', password: 'longpassword', displayName: 'A' }), b = db.newUser({ displayName: 'B' });
  const p = db.createPlaylist(a.id, { name: 'mine' });
  assert.equal(db.playlistFor(p.id, b.id), null); assert.equal(db.ownedPlaylist(p.id, b.id), null); assert.ok(db.playlistFor(p.id, a.id));
  p.privacy = 'public'; assert.ok(db.playlistFor(p.id, b.id)); assert.equal(db.ownedPlaylist(p.id, b.id), null);
  assert.ok(checkPassword(a, 'longpassword')); assert.ok(!checkPassword(a, 'wrong')); assert.ok(!a.passHash.includes('longpassword'));
  clearTimeout(db.timer);
});
test('slimTrack rejects malformed ids and strips unknown fields', () => {
  assert.equal(slimTrack({ id: '../../etc' }), null);
  assert.deepEqual(Object.keys(slimTrack({ id: 'dz:123', title: 't', evil: 1 })).sort(), ['id', 'title']);
});
test('search relevance prefers the exact song', () => {
  const q = 'we fell in love in october girl in red';
  assert.ok(relevance(q, { title: 'we fell in love in october', artist: 'girl in red' }) > relevance(q, { title: 'october', artist: 'someone else' }));
});

// ---------- v2: Replay, EQ, word-timed lyrics ----------
import { computeReplay, isListen } from '../server/replay.mjs';
import { effectiveGains, preampDb, PRESETS } from '../public/js/eq.js';

test('Replay counting rules: thresholds, brief starts, previews, test signals', () => {
  const at = (d, h = 12) => new Date(Date.UTC(2025, 0, d, h)).toISOString();
  const T = (id, artist, preview = false) => ({ id, title: `Song ${id}`, artist, preview, provider: preview ? 'deezer' : 'jamendo' });
  const h = [
    { at: at(1), track: T('jm:1', 'A'), ms: 200000 }, { at: at(2), track: T('jm:1', 'A'), ms: 180000 }, { at: at(3), track: T('jm:2', 'B'), ms: 31000 },
    { at: at(3), track: T('jm:3', 'C'), ms: 12000 },                    // brief start (full track < 30 s)
    { at: at(5), track: T('dz:9', 'D', true), ms: 20000 },              // preview listen (≥ 15 s)
    { at: at(5), track: T('dz:8', 'E', true), ms: 9000 },               // brief preview start
    { at: at(6), track: { id: 'ts:1', title: 't', artist: 'Vesper test signal', provider: 'test' }, ms: 40000 }, // excluded
  ];
  const r = computeReplay(h, Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1), { label: '2025' });
  assert.equal(r.totals.listens, 4); assert.equal(r.totals.fullListens, 3); assert.equal(r.totals.previewListens, 1); assert.equal(r.totals.briefStarts, 2);
  assert.equal(r.topTracks[0].track.id, 'jm:1'); assert.equal(r.topTracks[0].listens, 2);
  assert.ok(!r.topArtists.some((a) => a.name === 'C' || a.name === 'E'), 'brief starts must not reach top lists');
  assert.equal(r.longestStreak.days, 3); assert.equal(r.longestStreak.from, '2025-01-01');
  assert.equal(r.genres.length, 0, 'no genres shown without reliable metadata');
  assert.equal(r.totals.ms, 200000 + 180000 + 31000 + 12000 + 20000 + 9000, 'listening time includes brief starts but not test signals');
  assert.ok(isListen({ track: { preview: true }, ms: 15000 }) && !isListen({ track: { preview: false }, ms: 29999 }));
});
test('Replay discoveries only count artists first heard inside the period', () => {
  const ev = (y, m, a) => ({ at: new Date(Date.UTC(y, m, 2)).toISOString(), track: { id: `jm:${a}${y}`, title: 'x', artist: a, provider: 'jamendo' }, ms: 60000 });
  const r = computeReplay([ev(2024, 5, 'Old'), ev(2025, 1, 'Old'), ev(2025, 2, 'New')], Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1));
  assert.deepEqual(r.discoveries.map((a) => a.name), ['New']); assert.equal(r.discoveriesMeaningful, true);
});
test('EQ: presets, macros, clamping, off state and headroom', () => {
  assert.deepEqual(effectiveGains({ enabled: false, bands: PRESETS.rock.bands }), new Array(10).fill(0));
  const g = effectiveGains({ enabled: true, bands: PRESETS.flat.bands, bass: 6, mid: 0, treble: 0 });
  assert.equal(g[0], 6); assert.equal(g[9], 0);
  assert.equal(effectiveGains({ enabled: true, bands: new Array(10).fill(10), bass: 12, mid: 0, treble: 0 })[0], 12, 'clamped to +12 dB');
  assert.ok(preampDb([6, 0, 0]) < -5 && preampDb([-3, -3]) === -0);
});
test('Enhanced LRC word timestamps are parsed; plain lines have none', async () => {
  const { parseLRC } = await import('../public/js/lrc.js');
  const [a, b] = parseLRC('[00:02.00]<00:02.00>Hello <00:02.60>there\n[00:05.00]plain line');
  assert.deepEqual(a.words.map((w) => [w.t, w.text.trim()]), [[2, 'Hello'], [2.6, 'there']]); assert.equal(a.text, 'Hello there');
  assert.equal(b.words, undefined);
});

test('followed artists seed Daily Mixes for new accounts and remain recommendation signals', async () => {
  const { dailyMixSeeds, userSignals } = await import('../server/recommend.mjs');
  const user = {
    id: 'new-user', history: [],
    library: { artists: { 'dz:1': { id: 'dz:1', name: 'Drake', artwork: 'https://example.test/drake.jpg' } }, likes: {} },
    feedback: { avoidArtists: {}, less: {}, more: {} }, settings: { historyForRecs: false, explicit: true },
  };
  const seeds = dailyMixSeeds(user, 28, 4);
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].name, 'Drake');
  assert.equal(seeds[0].artistId, 'dz:1');
  assert.ok(userSignals(user).followedArtists.has('drake'));
});


test('missing song artwork gets a deterministic visible cover fallback', async () => {
  const { coverFallback } = await import('../public/js/cover.js');
  const a = coverFallback({ title: 'Moonlight', artist: 'Kali Uchis' });
  const b = coverFallback({ title: 'Moonlight', artist: 'Kali Uchis' });
  assert.match(a, /^data:image\/svg\+xml,/);
  assert.equal(a, b);
  assert.notEqual(a, coverFallback({ title: 'Different song', artist: 'Someone else' }));
});

// ---------- Beat grid + official YouTube matching ----------
import { analyze as analyzeBeats } from '../public/js/analysis.js';
import * as tsig from '../server/providers/testsignal.mjs';
import * as ytp from '../server/providers/youtube.mjs';
test('beat grid: tempo within 0.1 BPM and intro/outro beat phase within 10 ms on all test signals', () => {
  for (const t of tsig.tracks) {
    const b = tsig.wav(Number(t.id.slice(3))), len = (b.length - 44) / 2, d = new Float32Array(len);
    for (let i = 0; i < len; i++) d[i] = b.readInt16LE(44 + i * 2) / 32768;
    const a = analyzeBeats({ sampleRate: 22050, length: len, numberOfChannels: 1, getChannelData: () => d });
    const beat = 60 / t.bpm, err = (o) => { const e = ((o - 0.6) % beat + beat) % beat; return Math.min(e, beat - e); };
    assert.ok(Math.abs(a.bpm - t.bpm) <= 0.1, `${t.bpm}: ${a.bpm}`);
    assert.ok(err(a.beatOffset) < 0.01 && err(a.endBeatOffset) < 0.01, `${t.bpm}: phase ${a.beatOffset} / ${a.endBeatOffset}`);
    assert.ok(a.beatConfidence >= 1.3 && a.endBeatConfidence >= 1.3);
  }
});
test('YouTube match picks the official upload and rejects covers, wrong songs and wrong lengths', async () => {
  process.env.YOUTUBE_API_KEY = 'k';
  const vids = [
    ['cov00000001', 'we fell in love in october (cover)', 'Some Singer', 'PT3M5S'],
    ['wrong000001', 'girl in red - bad idea (Official Video)', 'girl in red', 'PT3M5S'],
    ['offic000001', 'we fell in love in october', 'girl in red - Topic', 'PT3M4S'],
    ['long0000001', 'girl in red - we fell in love in october (1 hour loop)', 'Loops', 'PT1H'],
  ];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/search?') ? { items: vids.map(([id]) => ({ id: { videoId: id } })) } : { items: vids.map(([id, title, ch, dur]) => ({ id, snippet: { title, channelTitle: ch }, contentDetails: { duration: dur }, status: { embeddable: true, privacyStatus: 'public' } })) }) });
  try {
    const m = await ytp.match({ title: 'we fell in love in october', artist: 'girl in red', duration: 184 });
    assert.equal(m.id, 'yt:offic000001');
    assert.equal(await ytp.match({ title: 'a song that is not there', artist: 'nobody', duration: 100 }), null);
  } finally { globalThis.fetch = real; delete process.env.YOUTUBE_API_KEY; }
});
test('YouTube stored data older than 30 days is refreshed, or reduced to the video ID without a key', async () => {
  const old = new Date(Date.now() - 31 * 86400_000).toISOString();
  const t = [{ id: 'yt:abcdefghijk', provider: 'youtube', title: 'T', artwork: 'x', ytFetchedAt: old }];
  assert.deepEqual(await ytp.refreshStored(t, { canRefresh: false }), { refreshed: 0, removed: 0, reduced: 1 });
  assert.equal(t[0].title, 'YouTube video'); assert.equal(t[0].artwork, null);
});

test('energy score leans calmer/upbeat from tempo, loudness and version words', async () => {
  const { energyOf } = await import('../server/recommend.mjs');
  assert.ok(energyOf({ title: 'Song', bpm: 140, gain: -14 }, 110, -10) > 0.5, 'faster and louder is more upbeat');
  assert.ok(energyOf({ title: 'Song (Acoustic)', bpm: 90, gain: -7 }, 110, -10) < -0.5, 'slower, quieter acoustic is calmer');
  assert.equal(energyOf({ title: 'Song' }, null, null), null, 'no data means no claim');
  assert.ok(Math.abs(energyOf({ title: 'Song', bpm: 220 }, 110, null)) < 0.1, 'double-time reading counts as the same feel');
});

test('database backs up before updates and restores instead of starting empty', async () => {
  const { DB } = await import('../server/db.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesper-db-'));
  const file = path.join(dir, 'vesper.json');
  const a = new DB(file); a.data.users.x = { id: 'x', name: 'kept' }; a.save();
  assert.ok(a.backup('before-test'), 'backup works even before the first write reached disk');
  fs.writeFileSync(file, '{ broken');
  const b = new DB(file);
  assert.equal(b.data.users.x?.name, 'kept', 'damaged file is replaced by the newest backup');
});


test('background song preparation keeps matcher versions and release metadata in sync', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const queue = fs.readFileSync(path.join(root, 'public/js/queue.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server/server.mjs'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const changelog = JSON.parse(fs.readFileSync(path.join(root, 'desktop/changelog.json'), 'utf8'));
  assert.match(queue, /const MATCH_V = 5/);
  assert.match(server, /const MATCH_V = 5/);
  assert.match(queue, /resolveTrack\(item\.track, \{ background: true \}\)/);
  assert.match(server, /\/api\/youtube\/prewarm-candidates/);
  assert.match(server, /\/api\/artist-top\/:id/);
  assert.match(server, /query\.first === '1'/);
  assert.match(worker, /vesper-shell-v23/);
  assert.equal(pkg.version, '1.10.0');
  assert.equal(changelog[0].version, pkg.version);
  assert.ok(fs.existsSync(path.join(root, 'VESPER-1.6-UPDATE.md')));
  assert.match(server, /\/api\/radio-stations\/search/);
  assert.match(server, /Radio Browser/);
  assert.match(worker, /\/js\/radio-directory\.js/);
  assert.ok(fs.existsSync(path.join(root, 'VESPER-1.8-UPDATE.md')));
  assert.ok(fs.existsSync(path.join(root, 'VESPER-1.9-UPDATE.md')));
  assert.match(server, /api\/me\/credentials/);
  assert.match(server, /VESPER_OWNER_PASSWORD/);
  assert.match(server, /ownerPassword\.length < 12/);
  assert.match(server, /db\.data\.ownerId === user\.id/);
});
