// Browse-side views.
import { api, store, toggleSaved } from './store.js';
import { collectionCover } from './artwork.js';
import { esc, attr, icon, fmtTime, fmtLong, year, plural, trackList, tile, albumTile, artistTile, section, errorNote, skeletonRows, skeletonShelf, registerList, providerName, toast, coverFallback } from './ui.js';

const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const mixColors = (s) => { const h = hue(s); return [`hsl(${h} 45% 42%)`, `hsl(${(h + 50) % 360} 40% 14%)`]; };
const sessionTile = (s) => tile({ href: `#/session/${s.slug}`, art: null, collage: s.artworkTiles || null, coverKey: `session:${s.slug}`, title: s.title, sub: s.mood, mix: mixColors(s.slug), typeTitle: s.title });
const shelf = (items) => `<div class="shelf">${items.join('')}</div>`;
const grid = (items) => `<div class="grid">${items.join('')}</div>`;
// Keep a bounded, local-only memory of tracks already surfaced by discovery. This is used
// only to diversify future recommendations; it never removes songs from the user's library.
function seenTracks(key) {
  try { const value = JSON.parse(localStorage.getItem(`vesper.seen.${key}`) || '[]'); return Array.isArray(value) ? value.filter((x) => typeof x === 'string').slice(-300) : []; }
  catch { return []; }
}
function rememberTracks(key, tracks) {
  try {
    const ids = [...new Set([...seenTracks(key), ...(tracks || []).map((t) => t?.id).filter(Boolean).map(String)])].slice(-300);
    localStorage.setItem(`vesper.seen.${key}`, JSON.stringify(ids));
  } catch { /* Private browsing/storage restrictions should not break discovery. */ }
}
const discoveryKey = (seed, mode) => `discover.${encodeURIComponent(seed?.id || 'none')}.${encodeURIComponent(mode || 'same')}`;
const moodKey = (mood) => `mood.${encodeURIComponent(String(mood || '').trim().toLowerCase().replace(/\s+/g, ' '))}`;
function trackTiles(tracks, ctx) {
  const id = registerList(tracks, ctx);
  return shelf(tracks.map((t, i) => `<div class="tile" data-list="${id}" data-idx="${i}"><div class="tile-art"><img src="${attr(t.albumArtwork || t.artworkSmall || t.artwork || coverFallback(t))}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${coverFallback(t)}'"><button class="tile-play" data-act="play-row" aria-label="Play ${attr(t.title)}">${icon('play')}</button></div><div class="tile-title">${esc(t.title)}</div><div class="tile-sub">${esc(t.artist)}</div></div>`));
}
async function guarded(el, fn) { try { await fn(); } catch (e) { if (e.name !== 'AbortError') el.innerHTML += errorNote(e.message); } }

