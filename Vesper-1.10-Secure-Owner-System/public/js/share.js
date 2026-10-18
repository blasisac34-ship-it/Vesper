// Shareable story-size cards (1080×1920) for songs, lyric lines and playlists, styled from the artwork.
import { proxied } from './store.js';
import { palette } from './color.js';

const loadImg = (u) => new Promise((res) => { if (!u) return res(null); const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = proxied(u); });
function lines(ctx, text, maxW, maxLines) {
  const out = []; let cur = '';
  for (const w of String(text || '').split(/\s+/)) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].replace(/\s*\S*$/, '…'); }
  return out;
}
function rounded(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
const font = (w, s) => `${w} ${s}px "Bricolage Grotesque", "Figtree", system-ui, sans-serif`;

export async function renderCard({ kind = 'song', title = '', subtitle = '', art = null, tiles = null, lyric = '', lyricLines = null }) {
  const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const pal = await palette(art || tiles?.[0]).catch(() => null);
  const hsl = (col, l) => (col ? `hsl(${Math.round(col.h)} ${Math.round(Math.min(0.75, col.s + 0.1) * 100)}% ${l}%)` : null);
  const g = x.createLinearGradient(0, 0, W * 0.4, H); g.addColorStop(0, hsl(pal?.vivid, 40) || '#3b2d78'); g.addColorStop(1, hsl(pal?.second, 9) || '#0d0d14');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,255,255,.85)'; x.font = font(700, 38); x.fillText('VESPER', 90, 140);
  const imgs = tiles?.length ? (await Promise.all([...new Set(tiles)].slice(0, 4).map(loadImg))).filter(Boolean) : [];
  const main = art ? await loadImg(art) : null;
  const S = kind === 'lyric' ? 260 : 820, ax = kind === 'lyric' ? 90 : (W - S) / 2, ay = kind === 'lyric' ? 1380 : 260;
  x.save(); x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 80; x.shadowOffsetY = 30; rounded(x, ax, ay, S, S, 28); x.fillStyle = '#16161c'; x.fill(); x.restore();
  x.save(); rounded(x, ax, ay, S, S, 28); x.clip();
  if (imgs.length > 1) { const n = imgs.length >= 4 ? 4 : imgs.length, cells = n === 4 ? [[0, 0], [1, 0], [0, 1], [1, 1]] : n === 3 ? [[0, 0, 1, 2], [1, 0], [1, 1]] : [[0, 0, 1, 2], [1, 0, 1, 2]]; imgs.slice(0, n).forEach((im, i) => { const [cx, cy, cw = 1, ch = 1] = cells[i]; x.drawImage(im, ax + cx * S / 2, ay + cy * S / 2, cw * S / 2, ch * S / 2); }); }
  else if (main || imgs[0]) x.drawImage(main || imgs[0], ax, ay, S, S);
  x.restore();
  x.fillStyle = '#fff';
  if (kind === 'lyric') {
    // Each chosen lyric line is its own paragraph; the type shrinks to fit longer picks.
    const paras = (lyricLines?.length ? lyricLines : [lyric]).map((t) => String(t).trim()).filter(Boolean).slice(0, 4);
    const total = paras.join(' ').length;
    const size = total < 60 ? 84 : total < 120 ? 74 : total < 200 ? 64 : 56, lead = Math.round(size * 1.28), maxY = ay - 90;
    x.globalAlpha = 0.3; x.font = font(700, 220); x.fillText('“', 70, 400); x.globalAlpha = 1;
    x.font = font(700, size); let y = 420 + size;
    const wrapped = paras.map((p) => lines(x, p, W - 180, 4));
    const height = wrapped.reduce((h, ls) => h + ls.length * lead, 0) + (wrapped.length - 1) * lead * 0.45;
    y = Math.max(420 + size, Math.min(y, maxY - height + size));
    for (const ls of wrapped) { for (const l of ls) { if (y > maxY) break; x.fillText(l, 90, y); y += lead; } y += lead * 0.45; }
    x.font = font(650, 50); lines(x, title, W - 450, 2).forEach((l, i) => x.fillText(l, ax + S + 50, ay + 90 + i * 60));
    x.font = font(500, 40); x.globalAlpha = 0.8; x.fillText(lines(x, subtitle, W - 450, 1)[0] || '', ax + S + 50, ay + 230); x.globalAlpha = 1;
  } else {
    x.font = font(650, 72); let y = ay + S + 140;
    for (const l of lines(x, title, W - 180, 2)) { x.fillText(l, 90, y); y += 86; }
    x.font = font(500, 44); x.globalAlpha = 0.8; for (const l of lines(x, subtitle, W - 180, 2)) { x.fillText(l, 90, y + 6); y += 56; } x.globalAlpha = 1;
  }
  x.font = font(500, 34); x.globalAlpha = 0.65; x.fillText(kind === 'playlist' ? 'A playlist on Vesper' : 'Listening on Vesper', 90, H - 110); x.globalAlpha = 1;
  return c;
}
// Returns 'shared' | 'saved' | 'cancelled'. Throws if the image can't be created.
export async function shareCard(opts) {
  const c = await renderCard(opts);
  const blob = await new Promise((res, rej) => { try { c.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t create the image.'))), 'image/png'); } catch { rej(new Error('This artwork can’t be used in an image, so the card couldn’t be created.')); } });
  const file = new File([blob], `vesper-${String(opts.title || 'card').replace(/[^\w]+/g, '-').slice(0, 40)}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: opts.title }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'saved';
}
