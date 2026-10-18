import { api } from './store.js';
import { esc, attr, icon, toast } from './ui.js';

const fmtCount = (n) => new Intl.NumberFormat().format(Number(n) || 0);
const cover = (s) => s.artwork ? `<img src="${attr(s.artwork)}" alt="" loading="lazy" onerror="this.style.display='none'">` : `<span class="radio-station-mark">${icon('radio')}</span>`;
function stationCard(s, i) {
  const meta = [s.country, s.language, s.codec && s.bitrate ? `${s.codec} · ${s.bitrate} kbps` : s.codec || (s.bitrate ? `${s.bitrate} kbps` : '')].filter(Boolean).join(' · ');
  return `<article class="radio-station" data-station="${attr(s.stationId)}"><div class="radio-station-art">${cover(s)}<button class="radio-play" data-radio-play="${i}" aria-label="Play ${attr(s.title)}" title="Play station">${icon('play')}</button></div><div class="radio-station-copy"><h3 title="${attr(s.title)}">${esc(s.title)}</h3><p>${esc(meta || s.tags.slice(0, 3).join(' · ') || 'Live radio')}</p>${s.homepage ? `<a href="${attr(s.homepage)}" target="_blank" rel="noopener noreferrer">Station website ↗</a>` : ''}</div></article>`;
}
export async function radioDirectoryView(_params, el, app) {
  el.innerHTML = `<div class="radio-page"><div class="radio-heading"><div><p class="eyebrow">LIVE · AROUND THE WORLD</p><h1 class="page-title">Radio</h1><p class="lede">Live stations from around the world. Explore popular stations or search by name, country, language, and genre.</p></div><div class="radio-orb">${icon('radio')}</div></div><div class="radio-controls"><label class="radio-search"><span class="sr-only">Search radio stations</span><input id="radio-q" class="input" type="search" placeholder="Search stations, countries, genres…" autocomplete="off"></label><select id="radio-country" class="input" aria-label="Filter by country"><option value="">Every country</option></select><select id="radio-language" class="input" aria-label="Filter by language"><option value="">Every language</option></select><select id="radio-tag" class="input" aria-label="Filter by genre"><option value="">Every genre</option></select><button class="btn primary" id="radio-search-btn">Search ${icon('search')}</button></div><div class="radio-tabs"><button class="chip on" data-radio-tab="popular">Most popular</button><button class="chip" data-radio-tab="votes">Top rated</button><button class="chip" data-radio-tab="browse">Browse directory</button></div><div class="radio-results-meta" id="radio-meta">Loading popular stations…</div><div class="radio-station-grid" id="radio-results"><div class="skeleton" style="height:160px"></div><div class="skeleton" style="height:160px"></div><div class="skeleton" style="height:160px"></div></div><div class="radio-more"><button class="btn ghost" id="radio-more" hidden>Load more stations</button></div><p class="source-note">Directory: Radio Browser, a community-maintained catalog. Streams are hosted by the stations themselves; availability and playback quality vary by station and region. Vesper does not own or control these broadcasts.</p></div>`;
  const q = el.querySelector('#radio-q'), country = el.querySelector('#radio-country'), language = el.querySelector('#radio-language'), tag = el.querySelector('#radio-tag'), results = el.querySelector('#radio-results'), meta = el.querySelector('#radio-meta'), more = el.querySelector('#radio-more');
  let tab = 'popular', offset = 0, stations = [], busy = false, requestNo = 0;
  const fill = (select, items, label) => { for (const item of items) { const o = document.createElement('option'); o.value = item.name; o.textContent = `${item.name} (${fmtCount(item.count)})`; select.append(o); } };
  try { const filters = await api('/radio-stations/filters'); fill(country, filters.countries || []); fill(language, filters.languages || []); fill(tag, (filters.tags || []).filter(x => x.count > 1)); }
  catch { /* Directory search still works if the optional filter lists are temporarily unavailable. */ }
  async function load(reset = true) {
    if (busy) return; busy = true; const n = ++requestNo;
    if (reset) { offset = 0; stations = []; results.innerHTML = `<div class="skeleton" style="height:160px"></div><div class="skeleton" style="height:160px"></div><div class="skeleton" style="height:160px"></div>`; }
    meta.textContent = 'Finding stations…'; more.disabled = true;
    try {
      let d;
      const term = q.value.trim();
      if (tab === 'popular' && !term && !country.value && !language.value && !tag.value) d = await api(`/radio-stations/top?order=clicks&limit=50`);
      else if (tab === 'votes' && !term && !country.value && !language.value && !tag.value) d = await api('/radio-stations/top?order=votes&limit=50');
      else d = await api(`/radio-stations/search?q=${encodeURIComponent(term)}&country=${encodeURIComponent(country.value)}&language=${encodeURIComponent(language.value)}&tag=${encodeURIComponent(tag.value)}&limit=50&offset=${offset}`);
      if (n !== requestNo) return;
      const got = d.stations || []; stations = reset ? got : [...stations, ...got];
      results.innerHTML = stations.length ? stations.map(stationCard).join('') : `<div class="empty"><h2>No stations found</h2><p>Try a different name, country, language, or genre.</p></div>`;
      meta.textContent = `${fmtCount(stations.length)} station${stations.length === 1 ? '' : 's'} shown · ${tab === 'popular' ? 'ordered by recent listening activity' : tab === 'votes' ? 'ordered by community votes' : 'directory results'}`;
      offset = stations.length; more.hidden = got.length < 50 || ((tab === 'popular' || tab === 'votes') && !term && !country.value && !language.value && !tag.value); more.disabled = false;
    } catch (e) { if (n === requestNo) { results.innerHTML = `<div class="empty"><h2>Radio directory unavailable</h2><p>${esc(e.message)}</p><button class="btn ghost" id="radio-retry">Try again</button></div>`; el.querySelector('#radio-retry')?.addEventListener('click', () => load(true)); meta.textContent = 'Could not load stations.'; } }
    finally { busy = false; more.disabled = false; }
  }
  el.querySelectorAll('[data-radio-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.radioTab; el.querySelectorAll('[data-radio-tab]').forEach(x => x.classList.toggle('on', x === b)); load(true); }));
  el.querySelector('#radio-search-btn').addEventListener('click', () => { tab = 'browse'; el.querySelectorAll('[data-radio-tab]').forEach(x => x.classList.toggle('on', x.dataset.radioTab === 'browse')); load(true); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { tab = 'browse'; load(true); } });
  [country, language, tag].forEach(s => s.addEventListener('change', () => { tab = 'browse'; el.querySelectorAll('[data-radio-tab]').forEach(x => x.classList.toggle('on', x.dataset.radioTab === 'browse')); load(true); }));
  more.addEventListener('click', () => load(false));
  results.addEventListener('click', async e => { const b = e.target.closest('[data-radio-play]'); if (!b) return; const s = stations[Number(b.dataset.radioPlay)]; if (!s) return; b.disabled = true; try { await app.engine.load({ ...s, id: `rb:${s.stationId}`, provider: 'radio', title: s.title, artist: [s.country, s.language].filter(Boolean).join(' · ') || 'Live radio', album: 'Radio', artwork: s.artwork || null, albumArtwork: s.artwork || null, duration: 0, playableDuration: 0, fullTrack: true, radio: true }, { reason: 'user' }); } catch (err) { toast(err.message || 'Could not play this station.', { error: true }); } finally { b.disabled = false; } });
  await load(true);
}