// ---------- Home ----------
export async function home(_p, el, app) {
  const h = new Date().getHours();
  const greet = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  el.innerHTML = `<h1 class="greeting">${greet}, ${esc(store.user.displayName)}</h1>${skeletonShelf()}${skeletonRows(4)}`;
  const d = await api('/home');
  let out = `<h1 class="greeting">${greet}, ${esc(d.name)}</h1>`;
  out += section('Mood-to-Mix', `<form id="mood-mix-form" class="mood-mix-form"><label for="mood-mix-input">What do you want your music to feel like?</label><div class="mood-mix-entry"><input id="mood-mix-input" class="input" maxlength="120" placeholder="e.g. dreamy late-night R&B, confident, nostalgic…" autocomplete="off"><button class="btn primary" type="submit">Make my mix ${icon('blend')}</button></div><div class="mood-mix-presets">${['late-night R&B','dreamy indie','hype workout','nostalgic','calm focus','happy upbeat'].map((m) => `<button type="button" class="chip" data-mood-preset="${attr(m)}">${esc(m)}</button>`).join('')}</div><div class="mood-controls"><label>Familiar <input type="range" id="mood-familiar" min="0" max="100" value="50" aria-label="Familiar songs versus new discoveries"> New</label><label>Lower energy <input type="range" id="mood-energy" min="0" max="100" value="50" aria-label="Energy"> Higher</label><label class="mood-auto"><input type="checkbox" id="mood-energy-auto" checked> Energy from my words</label></div></form><div id="mood-mix-result" aria-live="polite"></div>`);
  if (!d.hasHistory) out += `<div class="empty" style="padding-top:0"><h2>Start with a song you love</h2><p>Search for any song and play it. Vesper uses what you play, like and skip to build your mixes, and nothing else.</p><div class="actions"><a class="btn primary" href="#/search">Search music</a><a class="btn ghost" href="#/discover">Find music like a song</a></div><p class="note">No internet connection, or just want to check the player? Search for “test signal”.</p></div>`;
  if (d.recent.length) out += section('Recently played', trackTiles(d.recent, { name: 'Recently played' }));
  out += '<div id="home-rec-songs"></div>';
  if (d.mixes.length) out += section(`Made for ${d.name}`, shelf(d.mixes.map((m) => tile({ href: `#/mix/${m.kind}`, art: null, collage: m.artworkTiles || null, coverKey: `mix:${m.kind}`, title: m.title, sub: m.subtitle, mix: mixColors(m.kind + d.name), typeTitle: m.title }))));
  out += section('Trending worldwide', d.trending.error ? errorNote(`Couldn’t load the chart: ${d.trending.error}`) : trackList(d.trending.items.slice(0, 6), { name: 'Worldwide Top 50', href: '#/charts/global-top' }, { rank: true }) + '<p class="source-note">Deezer worldwide chart.</p>', '<a href="#/charts/global-top">See the chart</a>');
  out += '<div id="home-your-releases"></div><div id="home-rec-albums"></div>';
  if (d.newReleases.items.length) out += section('New releases', shelf(d.newReleases.items.map(albumTile)), '<a href="#/charts/new-releases">See all</a>');
  else if (d.newReleases.error) out += section('New releases', errorNote(d.newReleases.error));
  if (d.favoriteArtists.items.length) out += section('Your favourite artists', shelf(d.favoriteArtists.items.map(artistTile)));
  out += section('Listening sessions', shelf(d.sessions.map(sessionTile)), '<a href="#/discover">More moods</a>');
  el.innerHTML = out;
  // Prime the first song from each Home mix after the page is visible. These catalog calls are
  // sequential and only the first track per mix enters the slow YouTube preparation queue.
  setTimeout(async () => {
    for (const mix of (d.mixes || [])) {
      if (!el.isConnected) return;
      try {
        const result = await api(`/mix/${encodeURIComponent(mix.kind)}?first=1`);
        if (result.tracks?.[0]) app.queue.prewarmTracks([result.tracks[0]]);
      } catch { /* unavailable mix; normal Home remains usable */ }
    }
  }, 900);
  api('/following').then((f) => {
    const box = el.querySelector('#home-your-releases'); if (!box || !f.releases?.length) return;
    const seen = new Set(); const rel = f.releases.filter((a) => { const k = `${(a.title || '').toLowerCase()}|${(a.artist || '').toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 14);
    box.innerHTML = section('New from your artists', shelf(rel.map(albumTile)) + '<p class="source-note">Releases from the last 6 months by artists you follow, from Deezer.</p>', '<a href="#/following">See all</a>');
  }).catch(() => {});
  const moodForm = el.querySelector('#mood-mix-form');
  const moodInput = el.querySelector('#mood-mix-input');
  const moodResult = el.querySelector('#mood-mix-result');
  moodForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const mood = moodInput.value.trim();
    if (mood.length < 2) { moodInput.focus(); return; }
    const submit = moodForm.querySelector('button[type="submit"]');
    submit.disabled = true; submit.textContent = 'Building your mix…';
    // Keep the last successful mix visible while a refresh is running, and bound slow provider calls.
    const previousMarkup = moodResult.innerHTML;
    moodResult.innerHTML = `<div class="mood-mix-loading" role="status">Finding songs for <b>${esc(mood)}</b>…</div>${previousMarkup}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const slowHint = setTimeout(() => {
      const loading = moodResult.querySelector('.mood-mix-loading');
      if (loading) loading.insertAdjacentHTML('beforeend', '<p class="source-note">Still searching the music catalog — this can take a little while.</p>');
    }, 12_000);
    try {
      const mix = await api('/mood-mix', { method: 'POST', signal: controller.signal, body: { mood, familiar: Number(el.querySelector('#mood-familiar')?.value ?? 50) / 100, energy: el.querySelector('#mood-energy-auto')?.checked ? undefined : Number(el.querySelector('#mood-energy')?.value ?? 50) / 100, refresh: moodForm.dataset.refresh === '1', seen: seenTracks(moodKey(mood)) } });
      delete moodForm.dataset.refresh;
      if (!el.isConnected) return;
      rememberTracks(moodKey(mood), mix.tracks);
      moodResult.innerHTML = section(mix.title, `<div class="mood-mix-head"><div class="mood-mix-cover">${collectionCover({ tiles: mix.artworkTiles || mix.tracks.map((t) => t.albumArtwork || t.artwork), title: mix.title })}</div><div><div class="chips" style="margin:0 0 10px">${[mix.intent?.genre, ...(mix.intent?.moods || []), mix.intent?.energy ? `${mix.intent.energy} energy` : null].filter(Boolean).map((x) => `<span class="chip" style="display:inline-flex;align-items:center">${esc(x)}</span>`).join('')}</div><div class="actions" style="margin:0"><button class="btn primary" data-mood-play>${icon('play')} Play this mix</button><button class="btn ghost" data-mood-refresh>Refresh mix</button><button class="btn ghost" data-mood-save>Save as playlist</button></div></div></div>${trackList(mix.tracks, { name: mix.title, href: '#/' })}<p class="source-note">${esc(mix.note || 'Built from songs and related-artist recommendations.')}</p>`);
      moodResult.querySelector('[data-mood-play]')?.addEventListener('click', () => app.queue.playList(mix.tracks, 0, { name: mix.title, href: '#/' }));
      moodResult.querySelector('[data-mood-refresh]')?.addEventListener('click', () => { moodForm.dataset.refresh = '1'; moodForm.requestSubmit(); });
      moodResult.querySelector('[data-mood-save]')?.addEventListener('click', () => app.actions.saveAsPlaylist(mix.title, mix.tracks));
    } catch (err) {
      if (el.isConnected) {
        const message = err.name === 'AbortError' ? 'Mood-to-Mix took too long to respond. Your previous mix is still here — try again in a moment.' : (err.message || 'Could not build that mix. Try a different mood.');
        moodResult.innerHTML = `${previousMarkup}${errorNote(message)}`;
      }
    } finally {
      clearTimeout(timeout); clearTimeout(slowHint);
      if (el.isConnected && submit.isConnected) { submit.disabled = false; submit.innerHTML = `Make my mix ${icon('blend')}`; }
    }
  });
  moodForm?.querySelectorAll('[data-mood-preset]').forEach((button) => button.addEventListener('click', () => { moodInput.value = button.dataset.moodPreset; moodInput.focus(); }));
  // Build a real recommendation shelf from listening history; use the chart as a transparent starter fallback for new listeners.
  const recBox = el.querySelector('#home-rec-songs');
  if (recBox) {
    const recentSeeds = (d.recent || []).filter((t) => t.provider !== 'test').slice(0, 3);
    if (recentSeeds.length) {
      recBox.innerHTML = section('Recommended songs for you', '<p class="source-note">Picked from songs you have played, plus your recommendation feedback.</p>' + skeletonRows(5));
      api('/recs', { method: 'POST', body: { seeds: recentSeeds, mode: 'same', limit: 8, exclude: recentSeeds.map((t) => t.id) } }).then((r) => {
        const box = el.querySelector('#home-rec-songs'); if (!box) return;
        const tracks = (r.tracks || []).filter((t) => !recentSeeds.some((seed) => seed.id === t.id)).slice(0, 8);
        box.innerHTML = tracks.length ? section('Recommended songs for you', trackList(tracks, { name: 'Recommended for you' }) + '<p class="source-note">Based on your listening and feedback. Recommendations can change as you play, like and skip songs.</p>', '<a href="#/discover">Tune your mix</a>') : section('Recommended songs for you', trackList(d.trending.items.slice(0, 8), { name: 'Starter recommendations' }) + '<p class="source-note">Popular picks while Vesper learns your taste.</p>');
      }).catch(() => { const box = el.querySelector('#home-rec-songs'); if (box) box.innerHTML = section('Recommended songs to try', trackList(d.trending.items.slice(0, 8), { name: 'Starter recommendations' }) + '<p class="source-note">Popular picks while personalized recommendations are unavailable.</p>'); });
    } else if (d.favoriteArtists.items.length) {
      recBox.innerHTML = section('Recommended songs for you', '<p class="source-note">Picked from artists you follow. Play, like and skip tracks to tune future mixes.</p>' + skeletonRows(5));
      api('/mix/daily-0').then((mix) => {
        const box = el.querySelector('#home-rec-songs'); if (!box) return;
        const tracks = (mix.tracks || []).slice(0, 8);
        box.innerHTML = tracks.length ? section('Recommended songs for you', trackList(tracks, { name: 'Recommended from followed artists' }) + '<p class="source-note">Based on the artists you chose when creating your account.</p>', '<a href="#/discover">Tune your mix</a>') : section('Recommended songs to try', trackList(d.trending.items.slice(0, 8), { name: 'Starter recommendations' }));
      }).catch(() => { const box = el.querySelector('#home-rec-songs'); if (box) box.innerHTML = section('Recommended songs to try', trackList(d.trending.items.slice(0, 8), { name: 'Starter recommendations' }) + '<p class="source-note">Popular picks while Vesper builds your first mix.</p>'); });
    } else {
      recBox.innerHTML = section('Recommended songs to try', trackList(d.trending.items.slice(0, 8), { name: 'Starter recommendations' }) + '<p class="source-note">Popular picks to get started. After you play a few songs, this becomes more personalized.</p>');
    }
  }
  const dailyMixes = d.mixes.filter((m) => m.kind.startsWith('daily-')).slice(0, 4);
  if (dailyMixes.length) {
    Promise.all(dailyMixes.map(async (mix) => {
      try {
        const result = await api(`/mix/${encodeURIComponent(mix.kind)}`);
        const covers = [...new Set((result.tracks || []).map((t) => t.albumArtwork || t.artworkSmall || t.artwork).filter(Boolean))].slice(0, 4);
        const anchor = el.querySelector(`a[href="#/mix/${mix.kind}"] .tile-art`);
        /* covers come from the shared artwork renderer */
        return result;
      } catch { return null; }
    })).then((results) => {
      const first = results.find(Boolean);
      if (!first) return;
      const seen = new Map();
      for (const t of first.tracks || []) if (t.albumId?.startsWith('dz:') && t.album && !seen.has(t.albumId)) seen.set(t.albumId, { id: t.albumId, title: t.album, artist: t.artist, artwork: t.albumArtwork || t.artworkSmall || t.artwork });
      const box = el.querySelector('#home-rec-albums');
      if (box && seen.size > 2) box.innerHTML = section('Recommended albums', shelf([...seen.values()].slice(0, 10).map(albumTile)));
    });
  }
}

// ---------- Search ----------
export async function search(p, el, app) {
  const q0 = p.q || '';
  const src0 = p.source || 'all';
  el.innerHTML = `<h1 class="page-title">Search</h1>
    <div class="searchbar" role="combobox" aria-expanded="false" aria-haspopup="listbox">${icon('search')}
      <input class="input" id="q" type="search" placeholder="Songs, artists, albums" value="${attr(q0)}" autocomplete="off" aria-label="Search music" aria-controls="suggest">
      <div class="suggest" id="suggest" role="listbox" hidden></div></div>
    <div class="chips" id="sources">${[['all', 'All sources'], ['lyrics', 'Lyrics'], ['youtube', 'YouTube'], ['deezer', 'Deezer'], ['itunes', 'Apple'], ['jamendo', 'Jamendo'], ['local', 'My files'], ['test', 'Test signals']].map(([k, l]) => `<button class="chip" data-src="${k}" aria-pressed="${k === src0}">${l}</button>`).join('')}</div>
    <div id="results"></div>`;
  const input = el.querySelector('#q'), sug = el.querySelector('#suggest'), res = el.querySelector('#results');
  let source = src0, ctl = null, sugCtl = null, timer = 0, sel = -1, items = [], ydCache = [], qLast = q0;
  const setHash = (q) => history.replaceState(null, '', `#/search${q ? `?q=${encodeURIComponent(q)}${source !== 'all' ? `&source=${source}` : ''}` : ''}`);
  async function run(q, record = false) {
    setHash(q); qLast = q;
    if (!q.trim()) return browse();
    ctl?.abort(); ctl = new AbortController();
    res.innerHTML = skeletonRows(6);
    try {
      if (source === 'lyrics') {
        if (!record) { res.innerHTML = `<div class="actions"><button class="btn primary" data-lyrics-search>Find songs with these lyrics</button></div><p class="note">Type a line you remember, then press Search or this button.</p>`; return; }
        const ld = await api(`/lyrics-search?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        res.innerHTML = ld.tracks.length ? section('Songs with these lyrics', trackList(ld.tracks, { name: `Lyrics: ${q}` }) + '<p class="source-note">Lyrics search uses LRCLIB, a community lyrics library.</p>') : `<div class="empty"><h2>No songs found</h2><p>${esc(ld.note || 'Try a different line, or fewer words.')}</p></div>`;
        return;
      }
      if (source === 'youtube') {
        const cfg = await api('/youtube/config');
        const paste = '<form id="yt-paste" class="actions"><input class="input" name="url" placeholder="Paste a YouTube link" style="max-width:420px;height:40px" aria-label="YouTube link"><button class="btn ghost">Play link</button></form>';
        const terms = '<p class="source-note">Full-length audio plays in Vesper’s normal player. Search uses yt-dlp on this Mac; install it with <code>brew install yt-dlp</code> or update it with <code>brew upgrade yt-dlp</code>. Use content you are authorized to access and respect YouTube’s terms.</p>';
        if (!cfg.configured) { res.innerHTML = `<div class="notice"><b>YouTube search isn’t available.</b> ${esc(cfg.setup || 'Install yt-dlp with brew install yt-dlp, then restart Vesper.')}</div>${paste}${terms}`; return; }
        if (!record) { res.innerHTML = `<div class="actions"><button class="btn primary" data-yt-search>Search YouTube for “${esc(q)}”</button></div><p class="note">Vesper searches YouTube when you press this button.</p>${paste}${terms}`; return; }
        const yd = await api(`/youtube/search?q=${encodeURIComponent(q)}&record=1`, { signal: ctl.signal });
        res.innerHTML = yd.tracks.length ? section('YouTube videos', trackList(yd.tracks, { name: `YouTube: ${q}` }) + `<p class="source-note">${yd.hidden ? `Hid ${yd.hidden} likely fake or re-uploaded version${yd.hidden === 1 ? '' : 's'}. ` : ''}Official uploads are listed first.</p>`) + paste + terms : `<div class="empty"><h2>No YouTube videos for “${esc(q)}”</h2><p>Only videos their owners allow to play outside YouTube are shown.</p></div>${paste}`;
        return;
      }
      const d = await api(`/search?q=${encodeURIComponent(q)}&source=${source}${record ? '&record=1' : ''}`, { signal: ctl.signal });
      const errs = [...new Map(d.errors.map((e) => [e.provider, e])).values()];
      let out = errs.map((e) => errorNote(`${e.provider}: ${e.message}`)).join('');
      if (!d.tracks.length && !d.artists.length && !d.albums.length) out += `<div class="empty"><h2>No results for “${esc(q)}”</h2><p>${errs.length ? 'Some sources couldn’t be reached, so results may be missing.' : 'Check the spelling, or try fewer words.'}</p></div>`;
      if (d.tracks.length) out += section('Songs', trackList(d.tracks.slice(0, 20), { name: `Search: ${q}` }, { showSource: true }) + `<p class="source-note">Vesper tries to find a full-length playable version when a catalog result is only metadata or a short clip.</p>`);
      if (d.artists.length) out += section('Artists', shelf(d.artists.map(artistTile)));
      if (d.albums.length) out += section('Albums', shelf(d.albums.map(albumTile)));
      if (d.playlists.length) out += section('Playlists', shelf(d.playlists.map((pl) => tile({ href: `#/dzplaylist/${encodeURIComponent(pl.id)}`, art: pl.artwork, title: pl.title, sub: `By ${pl.creator}` }))));
      res.innerHTML = out;
      // Only warm the top five after an explicit search submit, not on every keystroke.
      // YouTube search results selected directly by the listener bypass this catalog matcher.
      if ((record || q === q0) && source !== 'youtube' && source !== 'lyrics') app.queue.prewarmTracks((d.tracks || []).slice(0, 5), { priority: true });
      if (record && source === 'all' && q.trim().split(/\s+/).length >= 4) {
        const sig = ctl.signal;
        api(`/lyrics-search?q=${encodeURIComponent(q)}`, { signal: sig }).then((ld) => {
          if (sig.aborted || !ld.tracks?.length) return;
          res.insertAdjacentHTML(d.tracks.length ? 'afterbegin' : 'beforeend', section('Songs with these lyrics', trackList(ld.tracks.slice(0, 5), { name: `Lyrics: ${q}` })));
          if (!d.tracks.length) res.querySelector('.empty')?.remove();
        }).catch(() => {});
      }
    } catch (e) { if (e.name !== 'AbortError') res.innerHTML = errorNote(e.message); }
  }
  async function browse() {
    let out = '';
    try {
      const { searches } = await api('/me/searches');
      if (searches.length) out += section('Recent searches', `<div class="chips">${searches.map((s) => `<button class="chip" data-recent="${attr(s)}">${esc(s)}</button>`).join('')}</div>`, '<button data-clear-searches>Clear</button>');
    } catch { /* ignore */ }
    const { sessions } = await api('/sessions');
    out += section('Charts', `<div class="chips">${[['us-top', 'United States Top 50'], ['global-top', 'Worldwide Top 50'], ['top-albums', 'Top albums'], ['top-artists', 'Top artists'], ['new-releases', 'New releases']].map(([k, l]) => `<a class="chip" style="display:inline-flex;align-items:center" href="#/charts/${k}">${l}</a>`).join('')}</div>`);
    out += section('Moods and sessions', shelf(sessions.map(sessionTile)));
    out += '<div id="genre-radios"></div>';
    res.innerHTML = out;
    api('/genre-radios').then((r) => { const b = res.querySelector('#genre-radios'); if (b) b.innerHTML = section('Genre mixes', shelf(r.radios.slice(0, 24).map((x) => tile({ href: `#/radio/${encodeURIComponent(x.id)}?title=${encodeURIComponent(x.title)}`, art: x.artwork, title: x.title, sub: `${x.genre} radio by Deezer` })))); }).catch((e) => { const b = res.querySelector('#genre-radios'); if (b) b.innerHTML = section('Genre mixes', errorNote(`Couldn’t load genre mixes: ${e.message}`)); });
  }
  function showSug(list) {
    items = list; sel = -1;
    sug.hidden = !list.length; el.querySelector('.searchbar').setAttribute('aria-expanded', String(!!list.length));
    sug.innerHTML = list.map((s, i) => `<button role="option" id="sg${i}" data-i="${i}" aria-selected="false"><img src="${attr(s.artwork || coverFallback({ title: s.text }))}" alt="" loading="lazy"><span>${esc(s.text)}</span><span class="kind">${s.kind === 'artist' ? 'Artist' : 'Song'}</span></button>`).join('');
  }
  function choose(s) {
    sug.hidden = true;
    if (s.kind === 'artist') { location.hash = `#/artist/${encodeURIComponent(s.id)}`; return; }
    input.value = s.query; run(s.query, true);
  }
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value;
    timer = setTimeout(async () => {
      run(q);
      if (q.trim().length >= 2) { sugCtl?.abort(); sugCtl = new AbortController(); try { const r = await api(`/suggest?q=${encodeURIComponent(q)}`, { signal: sugCtl.signal }); if (document.activeElement === input) showSug(r.suggestions); } catch { /* ignore */ } } else showSug([]);
    }, 320);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!items.length) return; e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; sug.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String(i === sel))); input.setAttribute('aria-activedescendant', `sg${sel}`); }
    else if (e.key === 'Enter') { e.preventDefault(); if (sel >= 0 && items[sel]) choose(items[sel]); else { sug.hidden = true; clearTimeout(timer); run(input.value, true); } }
    else if (e.key === 'Escape') { sug.hidden = true; }
  });
  input.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 150));
  sug.addEventListener('mousedown', (e) => { const b = e.target.closest('button[data-i]'); if (b) { e.preventDefault(); choose(items[Number(b.dataset.i)]); } });
  el.querySelector('#sources').addEventListener('click', (e) => { const b = e.target.closest('[data-src]'); if (!b) return; source = b.dataset.src; input.placeholder = source === 'lyrics' ? 'Type a line from the song' : 'Songs, artists, albums'; el.querySelectorAll('[data-src]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); run(input.value); });
  res.addEventListener('submit', async (e) => {
    if (e.target.id !== 'yt-paste') return; e.preventDefault();
    try { const { track } = await api(`/youtube/resolve?url=${encodeURIComponent(new FormData(e.target).get('url'))}`); app.queue.playOne(track, { name: 'YouTube link' }); }
    catch (err) { toast(err.message, { error: true }); }
  });
  res.addEventListener('click', async (e) => {
    if (e.target.closest('[data-yt-search]') || e.target.closest('[data-lyrics-search]')) { run(input.value, true); return; }
    const r = e.target.closest('[data-recent]'); if (r) { input.value = r.dataset.recent; run(r.dataset.recent, true); }
    if (e.target.closest('[data-clear-searches]')) { await api('/me/searches', { method: 'DELETE' }); browse(); }
  });
  if (q0) run(q0); else browse();
  if (!p.q) input.focus();
}

// ---------- Discover ----------
const MODES = [['same', 'Keep the same vibe'], ['calmer', 'Make it calmer'], ['upbeat', 'Make it more upbeat'], ['explore', 'Explore something new'], ['hidden', 'Hidden gems']];
export async function discover(_p, el, app) {
  let seed = JSON.parse(sessionStorage.getItem('vesper.seed') || 'null');
  let mode = sessionStorage.getItem('vesper.seedMode') || 'same';
  const cur = app.engine.state.track;
  el.innerHTML = `<h1 class="page-title">Discover</h1><p class="lede">Start from one song and get a session that matches it. Recommendations come from Deezer’s related-artist graph and artist radio, Deezer tempo data where it exists, and what you like and skip.</p>
    <div class="searchbar"><input class="input" id="seed-q" type="search" placeholder="Start from a song, e.g. We Fell in Love in October" aria-label="Find a song to start from" style="padding-left:20px"></div>
    <div class="actions" style="margin-top:-6px">${cur && cur.provider !== 'test' ? `<button class="btn sm ghost" id="use-current">Use what’s playing: ${esc(cur.title)}</button>` : ''}</div>
    <div id="seed-results"></div><div id="recs"></div><div id="moods"></div><div id="radios"></div>`;
  const recs = el.querySelector('#recs');
  async function load() {
    if (!seed) { recs.innerHTML = ''; return; }
    sessionStorage.setItem('vesper.seed', JSON.stringify(seed)); sessionStorage.setItem('vesper.seedMode', mode);
    recs.innerHTML = `${section(`Because you chose ${seed.title}`, `<div class="chips" role="group" aria-label="Adjust recommendations">${MODES.map(([k, l]) => `<button class="chip" data-mode="${k}" aria-pressed="${k === mode}">${l}</button>`).join('')}<button class="chip" data-refresh>Refresh</button></div>${skeletonRows(8)}`)}`;
    try {
      const key = discoveryKey(seed, mode);
      const r = await api('/recs', { method: 'POST', body: { seeds: [seed], mode, limit: 30, seen: seenTracks(key) } });
      rememberTracks(key, r.tracks);
      const body = `<div class="chips" role="group" aria-label="Adjust recommendations">${MODES.map(([k, l]) => `<button class="chip" data-mode="${k}" aria-pressed="${k === mode}">${l}</button>`).join('')}<button class="chip" data-refresh>Refresh</button></div>
        ${r.note ? `<div class="notice">${esc(r.note)}</div>` : ''}
        <div class="actions"><button class="btn primary" data-play-recs>${icon('play')} Play session</button><button class="btn ghost" data-save-recs>Save as playlist</button></div>
        ${trackList(r.tracks, { name: `Like ${seed.title}`, href: '#/discover' })}
        <p class="source-note">${r.tempoUsed ? `Tempo of the starting song: ${Math.round(r.seedBpm)} BPM (Deezer). ` : 'Deezer has no tempo for this song, so tempo isn’t used. '}Use “More like this”, “Less like this” and “Don’t recommend this artist” in any song’s menu to steer future picks. Vocal/instrumental filters aren’t offered because these sources don’t provide that data.</p>`;
      recs.innerHTML = section(`Because you chose ${seed.title}`, body);
      recs.querySelector('[data-play-recs]').onclick = () => app.queue.playList([seed, ...r.tracks], 0, { name: `Like ${seed.title}`, href: '#/discover' });
      recs.querySelector('[data-save-recs]').onclick = () => app.actions.saveAsPlaylist(`Like ${seed.title}`, [seed, ...r.tracks]);
    } catch (e) { recs.innerHTML = section('Recommendations', errorNote(e.message)); }
  }
  recs.addEventListener('click', (e) => { const m = e.target.closest('[data-mode]'); if (m) { mode = m.dataset.mode; load(); } if (e.target.closest('[data-refresh]')) load(); });
  el.querySelector('#use-current')?.addEventListener('click', () => { seed = app.engine.state.track; load(); });
  const sq = el.querySelector('#seed-q'), sr = el.querySelector('#seed-results'); let t = 0, list = [];
  sq.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
    if (sq.value.trim().length < 2) { sr.innerHTML = ''; return; }
    try { const d = await api(`/search?q=${encodeURIComponent(sq.value)}&source=deezer`); list = d.tracks.slice(0, 5);
      sr.innerHTML = `<div class="rows">${list.map((x, i) => `<div class="row" style="grid-template-columns:44px 1fr auto"><img class="r-art" src="${attr(x.artworkSmall || '')}" alt=""><div class="r-meta"><span class="r-title">${esc(x.title)}</span><span class="r-sub">${esc(x.artist)}</span></div><button class="btn sm" data-seed="${i}">Start here</button></div>`).join('')}</div>${d.errors.length ? errorNote(d.errors[0].message) : ''}`;
    } catch (e) { sr.innerHTML = errorNote(e.message); }
  }, 350); });
  sr.addEventListener('click', (e) => { const b = e.target.closest('[data-seed]'); if (b) { seed = list[Number(b.dataset.seed)]; sr.innerHTML = ''; sq.value = ''; load(); } });
  load();
  const { sessions } = await api('/sessions');
  el.querySelector('#moods').innerHTML = section('Moods', shelf(sessions.filter((s) => s.mix).map(sessionTile))) + section('Listening sessions', shelf(sessions.filter((s) => !s.mix).map(sessionTile))) + '<p class="source-note">Moods and sessions play real Deezer playlists matched to each theme. The source playlist is shown on each page.</p>';
  api('/genre-radios').then((r) => { el.querySelector('#radios').innerHTML = section('Genre mixes', shelf(r.radios.slice(0, 30).map((x) => tile({ href: `#/radio/${encodeURIComponent(x.id)}?title=${encodeURIComponent(x.title)}`, art: x.artwork, title: x.title, sub: `${x.genre} radio by Deezer` })))); }).catch(() => {});
}

