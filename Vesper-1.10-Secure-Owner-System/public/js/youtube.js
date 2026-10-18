// YouTube official IFrame player, managed for Vesper.
// - The player is always visible while a YouTube video is loaded: inside Now Playing, or in a docked
//   panel when Now Playing is closed. Vesper never draws over it, hides it, or alters it.
// - Media plays only inside YouTube's iframe; Vesper never touches YouTube audio or video data.
// - Nothing is loaded from YouTube until the user agrees to the disclosure on first use.
import { api, store, saveSettings } from './store.js';
import { esc, attr } from './ui.js';

const STATES = { '-1': 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' };
export const YT_ERRORS = {
  2: 'This YouTube link has an invalid video ID.',
  5: 'This video can’t be played by the browser’s player.',
  100: 'This video was removed, made private, or doesn’t exist.',
  101: 'The owner doesn’t allow this video to play outside YouTube. Age-restricted videos also can’t play here.',
  150: 'The owner doesn’t allow this video to play outside YouTube. Age-restricted videos also can’t play here.',
  153: 'YouTube needs to know which site is embedding it. Open Vesper at http://localhost:5177 or your Mac’s address, not as a file.',
};
const MIN = 200; // YouTube requires an embedded player viewport of at least 200 × 200 px

export class YouTubePlayer {
  constructor(engine) {
    this.e = engine; this.player = null; this.current = null; this.rate = 1; this.poll = 0;
    this.host = document.getElementById('yt-host'); this.dock = document.getElementById('yt-dock');
    const relayout = () => requestAnimationFrame(() => this.layout());
    addEventListener('resize', relayout);
    new MutationObserver(relayout).observe(document.getElementById('np'), { attributes: true, attributeFilter: ['hidden', 'data-mode', 'class'] });
    new ResizeObserver(relayout).observe(document.getElementById('np'));
    this.dock.addEventListener('click', (ev) => { const a = ev.target.closest('[data-yt]')?.dataset.yt; if (a === 'close') this.e.closeExternal(); });
  }
  config() { return (this._cfg ||= api('/youtube/config').catch((e) => { this._cfg = null; throw e; })); }

  // First-use disclosure. Resolves true only if the user chooses to continue.
  consent() {
    if (store.settings.youtubeAck) return Promise.resolve(true);
    const d = document.getElementById('dialog');
    d.innerHTML = `<h2>Play with YouTube?</h2>
      <p class="note" style="font-size:15px">This video plays in YouTube’s official player inside Vesper. Loading it connects your browser to YouTube, which may set cookies, collect data about your viewing and show ads, under <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube’s Terms of Service</a> and the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a>. Vesper uses YouTube’s privacy-enhanced (youtube-nocookie.com) player.</p>
      <p class="note" style="font-size:15px">The video stays visible while it plays and doesn’t continue in the background. Vesper’s equalizer, crossfades and visualizer don’t apply to YouTube.</p>
      <div class="actions"><button class="btn ghost" data-no>Not now</button><button class="btn primary" data-yes>Continue</button></div>`;
    return new Promise((resolve) => {
      // Record the answer BEFORE closing: the dialog's close event would otherwise resolve as "Not now".
      let answered = false;
      const answer = (yes) => { if (answered) return; answered = true; d.onclose = null; d.close(); resolve(yes); if (yes) saveSettings({ youtubeAck: true }).catch(() => {}); };
      d.querySelector('[data-no]').onclick = () => answer(false);
      d.querySelector('[data-yes]').onclick = () => answer(true);
      d.onclose = () => answer(false);
      d.showModal();
    });
  }
  async ensureApi() {
    if (window.YT?.Player) return;
    const cfg = await this.config();
    this._api ||= new Promise((res, rej) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); res(); };
      const s = document.createElement('script'); s.src = cfg.iframeApi; s.async = true;
      s.onerror = () => rej(new Error('Couldn’t load YouTube’s player. Check your internet connection and try again.'));
      document.head.append(s);
      setTimeout(() => rej(new Error('YouTube’s player took too long to load. Try again.')), 20000);
    });
    try { await this._api; } catch (e) { this._api = null; throw e; }
  }

  async load(videoId, { autoplay = true, at = 0 } = {}) {
    if (!(await this.consent())) { const e = new Error('YouTube playback cancelled. Choose Continue when asked to use YouTube’s player.'); e.code = 'declined'; throw e; }
    const cfg = await this.config();
    await this.ensureApi();
    this.current = videoId; this.show();
    const start = Math.max(0, Math.floor(at || 0));
    if (!this.player) {
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('YouTube’s player didn’t start. Try again.')), 20000);
        this.player = new window.YT.Player(document.getElementById('yt-mount'), {
          host: cfg.host, videoId, width: '100%', height: '100%',
          playerVars: { playsinline: 1, rel: 0, controls: 1, start, autoplay: autoplay ? 1 : 0, origin: location.origin },
          events: {
            onReady: () => { clearTimeout(t); res(); },
            onStateChange: (ev) => this.onState(ev.data),
            onError: (ev) => this.onError(ev.data),
            onPlaybackRateChange: (ev) => { this.rate = ev.data; this.e.onExternal('rate', ev.data); },
          },
        });
      });
      this.e.applyVolume();
      if (autoplay) this.player.playVideo(); else this.player.cueVideoById({ videoId, startSeconds: start });
    } else if (autoplay) this.player.loadVideoById({ videoId, startSeconds: start });
    else this.player.cueVideoById({ videoId, startSeconds: start });
    this.layout();
  }
  onState(code) {
    const s = STATES[code] || 'unknown';
    if (s === 'playing') this.startPoll(); else this.stopPoll();
    this.report(s === 'playing');
    this.e.onExternal('state', s);
  }
  onError(code) { this.stopPoll(); this.e.onExternal('error', { code, message: YT_ERRORS[code] || `YouTube couldn’t play this video (error ${code}).` }); }
  report(playing) { try { this.e.onExternal('time', { t: this.player.getCurrentTime() || 0, d: this.player.getDuration() || 0, playing }); } catch { /* player not ready */ } }
  startPoll() { this.stopPoll(); this.poll = setInterval(() => this.report(true), 250); }
  stopPoll() { clearInterval(this.poll); this.poll = 0; }

  play() { this.player?.playVideo(); }
  pause() { try { this.player?.pauseVideo(); } catch { /* ignore */ } }
  seek(t) { this.player?.seekTo(Math.max(0, t), true); setTimeout(() => this.report(this.e.state.status === 'playing'), 60); }
  setVolume(v, muted) { if (!this.player?.setVolume) return; if (muted) this.player.mute(); else { this.player.unMute(); this.player.setVolume(Math.round(v * 100)); } }
  setRate(r) { // YouTube only supports specific speeds; use the closest one it offers
    const avail = this.player?.getAvailablePlaybackRates?.() || [1];
    const best = avail.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), 1);
    this.player?.setPlaybackRate(best); this.rate = best; return best;
  }
  stop() { this.stopPoll(); this.pause(); this.current = null; this.hide(); }

  show() { this.host.hidden = false; this.layout(); }
  hide() { this.host.hidden = true; this.dock.hidden = true; document.body.classList.remove('yt-docked'); }
  // Place the (single, never re-parented) player over Now Playing's stage, or in the dock.
  layout() {
    if (this.host.hidden) return;
    const np = document.getElementById('np');
    const vw = innerWidth, vh = innerHeight, mobile = matchMedia('(max-width: 760px)').matches;
    let x, y, w, h;
    if (!np.hidden) {
      const art = np.querySelector('#np-art');
      const target = np.dataset.mode === 'lyrics' && art && getComputedStyle(art).display !== 'none' ? art : np.querySelector('#np-stage');
      const r = target.getBoundingClientRect();
      w = r.width; h = Math.min(r.height, w * 9 / 16);
      if (h < MIN) h = Math.min(Math.max(MIN, h), r.height);
      if (w < MIN) w = MIN;
      x = r.left + (r.width - w) / 2; y = r.top + (r.height - h) / 2;
      this.dock.hidden = true; document.body.classList.remove('yt-docked');
      this.host.classList.add('in-np');
    } else {
      const bar = document.querySelector('.player')?.getBoundingClientRect();
      const tabs = mobile ? document.querySelector('.tabbar')?.getBoundingClientRect() : null;
      const bottom = Math.min(bar?.top ?? vh, tabs?.top ?? vh) - 10;
      w = mobile ? vw - 16 : 384; h = Math.max(MIN, w * 9 / 16);
      if (w * 9 / 16 < MIN) w = Math.round(MIN * 16 / 9);
      x = mobile ? 8 : vw - w - 18; y = bottom - h;
      this.dock.hidden = false; document.body.classList.add('yt-docked');
      const t = this.e.state.track;
      this.dock.innerHTML = `<span class="badge yt">YouTube</span><span class="yt-dock-title">${esc(t?.title || '')}</span><button class="text-btn" data-act="np-open">Expand</button><button class="text-btn" data-yt="close" aria-label="Stop YouTube video">Close</button>`;
      this.dock.style.cssText = `left:${x}px;width:${w}px;top:${y - 40}px`;
      this.host.classList.remove('in-np');
    }
    Object.assign(this.host.style, { left: `${Math.round(x)}px`, top: `${Math.round(y)}px`, width: `${Math.round(w)}px`, height: `${Math.round(h)}px` });
  }
}
void attr;
