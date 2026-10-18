// Personal views: library, playlists, stats, settings, sign-in.
import { api, store, saveSettings, loadLibrary, refreshPlaylists, emit } from './store.js';
import { artistPhoto } from './artwork.js';
import { savedTracks, offlineUsage, removeAllOffline } from './offline.js';
import { esc, attr, icon, fmtTime, fmtLong, plural, trackList, tile, albumTile, artistTile, section, errorNote, skeletonRows, toast, formDialog, confirmDialog, providerName } from './ui.js';
import { PRESETS, IS_IOS } from './engine.js';
import { shelf, grid, mixColors } from './views.js';

// ---------- Library ----------
const TABS = [['songs', 'Liked songs'], ['albums', 'Albums'], ['artists', 'Artists'], ['playlists', 'Playlists'], ['recent', 'Recently played'], ['sessions', 'Saved sessions'], ['local', 'On this computer'], ['offline', 'Offline']];
export async function library(p, el, app) {
  const tab = p.tab || 'songs';
  await loadLibrary();
  const L = store.lib;
  el.innerHTML = `<h1 class="page-title">Library</h1><div class="chips">${TABS.map(([k, l]) => `<a class="chip" style="display:inline-flex;align-items:center" href="#/library/${k}" aria-pressed="${k === tab}">${l}</a>`).join('')}</div>
    <div class="actions" style="margin-top:0"><input class="input" id="lib-filter" type="search" placeholder="Filter" style="max-width:280px;height:38px" aria-label="Filter library"><select class="input" id="lib-sort" style="max-width:200px;height:38px" aria-label="Sort"><option value="recent">Recently added</option><option value="title">Title</option><option value="artist">Artist</option></select></div><div id="lib"></div>`;
  const box = el.querySelector('#lib'), fi = el.querySelector('#lib-filter'), so = el.querySelector('#lib-sort');
  let recent = null;
  async function draw() {
    const f = fi.value.trim().toLowerCase(), s = so.value;
    const match = (...xs) => !f || xs.some((x) => (x || '').toLowerCase().includes(f));
    const sortBy = (arr, title, artist, date) => s === 'title' ? arr.sort((a, b) => (title(a) || '').localeCompare(title(b) || '')) : s === 'artist' ? arr.sort((a, b) => (artist(a) || '').localeCompare(artist(b) || '')) : arr.sort((a, b) => (date(b) || '').localeCompare(date(a) || ''));
    if (tab === 'songs') {
      const list = sortBy([...L.likes.values()].filter((t) => match(t.title, t.artist, t.album)), (t) => t.title, (t) => t.artist, (t) => t.likedAt);
      box.innerHTML = list.length ? `<div class="actions"><button class="btn primary" data-l="play">${icon('play')} Play</button><button class="btn ghost" data-l="shuffle">${icon('shuffle')} Shuffle</button></div>${trackList(list, { name: 'Liked songs', href: '#/library/songs' })}` : '<div class="empty"><h2>Songs you like will appear here</h2><p>Tap the heart on any song.</p></div>';
      box.querySelector('[data-l="play"]')?.addEventListener('click', () => app.queue.playList(list, 0, { name: 'Liked songs', href: '#/library/songs' }));
      box.querySelector('[data-l="shuffle"]')?.addEventListener('click', () => { if (!app.queue.shuffle) app.queue.toggleShuffle(); app.queue.playList(list, Math.floor(Math.random() * list.length), { name: 'Liked songs' }); });
    } else if (tab === 'albums') {
      const list = sortBy([...L.albums.values()].filter((a) => match(a.title, a.artist)), (a) => a.title, (a) => a.artist, (a) => a.savedAt);
      box.innerHTML = list.length ? grid(list.map(albumTile)) : '<div class="empty"><h2>No saved albums yet</h2><p>Open an album and choose Save album.</p></div>';
    } else if (tab === 'artists') {
      const list = sortBy([...L.artists.values()].filter((a) => match(a.name)), (a) => a.name, (a) => a.name, (a) => a.followedAt);
      box.innerHTML = list.length ? grid(list.map(artistTile)) : '<div class="empty"><h2>No followed artists yet</h2><p>Open an artist and choose Follow.</p></div>';
    } else if (tab === 'playlists') {
      const list = sortBy(L.playlists.filter((x) => match(x.name, x.description)), (x) => x.name, (x) => x.name, (x) => x.updatedAt);
      box.innerHTML = `<div class="actions"><button class="btn primary" data-act="new-playlist">${icon('plus')} New playlist</button><a class="btn ghost" href="#/import">Import playlist</a></div>${grid(list.map(playlistTile))}`;
    } else if (tab === 'recent') {
      recent ||= (await api('/me/recent')).events;
      const list = recent.filter((e) => match(e.track.title, e.track.artist)).map((e) => ({ ...e.track, reason: `${new Date(e.at).toLocaleString()}${e.skipped ? ', skipped' : ''}` }));
      box.innerHTML = list.length ? trackList(list, { name: 'Recently played' }) : '<div class="empty"><h2>Nothing played yet</h2></div>';
    } else if (tab === 'sessions') {
      const list = [...L.sessions.values()].filter((x) => match(x.title, x.mood));
      box.innerHTML = list.length ? grid(list.map((x) => tile({ href: `#/session/${x.slug}`, coverKey: `session:${x.slug}`, title: x.title, sub: x.mood, mix: mixColors(x.slug), typeTitle: x.title }))) : '<div class="empty"><h2>No saved sessions</h2><p>Open a listening session and choose Save session.</p></div>';
    } else if (tab === 'offline') {
      const list = savedTracks().filter((t) => match(t.title, t.artist, t.album)), u = await offlineUsage();
      const mb = (b) => `${(b / 1048576).toFixed(b > 1e8 ? 0 : 1)} MB`;
      box.innerHTML = `<p class="note">${u.count} song${u.count === 1 ? '' : 's'} saved on this device (${mb(u.bytes)}${u.quota ? ` of about ${mb(u.quota)} available to this site` : ''}).${u.persisted ? '' : ' The browser may clear saved songs if the device runs very low on space.'} Only your own files and Jamendo tracks whose artists allow downloads can be saved.</p>${list.length ? `<div class="actions"><button class="btn primary" data-l="play-offline">${icon('play')} Play all</button><button class="btn ghost" data-l="clear-offline">Remove all</button></div>${trackList(list, { name: 'Offline' })}` : '<div class="empty"><h2>Nothing saved yet</h2><p>Use “Save for offline” in a song’s menu, or “Save offline” on a playlist.</p></div>'}`;
      box.querySelector('[data-l="play-offline"]')?.addEventListener('click', () => app.queue.playList(list, 0, { name: 'Offline' }));
      box.querySelector('[data-l="clear-offline"]')?.addEventListener('click', async () => { if (await confirmDialog('Remove all offline songs?', 'They’ll be deleted from this device. Your library isn’t affected.', 'Remove all')) { await removeAllOffline(); draw(); } });
    } else if (tab === 'local') {
      const list = L.local.filter((t) => match(t.title, t.artist, t.album));
      box.innerHTML = list.length ? `<div class="actions"><button class="btn primary" data-l="play-local">${icon('play')} Play all</button></div>${trackList(list, { name: 'My music folder' })}` : '<div class="empty"><h2>No music folder connected</h2><p>Set MUSIC_DIR in the .env file to a folder of your own music, restart Vesper, then rescan from Settings. Files play in full, and .lrc files next to them provide synced lyrics.</p><a class="btn ghost" href="#/settings">Open settings</a></div>';
      box.querySelector('[data-l="play-local"]')?.addEventListener('click', () => app.queue.playList(list, 0, { name: 'My music folder' }));
    }
  }
  fi.addEventListener('input', draw); so.addEventListener('change', draw);
  draw();
}
const playlistTile = (pl) => tile({ href: `#/playlist/${pl.id}`, art: pl.artwork, collage: pl.artworkTiles, coverKey: `playlist:${pl.id}`, title: pl.name, sub: `${plural(pl.trackCount ?? pl.tracks?.length ?? 0, 'song')}${pl.privacy === 'public' ? ', shared' : ''}`, mix: mixColors(pl.id) });

