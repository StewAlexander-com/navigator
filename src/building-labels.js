// Building name pills (v0.1.27). Only OSM-named buildings get a pill, placed on the wall that faces the street; the
// ⓘ button appears only when the building's OSM tags carry more than its name. Details are fetched from the OSM API
// only when ⓘ is tapped and are discarded when the pop-up closes (✕, or 2.5 m of movement).
import {simplifyRing} from './world.js';
export const LABELS = Object.freeze({radius: 175, occluderRadius: 160, shown: 1, special: 2, specialDistance: 150, foodDistance: 85, near: 6, nearMax: 9, maxDistance: 120, lift: 5, minLift: 2.4, offset: .6, closeDistance: 2.5, api: 'https://api.openstreetmap.org/api/0.6'});
const orient = r => r.reduce((s, a, i) => {const b = r[(i + 1) % r.length]; return s + a[0] * b[1] - b[0] * a[1];}, 0) > 0 ? 1 : -1;
// The wall that faces the street: of edges at least 4 m long, the one whose midpoint is nearest a non-footway road
// (within 40 m), computed once per building and cached. Falls back to the longest edge.
const FOOT = ['footway','path','steps','cycleway','bridleway','pedestrian'];
export function streetEdge(b, roads) {
  if (b.streetEdge !== undefined) return b.streetEdge;
  const r = b.rings[0], [a0, c0, a1, c1] = b.bounds, segs = [];
  for (const road of roads) {if (FOOT.includes(road.highway)) continue; for (let j = 1; j < road.points.length; j++) {const c = road.points[j-1], d = road.points[j]; if (Math.max(c[0], d[0]) < a0-40 || Math.min(c[0], d[0]) > a1+40 || Math.max(c[1], d[1]) < c0-40 || Math.min(c[1], d[1]) > c1+40) continue; segs.push([c, d]);}}
  let best = Infinity, index = -1, longest = -1, li = 0;
  for (let k = 0; k < r.length; k++) {
    const p = r[k], q = r[(k + 1) % r.length], l = Math.hypot(q[0]-p[0], q[1]-p[1]); if (l > longest) {longest = l; li = k;}
    if (l < 4) continue;
    const mx = (p[0]+q[0]) / 2, my = (p[1]+q[1]) / 2;
    for (const [c, d] of segs) {const dx = d[0]-c[0], dy = d[1]-c[1], L = dx*dx + dy*dy || 1, t = Math.max(0, Math.min(1, ((mx-c[0])*dx + (my-c[1])*dy) / L)), dist = Math.hypot(mx-c[0]-t*dx, my-c[1]-t*dy); if (dist < best) {best = dist; index = k;}}
  }
  return (b.streetEdge = index >= 0 ? index : li);
}
const inRing = (r, x, y) => {let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) {const a = r[j], b = r[i]; if ((a[1] > y) !== (b[1] > y) && x < (b[0]-a[0]) * (y-a[1]) / (b[1]-a[1]) + a[0]) inside = !inside;} return inside;};
const segDist = (p, q, x, y) => {const dx = q[0]-p[0], dy = q[1]-p[1], l = dx*dx + dy*dy || 1, t = Math.max(0, Math.min(1, ((x-p[0])*dx + (y-p[1])*dy) / l)); return Math.hypot(x-p[0]-t*dx, y-p[1]-t*dy);};
// Food places and landmarks mapped as points get attached to the footprint that contains them (or lies within 3 m);
// one per building, landmarks before food. The pill then goes on that building's wall nearest the point.
export function attachPlaces(buildings, places) {
  const order = [...places].sort((a, b) => (a.kind === 'landmark' ? 0 : 1) - (b.kind === 'landmark' ? 0 : 1));
  for (const p of order) {
    let best = null, bestD = 3;
    for (const b of buildings) {
      const [a0, c0, a1, c1] = b.bounds; if (p.x < a0-3 || p.x > a1+3 || p.y < c0-3 || p.y > c1+3 || b.place) continue;
      const r = b.rings[0];
      if (inRing(r, p.x, p.y)) {best = b; break;}
      for (let k = 0; k < r.length; k++) {const d = segDist(r[k], r[(k + 1) % r.length], p.x, p.y); if (d < bestD) {bestD = d; best = b;}}
    }
    if (best && !best.place) best.place = p;
  }
  return buildings;
}
// Anchor on the street-facing wall (the storefront/door edge when known), 0.6 m outside it, at 45 % of the height
// clamped to 2.4–5 m.
export function namedAnchors(buildings, x, y, radius = LABELS.radius, roads = []) {
  const out = [];
  for (const b of buildings) {
    const special = b.place?.kind || (b.name ? b.kind : null);
    if (!b.name && !b.place) continue;
    const [a0, c0, a1, c1] = b.bounds;
    if (Math.hypot(Math.max(a0 - x, 0, x - a1), Math.max(c0 - y, 0, y - c1)) > radius) continue;
    const r = b.rings[0]; let i = b.frontEdge ?? -1;
    if (b.place) {let bd = Infinity; for (let k = 0; k < r.length; k++) {const p = r[k], q = r[(k + 1) % r.length]; if (Math.hypot(q[0]-p[0], q[1]-p[1]) < 3) continue; const d = segDist(p, q, b.place.x, b.place.y); if (d < bd) {bd = d; i = k;}}}
    if (i < 0) i = streetEdge(b, roads);
    const p = r[i], q = r[(i + 1) % r.length], l = Math.hypot(q[0]-p[0], q[1]-p[1]) || 1, s = orient(r);
    const nx = s * (q[1]-p[1]) / l, ny = -s * (q[0]-p[0]) / l;
    // A mapped place sits on its wall where the point is (usually the entrance), not at the wall's midpoint.
    let mx = (p[0]+q[0]) / 2, my = (p[1]+q[1]) / 2;
    if (b.place) {const wx = q[0]-p[0], wy = q[1]-p[1], t = Math.max(.1, Math.min(.9, ((b.place.x-p[0])*wx + (b.place.y-p[1])*wy) / (l*l))); mx = p[0] + t*wx; my = p[1] + t*wy;}
    out.push({id: b.id, infoId: b.place?.id || b.id, special, name: b.place?.name || b.name, info: b.place ? true : !!b.info, x: mx + nx * LABELS.offset, y: my + ny * LABELS.offset, z: Math.max(LABELS.minLift, Math.min(LABELS.lift, b.height * .45)), nx, ny, wall: [p[0], p[1], q[0], q[1]], height: b.height});
  }
  return out;
}
// Simplified outer rings of nearby buildings, for a 2D line-of-sight test on the main thread.
export function occluders(buildings, x, y, radius = LABELS.occluderRadius) {
  const out = [];
  for (const b of buildings) {
    const [a0, c0, a1, c1] = b.bounds;
    if (b.height < 2.5 || Math.hypot(Math.max(a0 - x, 0, x - a1), Math.max(c0 - y, 0, y - c1)) > radius) continue;
    out.push({id: b.id, ring: simplifyRing(b.rings[0], 1, 12)});
  }
  return out;
}
const crosses = (ax, ay, bx, by, p, q) => {
  const d = (bx-ax) * (q[1]-p[1]) - (by-ay) * (q[0]-p[0]); if (Math.abs(d) < 1e-9) return false;
  const t = ((p[0]-ax) * (q[1]-p[1]) - (p[1]-ay) * (q[0]-p[0])) / d, u = ((p[0]-ax) * (by-ay) - (p[1]-ay) * (bx-ax)) / d;
  return t > 0 && t < 1 && u >= 0 && u <= 1;
};
const ringDistance = (ring, x, y) => {
  let inside = false, best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], dx = b[0]-a[0], dy = b[1]-a[1], l = dx*dx + dy*dy || 1, t = Math.max(0, Math.min(1, ((x-a[0])*dx + (y-a[1])*dy) / l));
    best = Math.min(best, Math.hypot(x-a[0]-t*dx, y-a[1]-t*dy));
    if ((a[1] > y) !== (b[1] > y) && x < dx * (y-a[1]) / (dy || 1e-12) + a[0]) inside = !inside;
  }
  return inside ? 0 : best;
};
// Which anchors to show from (x, y) looking along `heading`, kept deliberately sparse: only buildings you are
// standing next to — footprint within 5 m, widened to 7 m only when nothing is within 5 — in front of the camera,
// wall facing you, and not behind another footprint. At most `shown`, nearest first.
export function visibleLabels(anchors, blockers, {x, y, heading}, shown = LABELS.shown) {
  const h = heading * Math.PI / 180, fx = Math.sin(h), fy = Math.cos(h), near = [], far = [];
  const blocked = (a, px, py) => blockers.some(o => o.id !== a.id && o.ring.some((p, i) => crosses(x, y, px, py, p, o.ring[(i + 1) % o.ring.length])));
  for (const a of anchors) {
    // Food places and landmarks: named from up to 120 m, on their street wall at the wall's own anchor, but only when
    // that whole name area is in clear view — its centre and 2 m either side along the wall all have line of sight.
    if (a.special) {
      const dx = a.x - x, dy = a.y - y, d = Math.hypot(dx, dy);
      if (d > (a.special === 'food' ? LABELS.foodDistance : LABELS.specialDistance) || dx * fx + dy * fy < 2 || dx * a.nx + dy * a.ny > 0) continue;
      const tx = -a.ny * 2, ty = a.nx * 2;
      if ([[a.x, a.y], [a.x + tx, a.y + ty], [a.x - tx, a.y - ty]].some(([px, py]) => blocked(a, px, py))) continue;
      far.push({...a, d, near: d});
      continue;
    }
    const own = blockers.find(o => o.id === a.id), dist = own ? ringDistance(own.ring, x, y) : Math.hypot(a.x - x, a.y - y);
    if (dist > LABELS.nearMax) continue;
    // Up close the wall's midpoint can be far to the side or high overhead, so the pill goes to the point of the street
    // wall nearest where you are looking (4 m ahead), 0.6 m outside it, a little below eye level.
    let px = a.x, py = a.y, pz = a.z;
    if (a.wall) {
      const [ax, ay, bx, by] = a.wall, wx = bx-ax, wy = by-ay, l = wx*wx + wy*wy || 1, tx = x + fx * 4, ty = y + fy * 4;
      const t = Math.max(.05, Math.min(.95, ((tx-ax)*wx + (ty-ay)*wy) / l));
      px = ax + t*wx + a.nx * LABELS.offset; py = ay + t*wy + a.ny * LABELS.offset;
    }
    const dx = px - x, dy = py - y, d = Math.hypot(dx, dy);
    pz = Math.min(pz, 1.35 + .08 * d, Math.max(2, (a.height || 6) - .5));
    if (dx * fx + dy * fy < .5 || dx * a.nx + dy * a.ny > 0 || blocked(a, px, py)) continue;
    near.push({...a, x: px, y: py, z: pz, d, near: dist});
  }
  // Ordinary names only right beside the building: 5 m, widened to 7 m only when nothing is within 5 m.
  const close = near.filter(v => v.near <= LABELS.near), plain = (close.length ? close : near).sort((a, b) => a.near - b.near || a.d - b.d).slice(0, shown);
  // Landmarks before food at equal footing, then nearest; never more than LABELS.special.
  const specials = far.sort((a, b) => (a.special === 'landmark' ? 0 : 1) - (b.special === 'landmark' ? 0 : 1) || a.d - b.d).slice(0, LABELS.special);
  return [...specials, ...plain];
}
// Card rows in order of usefulness; the card shows six, the rest behind "More".
const LABEL_NAMES = {'cuisine':'Cuisine','opening_hours':'Hours','website':'Website','amenity':'Amenity','shop':'Shop','tourism':'Tourism','building':'Building type','building:use':'Use','start_date':'Built','building:levels':'Floors','height':'Height','architect':'Architect','heritage':'Heritage level','operator':'Operator','office':'Office','addr:housename':'House name','addr:block':'Block','addr:block_number':'Block','denomination':'Denomination','religion':'Religion','description':'Description','wikipedia':'Wikipedia','wikidata':'Wikidata','addr:housenumber':'Number','addr:street':'Street','addr:city':'City'};
const pretty = v => String(v).replace(/_/g, ' ');
// Rows [label, value, href?] for the pop-up, from the element's tags. Address parts are joined.
export function infoRows(tags) {
  const rows = [], num = tags['addr:housenumber'], street = tags['addr:street'];
  if (num || street) rows.push(['Address', [num, street].filter(Boolean).join(' ') + (tags['addr:city'] ? `, ${tags['addr:city']}` : '')]);
  for (const [k, label] of Object.entries(LABEL_NAMES)) {
    if (['addr:housenumber','addr:street','addr:city'].includes(k) || !tags[k]) continue;
    if (k === 'building' && ['yes','building'].includes(tags[k])) continue;
    const v = String(tags[k]).slice(0, 300);
    if (k === 'website') rows.push([label, v, /^https?:\/\//.test(v) ? v : null]);
    else if (k === 'wikipedia') {const [lang, title] = v.includes(':') ? v.split(/:(.+)/) : ['en', v]; rows.push([label, title, `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`]);}
    else if (k === 'wikidata') rows.push([label, v, /^Q\d+$/.test(v) ? `https://www.wikidata.org/wiki/${v}` : null]);
    else rows.push([label, k === 'height' ? `${pretty(v)} m` : k === 'cuisine' ? v.split(';').map(pretty).join(', ') : k === 'opening_hours' ? v.replace(/;\s*/g, ' · ') : pretty(v)]);
  }
  return rows;
}
export async function fetchInfo(id, signal, fetcher = fetch) {
  const [type, ref] = String(id).split('/');
  if (!['way', 'relation', 'node'].includes(type) || !/^\d+$/.test(ref)) throw new Error('Not an OSM element.');
  const response = await fetcher(`${LABELS.api}/${type}/${ref}.json`, {signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
  if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}.`);
  const element = (await response.json()).elements?.[0];
  return {tags: element?.tags || {}, url: `https://www.openstreetmap.org/${type}/${ref}`};
}
