// Vesper Replay: annual and custom listening recaps with story cards and a shareable image.
import { api, store, proxied } from './store.js';
import { esc, attr, fmtLong, plural, toast, confirmDialog, skeletonRows, errorNote } from './ui.js';
import { palette } from './color.js';

const mins = (ms) => Math.round(ms / 60000).toLocaleString();
const hueOf = (y) => { const n = parseInt(String(y).match(/\d+/)?.[0] || '7', 10); return (n * 47 + 250) % 360; };
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourName = (h) => (h === 0 ? 'midnight' : h < 12 ? `${h} am` : h === 12 ? 'noon' : `${h - 12} pm`);

let APP = null;
export async function replayView(p, el, app) {
  if (app) APP = app;
  el.innerHTML = `<h1 class="page-title">Vesper Replay</h1><p class="lede">Your listening, recapped from what you actually played on Vesper. Finished years are kept, and you can make a recap for any dates.</p>${skeletonRows(2)}`;
  const { years } = await api('/me/replay');
  const cy = new Date().getUTCFullYear();
  const today = new Date().toISOString().slice(0, 10), monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  el.innerHTML = `<h1 class="page-title">Vesper Replay</h1><p class="lede">Your listening, recapped from what you actually played on Vesper. Finished years are prepared automatically and kept, and you can make a recap for any dates.</p>
    ${years.length ? `<div class="replay-years">${years.map((y) => `<button class="replay-card" style="--h:${hueOf(y.year)}" data-year="${y.year}"><b>${y.year}</b><span>${y.status === 'final' ? 'Year complete' : 'So far this year'}</span></button>`).join('')}</div>` : `<div class="empty"><h2>No recap yet</h2><p>Replay is built from songs you play here. Listen for a while and your ${cy} recap will start filling in.</p></div>`}
    <section class="section"><div class="section-head"><h2>Custom recap</h2></div>
      <form id="custom" class="actions" style="margin-top:0"><label class="field" style="margin:0">From<input class="input" type="date" name="from" value="${monthAgo}" max="${today}" required></label><label class="field" style="margin:0">To<input class="input" type="date" name="to" value="${today}" max="${today}" required></label><button class="btn primary" style="align-self:flex-end">Create recap</button></form></section>
    <section class="section"><div class="section-head"><h2>How Replay counts</h2></div><p class="note" style="font-size:14px;max-width:70ch">A listen is at least 30 seconds of a full track, or 15 seconds of a short catalog clip. Shorter plays are shown as brief starts and never count toward top songs or artists. Time only counts while audio is actually playing, so skipping ahead doesn’t add minutes. Short clips and full-length listens are shown separately. Test signals are excluded. Nothing is imported or estimated.</p>
    ${years.some((y) => y.saved) ? `<p class="note" style="font-size:14px">Saved recaps for finished years: ${years.filter((y) => y.saved).map((y) => `${y.year} <button class="text-btn" data-del="${y.year}">Delete</button>`).join(' ')}</p>` : ''}</section>`;
  el.querySelector('.replay-years')?.addEventListener('click', async (e) => { const b = e.target.closest('[data-year]'); if (b) openStory((await api(`/me/replay/year/${b.dataset.year}`)).replay); });
  el.querySelector('#custom').addEventListener('submit', async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); try { openStory((await api(`/me/replay/custom?from=${f.from}&to=${f.to}`)).replay); } catch (err) { toast(err.message, { error: true }); } });
  el.addEventListener('click', async (e) => { const b = e.target.closest('[data-del]'); if (b && await confirmDialog(`Delete the ${b.dataset.del} recap?`, 'Your listening history isn’t affected. If history for that year still exists, the recap is rebuilt next time you open Replay.', 'Delete recap')) { await api(`/me/replay/year/${b.dataset.del}`, { method: 'DELETE' }); replayView(p, el); } });
}

