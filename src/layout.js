// Overlay layout: floating pills must never sit on top of each other or on fixed UI, whatever the viewport. Pure geometry
// on {x, y, w, h} rectangles in CSS pixels so the rules are unit-testable. Pills keep their designed position when it is
// free, move vertically to the nearest free slot when it is not, and shrink only when no slot in their column can fit them.
export const LAYOUT = Object.freeze({gap: 6, edge: 6, minScale: 0.6});
const overlapsX = (a, b, gap) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x;
const overlapsY = (a, b, gap) => a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
export const intersects = (a, b, gap = 0) => overlapsX(a, b, gap) && overlapsY(a, b, gap);
// Free vertical intervals [top, bottom) in the column of `rect`, between obstacles that share that column and the viewport edges.
export function freeIntervals(rect, obstacles, viewport, gap = LAYOUT.gap, edge = LAYOUT.edge) {
  const blocks = obstacles.filter(o => overlapsX(rect, o, gap)).map(o => [o.y - gap, o.y + o.h + gap]).sort((a, b) => a[0] - b[0]);
  const out = []; let cursor = edge;
  for (const [start, end] of blocks) {if (start > cursor) out.push([cursor, start]); cursor = Math.max(cursor, end);}
  if (viewport.height - edge > cursor) out.push([cursor, viewport.height - edge]);
  return out;
}
// Returns {y, scale, moved, shrunk} for `rect` at its preferred position. `y` is the unscaled top; scaling is about the
// box centre, so a shrunk pill is centred in the largest free interval of its column.
export function place(rect, obstacles, viewport, {gap = LAYOUT.gap, edge = LAYOUT.edge, minScale = LAYOUT.minScale} = {}) {
  const inside = rect.y >= edge && rect.y + rect.h <= viewport.height - edge;
  if (inside && !obstacles.some(o => intersects(rect, o, gap))) return {y: rect.y, scale: 1, moved: false, shrunk: false};
  const intervals = freeIntervals(rect, obstacles, viewport, gap, edge), fitting = intervals.filter(([s, e]) => e - s >= rect.h);
  if (fitting.length) {
    let best = null;
    // Nearest slot wins; an exact tie moves down, away from the header and compass.
    for (const [s, e] of fitting) {const y = Math.min(Math.max(rect.y, s), e - rect.h), d = Math.abs(y - rect.y); if (!best || d < best.d || (d === best.d && y > best.y)) best = {y, d};}
    return {y: best.y, scale: 1, moved: true, shrunk: false};
  }
  let largest = null; for (const iv of intervals) if (!largest || iv[1] - iv[0] > largest[1] - largest[0]) largest = iv;
  if (!largest) return {y: rect.y, scale: minScale, moved: false, shrunk: true};
  const room = largest[1] - largest[0], scale = Math.max(minScale, Math.min(1, room / rect.h)), centre = (largest[0] + largest[1]) / 2;
  return {y: centre - rect.h / 2, scale, moved: true, shrunk: true};
}
// The rectangle a placement occupies on screen (scaled about the centre), used as an obstacle for later pills.
export const placedRect = (rect, {y, scale}) => ({x: rect.x + (rect.w - rect.w * scale) / 2, y: y + (rect.h - rect.h * scale) / 2, w: rect.w * scale, h: rect.h * scale});
// Number of overlapping pairs among visible rectangles (used as the diagnostic "everything is readable" check).
export function overlapCount(rects) {let n = 0; for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (intersects(rects[i], rects[j])) n++; return n;}