// ---------- Charts ----------
export async function charts(p, el, app) {
  const { charts } = await api('/charts');
  const id = p.id || 'us-top';
  const main = charts.filter((c) => !c.genre), genres = charts.filter((c) => c.genre);
  el.innerHTML = `<h1 class="page-title">Charts</h1>
    <div class="chips">${main.map((c) => `<a class="chip" style="display:inline-flex;align-items:center" href="#/charts/${c.id}" aria-pressed="${c.id === id}">${esc(c.title)}</a>`).join('')}</div>
    <div class="chips" aria-label="Genre charts"><span class="note" style="align-self:center;margin-right:4px">Genres</span>${genres.map((c) => `<a class="chip" style="display:inline-flex;align-items:center" href="#/charts/${c.id}" aria-pressed="${c.id === id}">${esc(c.title)}</a>`).join('')}</div>
    <div id="chart">${skeletonRows(10)}</div>`;
  const box = el.querySelector('#chart');
  try {
    const d = await api(`/charts/${id}`);
    const c = d.chart;
    const when = d.updated ? `Updated ${new Date(d.updated).toLocaleString()}` : `Fetched ${new Date(d.fetchedAt).toLocaleString()}`;
    let out = `<div class="section-head" style="margin-top:8px"><h2 style="font-size:28px">${esc(c.title)}</h2></div><p class="note">Source: ${esc(c.source)}. ${esc(when)}.${d.comparedTo ? ` Movement compared with this app’s snapshot from ${esc(d.comparedTo)}.` : c.kind === 'tracks' && c.id !== 'rising' ? ' Movement appears once this app has a snapshot from an earlier day.' : ''}</p>`;
    if (d.message) out += `<div class="notice">${esc(d.message)}</div>`;
    if (c.kind === 'tracks' && d.items.length) {
      out += `<div class="actions"><button class="btn primary" data-play-chart>${icon('play')} Play</button><button class="btn ghost" data-shuffle-chart>${icon('shuffle')} Shuffle</button></div>`;
      out += trackList(d.items, { name: c.title, href: `#/charts/${c.id}` }, { rank: true, movement: true });
    } else if (c.kind === 'albums') out += grid(d.items.map(albumTile));
    else if (c.kind === 'artists') out += grid(d.items.map(artistTile));
    box.innerHTML = out;
    box.querySelector('[data-play-chart]')?.addEventListener('click', () => app.queue.playList(d.items, 0, { name: c.title, href: `#/charts/${c.id}` }));
    box.querySelector('[data-shuffle-chart]')?.addEventListener('click', () => { if (!app.queue.shuffle) app.queue.toggleShuffle(); app.queue.playList(d.items, Math.floor(Math.random() * d.items.length), { name: c.title }); });
  } catch (e) { box.innerHTML = errorNote(`Couldn’t load this chart: ${e.message}`); }
}