function cards(r) {
  const T = r.totals, out = [], songs = [];
  const tops = r.topTracks.map((x) => x.track);
  const push = (html, song) => { out.push(html); songs.push(song || null); };
  const img = (u) => (u ? `<img class="cover" src="${attr(proxied(u))}" alt="">` : '');
  const list = (items) => `<div class="story-list">${items.map((x) => `<div><img src="${attr(proxied(x.art) || '')}" alt=""><span><b>${esc(x.title)}</b><span>${esc(x.sub)}</span></span></div>`).join('')}</div>`;
  push(`<p class="lead">${esc(r.label)}</p><div class="big">${mins(T.listenMs)}</div><h2>minutes of music</h2><p class="small">${plural(T.listens, 'listen')} across ${plural(T.uniqueArtists, 'artist')} on ${plural(T.activeDays, 'day')}.</p>`);
  const tt = r.topTracks[0];
  if (tt) push(`<p class="lead">Your top song</p>${img(tt.track.artwork || tt.track.artworkSmall)}<h2>${esc(tt.track.title)}</h2><p class="lead">${esc(tt.track.artist)}</p><p class="small">${plural(tt.listens, 'listen')}, ${fmtLong(tt.ms)}</p>`, tt.track);
  if (r.topTracks.length > 1) push(`<h2>Top songs</h2>${list(r.topTracks.slice(0, 5).map((x) => ({ art: x.track.artworkSmall || x.track.artwork, title: x.track.title, sub: `${x.track.artist}, ${plural(x.listens, 'listen')}` })))}`, tops[1]);
  const ta = r.topArtists[0];
  if (ta) push(`<p class="lead">Your top artist</p>${img(ta.artwork)}<h2>${esc(ta.name)}</h2><p class="small">${mins(ta.ms)} minutes, ${plural(ta.listens, 'listen')}</p>`, tops.find((t) => String(t.artist).toLowerCase() === String(ta.name).toLowerCase()) || tops[2]);
  if (r.topArtists.length > 1) push(`<h2>Top artists</h2>${list(r.topArtists.slice(0, 5).map((a) => ({ art: a.artwork, title: a.name, sub: `${mins(a.ms)} minutes` })))}`);
  if (r.topAlbums.length || r.genres.length) push(`${r.topAlbums.length ? `<h2>Albums you lived in</h2>${list(r.topAlbums.slice(0, 3).map((a) => ({ art: a.artwork, title: a.title, sub: a.artist })))}` : ''}${r.genres.length ? `<p class="lead">Genres: ${r.genres.slice(0, 3).map((g) => esc(g.name)).join(', ')}</p>` : '<p class="small">Not enough genre information to show favourite genres.</p>'}`);
  const peakH = r.byHour.indexOf(Math.max(...r.byHour)), maxH = Math.max(1, ...r.byHour), peakD = r.byWeekday.indexOf(Math.max(...r.byWeekday));
  if (T.ms) push(`<h2>When you listened</h2><div class="story-bars-chart">${r.byHour.map((v) => `<div style="height:${(v / maxH) * 100}%"></div>`).join('')}</div><p class="small" style="display:flex;justify-content:space-between"><span>Midnight</span><span>Noon</span><span>11 pm</span></p><p class="lead">Most listening around ${hourName(peakH)}, and most of all on ${DOW[peakD]}s.</p>`);
  const series = r.byMonth.length >= 2 ? r.byMonth : r.byWeek;
  if (series.length >= 2) { const m = Math.max(1, ...series.map((x) => x.ms)); const top = series.reduce((a, b) => (b.ms > a.ms ? b : a)); push(`<h2>${r.byMonth.length >= 2 ? 'Month by month' : 'Week by week'}</h2><div class="story-bars-chart">${series.map((x) => `<div style="height:${(x.ms / m) * 100}%"></div>`).join('')}</div><p class="lead">Your biggest ${r.byMonth.length >= 2 ? 'month was ' + new Date(top.key + '-15').toLocaleDateString(undefined, { month: 'long' }) : 'week was ' + top.key}, with ${mins(top.ms)} minutes.</p>`); }
  if (r.longestStreak.days) push(`<p class="lead">Longest streak</p><div class="big">${r.longestStreak.days}</div><h2>day${r.longestStreak.days === 1 ? '' : 's'} in a row</h2><p class="small">${r.longestStreak.from} to ${r.longestStreak.to}${r.biggestDay ? `. Biggest day: ${r.biggestDay.date}, ${mins(r.biggestDay.ms)} minutes.` : ''}</p>`);
  if (r.discoveries.length && r.discoveriesMeaningful) push(`<h2>New to you</h2><p class="lead">Artists you heard for the first time in this period.</p>${list(r.discoveries.slice(0, 5).map((a) => ({ art: a.artwork, title: a.name, sub: `${mins(a.ms)} minutes` })))}`);
  if (r.tasteShift && (r.tasteShift.rising.length || r.tasteShift.fading.length)) push(`<h2>How your taste moved</h2>${r.tasteShift.rising.length ? `<p class="lead">Played more in the second half: ${r.tasteShift.rising.map((x) => esc(x.name)).join(', ')}.</p>` : ''}${r.tasteShift.fading.length ? `<p class="lead">Played less: ${r.tasteShift.fading.map((x) => esc(x.name)).join(', ')}.</p>` : ''}<p class="small">Compares each artist’s share of your listening in the first and second half of the period.</p>`);
  if (r.milestones.length) push(`<h2>Milestones</h2>${r.milestones.map((m) => `<p class="lead">${esc(m.text)}</p>`).join('')}`);
  push(`<h2>The honest numbers</h2><p class="lead">${plural(T.fullListens, 'full-track listen')}<br>${plural(T.previewListens, 'short-clip listen')}<br>${plural(T.briefStarts, 'brief start')} not counted</p><p class="small">Counted from real playback time recorded by Vesper.</p>`);
  push(`<p class="lead">${esc(r.label)}</p><h2>That’s your Replay</h2><p class="lead">${mins(T.listenMs)} minutes${ta ? `, led by ${esc(ta.name)}` : ''}.</p><p class="small">Only you can see this. Sharing creates an image you choose where to send.</p>`);
  if (tops.length) push(`<p class="lead">Made from your ${esc(r.label)}</p><h2>Your Top Songs</h2><div class="replay-mix-art">${tops.slice(0, 4).map((t) => `<img src="${attr(proxied(t.albumArtwork || t.artwork || t.artworkSmall) || '')}" alt="">`).join('')}</div><p class="lead">${plural(Math.min(tops.length, 50), 'song')} you played most, in order.</p><div class="story-actions"><button class="btn primary" data-s="play-mix">Play</button><button class="btn" data-s="save-mix">Save as playlist</button></div>`, tops[0]);
  // Cards without their own song cycle through the rest of the top songs, so it sounds like your year.
  let k = 3;
  for (let j = 0; j < songs.length; j++) if (!songs[j] && tops.length) songs[j] = tops[(k++) % tops.length];
  return { html: out, songs };
}

