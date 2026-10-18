// Import a playlist from Spotify (an Exportify CSV), Apple Music (File › Library › Export Playlist
// in the Music app on a Mac) or a pasted list. The file is read here in the browser; each song is
// matched to a Deezer track on the server, then saved as a normal Vesper playlist.
import { api, refreshPlaylists } from './store.js';
import { esc, attr, toast } from './ui.js';

// ---------- parsing ----------
export function decodeFile(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  // Apple's export is UTF-16 even without a BOM sometimes: lots of zero bytes gives it away.
  let zeros = 0; for (let i = 1; i < Math.min(b.length, 400); i += 2) if (b[i] === 0) zeros++;
  if (b.length > 20 && zeros > Math.min(b.length, 400) / 4) return new TextDecoder('utf-16le').decode(b);
  return new TextDecoder('utf-8').decode(b).replace(/^\uFEFF/, '');
}
function parseDelimited(text, delim) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some((x) => x.trim())) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
const COLS = {
  title: ['track name', 'name', 'title', 'song', 'song name', 'track'],
  artist: ['artist name(s)', 'artist name', 'artist', 'artists', 'album artist'],
  album: ['album name', 'album'],
  durationMs: ['duration (ms)', 'duration_ms', 'track duration (ms)'],
  durationS: ['time', 'duration', 'length'],
};
export function parsePlaylist(text) {
  text = String(text || '').trim();
  if (!text) return { items: [], format: null };
  const first = text.split(/\r?\n/, 1)[0];
  const delim = first.includes('\t') ? '\t' : first.includes(',') ? ',' : null;
  if (delim) {
    const rows = parseDelimited(text, delim);
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const find = (names) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
    const ti = find(COLS.title), ai = find(COLS.artist);
    if (ti >= 0) {
      const al = find(COLS.album), dm = find(COLS.durationMs), ds = find(COLS.durationS);
      const items = rows.slice(1).map((r) => {
        let duration = 0;
        if (dm >= 0) duration = Number(r[dm]) / 1000 || 0;
        else if (ds >= 0) { const v = String(r[ds] || ''); duration = v.includes(':') ? v.split(':').reduce((a, x) => a * 60 + Number(x), 0) : Number(v) || 0; }
        return { title: (r[ti] || '').trim(), artist: ai >= 0 ? (r[ai] || '').trim() : '', album: al >= 0 ? (r[al] || '').trim() : '', duration: Math.round(duration) };
      }).filter((x) => x.title);
      return { items, format: delim === '\t' ? 'Apple Music export' : head.includes('track uri') || head.includes('spotify id') || head.includes('artist name(s)') ? 'Spotify (Exportify)' : 'CSV file' };
    }
  }
  // Plain list: "Artist - Title", "Title by Artist", or just titles.
  const items = text.split(/\r?\n/).map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean).map((l) => {
    let m = l.match(/^(.+?)\s+[-–—]\s+(.+)$/); if (m) return { artist: m[1].trim(), title: m[2].trim(), album: '', duration: 0 };
    m = l.match(/^(.+?)\s+by\s+(.+)$/i); if (m) return { title: m[1].trim(), artist: m[2].trim(), album: '', duration: 0 };
    return { title: l, artist: '', album: '', duration: 0 };
  });
  return { items, format: 'List of songs' };
}

