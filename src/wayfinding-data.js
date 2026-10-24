// Wayfinding data (v0.1.33): street junctions, which of them get a signpost, the next cross street, and the size of the
// street-level pins under food/landmark names. Pure functions on local metres (x east, y north), unit-tested.
export const WAYDATA = Object.freeze({signs: 3, signRadius: 110, junctionMerge: 15, signRepeat: 40, corner: 8.4, crossingRadius: 160, visit: 20, trailStep: 3, trailMax: 600});
export const PIN_COLORS = Object.freeze({food: '#f2a03a', landmark: '#4ce8e4'});
const bearingOf = (dx, dy) => (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
const turn = (a, b) => ((b - a + 540) % 360) - 180;
// Junctions: points shared by two or more differently named carriageways (OSM ways share the junction node, so the
// local coordinates are identical). Nodes within `junctionMerge` metres merge, so a dual carriageway is one junction.
// Each street keeps its bearing at the junction for the sign blade.
export function findJunctions(roads) {
  const at = new Map();
  for (const road of roads) {
    if (!road.name || road.width <= 2) continue;
    const p = road.points;
    for (let i = 0; i < p.length; i++) {
      const key = `${Math.round(p[i][0] * 10)},${Math.round(p[i][1] * 10)}`, a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      if (a === b) continue;
      let e = at.get(key); if (!e) at.set(key, e = {x: p[i][0], y: p[i][1], streets: []});
      if (!e.streets.some(s => s.name === road.name)) e.streets.push({name: road.name, bearing: bearingOf(b[0]-a[0], b[1]-a[1]) % 180});
    }
  }
  const out = [];
  for (const j of at.values()) {
    if (j.streets.length < 2) continue;
    const m = out.find(o => Math.hypot(o.x - j.x, o.y - j.y) < WAYDATA.junctionMerge);
    if (!m) {out.push({x: j.x, y: j.y, streets: j.streets.slice()}); continue;}
    for (const s of j.streets) if (!m.streets.some(t => t.name === s.name)) m.streets.push(s);
  }
  return out;
}
// Up to `signs` junctions within `signRadius`, those ahead of the view first. Each sign stands on the corner nearest the
// viewer, with blades along the first two streets.
export function pickSignposts(junctions, player, {max = WAYDATA.signs, radius = WAYDATA.signRadius} = {}) {
  const scored = [];
  for (const j of junctions) {
    const d = Math.hypot(j.x - player.x, j.y - player.y); if (d > radius) continue;
    const ahead = d < 12 || Math.abs(turn(player.heading, bearingOf(j.x - player.x, j.y - player.y))) < 75;
    scored.push([d * (ahead ? 1 : 2.2), j]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  // A split carriageway maps one crossing as two or more junctions just over `junctionMerge` apart; one sign per street
  // pair within `signRepeat` metres.
  const kept = [];
  for (const [, j] of scored) {
    if (kept.length === max) break;
    const pair = j.streets.slice(0, 2).map(s => s.name).sort().join('|');
    if (kept.some(k => k.pair === pair && Math.hypot(k.j.x - j.x, k.j.y - j.y) < WAYDATA.signRepeat)) continue;
    kept.push({pair, j});
  }
  return kept.map(({j}) => {
    const [s1, s2] = j.streets, r1 = s1.bearing * Math.PI / 180, r2 = s2.bearing * Math.PI / 180;
    const u = [Math.sin(r1), Math.cos(r1)];
    let v = [Math.sin(r2), Math.cos(r2)];
    if (Math.abs(u[0] * v[0] + u[1] * v[1]) > .9) v = [-u[1], u[0]];
    let best = null;
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const x = j.x + (u[0] * a + v[0] * b) * WAYDATA.corner, y = j.y + (u[1] * a + v[1] * b) * WAYDATA.corner, d = Math.hypot(x - player.x, y - player.y);
      if (!best || d < best.d) best = {x, y, d};
    }
    return {x: best.x, y: best.y, names: [s1.name, s2.name], bearings: [s1.bearing, s2.bearing], key: `${s1.name}|${s2.name}|${Math.round(j.x)},${Math.round(j.y)}`};
  });
}
// The nearest junction ahead on the current street (within ±60° of the view), as the cross street's name and distance.
// Without a named current street, the nearest junction ahead of the view.
export function nextCrossing(junctions, player, streetName, radius = WAYDATA.crossingRadius) {
  let best = null;
  for (const j of junctions) {
    const d = Math.hypot(j.x - player.x, j.y - player.y); if (d < 6 || d > radius) continue;
    if (Math.abs(turn(player.heading, bearingOf(j.x - player.x, j.y - player.y))) > 60) continue;
    if (streetName && !j.streets.some(s => s.name === streetName)) continue;
    if (!best || d < best.d) best = {d, j};
  }
  if (!best) return null;
  const other = best.j.streets.find(s => s.name !== streetName);
  return other ? {name: other.name, distance: best.d} : null;
}
// Sign legibility (v0.1.38). A blade keeps its real orientation along its street while seen within `turnFrom` degrees
// of face-on; past that it turns smoothly toward the viewer (fully face-on when you look straight down its street), so
// it is never seen edge-on. The 180° turn where the fold flips is invisible because both faces read left to right.
// Up to `readDistance` the sign is its drawn size; beyond, the signpost grows with distance (up to `grow`×; see signZ), so
// capitals keep a constant on-screen height out to readDistance × grow (48 m, about half a block). textHeight: cap height
// of a full-size name at the 1.25× drawn size (Inter capitals are 0.73 em of the 116 px font in a 172 px row of a
// 0.525 m blade). fov: the vertical field of view fitView() in main.js sets on phones and on wider screens.
export const SIGN = Object.freeze({turnFrom: 35, readDistance: 12, grow: 4, eye: 1.65, collar: 2.7 * 1.25, textHeight: .73 * 116 / 172 * .42 * 1.25, fov: Object.freeze({phone: 65, wide: 45})});
export const signScale = d => Math.min(SIGN.grow, Math.max(1, d / SIGN.readDistance));
// Rendered blade yaw (radians, from +x) for a blade of street yaw `yaw`, seen from (dx, dy) = eye − sign. The vertex
// shader in wayfinding.js computes the same thing per frame.
export function bladeYaw(yaw, dx, dy) {
  const th = ((Math.atan2(dy, dx) - yaw) % Math.PI + Math.PI) % Math.PI - Math.PI / 2, from = SIGN.turnFrom * Math.PI / 180;
  const x = Math.min(1, Math.max(0, (Math.abs(th) - from) / (Math.PI / 2 - from)));
  return yaw + th * x * x * (3 - 2 * x);
}
// Height of a signpost point at drawn height `z` once grown by `k`. The blades grow about eye height, so a grown sign
// stays about 12° above the horizon instead of climbing into the screen's top overlays; the pole below the blade collar
// stretches to stay on the ground. The vertex shaders in wayfinding.js do the same.
export const signZ = (z, k) => z < SIGN.collar ? z * (SIGN.eye + (SIGN.collar - SIGN.eye) * k) / SIGN.collar : SIGN.eye + (z - SIGN.eye) * k;
// On-screen cap height in CSS pixels of a full-size name `d` metres away in a viewport `height` pixels tall.
export const signTextPixels = (d, height, fov) => SIGN.textHeight * signScale(d) * height / (2 * d * Math.tan(fov * Math.PI / 360));
// Sign-blade text: the conventional abbreviations real street signs use, so names fit and read at a distance.
const PREFIX = {North: 'N', South: 'S', East: 'E', West: 'W'}, SUFFIX = {Street: 'St', Avenue: 'Ave', Boulevard: 'Blvd', Road: 'Rd', Drive: 'Dr', Place: 'Pl', Lane: 'Ln', Court: 'Ct', Parkway: 'Pkwy', Highway: 'Hwy', Terrace: 'Ter', Square: 'Sq'};
export function signName(name) {
  const w = String(name).trim().split(/\s+/);
  if (w.length > 1 && PREFIX[w[0]]) w[0] = PREFIX[w[0]];
  if (w.length > 1 && SUFFIX[w[w.length - 1]]) w[w.length - 1] = SUFFIX[w[w.length - 1]];
  return w.join(' ');
}
// A street-level pin under a food/landmark name: on the pavement at the name's wall, growing with distance so it stays
// visible, and always topping out below the 2.4 m lowest name height so pin and name never sit on top of each other.
export function pinPose(d) {const s = Math.min(1.6, Math.max(.7, d / 45)); return {s, lift: .35, head: .35 + .66 * s};}
export const formatDistance = d => d < 1000 ? `${Math.max(1, Math.round(d))} m` : `${(d / 1000).toFixed(1)} km`;