export async function openStory(r) {
  if (!r.totals.listens) { toast('No listens in this period yet. Replay counts plays of at least 30 seconds (15 for short clips).'); return; }
  const el = document.getElementById('story');
  const built = cards(r), list = built.html;
  let i = 0, timer = 0, held = false;
  const music = soundtrack();
  const reduced = () => store.settings.reducedMotion === 'on' || (store.settings.reducedMotion !== 'off' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const art = r.topTracks[0]?.track.artwork || r.topArtists[0]?.artwork;
  const pal = art ? await palette(art) : null;
  const rgb = (c, l) => c ? `hsl(${Math.round(c.h)} ${Math.round(Math.min(.7, c.s + .1) * 100)}% ${l}%)` : null;
  el.style.setProperty('--s1', rgb(pal?.vivid, 36) || `hsl(${hueOf(r.label)} 50% 34%)`);
  el.style.setProperty('--s2', rgb(pal?.second, 10) || '#0f1020');
  el.innerHTML = `<div><div class="story-bars">${list.map(() => '<span><i></i></span>').join('')}</div><div class="story-top"><span>Vesper Replay</span><span><button class="icon-btn" data-s="mute" aria-label="Mute soundtrack">${music.muted ? '🔇' : '🔊'}</button><button class="icon-btn" data-s="pause" aria-label="Pause story">❚❚</button><button class="icon-btn" data-s="close" aria-label="Close">✕</button></span></div></div>
    <div class="story-stage"><div class="story-card" id="story-card" aria-live="polite"></div><div class="story-nav"><button data-s="prev" aria-label="Previous card"></button><button data-s="next" aria-label="Next card"></button></div></div>
    <div class="story-foot"><button class="btn" data-s="share">Share image</button></div>`;
  const bars = [...el.querySelectorAll('.story-bars span')];
  const show = (k) => {
    i = Math.max(0, Math.min(list.length - 1, k));
    el.querySelector('#story-card').innerHTML = list[i];
    music.play(built.songs[i]);
    bars.forEach((b, j) => { b.classList.toggle('done', j < i); const f = b.querySelector('i'); f.style.transition = 'none'; f.style.width = j < i ? '100%' : '0'; });
    clearTimeout(timer);
    if (!reduced() && !held && i < list.length - 1) {
      const f = bars[i].querySelector('i'); requestAnimationFrame(() => { f.style.transition = 'width 7s linear'; f.style.width = '100%'; });
      timer = setTimeout(() => show(i + 1), 7000);
    }
  };
  const close = () => { clearTimeout(timer); music.stop(); el.hidden = true; document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); };
  el.onclick = (e) => {
    const s = e.target.closest('[data-s]')?.dataset.s;
    if (s === 'next') show(i + 1); if (s === 'prev') show(i - 1); if (s === 'close') close();
    if (s === 'pause') { held = !held; e.target.textContent = held ? '▶' : '❚❚'; e.target.setAttribute('aria-label', held ? 'Resume story' : 'Pause story'); show(i); }
    if (s === 'share') shareImage(r).catch((err) => toast(err.message, { error: true }));
    if (s === 'mute') { music.setMuted(!music.muted); e.target.closest('button').textContent = music.muted ? '🔇' : '🔊'; if (!music.muted) music.play(built.songs[i], true); }
    if (s === 'play-mix') { close(); playMix(r); }
    if (s === 'save-mix') saveMix(r).catch((err) => toast(err.message, { error: true }));
  };
  document.addEventListener('keydown', key);
  el.hidden = false; show(0); el.querySelector('[data-s="close"]').focus();
}

