// Lightweight audio analysis run on decoded audio before playback.
// Produces: estimated BPM (onset autocorrelation), RMS loudness (dBFS, active frames only),
// leading/trailing silence, and the length of a natural fade-out at the end.
// These are estimates. Beat *phase* and musical key are not detected.

export function analyze(buffer) {
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const ch = buffer.numberOfChannels;
  // Mono mixdown
  const mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }

  // Frame energies (~10 ms frames)
  const hop = Math.max(64, Math.round(sr / 100));
  const frames = Math.floor(n / hop);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; const o = f * hop; for (let i = 0; i < hop; i++) { const v = mono[o + i]; s += v * v; } rms[f] = Math.sqrt(s / hop); }
  const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

  // Silence trimming (below -50 dBFS)
  const thr = 10 ** (-50 / 20);
  let a = 0; while (a < frames && rms[a] < thr) a++;
  let b = frames - 1; while (b > a && rms[b] < thr) b--;
  const leadSilence = a * hop / sr;
  const trailSilence = Math.max(0, (frames - 1 - b) * hop / sr);

  // Loudness over active frames
  let sum = 0, cnt = 0;
  for (let f = a; f <= b; f++) if (rms[f] > thr) { sum += rms[f] * rms[f]; cnt++; }
  const loudnessDb = cnt ? db(Math.sqrt(sum / cnt)) : -60;

  // Natural fade-out: smooth the level over ~1 s, find the typical "body" level, then walk back
  // from the end while the smoothed level stays below it.
  const blk = Math.max(1, Math.round(0.25 * sr / hop)); // 0.25 s blocks
  const nb = Math.floor((b - a + 1) / blk);
  let fadeOut = 0;
  if (nb > 12) {
    const lv = new Float32Array(nb);
    for (let k = 0; k < nb; k++) { let e = 0; for (let f = a + k * blk; f < a + (k + 1) * blk; f++) e += rms[f] * rms[f]; lv[k] = Math.sqrt(e / blk); }
    const sm = lv.map((_, k) => { let e = 0, c = 0; for (let j = Math.max(0, k - 2); j <= Math.min(nb - 1, k + 1); j++) { e += lv[j]; c++; } return e / c; });
    const body = [...sm].sort((x, y) => x - y)[Math.floor(nb * 0.6)];
    let k = nb - 1;
    while (k > 0 && sm[k] < body * 0.84 && sm[k] <= sm[k - 1] * 1.05) k--;
    fadeOut = (nb - 1 - k) * blk * hop / sr;
  }

  const tempo = estimateTempo(mono, sr, a * hop, Math.min(n, (a * hop) + 45 * sr));
  // Beat phase measured locally (intro and outro windows) so tempo-estimate error can't accumulate
  // across the song: the outro grid is what a DJ transition out of this song lines up with.
  if (tempo) tempo.bpm = refineTempo(mono, sr, a * hop, Math.min(n, a * hop + 120 * sr), tempo.bpm);
  const head = tempo ? beatPhase(mono, sr, a * hop, Math.min(n, a * hop + 20 * sr), tempo.bpm) : null;
  const tail = tempo ? beatPhase(mono, sr, Math.max(a * hop, (b + 1) * hop - 30 * sr), (b + 1) * hop, tempo.bpm) : null;
  return { bpm: tempo?.bpm ?? null, beatOffset: head?.offset ?? null, beatConfidence: head?.confidence ?? 0, endBeatOffset: tail?.offset ?? null, endBeatConfidence: tail?.confidence ?? 0, loudnessDb, leadSilence, trailSilence, fadeOut, duration: n / sr };
}