// ---------- Artist ----------
export async function artist(p, el, app) {
  el.innerHTML = skeletonShelf(1) + skeletonRows(6);
  const d = await api(`/artist/${encodeURIComponent(p.id)}`);
  if (d.redirect) { location.replace(`#/artist/${encodeURIComponent(d.redirect)}`); return; }
  const a = d.artist, following = store.lib.artists.has(a.id);
  const all = [...(d.albums || []), ...(d.eps || []), ...(d.singles || [])].sort((x, y) => (y.releaseDate || '').localeCompare(x.releaseDate || ''));
  const latest = all[0];
  let out = `<div class="hero round"><img class="hero-art" src="${attr(a.artwork || '')}" alt=""><div><div class="kind">Artist</div><h1>${esc(a.name)}</h1><div class="meta">${a.fans ? `<span>${a.fans.toLocaleString()} fans on Deezer</span>` : ''}${a.albumCount ? `<span>${plural(a.albumCount, 'release')}</span>` : ''}</div></div></div>
    <div class="actions"><button class="btn primary" data-act="play-artist">${icon('play')} Play</button><button class="btn ghost" data-act="shuffle-artist">${icon('shuffle')} Shuffle</button>${a.id.startsWith('dz:') ? `<a class="btn ghost" href="#/radio/${encodeURIComponent(a.id)}">${icon('radio')} Artist radio</a>` : ''}<button class="btn ghost" data-act="follow" aria-pressed="${following}">${following ? 'Following' : 'Follow'}</button></div>`;
  if (latest) out += section('Latest release', `<div style="max-width:200px">${albumTile(latest)}</div>`);
  out += section('Popular', trackList(d.top, { name: a.name, href: `#/artist/${encodeURIComponent(a.id)}` }, { hideAlbum: false }));
  if (d.albums?.length) out += section('Albums', shelf(d.albums.map(albumTile)));
  if (d.eps?.length) out += section('EPs', shelf(d.eps.map(albumTile)));
  if (d.singles?.length) out += section('Singles', shelf(d.singles.map(albumTile)));
  if (d.related?.length) out += section('Related artists', shelf(d.related.map(artistTile)));
  out += `<p class="source-note">Artist data from ${esc(providerName(d.provider))}. Biographies and concert dates aren’t available from this source.</p>`;
  el.innerHTML = out;
  el.querySelector('[data-act="play-artist"]').onclick = () => app.queue.playList(d.top, 0, { name: a.name, href: location.hash });
  el.querySelector('[data-act="shuffle-artist"]').onclick = () => { if (!app.queue.shuffle) app.queue.toggleShuffle(); app.queue.playList(d.top, Math.floor(Math.random() * d.top.length), { name: a.name, href: location.hash }); };
  el.querySelector('[data-act="follow"]').onclick = async (e) => { const button = e.currentTarget; const wasFollowing = store.lib.artists.has(a.id); const next = !wasFollowing; button.textContent = next ? 'Following' : 'Follow'; button.setAttribute('aria-pressed', String(next)); button.disabled = true; try { const on = await toggleSaved('artists', a); button.textContent = on ? 'Following' : 'Follow'; button.setAttribute('aria-pressed', String(on)); toast(on ? `Following ${a.name}` : `Unfollowed ${a.name}`); } catch (err) { button.textContent = wasFollowing ? 'Following' : 'Follow'; button.setAttribute('aria-pressed', String(wasFollowing)); toast(`Couldn’t update follow: ${err.message}`); } finally { button.disabled = false; } };
}
export async function artistByName(p) { const r = await api(`/artist-by-name?name=${encodeURIComponent(p.name)}`); location.replace(`#/artist/${encodeURIComponent(r.redirect)}`); }