async function loadImg(u) { if (!u) return null; return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = proxied(u); }); }
export async function renderShareCanvas(r) {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
  const x = c.getContext('2d');
  const st = getComputedStyle(document.getElementById('story'));
  const g = x.createLinearGradient(0, 0, 1080, 1350); g.addColorStop(0, st.getPropertyValue('--s1').trim() || '#3b2d78'); g.addColorStop(1, st.getPropertyValue('--s2').trim() || '#0f1020');
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
  const font = (w, s) => `${w} ${s}px "Bricolage Grotesque", "Figtree", system-ui, sans-serif`;
  x.fillStyle = '#fff'; x.font = font(600, 40); x.fillText(`Vesper Replay, ${r.label}`, 80, 120);
  x.font = font(700, 170); x.fillText(mins(r.totals.listenMs), 80, 320);
  x.font = font(600, 48); x.fillText('minutes of music', 80, 390);
  const cover = await loadImg(r.topTracks[0]?.track.artwork);
  if (cover) x.drawImage(cover, 720, 70, 280, 280);
  const col = (title, items, X) => { x.font = font(650, 40); x.fillText(title, X, 520); items.slice(0, 5).forEach((t, k) => { x.font = font(600, 34); x.globalAlpha = .7; x.fillText(String(k + 1), X, 600 + k * 120); x.globalAlpha = 1; const s = t.length > 22 ? `${t.slice(0, 21)}…` : t; x.fillText(s, X + 50, 600 + k * 120); }); };
  col('Top songs', r.topTracks.map((t) => t.track.title), 80);
  col('Top artists', r.topArtists.map((a) => a.name), 580);
  x.font = font(500, 28); x.globalAlpha = .75; x.fillText(`${plural(r.totals.listens, 'listen')}, ${plural(r.totals.uniqueArtists, 'artist')}, longest streak ${r.longestStreak.days} days`, 80, 1250); x.globalAlpha = 1;
  return c;
}
async function shareImage(r) {
  const c = await renderShareCanvas(r);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const file = new File([blob], `vesper-replay-${String(r.label).replace(/\W+/g, '-')}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'My Vesper Replay' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Replay image saved');
}
void errorNote;

// ---------- Replay soundtrack ----------
// Each card plays one of your top songs, like a recap video. It uses its own small player so it
// never touches your queue or counts toward your stats. The main player is paused and resumed after.
function soundtrack() {
  const engine = APP?.engine;
  const resume = engine && !engine.paused && engine.state.track;
  if (resume) engine.pause();
  const a = new Audio(); a.preload = 'auto'; a.setAttribute('playsinline', '');
  let current = null, fadeT = 0;
  const st = { muted: localStorage.getItem('vesper.replayMuted') === '1' };
  const fade = (to, ms, done) => {
    clearInterval(fadeT); const from = a.volume, steps = Math.max(1, Math.round(ms / 40)); let k = 0;
    fadeT = setInterval(() => { k++; try { a.volume = Math.max(0, Math.min(1, from + (to - from) * (k / steps))); } catch { /* iOS volume is fixed */ } if (k >= steps) { clearInterval(fadeT); done?.(); } }, 40);
  };
  const srcFor = (t) => {
    const dz = [t.sourceId, t.id].find((x) => /^(dz|it):/.test(x || ''));
    if (dz) return { url: `/api/audio/${encodeURIComponent(dz)}`, at: 0 }; // 30-second clip, small download
    if (/^(yt|lc|jm):/.test(t.id || '')) return { url: `/api/audio/${encodeURIComponent(t.id)}${t.id.startsWith('yt:') ? '?q=low' : ''}`, at: Math.max(20, (t.duration || 180) * 0.35) }; // jump to around the chorus
    return null;
  };
  st.play = (t, force = false) => {
    if (st.muted || !t) return;
    if (!force && current && current.id === t.id) return;
    current = t; const src = srcFor(t); if (!src) return;
    const start = () => { a.src = src.url; a.currentTime = 0; try { a.volume = 0; } catch {} a.play().then(() => { if (src.at) a.currentTime = src.at; fade(0.85, 900); }).catch(() => {}); };
    if (!a.paused && a.src) fade(0, 350, start); else start();
  };
  st.setMuted = (m) => { st.muted = m; localStorage.setItem('vesper.replayMuted', m ? '1' : '0'); if (m) { fade(0, 250, () => a.pause()); current = null; } };
  st.stop = () => { fade(0, 300, () => { a.pause(); a.removeAttribute('src'); a.load(); }); if (resume) setTimeout(() => engine.play?.(), 350); };
  return st;
}
function mixTracks(r) { return r.topTracks.map((x) => x.track).filter((t) => t && t.playable !== false).slice(0, 50); }
function playMix(r) {
  const tracks = mixTracks(r); if (!tracks.length || !APP?.queue) return;
  APP.queue.playList(tracks, 0, { name: `Your Top Songs: ${r.label}`, href: '#/replay' });
  toast(`Playing your top ${tracks.length} songs`);
}
async function saveMix(r) {
  const tracks = mixTracks(r); if (!tracks.length) return;
  const { playlist } = await api('/me/playlists', { method: 'POST', body: { name: `Your Top Songs: ${r.label}`, description: 'Made by Vesper Replay from what you played most.', tracks } });
  const { refreshPlaylists } = await import('./store.js'); await refreshPlaylists().catch(() => {});
  toast('Saved to your playlists', { action: { label: 'Open', fn: () => { location.hash = `#/playlist/${playlist.id}`; } } });
}
