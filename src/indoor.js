// "You may be inside a building": a confidence-gated hint from the GPS fix and the loaded OSM footprints. Pure functions;
// the worker runs locateBuilding once per accepted fix (a bounds scan plus one point-in-polygon), main.js renders the verdict.
import {containsPoint} from './building-style.js';

export const INDOOR = Object.freeze({
  likelyDepth: 1,   // fix at least one accuracy radius inside the footprint → "probably inside"
  maybeDepth: 0.3,  // at least 0.3 radii inside → "may be inside"; shallower is not shown at all
  maxSpeed: 3,      // m/s; moving faster than walking pace is never called "inside a building"
  holdFixes: 2      // consecutive fixes without a verdict before the pill hides (edge flicker guard)
});
const KIND_TEXT = ['a building', 'a home', 'an apartment building', 'a shop building', 'an office building', 'a utility building', 'a civic building'];

const segmentDistance = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
// Distance from a point to the nearest edge of any ring (outer or hole): how far "inside" a contained point is.
export function depthInside(rings, p) {
  let best = Infinity;
  for (const ring of rings) for (let i = 0; i < ring.length; i++) best = Math.min(best, segmentDistance(p, ring[i], ring[(i + 1) % ring.length]));
  return best;
}
// The footprint containing the local point, with its edge depth, or null. Bounds reject almost every building first.
export function locateBuilding(buildings, [x, y]) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const b of buildings) {
    const bb = b.bounds; if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue;
    if (containsPoint(b.rings, [x, y])) return {id: b.id, name: b.name || '', kind: b.style?.kind || 0, depth: depthInside(b.rings, [x, y])};
  }
  return null;
}
// Gate the hint on how deep the fix sits relative to its accuracy radius; a ±60 m fix inside a 10 m house says little.
export function indoorVerdict(located, accuracy, speed = null) {
  if (!located || !Number.isFinite(accuracy) || accuracy <= 0) return null;
  if (Number.isFinite(speed) && speed > INDOOR.maxSpeed) return null;
  const ratio = located.depth / accuracy;
  if (ratio < INDOOR.maybeDepth) return null;
  const level = ratio >= INDOOR.likelyDepth ? 'likely' : 'maybe', what = located.name || KIND_TEXT[located.kind] || KIND_TEXT[0];
  return {level, text: level === 'likely' ? `You are probably inside ${what}` : `You may be inside ${what}`, name: located.name, kind: located.kind, depth: located.depth, accuracy};
}
