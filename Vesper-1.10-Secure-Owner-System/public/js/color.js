// Extract a palette from cover art and turn it into contrast-safe theme colours.
import { proxied } from './store.js';

const cache = new Map();
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round);
}
const lum = ([r, g, b]) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const css = ([r, g, b], a = 1) => (a === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`);

export async function palette(url) {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 40;
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 40, 40);
        const d = x.getImageData(0, 0, 40, 40).data;
        const buckets = new Map();
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 200) continue;
          const key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
          const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 }; b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2]; buckets.set(key, b);
        }
        const cols = [...buckets.values()].map((b) => { const rgb = [b.r / b.n, b.g / b.n, b.b / b.n].map(Math.round); const [h, s, l] = rgbToHsl(...rgb); return { rgb, h, s, l, n: b.n }; });
        cols.sort((a, b) => b.n - a.n);
        const dominant = cols[0];
        const vivid = cols.filter((c) => c.s > 0.25 && c.l > 0.2 && c.l < 0.85).sort((a, b) => b.n * b.s - a.n * a.s)[0] || dominant;
        const second = cols.find((c) => Math.abs(c.h - vivid.h) > 35 && c.s > 0.15) || dominant;
        resolve({ dominant, vivid, second, avgL: cols.reduce((s, c) => s + c.l * c.n, 0) / cols.reduce((s, c) => s + c.n, 0) });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = proxied(url);
  });
  cache.set(url, p);
  return p;
}

// Accent that reads well on the given background (WCAG ≥ 4.5:1 for text-sized use).
export function accentFor(pal, theme) {
  const bg = theme === 'light' ? [247, 247, 249] : [26, 27, 32];
  let [h, s] = [pal.vivid.h, Math.max(0.35, Math.min(0.8, pal.vivid.s))];
  if (pal.vivid.s < 0.12) s = 0.15; // greyscale art → near-neutral accent
  let l = theme === 'light' ? 0.42 : 0.72;
  let rgb = hslToRgb(h, s, l);
  for (let i = 0; i < 20 && contrast(rgb, bg) < 4.5; i++) { l += theme === 'light' ? -0.03 : 0.03; rgb = hslToRgb(h, s, Math.max(0.05, Math.min(0.95, l))); }
  return rgb;
}

export function applyPalette(pal, theme) {
  const root = document.documentElement.style;
  if (!pal) { root.removeProperty('--art-accent'); return null; }
  const acc = accentFor(pal, theme);
  const g1 = hslToRgb(pal.vivid.h, Math.min(0.7, pal.vivid.s + 0.1), theme === 'light' ? 0.7 : 0.32);
  const g2 = hslToRgb(pal.second.h, Math.min(0.6, pal.second.s), theme === 'light' ? 0.75 : 0.22);
  root.setProperty('--art-accent', css(acc));
  root.setProperty('--art-1', css(g1));
  root.setProperty('--art-2', css(g2));
  return { g1: css(g1, theme === 'light' ? 0.35 : 0.55), g2: css(g2, theme === 'light' ? 0.3 : 0.45), accent: css(acc), raw: { g1, g2, acc } };
}