// ---------- Album ----------
export async function album(p, el, app) {
  el.innerHTML = skeletonShelf(1) + skeletonRows(8);
  const d = await api(`/album/${encodeURIComponent(p.id)}`);
  if (d.redirect) { location.replace(`#/album/${encodeURIComponent(d.redirect)}`); return; }
  const a = d.album, saved = store.lib.albums.has(a.id);
  const total = d.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  let out = `<div class="hero"><img class="hero-art" src="${attr(a.artwork || '')}" alt=""><div><div class="kind">${esc({ album: 'Album', ep: 'EP', single: 'Single', compile: 'Compilation' }[a.recordType] || 'Album')}</div><h1>${esc(a.title)}</h1><div class="meta">${a.artistId ? `<a href="#/artist/${encodeURIComponent(a.artistId)}"><b>${esc(a.artist)}</b></a>` : esc(a.artist)}${a.releaseDate ? `<span>${esc(new Date(a.releaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))}</span>` : ''}<span>${plural(d.tracks.length, 'song')}, ${fmtLong(total * 1000)}</span></div></div></div>
    <div class="actions"><button class="btn primary" data-a="play">${icon('play')} Play</button><button class="btn ghost" data-a="shuffle">${icon('shuffle')} Shuffle</button><button class="btn ghost" data-a="save" aria-pressed="${saved}">${saved ? 'Saved' : 'Save album'}</button><button class="btn ghost" data-a="add">${icon('plus')} Add to playlist</button></div>`;
  const popularTracks = [...d.tracks].filter((t) => Number(t.rank) > 0).sort((x, y) => Number(y.rank) - Number(x.rank)).slice(0, 3);
  if (popularTracks.length >= 2) out += section('Popular on this album', trackList(popularTracks, { name: `${a.title} — popular tracks`, href: location.hash }, { hideAlbum: true, rank: true }) + '<p class="source-note">Ranked by the music catalog’s popularity data.</p>');
  out += section('Tracklist', trackList(d.tracks, { name: a.title, href: location.hash }, { hideAlbum: true }));
  const credits = [a.label && `Label: ${a.label}`, a.genre && `Genre: ${a.genre}`, ...(a.contributors || []).map((c) => `${c.name} (${c.role})`)].filter(Boolean);
  if (credits.length) out += section('Credits', `<p class="note" style="font-size:14px">${credits.map(esc).join('<br>')}</p>`);
  if (d.more?.length) out += section(`More by ${a.artist}`, shelf(d.more.map(albumTile)));
  el.innerHTML = out;
  el.querySelector('[data-a="play"]').onclick = () => app.queue.playList(d.tracks, 0, { name: a.title, href: location.hash });
  el.querySelector('[data-a="shuffle"]').onclick = () => { if (!app.queue.shuffle) app.queue.toggleShuffle(); app.queue.playList(d.tracks, Math.floor(Math.random() * d.tracks.length), { name: a.title, href: location.hash }); };
  el.querySelector('[data-a="save"]').onclick = async (e) => { const on = await toggleSaved('albums', a); e.currentTarget.textContent = on ? 'Saved' : 'Save album'; toast(on ? 'Saved to your albums' : 'Removed from your albums'); };
  el.querySelector('[data-a="add"]').onclick = (e) => app.actions.addToPlaylistMenu(e.currentTarget, d.tracks);
}