export async function albums(_p, el) {
  await loadLibrary();
  const saved = [...store.lib.albums.values()];
  el.innerHTML = `<h1 class="page-title">Albums</h1>${section('Saved albums', saved.length ? grid(saved.map(albumTile)) : '<p class="note">Albums you save appear here.</p>')}<div id="nr"></div>`;
  api('/charts/new-releases').then((d) => { el.querySelector('#nr').innerHTML = section('New releases', shelf(d.items.map(albumTile))); }).catch((e) => { el.querySelector('#nr').innerHTML = section('New releases', errorNote(e.message)); });
}
export async function playlists(_p, el) {
  await loadLibrary();
  const L = store.lib;
  el.innerHTML = `<h1 class="page-title">Playlists</h1><div class="actions"><button class="btn primary" data-act="new-playlist">${icon('plus')} New playlist</button><a class="btn ghost" href="#/import">Import playlist</a></div>${grid([tile({ href: '#/library/songs', coverKey: 'likes', title: 'Liked songs', sub: plural(L.likes.size, 'song'), collage: [...L.likes.values()].slice(0, 4).map((t) => t.albumArtwork || t.artworkSmall || t.artwork).filter(Boolean), mix: ['#6b5bd6', '#1d1a33'], typeTitle: 'Liked songs' }), ...L.playlists.map(playlistTile)])}`;
}