// ---------- page ----------
export async function importView(_p, el, app) {
  let parsed = { items: [], format: null }, name = '', busy = false;
  el.innerHTML = `<h1 class="page-title">Import a playlist</h1>
    <p class="lede">Bring a playlist from Spotify or Apple Music. Vesper finds each song in its catalog and makes a playlist you can play here.</p>
    <div class="import-how">
      <details><summary>From Spotify</summary><ol><li>Open <b>exportify.net</b> in a browser and sign in with Spotify.</li><li>Press <b>Export</b> next to the playlist. You get a .csv file.</li><li>Choose that file below.</li></ol><p class="note">Exportify is a free, open-source tool. It only reads your playlists.</p></details>
      <details><summary>From Apple Music</summary><ol><li>On your Mac, open the <b>Music</b> app and select the playlist.</li><li>Choose <b>File › Library › Export Playlist…</b> and save it as a text file.</li><li>Choose that file below.</li></ol><p class="note">Apple Music on iPhone can’t export playlists, so this step needs the Mac.</p></details>
      <details><summary>From a list</summary><p>Paste songs below, one per line, like <i>Artist - Song</i>.</p></details>
    </div>
    <div class="import-box">
      <label class="btn primary import-file">Choose file<input type="file" id="imp-file" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden></label>
      <textarea class="input" id="imp-paste" rows="5" placeholder="Or paste songs here, one per line: Artist - Song"></textarea>
    </div>
    <div id="imp-preview" aria-live="polite"></div>`;
  const preview = el.querySelector('#imp-preview');
  const show = () => {
    if (!parsed.items.length) { preview.innerHTML = parsed.format === null ? '' : '<p class="note">No songs found in that file. Check it’s an Exportify CSV or an Apple Music export.</p>'; return; }
    preview.innerHTML = `<div class="import-ready"><p><b>${parsed.items.length} songs</b> found · ${esc(parsed.format)}</p>
      <label class="field"><span>Playlist name</span><input class="input" id="imp-name" value="${attr(name)}" maxlength="100"></label>
      <ul class="import-sample">${parsed.items.slice(0, 5).map((x) => `<li>${esc(x.title)}${x.artist ? ` <span>${esc(x.artist)}</span>` : ''}</li>`).join('')}${parsed.items.length > 5 ? `<li class="more">and ${parsed.items.length - 5} more</li>` : ''}</ul>
      <button class="btn primary" id="imp-go">Import ${parsed.items.length} songs</button></div>`;
  };
  el.querySelector('#imp-file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 5_000_000) { toast('That file is too large (over 5 MB).', { error: true }); return; }
    parsed = parsePlaylist(decodeFile(await f.arrayBuffer()));
    name = f.name.replace(/\.(csv|txt|tsv)$/i, '').replace(/[_]+/g, ' ').trim() || 'Imported playlist';
    el.querySelector('#imp-paste').value = '';
    show();
  });
  el.querySelector('#imp-paste').addEventListener('input', (e) => { parsed = parsePlaylist(e.target.value); if (!name) name = 'Imported playlist'; show(); });
  preview.addEventListener('input', (e) => { if (e.target.id === 'imp-name') name = e.target.value; });
  preview.addEventListener('click', async (e) => {
    if (!e.target.closest('#imp-go') || busy) return;
    busy = true;
    name = el.querySelector('#imp-name')?.value.trim() || name || 'Imported playlist';
    const items = parsed.items.slice(0, 2000), found = [], missing = [], seen = new Set();
    for (let i = 0; i < items.length; i += 50) {
      preview.innerHTML = `<div class="import-progress"><div class="bar"><span style="width:${Math.round((i / items.length) * 100)}%"></span></div><p>Matching songs… ${i} of ${items.length}</p></div>`;
      try {
        const { results } = await api('/import/match', { method: 'POST', body: { items: items.slice(i, i + 50) } });
        results.forEach((r, k) => { const want = items[i + k]; if (r.track && !seen.has(r.track.id)) { seen.add(r.track.id); found.push(r.track); } else if (!r.track) missing.push(want); });
      } catch (err) { items.slice(i, i + 50).forEach((x) => missing.push(x)); toast(`Some songs couldn’t be matched: ${err.message}`, { error: true }); }
    }
    if (!found.length) { busy = false; preview.innerHTML = '<div class="notice"><b>No songs could be matched.</b> Check your internet connection and try again.</div>'; return; }
    preview.innerHTML = '<div class="import-progress"><p>Saving playlist…</p></div>';
    try {
      const { playlist } = await api('/me/playlists', { method: 'POST', body: { name, description: `Imported from ${parsed.format}` } });
      for (let i = 0; i < found.length; i += 200) await api(`/me/playlists/${encodeURIComponent(playlist.id)}/tracks`, { method: 'POST', body: { tracks: found.slice(i, i + 200) } });
      await refreshPlaylists();
      preview.innerHTML = `<div class="import-done"><h2>Imported ${found.length} of ${items.length} songs</h2>
        <div class="actions"><a class="btn primary" href="#/playlist/${encodeURIComponent(playlist.id)}">Open playlist</a></div>
        ${missing.length ? `<details><summary>${missing.length} songs weren’t found</summary><ul class="import-sample">${missing.slice(0, 200).map((x) => `<li>${esc(x.title)}${x.artist ? ` <span>${esc(x.artist)}</span>` : ''}</li>`).join('')}</ul><p class="note">These may be missing from the catalog, or named differently. You can search for them and add them yourself.</p></details>` : ''}</div>`;
    } catch (err) { preview.innerHTML = `<div class="notice"><b>Couldn’t save the playlist.</b> ${esc(err.message)}</div>`; }
    busy = false;
  });
}