// ---------- Collections: Deezer playlist, session, mix, radio ----------
function collection(el, app, { art, kind, title, desc, source, tracks, href, extra = '' }) {
  el.innerHTML = `<div class="hero"><${art ? `img class="hero-art" src="${attr(art)}" alt=""` : `div class="hero-art mix-art" style="--m1:${mixColors(title)[0]};--m2:${mixColors(title)[1]}"`}>${art ? '' : '</div>'}<div><div class="kind">${esc(kind)}</div><h1>${esc(title)}</h1><div class="meta">${desc ? `<span>${esc(desc)}</span>` : ''}<span>${plural(tracks.length, 'song')}</span></div></div></div>
    <div class="actions"><button class="btn primary" data-c="play" ${tracks.length ? '' : 'disabled'}>${icon('play')} Play</button><button class="btn ghost" data-c="shuffle" ${tracks.length ? '' : 'disabled'}>${icon('shuffle')} Shuffle</button><button class="btn ghost" data-c="save">Save as playlist</button><button class="btn ghost" data-c="share">Share card</button><button class="btn ghost" data-c="offline">Save offline</button>${extra}</div>
    ${tracks.length ? trackList(tracks, { name: title, href }) : '<div class="empty"><p>Nothing to play here yet.</p></div>'}${source ? `<p class="source-note">${source}</p>` : ''}`;
  el.querySelector('[data-c="play"]').onclick = () => app.queue.playList(tracks, 0, { name: title, href });
  el.querySelector('[data-c="shuffle"]').onclick = () => { if (!app.queue.shuffle) app.queue.toggleShuffle(); app.queue.playList(tracks, Math.floor(Math.random() * tracks.length), { name: title, href }); };
  el.querySelector('[data-c="save"]').onclick = () => app.actions.saveAsPlaylist(title, tracks);
  el.querySelector('[data-c="share"]').onclick = () => app.actions.shareCollection(title, tracks, art);
  el.querySelector('[data-c="offline"]').onclick = (ev) => app.actions.saveCollectionOffline(tracks, ev.currentTarget);
}
export async function dzplaylist(p, el, app) {
  el.innerHTML = skeletonRows(10);
  const d = await api(`/dzplaylist/${encodeURIComponent(p.id)}`);
  collection(el, app, { art: d.playlist.artwork, kind: `Playlist by ${d.playlist.creator}`, title: d.playlist.title, desc: d.playlist.description, tracks: d.tracks, href: location.hash, source: 'Playlist from Deezer.' });
}
export async function session(p, el, app) {
  el.innerHTML = skeletonRows(10);
  const d = await api(`/sessions/${encodeURIComponent(p.slug)}`);
  const saved = store.lib.sessions.has(d.session.slug);
  collection(el, app, { art: null, kind: d.session.mix ? 'Mood mix' : 'Listening session', title: d.session.title, desc: d.session.mood, tracks: d.tracks, href: location.hash, source: `Tracks from the Deezer playlist “${esc(d.source.title)}” by ${esc(d.source.creator)}, filtered by your explicit-content and “don’t recommend” settings.`, extra: `<button class="btn ghost" data-c="keep" aria-pressed="${saved}">${saved ? 'Saved' : 'Save session'}</button>` });
  el.querySelector('[data-c="keep"]').onclick = async (e) => { const on = await toggleSaved('sessions', { ...d.session, artwork: d.artwork }); e.currentTarget.textContent = on ? 'Saved' : 'Save session'; };
}
export async function mix(p, el, app) {
  el.innerHTML = skeletonRows(10);
  const d = await api(`/mix/${encodeURIComponent(p.kind)}`);
  collection(el, app, { art: null, kind: `Made for ${store.user.displayName}`, title: d.title, desc: d.description, tracks: d.tracks, href: location.hash, source: 'Built from your listening on Vesper and Deezer’s related-artist data. Each song shows why it was picked.' });
}
export async function radio(p, el, app) {
  el.innerHTML = skeletonRows(10);
  const d = await api(`/radio/${encodeURIComponent(p.id)}`);
  const isArtist = p.id.startsWith('dz:');
  collection(el, app, { art: d.tracks[0]?.artwork, kind: isArtist ? 'Artist radio' : 'Genre mix', title: isArtist ? `${d.tracks[0]?.artist || 'Artist'} radio` : (p.title || 'Genre mix'), tracks: d.tracks, href: location.hash, source: isArtist ? 'Deezer artist radio.' : 'Deezer genre radio.' });
}