// ---------- Playlist (yours or a shared one) ----------
export async function playlist(p, el, app) {
  el.innerHTML = skeletonRows(8);
  let { playlist: pl } = await api(`/playlists/${encodeURIComponent(p.id)}`);
  let sort = 'custom', filter = '';
  let recs = null, recsBusy = false, recsNote = '', recsSkip = [];
  const loadRecs = async (fresh = false) => {
    if (recsBusy) return; recsBusy = true; if (fresh) recsSkip.push(...(recs || []).map((t) => t.id)); renderRecs();
    try { const r = await api(`/playlists/${encodeURIComponent(pl.id)}/recs${recsSkip.length ? `?skip=${encodeURIComponent(recsSkip.slice(-150).join(','))}` : ''}`); recs = r.tracks || []; recsNote = r.note || (r.basedOn?.length ? `Based on ${r.basedOn.join(', ')} and the rest of this playlist.` : ''); }
    catch (e) { recs = recs || []; recsNote = e.message; }
    recsBusy = false; renderRecs();
  };
  const renderRecs = () => {
    const box = el.querySelector('#pl-recs'); if (!box) return;
    if (!pl.tracks.length) { box.innerHTML = ''; return; }
    const head = `<div class="section-head"><h2>Recommended</h2><button class="text-btn" data-r="refresh" ${recsBusy ? 'disabled' : ''}>Refresh</button></div>`;
    if (recsBusy && !recs) { box.innerHTML = head + skeletonRows(4); return; }
    box.innerHTML = head + (recs?.length ? `<div class="rec-list">${trackList(recs.slice(0, 10), { name: `Recommended for ${pl.name}` })}</div>` : '') + (recsNote ? `<p class="source-note">${esc(recsNote)}</p>` : '');
    if (pl.isOwner) box.querySelectorAll('.rec-list .row').forEach((row, i) => {
      const b = document.createElement('button'); b.className = 'btn ghost rec-add'; b.dataset.r = 'add'; b.dataset.i = String(i); b.textContent = 'Add';
      b.setAttribute('aria-label', `Add ${recs[i]?.title} to ${pl.name}`);
      row.querySelector('[data-act="track-menu"]')?.before(b);
    });
  };
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    if (b.dataset.r === 'refresh') loadRecs(true);
    if (b.dataset.r === 'add') {
      e.stopPropagation(); const t = recs?.[Number(b.dataset.i)]; if (!t) return;
      b.disabled = true;
      try {
        ({ playlist: pl } = await api(`/me/playlists/${encodeURIComponent(pl.id)}/tracks`, { method: 'POST', body: { tracks: [t] } }));
        recs = recs.filter((x) => x !== t); toast(`Added to ${pl.name}`); refreshPlaylists().catch(() => {});
        draw(); if (recs.length < 4) loadRecs(true);
      } catch (err) { b.disabled = false; toast(err.message, { error: true }); }
    }
  });
  const draw = () => {
    const own = pl.isOwner;
    const total = pl.tracks.reduce((s, t) => s + ((t.preview ? 30 : t.duration) || 0), 0);
    let view = pl.tracks.map((t, i) => ({ t, i }));
    if (filter) view = view.filter(({ t }) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(filter));
    if (sort !== 'custom') view.sort((a, b) => (a.t[sort] || '').localeCompare(b.t[sort] || ''));
    const tracks = view.map((v) => v.t);
    el.innerHTML = `<div class="hero"><div style="position:relative">${pl.customArtwork ? `<img class="hero-art" src="${attr(pl.customArtwork)}" alt="">` : (pl.artworkTiles?.length ? `<div class="playlist-cover-collage cover-collage">${Array.from({ length: 4 }, (_, i) => pl.artworkTiles[i] ? `<img src="${attr(pl.artworkTiles[i])}" alt="" loading="lazy">` : '<span></span>').join('')}</div>` : `<div class="hero-art mix-art" style="--m1:${mixColors(pl.id)[0]};--m2:${mixColors(pl.id)[1]}"></div>`)}${own ? '<label class="btn sm" style="position:absolute;left:10px;bottom:10px;cursor:pointer">Change cover<input type="file" accept="image/*" id="cover" hidden></label>' : ''}</div>
      <div><div class="kind">${pl.privacy === 'public' ? 'Shared playlist' : 'Private playlist'}${own ? '' : ` by ${esc(pl.ownerName)}`}</div><h1>${esc(pl.name)}</h1>${pl.description ? `<p class="lede" style="margin:0 0 8px">${esc(pl.description)}</p>` : ''}<div class="meta"><span>${plural(pl.tracks.length, 'song')}, ${fmtLong(total * 1000)}</span></div></div></div>
      <div class="actions"><button class="btn primary" data-p="play" ${pl.tracks.length ? '' : 'disabled'}>${icon('play')} Play</button><button class="btn ghost" data-p="shuffle" ${pl.tracks.length ? '' : 'disabled'}>${icon('shuffle')} Shuffle</button>
        ${own ? `<button class="btn ghost" data-p="edit">Edit details</button><button class="btn ghost" data-p="privacy">${pl.privacy === 'public' ? 'Make private' : 'Share'}</button>` : ''}
        ${pl.privacy === 'public' ? '<button class="btn ghost" data-p="link">Copy link</button>' : ''}<button class="btn ghost" data-p="dup">Duplicate</button><button class="btn ghost" data-p="share">Share card</button><button class="btn ghost" data-p="offline">Save offline</button>${own ? '<button class="btn ghost" data-p="delete">Delete</button>' : ''}</div>
      ${pl.tracks.length > 6 ? `<div class="actions" style="margin-top:0"><input class="input" id="pl-filter" type="search" placeholder="Find in playlist" value="${attr(filter)}" style="max-width:260px;height:38px"><select class="input" id="pl-sort" style="max-width:180px;height:38px" aria-label="Sort"><option value="custom">Custom order</option><option value="title">Title</option><option value="artist">Artist</option><option value="album">Album</option></select></div>` : ''}
      ${pl.tracks.length ? trackList(tracks, { name: pl.name, href: location.hash, playlistId: own ? pl.id : null, indexMap: view.map((v) => v.i) }) : `<div class="empty"><h2>This playlist is empty</h2><p>Use “Add to playlist” in any song’s menu.</p><a class="btn ghost" href="#/search">Find songs</a></div>`}
      ${own && sort === 'custom' && !filter && pl.tracks.length > 1 ? '<p class="source-note">Drag and drop songs to reorder this playlist, or use the three-dot menu for more options.</p>' : ''}
      <section class="section" id="pl-recs"></section>`;
    renderRecs(); if (recs === null && pl.tracks.length) loadRecs();
    const $ = (s) => el.querySelector(s);
    $('#pl-sort') && ($('#pl-sort').value = sort);
    $('#pl-sort')?.addEventListener('change', (e) => { sort = e.target.value; draw(); });
    $('#pl-filter')?.addEventListener('input', (e) => { filter = e.target.value.toLowerCase(); clearTimeout(draw.t); draw.t = setTimeout(() => { draw(); el.querySelector('#pl-filter')?.focus(); }, 250); });
    if (own && sort === 'custom' && !filter && pl.tracks.length > 1) {
      const rows = [...el.querySelectorAll('.row[data-list]')];
      let dragged = null;
      rows.forEach((row) => {
        row.draggable = true;
        row.addEventListener('dragstart', (ev) => { dragged = Number(row.dataset.idx); row.classList.add('dragging'); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(dragged)); });
        row.addEventListener('dragend', () => { row.classList.remove('dragging'); rows.forEach((r) => r.classList.remove('drop-target')); });
        row.addEventListener('dragover', (ev) => { if (dragged === null) return; ev.preventDefault(); rows.forEach((r) => r.classList.remove('drop-target')); row.classList.add('drop-target'); ev.dataTransfer.dropEffect = 'move'; });
        row.addEventListener('drop', async (ev) => {
          ev.preventDefault(); const from = dragged, to = Number(row.dataset.idx); dragged = null;
          if (from === null || from === to || !Number.isInteger(from) || !Number.isInteger(to)) return;
          const order = pl.tracks.map((_, i) => i); const [moved] = order.splice(from, 1); order.splice(to, 0, moved);
          try { pl = (await api(`/me/playlists/${pl.id}`, { method: 'PATCH', body: { order } })).playlist; await refreshPlaylists(); draw(); toast('Playlist order saved'); }
          catch (err) { toast(err.message || 'Could not reorder playlist', { error: true }); }
        });
      });
    }
    $('[data-p="play"]')?.addEventListener('click', () => app.queue.playList(tracks, 0, { name: pl.name, href: location.hash }));
    $('[data-p="shuffle"]')?.addEventListener('click', () => { if (!app.queue.shuffle) app.queue.toggleShuffle(); app.queue.playList(tracks, Math.floor(Math.random() * tracks.length), { name: pl.name, href: location.hash }); });
    $('[data-p="edit"]')?.addEventListener('click', async () => { const v = await formDialog('Edit details', [{ name: 'name', label: 'Name', value: pl.name, required: true }, { name: 'description', label: 'Description', value: pl.description, type: 'textarea' }]); if (!v) return; pl = (await api(`/me/playlists/${pl.id}`, { method: 'PATCH', body: v })).playlist; refreshPlaylists(); draw(); toast('Playlist updated'); });
    $('[data-p="privacy"]')?.addEventListener('click', async () => { pl = (await api(`/me/playlists/${pl.id}`, { method: 'PATCH', body: { privacy: pl.privacy === 'public' ? 'private' : 'public' } })).playlist; draw(); toast(pl.privacy === 'public' ? 'Anyone with a profile on this Vesper server can open it with the link' : 'Playlist is private'); });
    $('[data-p="link"]')?.addEventListener('click', async () => { const url = `${location.origin}/#/playlist/${pl.id}`; try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url, { ms: 8000 }); } });
    $('[data-p="share"]')?.addEventListener('click', () => app.actions.shareCollection(pl.name, pl.tracks, pl.customArtwork || null));
    $('[data-p="offline"]')?.addEventListener('click', (ev) => app.actions.saveCollectionOffline(pl.tracks, ev.currentTarget));
    $('[data-p="dup"]')?.addEventListener('click', async () => { const r = await api(`/me/playlists/${pl.id}/duplicate`, { method: 'POST', body: {} }); await refreshPlaylists(); location.hash = `#/playlist/${r.playlist.id}`; toast('Playlist duplicated'); });
    $('[data-p="delete"]')?.addEventListener('click', async () => { if (!(await confirmDialog('Delete playlist?', `“${pl.name}” will be deleted. This can’t be undone.`))) return; await api(`/me/playlists/${pl.id}`, { method: 'DELETE' }); await refreshPlaylists(); location.hash = '#/playlists'; toast('Playlist deleted'); });
    $('#cover')?.addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; try { const data = await resizeImage(f, 600); pl = (await api(`/me/playlists/${pl.id}`, { method: 'PATCH', body: { artwork: data } })).playlist; refreshPlaylists(); draw(); } catch (err) { toast(err.message, { error: true }); } });
  };
  app.currentPlaylist = { get: () => pl, set: (x) => { pl = x; draw(); } };
  draw();
  app.queue.prewarmTracks(pl.tracks || []);
  return () => { app.currentPlaylist = null; };
}
export function resizeImage(file, size) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); const s = Math.min(img.width, img.height); x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size); URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = () => rej(new Error('That image couldn’t be read.'));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Stats ----------
const RANGES = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time']];
export async function stats(p, el) {
  const range = p.range || '30d';
  el.innerHTML = `<h1 class="page-title">Listening stats</h1><div class="chips">${RANGES.map(([k, l]) => `<a class="chip" style="display:inline-flex;align-items:center" href="#/stats?range=${k}" aria-pressed="${k === range}">${l}</a>`).join('')}</div><div id="st">${skeletonRows(4)}</div>`;
  const s = await api(`/me/stats?range=${range}`);
  const box = el.querySelector('#st');
  if (!s.totals.plays) { box.innerHTML = `<div class="empty"><h2>No listening recorded ${range === 'all' ? 'yet' : 'in this period'}</h2><p>Stats only count what you play in Vesper${store.settings.recordHistory ? '' : ', and history recording is currently off in Settings'}. Nothing is imported or estimated.</p></div>`; return; }
  const maxS = Math.max(1, ...s.series.map((x) => x.ms)), maxH = Math.max(1, ...s.hours);
  const rank = (items, f) => `<div class="rank-list">${items.map((x, i) => { const v = f(x); return `<div class="rank-item"><span class="rank">${i + 1}</span><img src="${attr(v.art || '')}" alt="" loading="lazy"><div style="min-width:0"><div class="r-title">${v.href ? `<a href="${attr(v.href)}">${esc(v.title)}</a>` : esc(v.title)}</div><div class="r-sub">${esc(v.sub)}</div><div class="meter"><div style="width:${(v.ms / items.reduce((m, y) => Math.max(m, f(y).ms), 1)) * 100}%"></div></div></div><span class="note">${esc(v.right)}</span></div>`; }).join('')}</div>`;
  const label = (k) => k.length === 7 ? new Date(`${k}-15`).toLocaleDateString(undefined, { month: 'short' }) : new Date(`${k}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  box.innerHTML = `<div class="stat-row"><div class="stat"><b>${fmtLong(s.totals.ms)}</b><span>Listening time</span></div><div class="stat"><b>${s.totals.plays.toLocaleString()}</b><span>Plays</span></div><div class="stat"><b>${s.totals.artists}</b><span>Artists</span></div><div class="stat"><b>${s.streak.current}</b><span>Day streak (longest ${s.streak.longest})</span></div><div class="stat"><b>${s.totals.plays ? Math.round((s.totals.skipped / s.totals.plays) * 100) : 0}%</b><span>Skipped</span></div></div>
    ${section(s.series[0]?.key.length === 7 ? 'Listening by month' : 'Listening by day', `<div class="bars" role="img" aria-label="Listening time per period">${s.series.map((x) => `<div style="height:${Math.max(2, (x.ms / maxS) * 100)}%" title="${esc(label(x.key))}: ${fmtLong(x.ms)}"></div>`).join('')}</div><div class="bars-x"><span>${esc(label(s.series[0].key))}</span><span>${esc(label(s.series[s.series.length - 1].key))}</span></div>`)}
    <div class="two-col">${section('Top artists', rank(s.topArtists, (a) => ({ art: a.artwork, title: a.name, sub: plural(a.plays, 'play'), ms: a.ms, right: fmtLong(a.ms), href: a.artistId?.startsWith('dz:') ? `#/artist/${encodeURIComponent(a.artistId)}` : null })))}
    ${section('Top songs', rank(s.topTracks, (t) => ({ art: t.track.artworkSmall || t.track.artwork, title: t.track.title, sub: t.track.artist, ms: t.plays, right: plural(t.plays, 'play') })))}</div>
    <div class="two-col">${section('Top albums', s.topAlbums.length ? rank(s.topAlbums, (a) => ({ art: a.artwork, title: a.title, sub: a.artist, ms: a.ms, right: fmtLong(a.ms), href: a.albumId?.startsWith('dz:') ? `#/album/${encodeURIComponent(a.albumId)}` : null })) : '<p class="note">No album information for these plays.</p>')}
    ${section('Favourite genres', s.genres.length ? `${rank(s.genres, (g) => ({ title: g.name, sub: '', ms: g.ms, right: fmtLong(g.ms) }))}<p class="source-note">Genre is known for ${Math.round(s.genreCoverage * 100)}% of listening time in this period (Deezer search results don’t include genre).</p>` : '<p class="note">No genre data for these plays.</p>')}</div>
    ${section('Time of day', `<div class="bars" style="height:90px">${s.hours.map((m, h) => `<div style="height:${Math.max(2, (m / maxH) * 100)}%" title="${h}:00 — ${fmtLong(m)}"></div>`).join('')}</div><div class="bars-x"><span>Midnight</span><span>Noon</span><span>11 pm</span></div>`)}
    ${s.mostReplayed.length ? section('Most replayed', trackList(s.mostReplayed.map((x) => ({ ...x.track, reason: plural(x.plays, 'play') })), { name: 'Most replayed' })) : ''}
    ${s.recentlyDiscovered.length ? section('Recently discovered artists', `<div class="chips">${s.recentlyDiscovered.map((a) => `<span class="chip" style="display:inline-flex;align-items:center">${esc(a.name)}</span>`).join('')}</div>`) : ''}
    <p class="source-note">Recorded by Vesper since ${new Date(s.recordingSince).toLocaleDateString()}. Only plays longer than one second count. Nothing is imported from other services.</p>`;
}

// ---------- Settings ----------
export async function settings(_p, el, app) {
  const u = store.user, s = u.settings;
  const sw = (k, title, desc, disabled = false) => `<div class="setting"><div class="s-text"><div class="s-title">${title}</div><div class="s-desc">${desc}</div></div><label class="switch"><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="${attr(title)}"></label></div>`;
  const sel = (k, title, desc, opts) => `<div class="setting"><div class="s-text"><div class="s-title">${title}</div><div class="s-desc">${desc}</div></div><select class="input" data-set="${k}" style="width:auto;height:38px" aria-label="${attr(title)}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[k]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  const caps = app.engine.capabilities;
  el.innerHTML = `<h1 class="page-title">Settings</h1>
  <div class="settings-group"><h2>Profile</h2>
    <div class="setting"><div class="s-text"><div class="s-title">Display name</div><div class="s-desc">Used in greetings and “Made for” mixes.</div></div><button class="btn sm ghost" data-x="name">${esc(u.displayName)}</button></div>
    <div class="setting"><div class="s-text"><div class="s-title">${u.isOwner ? 'Owner account' : 'Account'}</div><div class="s-desc">${u.guest ? 'You’re using a guest profile on this server. Add a username and password to sign in from other devices, like your phone.' : `Signed in as ${esc(u.username)}.${u.isOwner ? ' You can manage Vesper, view server status, make backups and install server updates below.' : ''}`}</div></div>${u.guest ? '<button class="btn sm primary" data-x="secure">Add sign-in</button>' : `<span class="actions" style="margin:0"><button class="btn sm ghost" data-x="credentials">Change sign-in</button><button class="btn sm ghost" data-x="logout">Sign out</button></span>`}</div>
  </div>
  <div class="settings-group"><h2>Transitions</h2><p class="note">${caps.graph ? 'How one song flows into the next.' : esc(caps.reason || '')}</p>
    <div class="presets" role="radiogroup">${Object.entries(PRESETS).map(([k, v]) => `<button class="preset" role="radio" data-preset="${k}" aria-pressed="${s.transition === k}" aria-checked="${s.transition === k}" ${!caps.graph && !['off', 'seamless'].includes(k) ? 'disabled' : ''}><b>${v.label}</b><span>${v.desc}</span></button>`).join('')}</div>
    <div class="setting"><div class="s-text"><div class="s-title">Crossfade length: <span id="cf-val">${s.crossfade} s</span></div><div class="s-desc">Used by Smooth, and as the minimum for Cinematic. Vesper shortens it automatically for short songs and songs that already fade out.</div></div><input type="range" min="1" max="12" step="1" value="${s.crossfade}" data-set="crossfade" aria-label="Crossfade length" style="width:180px" ${['smooth', 'cinematic'].includes(s.transition) && caps.graph ? '' : 'disabled'}></div>
  </div>
  <div class="settings-group"><h2>Playback</h2>
    ${sel('speed', 'Playback speed', 'Pitch is preserved.', [[0.75, '0.75×'], [0.9, '0.9×'], [1, '1×'], [1.1, '1.1×'], [1.25, '1.25×'], [1.5, '1.5×'], [2, '2×']])}
    <div class="setting"><div class="s-text"><div class="s-title">Equalizer</div><div class="s-desc">${caps.eq ? `10-band equalizer with presets. Currently ${s.eq?.enabled ? 'on' : 'off'}.` : 'Needs audio processing.'}</div></div><button class="btn sm ghost" data-act="audio-panel">Open equalizer</button></div>
    ${sw('autoplay', 'Autoplay', 'When your queue ends, keep playing similar songs. Songs you skip steer what comes next right away.')}
    ${sel('noFullFallback', 'When a song has no full version', 'Vesper plays full songs from YouTube, only from the artist’s official uploads. Rarely a song isn’t on YouTube at all.', [['skip', 'Skip it'], ['clip', 'Play the 30-second clip']])}
    ${sw('dataSaver', 'Data saver', 'Plays full songs at lower quality: about 22 MB an hour instead of about 60 MB. Useful when you listen away from home on mobile data. At home on Wi-Fi, music comes from your Mac and uses no mobile data.')}
    ${window.vesperDesktop?.isDesktop ? sw('discordPresence', 'Show what I’m listening to on Discord', '<span id="discord-status">Shows the song and artist on your Discord profile while music plays. Discord needs to be open on this computer.</span>') : `<div class="setting"><div class="s-text"><div class="s-title">Discord status</div><div class="s-desc">Available in the Vesper desktop app. Browsers can’t talk to Discord.</div></div></div>`}
    ${sw('smartShuffle', 'Smart shuffle', 'Spreads out artists and slips in a few liked songs you haven’t heard lately (each one is labelled).')}
    <p class="note" style="font-size:14px">Full-song matching is automatic: when a catalog source only has a preview, Vesper tries to find a full-length YouTube version and plays it through the normal player. If no reliable full-length match is found, it reports the issue instead of quietly switching to a 30-second preview.</p>
    ${sw('leveling', 'Volume leveling', caps.leveling ? 'Measures each song’s loudness before it plays and evens out the difference (up to −9/+6 dB). Works for test signals and shorter tracks.' : 'Needs audio processing.', !caps.leveling)}
    ${sw('explicit', 'Allow explicit content', 'When off, songs marked explicit by the provider are hidden from search and skipped in queues.')}
    ${sel('processing', 'Audio processing', `Routes audio through the Web Audio engine for crossfades, leveling and the visualizer. “Automatic” turns it off on iPhone and iPad so playback continues on the Lock Screen.${IS_IOS ? ' You’re on iOS.' : ''} Changes apply after reloading.`, [['auto', 'Automatic'], ['on', 'On'], ['off', 'Off']])}
  </div>
  <div class="settings-group" id="yt-signin" hidden><h2>YouTube sign-in</h2><div id="yt-body"></div></div>
  <div class="settings-group" id="owner-tools" hidden><h2>Your Vesper server</h2><div id="owner-body"><p class="note">Loading…</p></div></div>
  <div class="settings-group"><h2>Display</h2>
    ${sel('theme', 'Theme', 'Dark is the default.', [['dark', 'Dark'], ['light', 'Light']])}
    ${sel('artworkMode', 'Now Playing artwork', 'Ambient motion is generated from the cover image; official animated covers aren’t provided by these sources.', [['minimal', 'Minimal'], ['ambient', 'Ambient'], ['immersive', 'Immersive'], ['visualizer', 'Visualizer'], ['lyrics', 'Lyrics']])}
    <div class="setting"><div class="s-text"><div class="s-title">Visualizer intensity</div><div class="s-desc">${caps.visualizer ? 'How strongly the visualizer reacts.' : 'Needs audio processing.'}</div></div><input type="range" min="0" max="1" step="0.1" value="${s.visualizerIntensity}" data-set="visualizerIntensity" style="width:180px" aria-label="Visualizer intensity" ${caps.visualizer ? '' : 'disabled'}></div>
    ${sel('reducedMotion', 'Reduce motion', 'Follows your system setting unless you choose otherwise.', [['system', 'Use system setting'], ['on', 'Always reduce'], ['off', 'Never reduce']])}
  </div>
  <div class="settings-group"><h2>Lyrics</h2>
    ${sel('lyricsSource', 'Online lyrics', 'LRCLIB is a free, community-contributed lyrics database. It is not a licensed lyrics provider — fine for personal use, but replace it with a licensed service before sharing this app publicly. Your own .lrc files always work.', [['lrclib', 'LRCLIB'], ['off', 'Off']])}
  </div>
  <div class="settings-group"><h2>Privacy</h2>
    ${sw('recordHistory', 'Record listening history', 'Powers stats, Recently played and personal mixes. Stored only on this Vesper server.')}
    ${sw('historyForRecs', 'Use history for recommendations', 'When off, recommendations use only the song you start from plus your explicit feedback.')}
    <div class="setting"><div class="s-text"><div class="s-title">Recommendation feedback</div><div class="s-desc" id="fb">Loading…</div></div></div>
    <div class="actions"><button class="btn ghost" data-x="clear-history">Clear listening history</button><button class="btn ghost" data-x="clear-searches">Clear search history</button><a class="btn ghost" href="/api/me/export" download>Export my data</a><button class="btn ghost" data-x="delete">Delete profile</button></div>
  </div>
  <div class="settings-group"><h2>YouTube</h2><p class="note" style="font-size:14px;max-width:70ch">Full-length audio is resolved by yt-dlp on the Mac running Vesper and streamed through Vesper’s normal audio player. A YouTube Data API key is not required. YouTube delivery can change, so keep yt-dlp updated. Use content you are authorized to access and respect <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube’s Terms of Service</a> and applicable copyright law.</p></div>
  <div class="settings-group"><h2>Music sources</h2><div id="sources">${skeletonRows(3)}</div></div>
  <div class="settings-group"><h2>Keyboard shortcuts</h2><div class="kbd-list">${[["Space","Play or pause"],["← →","Seek 5 seconds"],["Shift + ← →","Previous or next song"],["/","Search"],["Q","Up next"],["L","Lyrics"],["M","Mute"],["F","Now Playing"]].map(([k,d])=>`<kbd>${k}</kbd><span>${d}</span>`).join("")}</div></div>`;
  el.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-set]'); if (!t) return;
    const k = t.dataset.set;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (['speed', 'crossfade', 'visualizerIntensity'].includes(k)) v = Number(v);
    try { await saveSettings({ [k]: v }); toast(k === 'processing' ? 'Saved. Reload the page to apply.' : k === 'dataSaver' ? (v ? 'Data saver on. It applies from the next song.' : 'Data saver off. Full quality from the next song.') : 'Saved'); } catch (err) { toast(err.message, { error: true }); }
    if (k === 'discordPresence') showDiscordStatus();
  });
  async function showDiscordStatus() {
    const box = el.querySelector('#discord-status'); if (!box || !window.vesperDesktop) return;
    const st = await window.vesperDesktop.discord.status().catch(() => null); if (!st) return;
    if (!store.settings.discordPresence) box.textContent = 'Shows the song and artist on your Discord profile while music plays. Discord needs to be open on this computer.';
    else if (!st.configured) box.innerHTML = `Needs one-time setup: create a free app named “Vesper” at discord.com/developers/applications, copy its Application ID, and save it in a text file at <code>${esc(st.idFile)}</code>. Then restart Vesper.`;
    else if (st.connected) box.textContent = 'On. Your Discord profile shows what’s playing.';
    else box.textContent = st.error || 'Connecting to Discord… Make sure the Discord app is open.';
  }
  showDiscordStatus(); setTimeout(showDiscordStatus, 2500);
  // YouTube sign-in: lets yt-dlp use a browser's YouTube login when YouTube asks "are you a bot?".
  (async () => {
    const st = await api('/youtube/status').catch(() => null); if (!st?.isAdmin) return;
    const box = el.querySelector('#yt-signin'), body = el.querySelector('#yt-body'); box.hidden = false;
    const mac = st.platform === 'darwin';
    const draw = (msg = '') => {
      body.innerHTML = `<div class="setting"><div class="s-text"><div class="s-title">${st.blocked ? 'YouTube is asking for sign-in right now' : st.browser ? `Using ${esc(st.browser)}’s YouTube sign-in` : 'Not signed in'}</div><div class="s-desc">If songs stop loading with “confirm you’re not a bot”, sign in to YouTube in a browser on ${mac ? 'this Mac' : 'this server'} (a spare Google account is best), then choose that browser here. Vesper reads the sign-in from it; your password is never seen.${mac ? ' Chrome is easiest. Safari needs Terminal to have Full Disk Access.' : ''}${st.cookieFile && !st.browser ? ' A cookies.txt file is also being used.' : ''}</div>${msg ? `<div class="s-desc" style="margin-top:6px;color:var(--ink)">${msg}</div>` : ''}</div>
        <select class="input" id="yt-browser" style="width:auto;height:38px" aria-label="Browser to use"><option value="">None</option>${['chrome', 'safari', 'firefox', 'brave', 'edge', 'chromium', 'opera', 'vivaldi'].map((b) => `<option value="${b}" ${st.browser === b ? 'selected' : ''}>${b[0].toUpperCase() + b.slice(1)}</option>`).join('')}</select></div>`;
      body.querySelector('#yt-browser').addEventListener('change', async (e) => {
        draw('Checking…'); body.querySelector('#yt-browser').value = e.target.value;
        try { const r = await api('/admin/youtube', { method: 'PUT', body: { browser: e.target.value } }); st.browser = r.browser; st.blocked = false; draw(!r.browser ? 'Turned off.' : r.working ? '✓ Working. Full songs should load again.' : `Didn’t work yet: ${esc(r.error || '')}`); }
        catch (err) { draw(esc(err.message)); }
      });
    };
    draw();
  })();
  // Owner tools: backups and installing updates (only the Vesper owner sees this).
  (async () => {
    const v = await api('/version').catch(() => null); if (!v?.isAdmin) return;
    const st = await api('/admin/status').catch(() => null); if (!st) return;
    const box = el.querySelector('#owner-tools'), body = el.querySelector('#owner-body'); box.hidden = false;
    body.innerHTML = `<div class="setting"><div class="s-text"><div class="s-title">Version ${esc(st.version)}</div><div class="s-desc">${st.users} ${st.users === 1 ? 'person uses' : 'people use'} this server. Data is backed up automatically every day and before every update.${st.backups[0] ? ` Latest backup: ${esc(st.backups[0].replace(/^vesper-|\.json$/g, ''))}.` : ''}</div></div></div>
      <div class="setting"><div class="s-text"><div class="s-title">Back up everyone’s data</div><div class="s-desc">Downloads a copy of all accounts, playlists and history. Keep it somewhere safe.</div></div><span class="actions" style="margin:0"><button class="btn" data-own="backup">Back up now</button><a class="btn" href="/api/admin/backup-file" download>Download</a></span></div>
      <div class="setting"><div class="s-text"><div class="s-title">Install an update</div><div class="s-desc">${st.canSelfUpdate ? 'Choose the new Vesper .zip. Everyone’s data is backed up first and nobody is signed out. Every phone, browser and desktop app gets the new version.' : 'Available once Vesper runs on your server with the setup script. On a computer, unzip the new version and copy your data folder into it.'}</div></div><label class="btn primary" ${st.canSelfUpdate ? '' : 'aria-disabled="true" style="opacity:.5;pointer-events:none"'}>Choose .zip<input type="file" accept=".zip,application/zip" data-own="update" hidden></label></div>`;
    body.addEventListener('click', async (e) => { if (e.target.closest('[data-own="backup"]')) { try { const r = await api('/admin/backup', { method: 'POST', body: {} }); toast(`Backed up (${r.name})`); } catch (err) { toast(err.message, { error: true }); } } });
    body.addEventListener('change', async (e) => {
      const f = e.target.closest('[data-own="update"]')?.files?.[0]; if (!f) return;
      if (!await confirmDialog(`Install ${f.name}?`, 'Vesper backs up everyone’s data, installs the update and restarts. Music stops for a few seconds. Nobody is signed out.', 'Install update')) return;
      toast('Uploading update…', { ms: 20000 });
      try {
        const r = await fetch('/api/admin/update', { method: 'POST', headers: { 'x-vesper': '1', 'content-type': 'application/zip' }, body: f, credentials: 'same-origin' });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Update failed (${r.status})`);
        toast(`Installing Vesper ${j.to}… the page reloads when it’s ready.`, { ms: 30000 });
        const wait = async (n = 0) => { await new Promise((res) => setTimeout(res, 2000)); try { const h = await fetch('/api/health', { cache: 'no-store' }).then((x) => x.json()); if (h.version === j.to) return location.reload(); } catch {} if (n < 45) wait(n + 1); else toast('The server hasn’t come back yet. Check it, or reload in a minute.', { error: true }); };
        wait();
      } catch (err) { toast(err.message, { error: true }); }
    });
  })();
  el.querySelector('[data-set="crossfade"]').addEventListener('input', (e) => { el.querySelector('#cf-val').textContent = `${e.target.value} s`; });
  el.querySelector('.presets').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    await saveSettings({ transition: b.dataset.preset });
    el.querySelectorAll('[data-preset]').forEach((x) => { x.setAttribute('aria-pressed', String(x === b)); x.setAttribute('aria-checked', String(x === b)); });
    el.querySelector('[data-set="crossfade"]').disabled = !(['smooth', 'cinematic'].includes(b.dataset.preset) && caps.graph);
  });
  el.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x; if (!x) return;
    try {
      if (x === 'name') { const v = await formDialog('Display name', [{ name: 'displayName', label: 'Name', value: u.displayName, required: true }]); if (v) { store.user = (await api('/me', { method: 'PATCH', body: v })).user; emit('user'); settings(_p, el, app); } }
      if (x === 'secure') { const v = await formDialog('Add sign-in', [{ name: 'username', label: 'Username', required: true }, { name: 'password', label: 'Password (8+ characters)', type: 'password', required: true }], 'Save'); if (v) { store.user = (await api('/auth/register', { method: 'POST', body: v })).user; toast('Sign-in added'); settings(_p, el, app); } }
      if (x === 'credentials') { const v = await formDialog('Change username or password', [{ name: 'currentPassword', label: 'Current password', type: 'password', required: true }, { name: 'username', label: 'Username', value: u.username || '', required: true }, { name: 'newPassword', label: 'New password (leave blank to keep current)', type: 'password' }], 'Update sign-in'); if (v) { store.user = (await api('/me/credentials', { method: 'PUT', body: v })).user; toast('Sign-in updated'); settings(_p, el, app); } }
      if (x === 'logout') { await api('/auth/logout', { method: 'POST', body: {} }); location.reload(); }
      if (x === 'clear-history' && await confirmDialog('Clear listening history?', 'Stats, Recently played and history-based mixes will start over. Saved Replay recaps for finished years are kept; delete them from the Replay page if you want.', 'Clear')) { await api('/me/history', { method: 'DELETE' }); toast('Listening history cleared'); }
      if (x === 'clear-searches') { await api('/me/searches', { method: 'DELETE' }); toast('Search history cleared'); }
      if (x === 'delete' && await confirmDialog('Delete your profile?', 'Your playlists, likes, history and settings on this server will be permanently deleted.', 'Delete profile')) { await api('/me', { method: 'DELETE' }); localStorage.removeItem(`vesper.queue.${u.id}`); location.reload(); }
    } catch (err) { toast(err.message, { error: true }); }
  });
  const fbBox = el.querySelector('#fb');
  const drawFb = (f) => {
    const items = [...Object.entries(f.avoidArtists).map(([k, v]) => ({ type: 'avoid-artist', key: k, label: `Not recommending ${v.name}` })), ...Object.values(f.less).map((t) => ({ type: 'less', key: t.id, label: `Less like ${t.title}` })), ...Object.values(f.more).map((t) => ({ type: 'more', key: t.id, label: `More like ${t.title}` }))];
    fbBox.innerHTML = items.length ? `<div class="chips" style="margin-top:8px">${items.map((i) => `<button class="chip" data-fb="${i.type}" data-key="${attr(i.key)}" title="Remove">${esc(i.label)} ✕</button>`).join('')}</div>` : 'None yet. Use a song’s menu to steer recommendations.';
  };
  api('/me/feedback').then((r) => drawFb(r.feedback));
  fbBox.addEventListener('click', async (e) => { const b = e.target.closest('[data-fb]'); if (b) drawFb((await api(`/me/feedback/${b.dataset.fb}/${encodeURIComponent(b.dataset.key)}`, { method: 'DELETE' })).feedback); });
  const src = await api('/sources');
  el.querySelector('#sources').innerHTML = src.providers.map((pv) => `<div class="source-row"><div><div class="s-title">${esc(pv.name)}</div><div class="s-desc note">${pv.fullTracks ? 'Full-length catalog' : 'Catalog / discovery source'}. ${esc(pv.limitation)}${pv.status !== 'ready' && pv.setup ? ` <b>Setup:</b> ${esc(pv.setup)}` : ''}${pv.id === 'local' && pv.root ? ` Folder: ${esc(pv.root)} (${pv.count} files).` : ''}</div></div><span class="status-pill ${pv.status === 'ready' ? 'ready' : ''}">${{ ready: 'Ready', 'needs-key': 'Needs key', 'not-configured': 'Not set up', disabled: 'Off' }[pv.status]}</span></div>`).join('')
    + (src.providers.find((x) => x.id === 'local')?.status === 'ready' ? '<div class="actions"><button class="btn sm ghost" id="rescan">Rescan music folder</button></div>' : '')
    + `<h3 style="font-size:17px;margin:22px 0 6px">Not integrated</h3>${src.notIntegrated.map((n) => `<div class="source-row"><div><div class="s-title">${esc(n.name)}</div><div class="s-desc note">${esc(n.needs)}</div></div><span class="status-pill">Not built</span></div>`).join('')}`;
  el.querySelector('#rescan')?.addEventListener('click', async () => { const r = await api('/local/rescan', { method: 'POST', body: {} }); toast(`Found ${r.status.count} files`); });
}

// ---------- Welcome / sign in ----------
export function renderAuth(container, onDone, app = null) {
  let mode = 'guest';
  let registerStep = 0;
  let registerDetails = null;
  let artistQuery = '';
  let artistSearchResults = [];
  let artistSearchBusy = false;
  let artistSearchError = '';
  const selectedArtists = new Map();
  const artistArtworkCache = new Map();
  const onboardingTopTracks = new Map();
  const onboardingTrackLoads = new Map();
  const norm = (s) => String(s || '').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  // Starter catalog is grouped by genre and ordered roughly from broadly popular to more niche.
  // Search below lets people find artists outside this curated starter list.
  const genres = [
    ['Hip-hop & Rap', ['Drake', 'Kendrick Lamar', 'Travis Scott', 'Future', 'Playboi Carti', '21 Savage', 'Tyler, The Creator', 'Nicki Minaj', 'Lil Uzi Vert', 'Yeat', 'J. Cole', 'Don Toliver', 'Baby Keem', 'Chief Keef', 'Ken Carson', 'Destroy Lonely']],
    ['R&B & Soul', ['The Weeknd', 'SZA', 'Frank Ocean', 'Daniel Caesar', 'Brent Faiyaz', 'Steve Lacy', 'Summer Walker', 'Giveon', 'PARTYNEXTDOOR', 'Cleo Sol', 'Snoh Aalegra', 'Omar Apollo']],
    ['Pop', ['Taylor Swift', 'Billie Eilish', 'Ariana Grande', 'Sabrina Carpenter', 'Olivia Rodrigo', 'Dua Lipa', 'Lady Gaga', 'Chappell Roan', 'Lana Del Rey', 'Charli xcx', 'Tate McRae', 'Lorde']],
    ['Alternative & Indie', ['The Neighbourhood', 'Tame Impala', 'Arctic Monkeys', 'TV Girl', 'Cigarettes After Sex', 'Laufey', 'Clairo', 'beabadoobee', 'Joji', 'The Marías', 'Mac DeMarco', 'Phoebe Bridgers']],
    ['Rock & Metal', ['Nirvana', 'The Beatles', 'Radiohead', 'Queen', 'The Rolling Stones', 'Deftones', 'Metallica', 'Linkin Park', 'Foo Fighters', 'System of a Down', 'The Cure', 'Paramore']],
    ['Latin', ['Bad Bunny', 'Peso Pluma', 'KAROL G', 'Feid', 'Rauw Alejandro', 'Shakira', 'J Balvin', 'Rosalía', 'Junior H', 'Natanael Cano', 'Fuerza Regida', 'Ivan Cornejo']],
    ['Afrobeats & Amapiano', ['Burna Boy', 'Wizkid', 'Tems', 'Rema', 'Davido', 'Ayra Starr', 'Asake', 'Omah Lay', 'Tyler ICU', 'Uncle Waffles']],
    ['K-pop', ['BTS', 'BLACKPINK', 'Stray Kids', 'NewJeans', 'TWICE', 'Jung Kook', 'SEVENTEEN', 'LE SSERAFIM', 'aespa', 'ENHYPEN']],
    ['Electronic & Dance', ['Calvin Harris', 'David Guetta', 'Skrillex', 'Fred again..', 'Daft Punk', 'Tiësto', 'Disclosure', 'Peggy Gou', 'Four Tet', 'Jamie xx']],
    ['Country & Folk', ['Morgan Wallen', 'Luke Combs', 'Zach Bryan', 'Noah Kahan', 'Kacey Musgraves', 'Tyler Childers', 'Chris Stapleton', 'Megan Moroney', 'Hozier', 'Mumford & Sons']],
    ['Jazz & Instrumental', ['Miles Davis', 'Laufey', 'John Coltrane', 'Ella Fitzgerald', 'Chet Baker', 'Billie Holiday', 'Nujabes', 'Yussef Dayes']]
  ];
  const artistKey = (a) => norm(typeof a === 'string' ? a : (a?.name || ''));
  // While onboarding is open, fetch Deezer's top tracks for selected artists. Matching starts
  // quietly as soon as registration succeeds, while the follow-up steps are still running.
  const loadOnboardingTracks = (picked) => {
    const key = artistKey(picked);
    if (!key || onboardingTopTracks.has(key)) return Promise.resolve(onboardingTopTracks.get(key) || []);
    if (onboardingTrackLoads.has(key)) return onboardingTrackLoads.get(key);
    const task = (async () => {
      try {
        let id = picked?.id || null;
        if (!id) { const found = await api(`/artist-by-name?name=${encodeURIComponent(picked?.name || '')}`); id = found.artist?.id || found.redirect || null; }
        if (!id) return [];
        const detail = await api(`/artist-top/${encodeURIComponent(id)}?limit=2`);
        const tracks = (detail.tracks || []).slice(0, 2).filter((t) => t?.title && t?.artist && /^(dz|it):/.test(String(t.id || '')));
        onboardingTopTracks.set(key, tracks);
        return tracks;
      } catch { onboardingTopTracks.set(key, []); return []; }
      finally { onboardingTrackLoads.delete(key); }
    })();
    onboardingTrackLoads.set(key, task); return task;
  };
  const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const artistButton = (name, genre, item = null) => {
    const validItem = item && typeof item === 'object' ? item : null;
    const label = String(validItem?.name || name || 'Unknown artist');
    const key = artistKey(validItem || label), active = selectedArtists.has(key);
    const art = validItem?.artwork || validItem?.artworkSmall || artistArtworkCache.get(norm(label)) || '';
    const initials = label.split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase();
    return `<button type="button" class="artist-pick${active ? ' selected' : ''}" data-pick-artist="${escapeHtml(key)}" data-artist-name="${escapeHtml(label)}" data-artist-genre="${escapeHtml(genre || 'Artist search')}" ${active ? 'aria-pressed="true"' : 'aria-pressed="false"'}>${artistPhoto({ id: validItem?.id || null, name: label, artwork: art || null }, 'artist-pick-photo')}<span class="artist-pick-name">${escapeHtml(label)}</span><span class="artist-pick-check">${active ? '✓' : '+'}</span></button>`;
  };
  const draw = () => {
    const choosingArtists = mode === 'register' && registerStep === 1;
    const genreMarkup = genres.map(([genre, names]) => `<section class="artist-genre"><h3>${escapeHtml(genre)}</h3><div class="artist-pick-grid">${names.map((name) => artistButton(name, genre)).join('')}</div></section>`).join('');
    const selectedMarkup = selectedArtists.size ? [...selectedArtists.values()].map((a) => `<button type="button" class="artist-selected-chip" data-remove-artist="${escapeHtml(artistKey(a))}">${escapeHtml(a.name)} <span>×</span></button>`).join('') : '<span class="artist-selection-empty">Choose at least one artist to continue.</span>';
    container.innerHTML = `<div class="auth-card${choosingArtists ? ' auth-card-wide' : ''}"><div class="brand"><svg viewBox="0 0 32 32" class="brand-mark" aria-hidden="true"><path d="M23.5 6.2A11 11 0 1 0 25.8 22 8.6 8.6 0 0 1 23.5 6.2Z" fill="currentColor"/><circle cx="24.6" cy="9.4" r="1.6" fill="currentColor"/></svg><span>Vesper</span></div>
      ${choosingArtists ? `<div class="artist-onboarding-head"><span class="onboarding-step">STEP 2 OF 2</span><h1>Who do you love listening to?</h1><p>Follow at least one artist to create your account. We'll use your picks to personalize recommendations, Daily Mixes and new releases.</p></div><div class="artist-selection-bar"><div><b>${selectedArtists.size} artists selected</b><small>Choose a few across any genres</small></div><div class="artist-selected-chips">${selectedMarkup}</div></div>
      <div class="artist-search-wrap"><label for="artist-onboarding-search">Find any artist</label><input class="input" id="artist-onboarding-search" type="search" placeholder="Search artists beyond this list…" value="${escapeHtml(artistQuery)}" autocomplete="off"><div class="artist-search-status" aria-live="polite">${artistSearchBusy ? 'Searching artists…' : escapeHtml(artistSearchError || '')}</div>${artistSearchResults.length ? `<div class="artist-pick-grid artist-search-results">${artistSearchResults.map((a) => artistButton(a.name, 'Artist search', a)).join('')}</div>` : ''}</div>
      <div class="artist-genre-list">${genreMarkup}</div><div class="auth-err" role="alert" id="auth-err"></div><div class="artist-onboarding-actions"><button class="btn ghost" type="button" data-reg-back>Back</button><button class="btn primary" type="button" data-create-account ${selectedArtists.size ? '' : 'disabled'}>Create account & follow ${selectedArtists.size || 'artists'}</button></div>` : `<h1>Music for the hours after dark</h1><p>Search real songs, follow artists, and let one song lead you to the next.</p>
      <div class="auth-tabs chips">${[['guest', 'Start listening'], ['login', 'Sign in'], ['register', 'Create account']].map(([k, l]) => `<button class="chip" data-mode="${k}" aria-pressed="${k === mode}">${l}</button>`).join('')}</div>
      <form id="auth-form">${mode === 'guest' ? '<div class="field"><label for="a-name">What should we call you?</label><input class="input" id="a-name" name="displayName" required maxlength="40" autocomplete="nickname"></div>'
        : `<div class="field"><label for="a-user">Username</label><input class="input" id="a-user" name="username" required autocomplete="username"></div><div class="field"><label for="a-pass">Password</label><input class="input" id="a-pass" name="password" type="password" required autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></div>${mode === 'register' ? '<div class="field"><label for="a-name">Display name</label><input class="input" id="a-name" name="displayName" maxlength="40" autocomplete="nickname"></div>' : ''}`}
        <div class="auth-err" role="alert" id="auth-err"></div><button class="btn primary" style="width:100%;justify-content:center;height:46px">${{ guest: 'Continue', login: 'Sign in', register: 'Choose favorite artists →' }[mode]}</button></form>
      <p class="note" style="margin-top:18px">${mode === 'guest' ? 'A guest profile lives on this Vesper server. You can add a username and password later to use it from your phone.' : mode === 'register' ? 'Before creating your account, choose artists so Vesper can personalize your music from day one.' : 'Accounts are stored on this Vesper server only.'}</p>`}</div>`;
    // Curated starter artists resolve their real artist portrait from the provider instead of
    // displaying initials. Load near the viewport to avoid firing a request for every card at once.
    const loadArtistCard = async (card) => {
      if (!card || card.dataset.artLoading || card.querySelector('img')) return;
      card.dataset.artLoading = '1';
      const name = card.dataset.artistName || '';
      try {
        const result = await api(`/search?q=${encodeURIComponent(name)}&source=deezer`);
        const wanted = norm(name);
        const match = (result.artists || []).find((a) => norm(a.name) === wanted && (a.artwork || a.artworkSmall))
          || (result.artists || []).find((a) => norm(a.name).includes(wanted) && (a.artwork || a.artworkSmall));
        const url = match?.artwork || match?.artworkSmall;
        if (url) artistArtworkCache.set(wanted, url);
        if (url && card.isConnected) {
          const img = document.createElement('img'); img.src = url; img.alt = `${name} artist portrait`; img.loading = 'lazy';
          img.onerror = () => { const fallback = document.createElement('span'); fallback.className = 'artist-pick-avatar'; fallback.textContent = name.split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase(); img.replaceWith(fallback); delete card.dataset.artLoading; };
          card.querySelector('[data-artist-art-pending]')?.replaceWith(img);
        }
      } catch { /* initials remain as a graceful fallback if the provider has no portrait */ }
    };
    const artistCards = [...container.querySelectorAll('[data-pick-artist]')].filter((card) => card.querySelector('[data-artist-art-pending]'));
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { observer.unobserve(entry.target); loadArtistCard(entry.target); } }), { rootMargin: '320px 0px' });
      artistCards.forEach((card) => observer.observe(card));
    } else artistCards.slice(0, 16).forEach(loadArtistCard);
    container.querySelector('.auth-tabs')?.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) { mode = b.dataset.mode; registerStep = 0; registerDetails = null; draw(); } });
    container.querySelector('#auth-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      if (mode === 'register') { registerDetails = body; registerStep = 1; draw(); return; }
      try {
        const r = await api(`/auth/${mode}`, { method: 'POST', body }); store.user = r.user;
        if (r.user.mustChangePassword) {
          const change = await formDialog('Secure your owner account', [{ name: 'currentPassword', label: 'Current starter password', type: 'password', required: true }, { name: 'username', label: 'Username', value: r.user.username || 'Isaac', required: true }, { name: 'newPassword', label: 'Choose a new password (8+ characters)', type: 'password', required: true }], 'Save secure sign-in');
          if (!change) { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); store.user = null; throw new Error('Change the starter password before using Vesper. Sign in again when you’re ready.'); }
          try { store.user = (await api('/me/credentials', { method: 'PUT', body: change })).user; }
          catch (err) { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); store.user = null; throw err; }
        }
        onDone();
      }
      catch (err) { const target = container.querySelector('#auth-err'); if (target) target.textContent = err.message; }
    });
    container.querySelector('[data-reg-back]')?.addEventListener('click', () => { registerStep = 0; draw(); });
    container.querySelectorAll('[data-pick-artist]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.pickArtist;
      if (selectedArtists.has(key)) selectedArtists.delete(key);
      else {
        const result = artistSearchResults.find((a) => artistKey(a) === key);
        const picked = result ? { ...result, genre: b.dataset.artistGenre } : { name: b.dataset.artistName, genre: b.dataset.artistGenre };
        selectedArtists.set(key, picked);
        loadOnboardingTracks(picked);
      }
      draw();
    }));
    container.querySelectorAll('[data-remove-artist]').forEach((b) => b.addEventListener('click', () => { selectedArtists.delete(b.dataset.removeArtist); draw(); }));
    const searchInput = container.querySelector('#artist-onboarding-search');
    if (searchInput) searchInput.addEventListener('input', () => {
      artistQuery = searchInput.value;
      clearTimeout(searchInput._timer);
      searchInput._timer = setTimeout(async () => {
        const q = artistQuery.trim();
        if (q.length < 2) { artistSearchResults = []; artistSearchBusy = false; artistSearchError = ''; draw(); return; }
        artistSearchBusy = true; artistSearchError = ''; const current = q; draw();
        try { const r = await api(`/search?q=${encodeURIComponent(current)}&source=deezer`); if (artistQuery.trim() !== current) return; artistSearchResults = (r.artists || []).filter((a) => a && typeof a.name === 'string' && a.name.trim()).slice(0, 12); artistSearchError = artistSearchResults.length ? '' : 'No artists found. Try a different spelling.'; }
        catch (err) { if (artistQuery.trim() === current) { artistSearchResults = []; artistSearchError = err.message; } }
        if (artistQuery.trim() === current) { artistSearchBusy = false; draw(); const next = container.querySelector('#artist-onboarding-search'); if (next) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); } }
      }, 280);
    });
    container.querySelector('[data-create-account]')?.addEventListener('click', async () => {
      const errBox = container.querySelector('#auth-err');
      if (!selectedArtists.size) { if (errBox) errBox.textContent = 'Choose at least one artist to continue.'; return; }
      const submit = container.querySelector('[data-create-account]'); submit.disabled = true; submit.textContent = 'Creating your account…';
      try {
        const chosen = [...selectedArtists.values()];
        const r = await api('/auth/register', { method: 'POST', body: { ...(registerDetails || {}), favoriteArtists: chosen.map((a) => ({ id: a.id || null, name: a.name, artwork: a.artwork || null, artworkSmall: a.artworkSmall || null, genre: a.genre || null })) } }); store.user = r.user;
        // Prioritize any tracks already fetched during onboarding. Finish remaining catalog
        // lookups in the background; account creation must not wait on recommendation prep.
        const readyTracks = chosen.flatMap((a) => onboardingTopTracks.get(artistKey(a)) || []);
        app?.queue?.prewarmTracks(readyTracks, { priority: true });
        for (const picked of chosen) {
          loadOnboardingTracks(picked).then((tracks) => app?.queue?.prewarmTracks(tracks, { priority: true })).catch(() => {});
        }
        let failed = 0;
        for (const picked of chosen) {
          try {
            let artist = picked;
            if (!artist.id) {
              const result = await api(`/artist-by-name?name=${encodeURIComponent(picked.name)}`);
              artist = result.artist || (result.redirect ? { id: result.redirect, name: picked.name } : null);
            }
            if (!artist?.id) { failed++; continue; }
            await api(`/me/artists/${encodeURIComponent(artist.id)}`, { method: 'PUT', body: { artist: { id: artist.id, name: artist.name || picked.name, artwork: artist.artwork || null, artworkSmall: artist.artworkSmall || null } } });
          } catch { failed++; }
        }
        await loadLibrary().catch(() => {});
        onDone();
        if (failed) setTimeout(() => toast(`Account created. ${failed} artist${failed === 1 ? '' : 's'} couldn't be matched; you can follow them from Search.`), 250);
      } catch (err) { const target = container.querySelector('#auth-err'); if (target) target.textContent = err.message; const btn = container.querySelector('[data-create-account]'); if (btn) { btn.disabled = false; btn.textContent = `Create account & follow ${selectedArtists.size}`; } }
    });
    container.querySelector('#a-user')?.focus();
  };
  draw();
}
void fmtTime; void providerName;