function estimateTempo(x, sr, start, end) {
  // Onset envelope: positive change in log energy, ~5.8 ms hop.
  const hop = Math.round(sr / 172);
  const len = Math.floor((end - start) / hop);
  if (len < 600) return null;
  const raw = new Float32Array(len);
  let prev = 0;
  for (let f = 0; f < len; f++) {
    let s = 0; const o = start + f * hop;
    for (let i = 0; i < hop; i++) { const v = x[o + i] || 0; s += v * v; }
    const e = Math.log1p(s * 1000);
    raw[f] = Math.max(0, e - prev); prev = e;
  }
  // Remove slow trends (~0.3 s window), then smooth so one onset doesn't split across frames.
  const w = 48; let acc = 0; const hp = new Float32Array(len);
  for (let i = 0; i < len; i++) { acc += raw[i]; if (i >= w) acc -= raw[i - w]; hp[i] = Math.max(0, raw[i] - acc / Math.min(i + 1, w)); }
  const env = new Float32Array(len);
  for (let i = 2; i < len - 2; i++) env[i] = (hp[i - 2] + 2 * hp[i - 1] + 3 * hp[i] + 2 * hp[i + 1] + hp[i + 2]) / 9;
  let mean = 0; for (let i = 0; i < len; i++) mean += env[i]; mean /= len;
  let v0 = 0; for (let i = 0; i < len; i++) { env[i] -= mean; v0 += env[i] * env[i]; }
  v0 /= len;
  if (Math.sqrt(v0) < 0.05) return null; // no real onsets (e.g. a sustained tone or silence)

  const fps = sr / hop;
  const maxLag = Math.min(Math.floor(len / 2), Math.ceil((fps * 60 / 60) * 4) + 2);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag + 1; lag++) { let s = 0; for (let i = 0; i + lag < len; i++) s += env[i] * env[i + lag]; ac[lag] = s / (len - lag) / v0; } // normalised: 1 = perfect periodicity
  const at = (l) => { const i = Math.floor(l), f = l - i; return i + 1 < ac.length ? ac[i] * (1 - f) + ac[i + 1] * f : NaN; };

  // Comb score: a true beat period also correlates at 2x, 3x and 4x its lag. This is far more robust
  // than picking the single tallest autocorrelation peak.
  let best = -Infinity, bestBpm = 0, bestRaw = 0;
  for (let bpm = 60; bpm <= 190; bpm += 0.25) {
    const lag = fps * 60 / bpm;
    let s = 0, n = 0;
    for (let k = 1; k <= 4; k++) { const v = at(k * lag); if (Number.isFinite(v)) { s += v; n++; } }
    if (!n) continue;
    s /= n;
    const pref = Math.exp(-0.5 * (Math.log2(bpm / 118) / 0.9) ** 2); // gentle bias against octave errors
    const v = s * (0.6 + 0.4 * pref);
    if (v > best) { best = v; bestBpm = bpm; bestRaw = s; }
  }
  if (!bestBpm || bestRaw < 0.12) return null; // not rhythmic enough to trust
  // Beat phase: the offset within one beat period where onsets line up best → time of the first beat.
  const P = fps * 60 / bestBpm; let bestPh = 0, bestSc = -Infinity, sum = 0, cnt = 0;
  for (let ph = 0; ph < P; ph += 1) {
    let sc = 0;
    for (let k = ph; k < len - 1; k += P) { const i = Math.round(k); sc += Math.max(0, env[i]) + 0.5 * Math.max(0, env[i - 1] || 0) + 0.5 * Math.max(0, env[i + 1] || 0); }
    sum += sc; cnt++; if (sc > bestSc) { bestSc = sc; bestPh = ph; }
  }
  const beatConfidence = sum > 0 ? bestSc / (sum / cnt) : 0; // how much the best phase stands out
  return { bpm: Math.round(bestBpm * 10) / 10, beatOffset: start / sr + bestPh / fps, beatConfidence };
}

// Onset envelope (positive log-energy change, ~5.8 ms frames) for a sample window.
function onsetEnv(x, sr, start, end) {
  const hop = Math.round(sr / 172), len = Math.floor((end - start) / hop);
  if (len < 200) return null;
  const raw = new Float32Array(len); let prev = 0;
  for (let f = 0; f < len; f++) { let s = 0; const o = start + f * hop; for (let i = 0; i < hop; i++) { const v = x[o + i] || 0; s += v * v; } const e = Math.log1p(s * 1000); raw[f] = Math.max(0, e - prev); prev = e; }
  const w = 48, env = new Float32Array(len); let acc = 0;
  for (let i = 0; i < len; i++) { acc += raw[i]; if (i >= w) acc -= raw[i - w]; env[i] = Math.max(0, raw[i] - acc / Math.min(i + 1, w)); }
  return { env, fps: sr / hop, t0: start / sr };
}
// Best beat phase for a tempo: returns a beat time (s) and how strongly that phase stands out.
function phaseOf(E, bpm) {
  const { env, fps } = E, len = env.length, P = fps * 60 / bpm;
  let best = 0, bestSc = -1, sum = 0, cnt = 0;
  for (let ph = 0; ph < P; ph += 0.5) {
    let sc = 0; for (let k = ph; k < len - 1; k += P) { const i = Math.round(k); sc += env[i] + 0.5 * (env[i - 1] || 0) + 0.5 * (env[i + 1] || 0); }
    sum += sc; cnt++; if (sc > bestSc) { bestSc = sc; best = ph; }
  }
  return { offset: E.t0 + best / fps, confidence: sum > 0 ? bestSc / (sum / cnt) : 0 };
}
function beatPhase(x, sr, start, end, bpm) { const E = bpm && onsetEnv(x, sr, start, end); return E ? phaseOf(E, bpm) : null; }
// Refine a coarse tempo to ±0.05 BPM: over a long window, the true tempo keeps its beat grid sharp.
function refineTempo(x, sr, start, end, bpm) {
  const E = onsetEnv(x, sr, start, end); if (!E) return bpm;
  let best = bpm, bestC = -1;
  for (let d = -0.6; d <= 0.6001; d += 0.05) { const c = phaseOf(E, bpm + d).confidence; if (c > bestC) { bestC = c; best = bpm + d; } }
  return Math.round(best * 100) / 100;
}
export function tempoCompatible(a, b) {
  if (!a || !b) return null;
  const r = [b / a, (b * 2) / a, b / (a * 2)].map((x) => Math.abs(1 - x));
  return Math.min(...r) <= 0.06;
}


