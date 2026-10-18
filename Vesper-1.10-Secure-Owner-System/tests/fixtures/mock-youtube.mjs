// TEST-ONLY stand-in for the YouTube Data API v3, oEmbed and the IFrame Player API.
// Vesper's server only uses these URLs when VESPER_TEST=1. It serves metadata JSON and a fake
// player script; there is no audio or video here.
import http from 'node:http';
const port = Number(process.argv[2] || 5198);
const log = [];
const V = (id, title, channel, extra = {}) => ({ id, snippet: { title, channelTitle: channel, publishedAt: '2018-10-01T00:00:00Z', liveBroadcastContent: 'none', thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` }, high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } } }, contentDetails: { duration: 'PT3M35S', ...(extra.cd || {}) }, status: { privacyStatus: 'public', uploadStatus: 'processed', embeddable: true, ...(extra.st || {}) } });
const VIDEOS = {
  AAAAAAAAAA1: V('AAAAAAAAAA1', 'girl in red - we fell in love in october (Official Audio)', 'girl in red'),
  BBBBBBBBBB2: V('BBBBBBBBBB2', 'we fell in love in october &amp; more (Live Session)', 'girl in red - Topic', { cd: { duration: 'PT1H2M5S' } }),
  AGEVIDEO001: V('AGEVIDEO001', 'Age restricted example', 'Some Channel', { cd: { contentRating: { ytRating: 'ytAgeRestricted' } } }),
  REGIONBLK01: V('REGIONBLK01', 'Region blocked example', 'Some Channel', { cd: { regionRestriction: { blocked: ['US', 'CA'] } } }),
  ERRVIDEO150: V('ERRVIDEO150', 'Embed rejected at playback', 'Some Channel'),
  SHORTVIDEO1: V('SHORTVIDEO1', 'Three second clip', 'Short Channel', { cd: { duration: 'PT3S' } }),
};
const SEARCH_IDS = ['AAAAAAAAAA1', 'BBBBBBBBBB2', 'AGEVIDEO001', 'REGIONBLK01', 'DELETED0001', 'ERRVIDEO150'];
const PLAYER = String.raw`(function(){
  class Player {
    constructor(el, o) { this.o = o; const m = typeof el === 'string' ? document.getElementById(el) : el; const f = document.createElement('div'); f.className = 'fake-yt-player'; f.style.cssText = 'position:absolute;inset:0;background:#111;color:#fff;display:grid;place-items:center;font:14px sans-serif'; f.textContent = 'Test stand-in for the YouTube player'; m.replaceWith(f); this.frame = f; this.vid = o.videoId; f.dataset.video = this.vid; this.t = (o.playerVars && o.playerVars.start) || 0; this.state = -1; this.rate = 1; this.vol = 100; this.muted = false; this.host = o.host; window.__ytFake = this; setTimeout(() => o.events.onReady && o.events.onReady({ target: this }), 50); }
    _set(s) { this.state = s; this.o.events.onStateChange && this.o.events.onStateChange({ data: s, target: this }); }
    _dur() { return this.vid === 'SHORTVIDEO1' ? 3 : 215; }
    _bad() { const c = { ERRVIDEO150: 150, GONEVIDEO00: 100 }[this.vid]; if (c) { setTimeout(() => this.o.events.onError({ data: c }), 100); return true; } return false; }
    loadVideoById(a) { clearInterval(this._iv); this.vid = a.videoId; this.t = a.startSeconds || 0; this.frame.dataset.video = this.vid; this.state = -1; this.playVideo(); }
    cueVideoById(a) { clearInterval(this._iv); this.vid = a.videoId; this.t = a.startSeconds || 0; this.frame.dataset.video = this.vid; if (!this._bad()) this._set(5); }
    playVideo() { if (this.state === 1) return; if (this._bad()) return; this._set(3); clearTimeout(this._b); this._b = setTimeout(() => { this._set(1); this._last = performance.now(); clearInterval(this._iv); this._iv = setInterval(() => { const n = performance.now(); this.t += (n - this._last) / 1000 * this.rate; this._last = n; if (this.t >= this._dur()) { this.t = this._dur(); clearInterval(this._iv); this._set(0); } }, 100); }, 200); }
    pauseVideo() { clearInterval(this._iv); clearTimeout(this._b); if (this.state === 1 || this.state === 3) this._set(2); }
    seekTo(t) { this.t = t; } getCurrentTime() { return this.t; } getDuration() { return this._dur(); } getPlayerState() { return this.state; }
    setVolume(v) { this.vol = v; } mute() { this.muted = true; } unMute() { this.muted = false; }
    getAvailablePlaybackRates() { return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; } setPlaybackRate(r) { this.rate = r; this.o.events.onPlaybackRateChange && this.o.events.onPlaybackRateChange({ data: r }); }
    destroy() {}
  }
  window.YT = { Player }; setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 0);
})();`;
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); log.push(u.pathname + (u.searchParams.get('q') ? `?q=${u.searchParams.get('q')}` : ''));
  if (u.pathname === '/__log') return json(res, 200, log);
  if (u.pathname === '/iframe_api.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }); return res.end(PLAYER); }
  if (u.pathname === '/oembed') { const id = (u.searchParams.get('url') || '').split('v=')[1]; if (id === 'NOEMBED0001') return json(res, 401, {}); if (!VIDEOS[id]) return json(res, 404, {}); return json(res, 200, { title: VIDEOS[id].snippet.title, author_name: VIDEOS[id].snippet.channelTitle, thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }); }
  if (u.searchParams.get('key') !== 'test-key') return json(res, 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }] } });
  if (u.pathname === '/youtube/v3/search') {
    if (/quota/i.test(u.searchParams.get('q'))) return json(res, 403, { error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } });
    return json(res, 200, { items: SEARCH_IDS.map((id) => ({ id: { kind: 'youtube#video', videoId: id } })) });
  }
  if (u.pathname === '/youtube/v3/videos') return json(res, 200, { items: (u.searchParams.get('id') || '').split(',').filter((id) => VIDEOS[id]).map((id) => VIDEOS[id]) });
  json(res, 404, {});
}).listen(port, () => console.log(`mock youtube on ${port}`));
