// LRC (timed lyrics) parser. No DOM dependencies.
export function parseLRC(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!tags.length) continue;
    const body = raw.replace(/\[[^\]]*\]/g, '');
    // Enhanced LRC: <mm:ss.xx> before each word. Only used when the source really provides it.
    const wordTags = [...body.matchAll(/<(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)>([^<]*)/g)];
    const words = wordTags.length ? wordTags.map((m) => ({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3] })).filter((w) => w.text.trim()) : null;
    const text = (words ? words.map((w) => w.text.trim()).join(' ') : body).trim();
    for (const m of tags) out.push({ t: Number(m[1]) * 60 + Number(m[2].replace(':', '.')), text, ...(words ? { words } : {}) });
  }
  return out.sort((a, b) => a.t - b.t);
}
