// Pure helpers for the tqdm-style progress strip: no DOM, so the wording and the "is the total trustworthy" rule are unit-testable.
export const mib = bytes => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 2 : 1)} MiB`;
export const clock = ms => {const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;};
// Fraction complete, or null when it cannot be known. A Content-Length smaller than the bytes already read means the body
// was compressed in transit (common for OSM JSON), so the total is not a byte budget and the bar goes indeterminate.
export function progressFraction({fraction = null, bytes = 0, total = null} = {}) {
  if (Number.isFinite(fraction)) return Math.min(1, Math.max(0, fraction));
  if (Number.isFinite(total) && total > 0 && bytes <= total) return bytes / total;
  return null;
}
// One-line status like tqdm's postfix: "42 % · 1.20 / 2.85 MiB · 0.41 MiB/s · 00:03 · parsing OSM data".
export function progressText({fraction = null, bytes = 0, total = null, rate = 0, elapsedMs = 0, detail = ''} = {}) {
  const f = progressFraction({fraction, bytes, total}), parts = [];
  if (f !== null) parts.push(`${Math.round(f * 100)} %`);
  if (bytes > 0) parts.push(f !== null && Number.isFinite(total) && total > 0 && bytes <= total ? `${mib(bytes).replace(' MiB', '')} / ${mib(total)}` : mib(bytes));
  if (rate > 0 && bytes > 0) parts.push(`${mib(rate)}/s`);
  parts.push(clock(elapsedMs));
  if (detail) parts.push(detail);
  return parts.join(' · ');
}
// Exponential-ish smoothing of the transfer rate, sampled at most every 400 ms so the figure does not flicker.
export function updateRate(state, bytes, now) {
  if (!state.lastAt) {state.lastAt = now; state.lastBytes = bytes; return state.rate || 0;}
  const dt = (now - state.lastAt) / 1000;
  if (dt >= 0.4) {const instant = Math.max(0, bytes - state.lastBytes) / dt; state.rate = state.rate ? state.rate * 0.5 + instant * 0.5 : instant; state.lastAt = now; state.lastBytes = bytes;}
  return state.rate || 0;
}
