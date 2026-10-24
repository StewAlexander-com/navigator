// Bridges and shaped landmark buildings (v0.1.41). Illustrative massing from OSM tags, like the gables and tower
// crowns: a church is a stone nave under a steep slate gable with a west tower and spire, a mosque a block under a
// dome with a minaret, a temple or shrine a deep hipped tile roof, a warehouse a shallow metal gable, a barn a tall
// gable, and a silo or tank a cylinder. Bridges are raised decks with parapets and piers. Nothing here is surveyed.
import {ShapeUtils, Vector2} from 'three';

// Style codes from 32 up are extended surface types; the shader decodes code − 25 as type 7 and above.
export const SURFACE = Object.freeze({deck: 32, concrete: 33, stone: 34, slate: 35, dome: 36, metal: 37, tile: 38, tank: 39, timber: 40});
// Deck height: `clearance` per OSM layer (1–3), reached at `grade` from each end over at most `rampShare` of the
// length, so a 20 m creek bridge stays under a metre high and a 120 m river bridge clears 5.5 m. Decks are split into
// pieces of at most `piece` metres so each lands in the level-of-detail chunk it crosses.
export const BRIDGE = Object.freeze({clearance: 5.5, grade: .1, rampShare: .42, thickness: .9, parapet: 1.05, parapetWidth: .3, pierEvery: 24, pierMin: 2.2, piece: 40, deckStep: 1.2});
export const isBridge = road => !!road?.bridge && road.bridge !== 'no' && !(road.tunnel && road.tunnel !== 'no');

export function bridgeProfile(length, layer = 1) {
  const target = BRIDGE.clearance * Math.min(3, Math.max(1, parseInt(layer) || 1));
  const ramp = Math.min(length * BRIDGE.rampShare, target / BRIDGE.grade), top = ramp * BRIDGE.grade;
  return s => {const e = Math.max(0, Math.min(s, length - s)); if (e >= ramp) return top; const t = e / ramp; return top * t * t * (3 - 2 * t);};
}
// Each bridge road as pieces {bridge: true, points: [[x, y, z, s]…], width, bounds, height}; s is metres along the bridge.
export function bridgePieces(roads) {
  const out = [];
  for (const road of roads || []) {
    if (!isBridge(road) || (road.points || []).length < 2) continue;
    const pts = road.points, along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const length = along.at(-1);
    if (length < 2) continue;
    const z = bridgeProfile(length, road.layer);
    // Resample so the ramps are smooth and no piece is longer than BRIDGE.piece.
    const samples = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], l = along[i] - along[i - 1], n = Math.max(1, Math.ceil(l / 8));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {const t = k / n, s = along[i - 1] + l * t; samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z(s), s]);}
    }
    let piece = [samples[0]];
    const flush = () => {if (piece.length < 2) return; const xs = piece.map(p => p[0]), ys = piece.map(p => p[1]), h = road.width / 2;
      out.push({bridge: true, points: piece, width: road.width, bounds: [Math.min(...xs) - h, Math.min(...ys) - h, Math.max(...xs) + h, Math.max(...ys) + h], height: Math.max(...piece.map(p => p[2]))});};
    for (const p of samples.slice(1)) {piece.push(p); if (p[3] - piece[0][3] >= BRIDGE.piece) {flush(); piece = [p];}}
    flush();
  }
  return out;
}
// Nearest point of a piece's centre line to (x, y): {d, z, ex, ey} (distance, deck height, segment direction).
function nearestOnPiece(p, x, y) {
  let best = null;
  for (let i = 1; i < p.points.length; i++) {
    const a = p.points[i - 1], b = p.points[i], ex = b[0] - a[0], ey = b[1] - a[1], l = ex * ex + ey * ey;
    if (!l) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l)), d = Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t);
    if (!best || d < best.d) best = {d, z: a[2] + (b[2] - a[2]) * t, ex, ey};
  }
  return best;
}
const inBounds = (p, x, y) => x >= p.bounds[0] && x <= p.bounds[2] && y >= p.bounds[1] && y <= p.bounds[3];
// Deck heights under (x, y): every deck whose carriageway covers the point.
export function decksAt(pieces, x, y) {
  const zs = [];
  for (const p of pieces || []) {if (!inBounds(p, x, y)) continue; const n = nearestOnPiece(p, x, y); if (n && n.d <= p.width / 2 + .25) zs.push(n.z);}
  return zs;
}
// Height to stand at: the deck closest to where you were, if within `deckStep`, else the ground. So you climb a ramp
// from its end but walk under a bridge on the road below. With no previous height (arrival) take the top deck.
export function standingHeight(pieces, x, y, previous = null) {
  const decks = decksAt(pieces, x, y);
  if (previous === null || previous === undefined) return Math.max(0, ...decks);
  let best = null;
  for (const z of decks) if (Math.abs(z - previous) <= BRIDGE.deckStep && (best === null || Math.abs(z - previous) < Math.abs(best - previous))) best = z;
  return best ?? 0;
}
// True when a flat road quad centred at (x, y) running along (dx, dy) lies under a raised deck going the same way:
// that strip is the bridge's own road, now drawn by the deck, and would otherwise show on the water below.
export function underDeck(pieces, x, y, dx, dy) {
  const l0 = Math.hypot(dx, dy) || 1;
  for (const p of pieces || []) {
    if (!inBounds(p, x, y)) continue;
    const n = nearestOnPiece(p, x, y);
    if (n && n.d <= p.width / 2 + .5 && n.z > .3 && Math.abs(dx * n.ex + dy * n.ey) / (l0 * Math.hypot(n.ex, n.ey)) > .85) return true;
  }
  return false;
}

