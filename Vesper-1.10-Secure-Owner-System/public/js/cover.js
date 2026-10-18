// Artwork fallback for missing or expired provider covers.
export function coverFallback(track = {}) {
  const seed = `${track.title || 'Vesper'} ${track.artist || ''}`;
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  const title = String(track.title || 'Vesper').slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${h} 70% 58%)"/><stop offset="1" stop-color="hsl(${(h+78)%360} 55% 12%)"/></linearGradient><radialGradient id="r"><stop stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="240" height="240" fill="url(#g)"/><circle cx="175" cy="55" r="100" fill="url(#r)"/><path d="M-20 190 Q80 90 150 190 T270 150 L270 260 L-20 260Z" fill="#05050b" fill-opacity=".32"/><text x="120" y="145" text-anchor="middle" font-family="Arial,sans-serif" font-size="90" font-weight="700" fill="#fff" fill-opacity=".92">${title.replace(/[&<>"']/g,'')}</text><text x="120" y="216" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" letter-spacing="4" fill="#fff" fill-opacity=".72">VESPER</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