// ---------- Following ----------
export async function following(_p, el) {
  el.innerHTML = `<h1 class="page-title">Following</h1>${skeletonShelf()}`;
  const d = await api('/following');
  if (!d.artists.length) { el.innerHTML = '<h1 class="page-title">Following</h1><div class="empty"><h2>Follow artists to see their new music here</h2><p>Open any artist and choose Follow.</p><a class="btn primary" href="#/search">Find artists</a></div>'; return; }
  el.innerHTML = `<h1 class="page-title">Following</h1>${section('Newest songs', d.latestTracks?.length ? trackList(d.latestTracks, { name: 'Newest songs from followed artists' }, { rank: false, hideAlbum: false }) : '<p class="note">No recent songs found for followed artists yet.</p>')}
    ${section('Newest albums and singles', d.releases.length ? `<div class="grid">${d.releases.map(albumTile).join('')}</div><p class="source-note">Latest releases from artists you follow, newest first.</p>` : '<p class="note">No recent releases found yet.</p>')}
    ${section(`Artists you follow (${d.artists.length})`, `<div class="follow-tools"><input class="input" id="f-filter" type="search" placeholder="Filter artists" style="max-width:260px;height:38px" aria-label="Filter followed artists"><select class="input" id="f-sort" style="max-width:220px;height:38px" aria-label="Sort followed artists"><option value="recent">Recently followed</option><option value="name">Name</option><option value="releases">Newest release</option></select></div><div id="f-list"></div>`)}
    <p class="source-note">Follows are saved to your profile on this server and use Deezer’s artist IDs, so two artists with the same name stay separate. Artists from Jamendo can be followed too, but their releases aren’t listed here. Push notifications aren’t available in this web version; new releases appear on this page.</p>`;
  const latest = new Map(); for (const a of d.releases) if (!latest.has(a.artistId)) latest.set(a.artistId, a.releaseDate);
  const draw = () => {
    const f = el.querySelector('#f-filter').value.trim().toLowerCase(), s = el.querySelector('#f-sort').value;
    const list = d.artists.filter((a) => !f || a.name.toLowerCase().includes(f));
    list.sort((a, b) => s === 'name' ? a.name.localeCompare(b.name) : s === 'releases' ? (latest.get(b.id) || '').localeCompare(latest.get(a.id) || '') : (b.followedAt || '').localeCompare(a.followedAt || ''));
    el.querySelector('#f-list').innerHTML = list.length ? grid(list.map(artistTile)) : '<p class="note">No followed artists match.</p>';
  };
  el.querySelector('#f-filter').addEventListener('input', draw); el.querySelector('#f-sort').addEventListener('change', draw); draw();
}
export { shelf, grid, trackTiles, mixColors, guarded, fmtTime };