// ---- Mesh helpers. `emit(a, b, c, n, code, ua, ub, uc)`; uv is (metres along a wall, height) for façade patterns.
const signedArea = r => r.reduce((s, a, i) => {const b = r[(i + 1) % r.length]; return s + a[0] * b[1] - b[0] * a[1];}, 0) / 2;
const ccw = r => signedArea(r) < 0 ? r.slice().reverse() : r;
const centroid = r => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
const inRing = (r, x, y) => {let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) {const a = r[j], b = r[i]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;} return inside;};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function face(emit, a, b, c, code, centre) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n);
  if (l < 1e-9) return;
  n = n.map(x => x / l);
  const out = Math.abs(n[2]) > 1e-3 ? n[2] : n[0] * ((a[0] + b[0] + c[0]) / 3 - centre[0]) + n[1] * ((a[1] + b[1] + c[1]) / 3 - centre[1]);
  if (out < 0) n = n.map(x => -x);
  emit(a, b, c, n, code, [0, a[2]], [0, b[2]], [0, c[2]]);
}
function walls(emit, ring, z0, z1, code) {
  const r = ccw(ring);
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    if (l < .01) continue;
    const n = [dy / l, -dx / l, 0], p = [...a, z0], q = [...b, z0], s = [...b, z1], t = [...a, z1];
    emit(p, q, s, n, code, [0, z0], [l, z0], [l, z1]); emit(p, s, t, n, code, [0, z0], [l, z1], [0, z1]);
  }
}
function cap(emit, ring, z, code) {
  const r = ccw(ring), tris = ShapeUtils.triangulateShape(r.map(p => new Vector2(...p)), []);
  for (const t of tris) emit(...t.map(i => [...r[i], z]), [0, 0, 1], code, [0, z], [0, z], [0, z]);
}
function pyramid(emit, ring, z, rise, code) {
  const r = ccw(ring), c = centroid(r), apex = [...c, z + rise];
  for (let i = 0; i < r.length; i++) face(emit, [...r[i], z], [...r[(i + 1) % r.length], z], apex, code, c);
}
// Ridge roof over a counter-clockwise rectangle whose first edge is a long side: `inset` 0 gives a gable with
// vertical end walls (`endCode`), half the short side gives a hipped roof.
function ridgeRoof(emit, q, z, rise, inset, roofCode, endCode) {
  const c = centroid(q), L = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), u = [(q[1][0] - q[0][0]) / L, (q[1][1] - q[0][1]) / L], k = L / 2 - inset;
  const A = [c[0] - u[0] * k, c[1] - u[1] * k, z + rise], B = [c[0] + u[0] * k, c[1] + u[1] * k, z + rise], P = q.map(p => [...p, z]);
  face(emit, P[0], P[1], B, roofCode, c); face(emit, P[0], B, A, roofCode, c);
  face(emit, P[2], P[3], A, roofCode, c); face(emit, P[2], A, B, roofCode, c);
  face(emit, P[1], P[2], B, inset > 0 ? roofCode : endCode, c); face(emit, P[3], P[0], A, inset > 0 ? roofCode : endCode, c);
}
const circle = (c, r, n) => Array.from({length: n}, (_, i) => [c[0] + r * Math.cos(i / n * 2 * Math.PI), c[1] + r * Math.sin(i / n * 2 * Math.PI)]);
function dome(emit, c, z, r, n, code) {
  const bands = Math.max(3, Math.round(n / 3)), at = (i, j) => {const t = i / n * 2 * Math.PI, f = j / bands * Math.PI / 2; return [c[0] + r * Math.cos(f) * Math.cos(t), c[1] + r * Math.cos(f) * Math.sin(t), z + r * Math.sin(f)];};
  for (let j = 0; j < bands; j++) for (let i = 0; i < n; i++) {
    const p = at(i, j), q = at(i + 1, j), s = at(i + 1, j + 1), t = at(i, j + 1);
    face(emit, p, q, s, code, c); if (j < bands - 1) face(emit, p, s, t, code, c);
  }
}
// Minimum-area bounding rectangle: centre, long axis u, its normal v, length L ≥ width W.
export function orientedBox(ring) {
  let best = null;
  const r = ring.length > 300 ? null : ring;
  const axes = r ? r.map((a, i) => {const b = r[(i + 1) % r.length]; return [b[0] - a[0], b[1] - a[1]];}) : [[1, 0]];
  for (const [dx, dy] of axes) {
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) continue;
    const u = [dx / l, dy / l], v = [-u[1], u[0]];
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const p of ring) {const pu = p[0] * u[0] + p[1] * u[1], pv = p[0] * v[0] + p[1] * v[1]; a = Math.min(a, pu); b = Math.max(b, pu); c = Math.min(c, pv); d = Math.max(d, pv);}
    if (!best || (b - a) * (d - c) < best.area) best = {area: (b - a) * (d - c), u, v, a, b, c, d};
  }
  let {u, v, a, b, c, d} = best;
  if (d - c > b - a) {[u, v, a, b, c, d] = [v, [-v[1], v[0]], c, d, -b, -a];}
  const mu = (a + b) / 2, mv = (c + d) / 2;
  return {c: [u[0] * mu + v[0] * mv, u[1] * mu + v[1] * mv], u, v, L: b - a, W: d - c};
}
// Counter-clockwise rectangle around `c` along `u`, first edge a long side (length L).
const rect = (c, u, L, W) => {const v = [-u[1], u[0]], p = (su, sv) => [c[0] + u[0] * su * L / 2 + v[0] * sv * W / 2, c[1] + u[1] * su * L / 2 + v[1] * sv * W / 2]; return [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];};

