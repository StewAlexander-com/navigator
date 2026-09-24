// Match the player to rendered road surfaces; no route or survey-accuracy claim.
export function nearestStreet(roads,player,previous=null){
 const candidates=[];
 for(const road of roads)for(let i=1;i<road.points.length;i++){
  const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;
  if(!l)continue;
  const t=Math.max(0,Math.min(1,((player.x-a[0])*dx+(player.y-a[1])*dy)/l));
  const distance=Math.hypot(player.x-a[0]-t*dx,player.y-a[1]-t*dy);
  const surfaceDistance=Math.max(0,distance-road.width/2);
  if(surfaceDistance>3)continue;
  const path=['footway','path','pedestrian','steps','cycleway','bridleway'].includes(road.highway);
  const name=String(road.name||'').trim(),key=streetKey(road);
  candidates.push({key,name:name||(path?'Path name unavailable':'Street name unavailable'),kind:path?'PATH':'STREET',distance,surfaceDistance,named:!!name,insideNamedStreet:!!name&&!path&&surfaceDistance===0});
 }
 candidates.sort((a,b)=>Number(b.insideNamedStreet)-Number(a.insideNamedStreet)||a.surfaceDistance-b.surfaceDistance||a.distance-b.distance||a.key.localeCompare(b.key));
 const best=candidates[0];if(!best)return null;
 // Keep the same street through small GPS fluctuations near an intersection.
 return candidates.find(c=>c.key===previous?.key&&(!best.insideNamedStreet||c.insideNamedStreet)&&c.surfaceDistance<=best.surfaceDistance+2)||best;
}
// v0.1.23: where the street label floats. The label used to ride a single point 4.5 m ahead of the camera at eye
// height and was hidden whenever that point left a fixed screen band, so any vertical drag (pitch) or a turn away
// from the street hid it. Now it sits on the current street itself: the view ray is intersected with the ground (or,
// looking at or above the horizon, taken 40 m ahead), and the label goes to the closest point of the current street
// in front of the camera. It shows whenever that point is on screen.
const PATHS = ['footway','path','pedestrian','steps','cycleway','bridleway'];
export const LABEL = Object.freeze({eye: 1.65, lift: 2.2, reach: 120, ahead: 40, minAhead: 1.5, maxGround: 80, segments: 400});
export const streetKey = road => String(road.name || '').trim() || `unnamed:${road.source?.[0] ?? road.highway}`;
// Segments of `street` (from nearestStreet) within `radius` of the player, as [ax, ay, bx, by, half width].
export function streetSegments(roads, street, player, radius = LABEL.reach) {
  if (!street) return [];
  const out = [];
  for (const road of roads) {
    if (streetKey(road) !== street.key || PATHS.includes(road.highway) !== (street.kind === 'PATH')) continue;
    for (let i = 1; i < road.points.length && out.length < LABEL.segments; i++) {
      const a = road.points[i-1], b = road.points[i], dx = b[0]-a[0], dy = b[1]-a[1], l = dx*dx + dy*dy;
      if (!l) continue;
      const t = Math.max(0, Math.min(1, ((player.x-a[0])*dx + (player.y-a[1])*dy) / l));
      if (Math.hypot(player.x-a[0]-t*dx, player.y-a[1]-t*dy) <= radius) out.push([a[0], a[1], b[0], b[1], road.width / 2]);
    }
  }
  return out;
}
// World point [x, y, z] for the label, or null when no part of the street lies in front of the camera.
export function labelPoint(segments, {x, y, heading, pitch = 0}) {
  if (!segments.length) return null;
  const h = heading * Math.PI / 180, p = pitch * Math.PI / 180, fx = Math.sin(h), fy = Math.cos(h);
  // Where the view centre meets the ground; at or above the horizon, a point `ahead` metres along the view.
  const down = -Math.sin(p), reach = down > 0.02 ? Math.min(LABEL.maxGround, LABEL.eye / Math.tan(-p)) : LABEL.ahead;
  const gx = x + fx * reach, gy = y + fy * reach;
  // First choice: where the view centre itself is over the street — the farthest point along the view ray (up to the
  // ground hit or 40 m) that lies on the carriageway, sampled every 1/24 of the way. That keeps the label mid-screen
  // whenever the camera looks at any part of the street, including turned well away from its axis.
  const onStreet = (px, py) => segments.some(([ax, ay, bx, by, half]) => {const dx = bx-ax, dy = by-ay, l = dx*dx + dy*dy, t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / l)); return Math.hypot(px-ax-t*dx, py-ay-t*dy) <= half;});
  for (let i = 24; i >= 0; i--) {
    const d = LABEL.minAhead + (reach - LABEL.minAhead) * i / 24, px = x + fx * d, py = y + fy * d;
    if (onStreet(px, py)) return [px, py, Math.min(LABEL.lift, Math.max(.6, .5 + .085 * d))];
  }
  // Otherwise: the point of the street nearest that spot, still in front of the camera (the caller hides it off screen).
  let best = null, bestD = Infinity;
  for (const [ax, ay, bx, by, half] of segments) {
    const dx = bx-ax, dy = by-ay, l = dx*dx + dy*dy;
    // Clip the centreline to what can still reach `minAhead` metres in front within the street's half width, so a
    // street you stand on and look straight across still counts: its far half is in view.
    let t0 = 0, t1 = 1; const s0 = (ax-x)*fx + (ay-y)*fy - LABEL.minAhead + half, ds = dx*fx + dy*fy;
    if (Math.abs(ds) < 1e-9) {if (s0 < 0) continue;} else {const tc = -s0 / ds; if (ds > 0) t0 = Math.max(t0, tc); else t1 = Math.min(t1, tc);}
    if (t0 > t1) continue;
    const t = Math.max(t0, Math.min(t1, ((gx-ax)*dx + (gy-ay)*dy) / l));
    let px = ax + t*dx, py = ay + t*dy;
    // Push a point that is too close forward along the view, staying on the carriageway (at most the half width).
    const f = (px-x)*fx + (py-y)*fy, push = Math.min(half, Math.max(0, LABEL.minAhead - f));
    px += fx * push; py += fy * push;
    const d = Math.hypot(px-gx, py-gy);
    // Near points float lower (0.6 m at arm's length, rising to the 2.2 m lift by about 20 m) so they stay in view.
    if (d < bestD) {bestD = d; best = [px, py, Math.min(LABEL.lift, Math.max(.6, .5 + .085 * (f + push)))];}
  }
  return best;
}
