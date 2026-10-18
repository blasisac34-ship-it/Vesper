// Equalizer definitions shared by the engine and the audio panel. No DOM dependencies.
export const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const BAND_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
export const PRESETS = {
  flat: { label: 'Flat', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: 'Bass Boost', bands: [6, 5.5, 4.5, 2.5, 0.5, 0, 0, 0, 0, 0] },
  treble: { label: 'Treble Boost', bands: [0, 0, 0, 0, 0, 0.5, 1.5, 3.5, 5, 6] },
  vocal: { label: 'Vocal', bands: [-2, -2, -1, 0.5, 2, 3.5, 3.5, 2, 0, -1] },
  pop: { label: 'Pop', bands: [-1, 0.5, 2.5, 3.5, 2, 0, -1, -1, 0.5, 1.5] },
  rock: { label: 'Rock', bands: [4, 3, 1.5, -0.5, -1.5, -0.5, 1, 2.5, 3.5, 4] },
  electronic: { label: 'Electronic', bands: [5, 4, 1.5, 0, -1.5, 1, 0, 1, 3.5, 4.5] },
};
// How strongly the Bass / Mid / Treble controls move each band (1 = full amount).
const MACRO = { bass: [1, 1, 0.8, 0.4, 0, 0, 0, 0, 0, 0], mid: [0, 0, 0.2, 0.6, 1, 1, 0.8, 0.3, 0, 0], treble: [0, 0, 0, 0, 0, 0, 0.3, 0.8, 1, 1] };
const clamp = (v) => Math.max(-12, Math.min(12, v));
export function effectiveGains(eq) {
  if (!eq?.enabled) return BANDS.map(() => 0);
  return BANDS.map((_, i) => clamp((eq.bands?.[i] || 0) + (eq.bass || 0) * MACRO.bass[i] + (eq.mid || 0) * MACRO.mid[i] + (eq.treble || 0) * MACRO.treble[i]));
}
// Pre-gain so boosts don't push the signal into the limiter: pull down by most of the largest boost.
export const preampDb = (gains) => -Math.max(0, ...gains) * 0.85;
// Every band is a peaking filter (Web Audio shelf filters ignore Q, so a 16 kHz shelf barely touched 14 kHz).
export function bandTypes() { return 'peaking'; }