export function emitBridge(piece, emit, full = true) {
  const {points, width} = piece, h = width / 2, T = BRIDGE.thickness, P = BRIDGE.parapet, pw = BRIDGE.parapetWidth, D = SURFACE.deck, C = SURFACE.concrete;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    if (l < .01) continue;
    const nx = -dy / l, ny = dx / l, za = a[2] + .02, zb = b[2] + .02, ua = Math.max(.02, za - T), ub = Math.max(.02, zb - T);
    const at = (p, o, z) => [p[0] + nx * o, p[1] + ny * o, z], sa = a[3], sb = b[3];
    const top = [at(a, h, za), at(a, -h, za), at(b, -h, zb), at(b, h, zb)];
    emit(top[0], top[1], top[2], [0, 0, 1], D, [sa, 1], [sa, -1], [sb, -1]); emit(top[0], top[2], top[3], [0, 0, 1], D, [sa, 1], [sb, -1], [sb, 1]);
    if (za - T > .05 || zb - T > .05) {const u = [at(a, h, ua), at(a, -h, ua), at(b, -h, ub), at(b, h, ub)]; emit(u[0], u[2], u[1], [0, 0, -1], C, [sa, ua], [sb, ub], [sa, ua]); emit(u[0], u[3], u[2], [0, 0, -1], C, [sa, ua], [sb, ub], [sb, ub]);}
    for (const sgn of [1, -1]) {
      const n = [nx * sgn, ny * sgn, 0], o = h * sgn, oi = (h - pw) * sgn;
      // Fascia: the deck edge, from its underside to the road.
      emit(at(a, o, ua), at(b, o, ub), at(b, o, zb), n, D, [sa, ua], [sb, ub], [sb, zb]); emit(at(a, o, ua), at(b, o, zb), at(a, o, za), n, D, [sa, ua], [sb, zb], [sa, za]);
      if (!full) continue;
      const ni = [-n[0], -n[1], 0];
      emit(at(a, o, za), at(b, o, zb), at(b, o, zb + P), n, C, [sa, za], [sb, zb], [sb, zb + P]); emit(at(a, o, za), at(b, o, zb + P), at(a, o, za + P), n, C, [sa, za], [sb, zb + P], [sa, za + P]);
      emit(at(a, oi, za), at(b, oi, zb), at(b, oi, zb + P), ni, C, [sa, za], [sb, zb], [sb, zb + P]); emit(at(a, oi, za), at(b, oi, zb + P), at(a, oi, za + P), ni, C, [sa, za], [sb, zb + P], [sa, za + P]);
      emit(at(a, o, za + P), at(b, o, zb + P), at(b, oi, zb + P), [0, 0, 1], C, [sa, 0], [sb, 0], [sb, 0]); emit(at(a, o, za + P), at(b, oi, zb + P), at(a, oi, za + P), [0, 0, 1], C, [sa, 0], [sb, 0], [sa, 0]);
    }
    if (!full) continue;
    for (let k = Math.floor(sa / BRIDGE.pierEvery) + 1; k * BRIDGE.pierEvery <= sb; k++) {
      const t = (k * BRIDGE.pierEvery - sa) / (sb - sa), z = za + (zb - za) * t - T;
      if (z < BRIDGE.pierMin) continue;
      walls(emit, rect([a[0] + dx * t, a[1] + dy * t], [dx / l, dy / l], 1.4, width * .7), 0, z, C);
    }
  }
}
// Landmark massing for a building whose style has a `shape` (building-style.js). Returns false to fall back to the
// ordinary extrusion (courtyards, tiny footprints, or a footprint the shape does not suit).
export function emitShaped(b, emit, segments = 16) {
  const shape = b.style?.shape;
  if (!shape || b.part || b.hasParts || b.rings.length !== 1 || b.rings[0].length < 3) return false;
  const ring = ccw(b.rings[0]), area = Math.abs(signedArea(ring));
  if (area < 25) return false;
  const box = orientedBox(ring), fill = area / Math.max(1e-6, box.L * box.W), {L, W} = box, h = b.height, tagged = !!b.style.tagged;
  const S = SURFACE, own = b.style.kind || 0;
  if (shape === 'church') {
    const rise = Math.min(.6 * W, 12);
    const eave = tagged && h <= 25 ? Math.max(3.5, h - rise) : clamp(W * .55, 5, 14), ridge = eave + rise;
    walls(emit, ring, 0, eave, S.stone);
    if (fill >= .8) ridgeRoof(emit, rect(box.c, box.u, L, W), eave, rise, 0, S.slate, S.stone);
    else {cap(emit, ring, eave, S.slate); ridgeRoof(emit, rect(box.c, box.u, L * .92, W * .5), eave, rise * .5, 0, S.slate, S.stone);}
    if (L >= 14) {
      // West tower (churches are traditionally entered from the west); on a north–south nave, the south end.
      const s = clamp(W * .36, 3, 8), k = L / 2 - s / 2, ends = [1, -1].map(g => [box.c[0] + box.u[0] * k * g, box.c[1] + box.u[1] * k * g]);
      const end = Math.abs(box.u[0]) >= .38 ? (ends[0][0] < ends[1][0] ? ends[0] : ends[1]) : (ends[0][1] < ends[1][1] ? ends[0] : ends[1]);
      const top = tagged && h > 25 ? h * .6 : ridge + Math.max(4, s * 1.2), spire = tagged && h > 25 ? h * .4 : s * 2.4, tower = rect(end, box.u, s, s);
      walls(emit, tower, 0, top, S.stone); pyramid(emit, tower, top, spire, S.slate);
    }
    return true;
  }
  if (shape === 'mosque') {
    const eave = tagged ? Math.max(3.5, Math.min(h, 14)) : clamp(W * .42, 5, 12), rd = clamp(Math.min(L, W) * .22, 2.5, 12);
    const c = inRing(ring, ...box.c) ? box.c : centroid(ring), drum = rd * .3;
    walls(emit, ring, 0, eave, S.stone); cap(emit, ring, eave, S.stone);
    walls(emit, circle(c, rd, segments), eave, eave + drum, S.stone); dome(emit, c, eave + drum, rd, segments, S.dome);
    pyramid(emit, circle(c, .35, 6), eave + drum + rd - .1, rd * .3, S.dome);
    if (L >= 12) {
      const m = [box.c[0] + box.u[0] * (L / 2 - 1.8) + box.v[0] * (W / 2 - 1.8), box.c[1] + box.u[1] * (L / 2 - 1.8) + box.v[1] * (W / 2 - 1.8)];
      const top = Math.max(eave * 2.5, eave + drum + rd + 6, 16), n = Math.max(6, segments / 2);
      walls(emit, circle(m, 1.2, n), 0, top, S.stone);
      walls(emit, circle(m, 1.8, n), top * .8, top * .8 + .7, S.stone); cap(emit, circle(m, 1.8, n), top * .8 + .7, S.stone);
      pyramid(emit, circle(m, 1.3, n), top, 3.5, S.dome);
    }
    return true;
  }
  if (shape === 'temple') {
    const eave = tagged ? Math.max(3, h * .55) : clamp(W * .35, 3.5, 8), rise = tagged ? Math.max(1.5, h - eave) : W * .42, o = clamp(W * .12, .6, 2);
    const eaves = rect(box.c, box.u, L + 2 * o, W + 2 * o);
    walls(emit, ring, 0, eave, S.timber); cap(emit, eaves, eave, S.tile);
    ridgeRoof(emit, eaves, eave, rise, Math.min((W + 2 * o) / 2, (L + 2 * o) / 2 - .5), S.tile, S.tile);
    return true;
  }
  if (shape === 'industrial' || shape === 'barn') {
    if (area < 60 || fill < .85) return false;
    const rise = shape === 'barn' ? W * .45 : Math.min(W * .08, 4), eave = Math.max(3, h - (tagged ? rise : 0));
    const wall = shape === 'barn' ? S.timber : own;
    walls(emit, ring, 0, eave, wall); ridgeRoof(emit, rect(box.c, box.u, L, W), eave, rise, 0, S.metal, wall);
    return true;
  }
  if (shape === 'silo' || shape === 'tank') {
    const r = Math.sqrt(area / Math.PI), c = centroid(ring);
    if (ring.length < 6 || fill < .7 || fill > .86 || L / W > 1.25) {walls(emit, ring, 0, h, S.tank); cap(emit, ring, h, S.tank); return true;}
    const top = tagged ? h : shape === 'silo' ? Math.max(h, r * 2.5, 10) : Math.max(4, Math.min(h, r * 1.1, 15));
    walls(emit, circle(c, r, segments), 0, top, S.tank); pyramid(emit, circle(c, r, segments), top, r * (shape === 'silo' ? .5 : .15), S.tank);
    return true;
  }
  return false;
}