// Streaming tempo estimator. It consumes spectral-flux samples from the already-playing
// audio graph; it does not fetch, buffer, or upload any audio. At 10 samples/second it
// waits for enough real music before making a conservative BPM estimate.
export class TempoTracker {
  constructor(fps = 10) {
    this.fps = fps;
    this.previous = null;
    this.samples = [];
    this.lastEstimateAt = 0;
    this.bpm = null;
    this.confirmations = 0;
  }
  pushSpectrum(bytes) {
    let flux = 0;
    if (this.previous && this.previous.length === bytes.length) {
      // Spectral flux: only count energy rising since the previous sample.
      for (let i = 2; i < bytes.length; i++) {
        const weight = i < bytes.length * 0.55 ? 1.25 : 0.65;
        flux += Math.max(0, bytes[i] - this.previous[i]) * weight;
      }
    }
    this.previous = Uint8Array.from(bytes);
    this.samples.push(flux);
    if (this.samples.length > this.fps * 30) this.samples.shift();
    if (this.samples.length < this.fps * 10) return null;
    if (this.samples.length - this.lastEstimateAt < this.fps * 3) return null;
    this.lastEstimateAt = this.samples.length;
    const bpm = this.estimate();
    if (!bpm) return null;
    // Require estimates to agree across successive windows before accepting them.
    if (this.bpm && Math.abs(this.bpm - bpm) <= 4) {
      this.bpm = Math.round((this.bpm * 0.65 + bpm * 0.35) * 10) / 10;
      this.confirmations++;
    } else {
      this.bpm = bpm;
      this.confirmations = 1;
    }
    return this.confirmations >= 2 ? this.bpm : null;
  }
  estimate() {
    const x = this.samples;
    const n = x.length;
    let mean = 0;
    for (const v of x) mean += v;
    mean /= n;
    const env = new Float64Array(n);
    let variance = 0;
    // Remove slow changes in loudness so the estimate follows rhythmic attacks.
    const w = Math.max(2, Math.round(this.fps * 0.8));
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += x[i]; if (i >= w) acc -= x[i - w];
      env[i] = Math.max(0, x[i] - acc / Math.min(i + 1, w));
      variance += (env[i] - mean) ** 2;
    }
    if (variance / n < 0.5) return null;
    let bestBpm = null, best = -Infinity, runnerUp = -Infinity;
    const minLag = Math.max(2, Math.floor(this.fps * 60 / 190));
    const maxLag = Math.min(Math.floor(n / 2), Math.ceil(this.fps * 60 / 60));
    for (let lag = minLag; lag <= maxLag; lag++) {
      let dot = 0, aa = 0, bb = 0;
      for (let i = lag; i < n; i++) { dot += env[i] * env[i - lag]; aa += env[i] * env[i]; bb += env[i - lag] * env[i - lag]; }
      const corr = dot / Math.sqrt(Math.max(1e-9, aa * bb));
      // Mild preference against half/double-time errors, not enough to override clear data.
      const bpm = this.fps * 60 / lag;
      const score = corr * (0.92 + 0.08 * Math.exp(-0.5 * (Math.log2(bpm / 118) / 0.9) ** 2));
      if (score > best) { runnerUp = best; best = score; bestBpm = bpm; }
      else if (score > runnerUp) runnerUp = score;
    }
    if (!bestBpm || best < 0.18) return null;
    return Math.round(bestBpm * 10) / 10;
  }
}
