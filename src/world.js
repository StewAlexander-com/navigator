import {buildingStyle,contextLanduse,storefrontEdge,nearestRoadClass,residentialRoads,BUILDING_STYLES} from './building-style.js';
import osmtogeojson from 'osmtogeojson';
import {areaContext, isCountryside} from './context.js';
import {climateProfile} from './climate.js';
import {ShapeUtils, Vector2} from 'three';
import {BRIDGE, bridgePieces, emitBridge, emitShaped} from './structures.js';

export const ORIGIN = [-118.2462058, 34.0510824];
export const BBOX = [34.0477, -118.2490, 34.0538, -118.2417];
// `area` is the half-size of a live GPS download square; `areaFallback` is retried once when a dense area exceeds the response cap.
// Above walking pace the half-size grows `areaPerSpeed` metres per m/s to `areaMax`, the centre leads the fix by `areaLeadS`
// seconds of travel, the next square is prefetched `prefetchLeadS` seconds (at least `prefetchMargin` metres) before the edge,
// and the worker keeps the last `squares` parsed squares (at most `squareBytes` of source responses) for the session.
// `buildings` is only a sanity cap: the GPU cost is vertices, so detail is budgeted by `vertices` (see DETAIL).
export const LIMITS = Object.freeze({radius: 180, movement: 120, area: 400, areaFallback: 250, areaMax: 1000, areaPerSpeed: 30, areaLeadS: 6, prefetchLeadS: 8, prefetchMargin: 100, squares: 8, squareBytes: 16 * 1024 * 1024, vertices: 90000, buildings: 4000, responseBytes: 8 * 1024 * 1024});
// Detail tiers (v0.1.42), game-style: a building is drawn in full (exact footprint, gable, crown), as a `facade`
// (outer ring simplified to ≤ `facadePoints` corners with a flat top; the shader still paints its windows, so from the
// street it reads the same), or as its bounding `box`, and dropped only when even a box no longer fits the vertex
// budget. A flat roof above `hiddenRoof` is never drawn: the highest eye is 1.65 m over a third-layer bridge deck
// (18.2 m), and from below a roof plane is hidden by its own walls. When even boxes would not fit, boxes may take at most
// `coverage` of the budget so the nearest buildings keep their detail and only the furthest are left out (and reported).
export const DETAIL = Object.freeze({facadePoints: 10, facadeTolerance: 1.5, box: 30, coverage: .75, hiddenRoof: 1.65 + 3 * BRIDGE.clearance + 6});
const M = 111319.49079327358;
// Local metres are east/north of an origin; the origin is the bundled LA point unless a GPS area re-anchors it.
export const toLocal = ([lng, lat], origin = ORIGIN) => [(lng - origin[0]) * M * Math.cos(origin[1] * Math.PI / 180), (lat - origin[1]) * M];
export const toLngLat = (x, y, origin = ORIGIN) => [origin[0] + x / (M * Math.cos(origin[1] * Math.PI / 180)), origin[1] + y / M];
// True when OSM carries a usable height or level count; otherwise `height()` returns a documented default.
export const hasHeightTag = tags => Number.isFinite(parseFloat(String(tags.height || ''))) || Number.isFinite(parseFloat(tags['building:levels']));
// Deterministic defaults by building type. A bare `building=yes` is 12 m unless it is a small footprint (≤ 250 m²) in
// residential context, where two storeys (6.5 m) is the honest guess; house-like types and outbuildings have their own.
// In the countryside or a town (context.js) an untagged generic footprint is one storey (4 m) up to 120 m², otherwise
// 6.5 m: a small town's main street is not a row of 12 m blocks, and its taller buildings usually carry levels tags.
export function height(tags, {residential = false, area = Infinity, countryside = false} = {}) {
  const raw = String(tags.height || '');
  const explicit = parseFloat(raw) * (/ft|feet|'/.test(raw) ? 0.3048 : 1);
  const levels = parseFloat(tags['building:levels']);
  const fallback = {house: 7, detached: 7, semidetached_house: 7, terrace: 7, bungalow: 4, cabin: 4, hut: 3.5, stilt_house: 5, static_caravan: 3, garage: 3, garages: 3, shed: 3, carport: 3, kiosk: 3, greenhouse: 3.5, farm_auxiliary: 5, barn: 7, stable: 5, cowshed: 5, sty: 3, farm: 7, residential: 12, apartments: 18, commercial: 24, industrial: 9, office: 30};
  const generic = ['yes', 'building', undefined].includes(tags.building);
  const rural = countryside && (generic || (tags.building === 'residential' && area <= 300)) ? (area <= 120 ? 4 : 6.5) : null;
  const small = residential && area <= 250 && generic ? 6.5 : null;
  return Math.min(180, Math.max(3, Number.isFinite(explicit) ? explicit : Number.isFinite(levels) ? levels * 3.2 : rural || fallback[tags.building] || small || 12));
}
// True when OSM tags carry more than a name (address, type, levels, dates…); read by the building pills' ⓘ button.
const INFO_TAGS=['addr:housenumber','addr:housename','addr:street','addr:block','addr:block_number','building:levels','height','start_date','architect','operator','website','wikipedia','wikidata','description','amenity','shop','office','tourism','heritage','opening_hours','building:use'];
const hasInfoTags=t=>INFO_TAGS.some(k=>t[k])||(t.building&&!['yes','building'].includes(t.building));
const pointInRing = (r, x, y) => {let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) {const a = r[j], b = r[i]; if ((a[1] > y) !== (b[1] > y) && x < (b[0]-a[0]) * (y-a[1]) / (b[1]-a[1]) + a[0]) inside = !inside;} return inside;};
const minHeight = (t, h) => {const m = parseFloat(t.min_height), l = parseFloat(t['building:min_level']); return Math.max(0, Math.min(h - .5, Number.isFinite(m) ? m : Number.isFinite(l) ? l * 3.2 : 0));};
// OSM roof:shape → a cheap roof: pyramidal/dome/onion/hipped/cone become a pyramid (apex over the centroid), gabled
// stays the gable; roof:height or a proportional default sets how tall it is. Anything else, or untagged, is flat.
function roofOf(t, h) {
  const shape = {pyramidal: 'pyramid', dome: 'pyramid', onion: 'pyramid', hipped: 'pyramid', cone: 'pyramid', gabled: 'gable'}[t['roof:shape']];
  if (!shape) return null;
  const rh = parseFloat(t['roof:height']);
  return {shape, height: Math.min(h * .6, Number.isFinite(rh) && rh > 0 ? rh : h * (shape === 'pyramid' ? .18 : .12))};
}
const ringArea = points => Math.abs(points.reduce((sum, a, i) => {const b = points[(i + 1) % points.length]; return sum + a[0] * b[1] - b[0] * a[1];}, 0)) / 2;
export function boundedPosition(x, y) {
  const length = Math.hypot(x, y);
  return length > LIMITS.movement ? [x * LIMITS.movement / length, y * LIMITS.movement / length] : [x, y];
}
// Manual movement speed (m/s) after holding a move key or arrow for `held` seconds: walking pace at first, so a tap is
// a small step, then an ease-in-out ramp to 7 mph (3.13 m/s) over `rampS`; held on from `fastFrom` s, a second ramp
// over `fastS` s reaches 15 mph (6.71 m/s) for crossing an area quickly.
const MPH = 0.44704, ease = t => {t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t);};
export const MOVE = Object.freeze({walk: 1.4, top: 7 * MPH, rampS: 2, fast: 15 * MPH, fastFrom: 7, fastS: 3});
export function moveSpeed(held) {
  const t = held || 0;
  return MOVE.walk + (MOVE.top - MOVE.walk) * ease(t / MOVE.rampS) + (MOVE.fast - MOVE.top) * ease((t - MOVE.fastFrom) / MOVE.fastS);
}
// Manual exploration (v0.1.26) may walk to the edge of the loaded area, `margin` metres short of it, instead of the
// old 120 m circle. Returns [x, y, hit] with `hit` true when the step was clamped at the edge.
export function boundedToArea(x, y, [south, west, north, east], origin = ORIGIN, margin = 10) {
  const [minX, minY] = toLocal([west, south], origin), [maxX, maxY] = toLocal([east, north], origin);
  const cx = Math.min(maxX - margin, Math.max(minX + margin, x)), cy = Math.min(maxY - margin, Math.max(minY + margin, y));
  return [cx, cy, cx !== x || cy !== y];
}
// Metres from (x, y) to the nearest edge of the area (negative outside).
export function areaEdgeDistance(x, y, [south, west, north, east], origin = ORIGIN) {
  const [minX, minY] = toLocal([west, south], origin), [maxX, maxY] = toLocal([east, north], origin);
  return Math.min(x - minX, maxX - x, y - minY, maxY - y);
}
export const COUNTRY_WIDTH = Object.freeze({track: 3.5, living_street: 5, residential: 6, unclassified: 6, road: 6, tertiary: 8, tertiary_link: 7, secondary: 10, secondary_link: 8, primary: 12, primary_link: 9});
export function parseWorld(raw, origin = ORIGIN) {
  if (!Array.isArray(raw.elements) || raw.elements.length > 30000 || raw.remark) throw new Error('Incomplete or oversized OSM response.');
  const features = osmtogeojson(raw, {flatProperties: true}).features;
  const buildings = [], roads = [];
  // Use only bounded land-use polygons already in this response; no extra lookup per building.
  const zones=[];
  for(const f of features){if(!['residential','retail','industrial'].includes(f.properties.landuse))continue;
   const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[];
   for(const poly of polys){if(zones.length>=128||poly.flat().length>2048)continue;zones.push({use:f.properties.landuse,rings:poly.map(r=>r.map(p=>toLocal(p,origin)))});}
  }
  const zoneArea=z=>Math.abs(z.rings[0].reduce((sum,a,i,r)=>{const b=r[(i+1)%r.length];return sum+a[0]*b[1]-b[0]*a[1];},0));zones.sort((a,b)=>zoneArea(a)-zoneArea(b));
  const local = p => toLocal(p, origin);
  for (const f of features) {
    if (f.properties.highway && f.geometry.type === 'LineString') {
      const width = ['footway', 'path', 'steps'].includes(f.properties.highway) ? 2 : f.properties.highway === 'service' ? 5 : 14;
      roads.push({points: f.geometry.coordinates.map(local), width, name: f.properties.name || '', highway:f.properties.highway, oneway:['yes','-1','true','1'].includes(String(f.properties.oneway))||['motorway','motorway_link'].includes(f.properties.highway)||f.properties.junction==='roundabout', lanes:parseInt(f.properties.lanes)||null, bridge:f.properties.bridge, tunnel:f.properties.tunnel, layer:f.properties.layer});
    }
  }
  // Footprints first, so the square-level prior (mostly small untagged footprints, as in tag-poor suburbs) is known
  // before any building is classified. In a downtown of tagged towers the prior is false and nothing below changes.
  const footprints=[];
  for (const f of features) {
    if (f.properties.building && f.properties.building !== 'no') {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
      for (const poly of polys) {
        const rings = poly.map(r => r.slice(0, -1).map(local)).filter(r => r.length >= 3);
        if (!rings.length || rings.flat().some(p => !p.every(Number.isFinite))) continue;
        if (rings.flat().length > 2000) continue;
        const points = rings[0];
        const bounds = [Math.min(...points.map(p=>p[0])), Math.min(...points.map(p=>p[1])), Math.max(...points.map(p=>p[0])), Math.max(...points.map(p=>p[1]))];
        footprints.push({f,rings,bounds,area:ringArea(points)});
      }
    }
  }
  const generic=footprints.filter(p=>['yes','building'].includes(p.f.properties.building));
  const prior=generic.length>=8&&generic.filter(p=>p.area<=250).length/generic.length>=0.7;
  const settlements=features.filter(f=>f.properties.place&&f.geometry?.type==='Point').map(f=>{const [x,y]=local(f.geometry.coordinates);return {place:f.properties.place,name:f.properties.name,x,y};});
  const context=areaContext({lat:origin[1],lng:origin[0],places:settlements,footprints:footprints.map(p=>({area:p.area,centre:[(p.bounds[0]+p.bounds[2])/2,(p.bounds[1]+p.bounds[3])/2],tall:hasHeightTag(p.f.properties)&&height(p.f.properties)>=20}))}),countryside=isCountryside(context);
  // Country lanes are not 14 m boulevards: in a village or rural square the carriageway follows the road class, so only
  // secondary and larger roads (10 m and up) get painted centre lines.
  if(countryside)for(const r of roads){const w=COUNTRY_WIDTH[r.highway];if(w)r.width=w;}
  const bridges=bridgePieces(roads);
  // Homes in a dry climate (adobe, Moroccan riads, outback houses) have flat roofs unless OSM tags a roof shape.
  const flatHomes=context.biome?.group==='arid';
  for (const {f,rings,bounds,area} of footprints) {
    const landuse=contextLanduse(zones,bounds),nearRoad=landuse?null:nearestRoadClass(bounds,roads);
    const residential=landuse==='residential'||(!landuse&&prior&&residentialRoads.has(nearRoad));
    const h=height(f.properties,{residential,area,countryside:countryside||context.setting==='town'}),heightDefault=!hasHeightTag(f.properties);
    buildings.push({rings,bounds,height:h,roof:roofOf(f.properties,h),...(flatHomes&&!f.properties['roof:shape']?{flat:true}:{}),id:f.id,name:String(f.properties.name||'').slice(0,80),info:hasInfoTags(f.properties),kind:placeKind(f.properties),style:buildingStyle(f.properties,{height:h,area,landuse,heightDefault,nearRoad,prior,countryside})});
  }
  for(const b of buildings)b.frontEdge=storefrontEdge(b,roads);
  // Simple 3D Buildings parts (v0.1.32): each `building:part` is its own extrusion from min_height (or
  // building:min_level × 3.2 m) to its height, with its own roof shape, styled like the outline that contains it. An
  // outline with parts is not drawn itself (the parts are), but keeps its role for labels, the indoor hint and the far
  // field. Parts stay out of `world.buildings`, so the ingest-time sector graph for the bundled area is unchanged.
  const parts=[];
  for (const f of features) {
    if (!f.properties['building:part'] || f.properties['building:part'] === 'no' || f.properties.building) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) {
      const rings = poly.map(r => r.slice(0, -1).map(local)).filter(r => r.length >= 3);
      if (!rings.length || rings.flat().length > 2000 || rings.flat().some(p => !p.every(Number.isFinite)) || parts.length >= 2000) continue;
      const pts = rings[0], bounds = [Math.min(...pts.map(p=>p[0])), Math.min(...pts.map(p=>p[1])), Math.max(...pts.map(p=>p[0])), Math.max(...pts.map(p=>p[1]))];
      const cx = (bounds[0]+bounds[2])/2, cy = (bounds[1]+bounds[3])/2;
      const owner = buildings.find(b => cx >= b.bounds[0] && cx <= b.bounds[2] && cy >= b.bounds[1] && cy <= b.bounds[3] && pointInRing(b.rings[0], cx, cy));
      const h = height(f.properties, {}), min = minHeight(f.properties, h);
      if (h - min < .5) continue;
      if (owner) {owner.hasParts = true; (owner.partList ||= []);}
      const part = {rings, bounds, height: h, minHeight: min, roof: roofOf(f.properties, h - min), id: f.id, part: true, style: owner?.style || buildingStyle(f.properties, {height: h, area: ringArea(pts), heightDefault: !hasHeightTag(f.properties)}), frontEdge: -1};
      parts.push(part); owner?.partList.push(part);
    }
  }
  // Countryside squares may map roads and land cover but no buildings at all; that is still a place to explore.
  if (!buildings.length && !roads.length) throw new Error('No usable buildings or roads returned.');
  const kinds=BUILDING_STYLES.map(()=>0);for(const b of buildings)kinds[b.style.kind]++;
  const extras = parseExtras(features, origin, buildings, {context, roads});
  return {buildings, parts, bridges, roads, origin, kinds, prior, context, areas: extras.areas, trees: extras.trees, places: extras.places, timestamp: raw.osm3s?.timestamp_osm_base || null};
}
function distanceToBox(b, x, y) {return Math.hypot(Math.max(b[0]-x, 0, x-b[2]), Math.max(b[1]-y, 0, y-b[3]));}
// Gable over a four-point ring: ridge along the longer axis at `h + 0.29 × short side` (about a 30° pitch), two sloped
// quads and two vertical gable triangles. Eighteen vertices against six for the flat roof it replaces.
export const GABLE_RISE = 0.29;
export function gableRoof(ring, h, triangle) {
  const len = (a, b) => Math.hypot(b[0]-a[0], b[1]-a[1]), mid = (a, b) => [(a[0]+b[0])/2, (a[1]+b[1])/2];
  const s = len(ring[0], ring[1]) >= len(ring[1], ring[2]) ? 0 : 1, q = [0,1,2,3].map(i => ring[(s+i)%4]);
  const rise = GABLE_RISE * Math.min(len(q[1], q[2]), len(q[3], q[0])), z = h + rise;
  const A = [...mid(q[3], q[0]), z], B = [...mid(q[1], q[2]), z], cx = (q[0][0]+q[1][0]+q[2][0]+q[3][0])/4, cy = (q[0][1]+q[1][1]+q[2][1]+q[3][1])/4;
  function face(a, b, c) {
    const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    let n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const l = Math.hypot(...n) || 1; n = n.map(x => x/l);
    // Outward: up for sloped faces, away from the footprint centre for the vertical gables.
    const outward = Math.abs(n[2]) > 1e-6 ? n[2] : n[0]*((a[0]+b[0]+c[0])/3-cx) + n[1]*((a[1]+b[1]+c[1])/3-cy);
    if (outward < 0) n = n.map(x => -x);
    triangle(a, b, c, n);
  }
  const P = q.map(p => [p[0], p[1], h]);
  face(P[0], P[1], B); face(P[0], B, A);
  face(P[2], P[3], A); face(P[2], A, B);
  face(P[1], P[2], B); face(P[3], P[0], A);
}
// Towers without parts or a roof shape get one of three illustrative crowns, chosen by a hash of the OSM id so a
// skyline is not uniform: a setback top (the upper 14 % inset 22 % toward the centre), a rooftop mechanical penthouse
// (a windowless box, 35 % of the footprint's extent, 4.5 m tall), or both. Only where the inset stays inside the
// footprint; like the windows, these are illustrative, not surveyed.
export const TOWER = Object.freeze({height: 45, maxPoints: 40, setback: .86, inset: .78, penthouse: .35, penthouseHeight: 4.5});
const idHash = id => {let h = 2166136261; for (const c of String(id)) {h ^= c.charCodeAt(0); h = Math.imul(h, 16777619);} return (h >>> 0) / 4294967296;};
export function towerCrown(b) {
  if (b.part || b.hasParts || b.roof || b.height < TOWER.height || b.rings.length !== 1 || b.rings[0].length > TOWER.maxPoints) return null;
  const r = b.rings[0], cx = r.reduce((s, p) => s + p[0], 0) / r.length, cy = r.reduce((s, p) => s + p[1], 0) / r.length;
  if (!pointInRing(r, cx, cy)) return null;
  const v = Math.floor(idHash(b.id) * 3), inset = r.map(([x, y]) => [cx + (x - cx) * TOWER.inset, cy + (y - cy) * TOWER.inset]);
  const setback = v !== 1 && inset.every(p => pointInRing(r, p[0], p[1])) ? inset : null;
  const [a0, c0, a1, c1] = b.bounds, hw = (a1 - a0) * TOWER.penthouse / 2, hh = (c1 - c0) * TOWER.penthouse / 2;
  const box = [[cx-hw, cy-hh], [cx+hw, cy-hh], [cx+hw, cy+hh], [cx-hw, cy+hh]];
  const penthouse = v !== 0 && box.every(p => pointInRing(setback || r, p[0], p[1])) ? box : null;
  return setback || penthouse ? {setback, penthouse} : null;
}
export function buildGeometry(world, x = 0, y = 0, budget = LIMITS) {
  const pos = [], normal = [], uv = [], styles=[];let code=0,floor=32;
  function triangle(a,b,c,n,ta=[0,0],tb=[0,0],tc=[0,0]) {pos.push(...a,...b,...c); normal.push(...n,...n,...n); uv.push(...ta,...tb,...tc);styles.push(code,floor,code,floor,code,floor);}
  // Walls of every ring from z0 to z1 (uv keeps the façade grid continuous with height), then a roof at z1: flat,
  // or a pyramid of `rise` over the ring's centroid.
  function walls(b, rings, z0, z1, front = true) {
    for(const ring of rings) for(let i=0;i<ring.length;i++) {
      // +8 marks the street-facing shopfront edge, +16 a home's street-facing door edge; both leave the style kind in the low bits.
      code=(b.style?.kind||0)+(front&&rings===b.rings&&ring===rings[0]&&i===b.frontEdge?(b.style?.storefront?8:16):0);
      const a = ring[i], b2 = ring[(i+1)%ring.length], dx=b2[0]-a[0], dy=b2[1]-a[1], l=Math.hypot(dx,dy);
      if(l<0.01) continue;
      const n=[dy/l,-dx/l,0], p=[...a,z0], q=[...b2,z0], r=[...b2,z1], s=[...a,z1];
      triangle(p,q,r,n,[0,z0],[l,z0],[l,z1]); triangle(p,r,s,n,[0,z0],[l,z1],[0,z1]);
    }
    code=b.style?.kind||0;
  }
  function roof(rings, z, rise = 0) {
    if (rise <= 0 && z > DETAIL.hiddenRoof) return;
    if (rise > 0 && rings.length === 1) {
      const r = rings[0], cx = r.reduce((s, p) => s + p[0], 0) / r.length, cy = r.reduce((s, p) => s + p[1], 0) / r.length, apex = [cx, cy, z + rise];
      for (let i = 0; i < r.length; i++) {const a = [...r[i], z], c = [...r[(i+1)%r.length], z], u = [c[0]-a[0], c[1]-a[1], 0], w = [apex[0]-a[0], apex[1]-a[1], rise];
        let n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]]; const l = Math.hypot(...n) || 1; n = n.map(v => v / l); if (n[2] < 0) n = n.map(v => -v); triangle(a, c, apex, n);}
      return;
    }
    const vectors = rings.map(r=>r.map(p=>new Vector2(...p))), tris = ShapeUtils.triangulateShape(vectors[0], vectors.slice(1)), flat = rings.flat();
    for(const t of tris) triangle(...t.map(i=>[...flat[i],z]),[0,0,1]);
  }
  const pool = [...world.buildings, ...(world.parts || []), ...(world.bridges || [])];
  const emit = (a, b2, c, n, k, ta, tb, tc) => {code = k; triangle(a, b2, c, n, ta, tb, tc);};
  // Bridge decks first and outside the building count, so a chunk's building budget is unchanged.
  for (const p of pool) if (p.bridge && distanceToBox(p.bounds, x, y) <= LIMITS.radius && pos.length / 3 + p.points.length * 90 <= budget.vertices) {floor = Math.min(255, Math.round(p.width * 10)); emitBridge(p, emit);}
  // Landmark shapes (churches, mosques, temples…) come first, so a chunk's building cap never drops them.
  const candidates = pool.filter(b => !b.bridge && !b.hasParts && distanceToBox(b.bounds,x,y) <= LIMITS.radius).sort((a,b)=>!!b.style?.shape-!!a.style?.shape||distanceToBox(a.bounds,x,y)-distanceToBox(b.bounds,x,y));
  // Tier choice keeps room for the cheapest version of every building still to come: full detail only while the rest
  // can still be façades, a façade only while the rest can still be boxes.
  const facadeRing = b => b.rings[0].length <= DETAIL.facadePoints ? b.rings[0] : simplifyRing(b.rings[0], DETAIL.facadeTolerance, DETAIL.facadePoints);
  const drawable = budget.vertices * DETAIL.coverage / DETAIL.box | 0;
  const plan = (candidates.length * DETAIL.box > budget.vertices ? candidates.slice(0, drawable) : candidates).map(b => {const ring = facadeRing(b); return {b, ring, full: b.rings.reduce((s,r)=>s+r.length*9,0)+b.rings.length*6+48+(b.style?.shape?1200:0), facade: ring.length * 9 + 6};});
  let count = 0, facades = 0, boxes = 0, reserveFacade = plan.reduce((s, p) => s + p.facade, 0), reserveBox = plan.length * DETAIL.box;
  for (const {b, ring, full, facade} of plan) {
    reserveFacade -= facade; reserveBox -= DETAIL.box;
    if (count >= budget.buildings) break;
    const room = budget.vertices - pos.length / 3;
    if (room < DETAIL.box) break;
    let rings = b.rings;code=b.style?.kind||0;floor=Math.round((b.style?.floorHeight||3.2)*10);
    const base = b.minHeight || 0, top = b.height;
    if (full + reserveFacade > room) {
      // Façade or box: walls and a flat top only, no storefront edge, gable or crown.
      const box = facade + reserveBox > room;
      if (box) {const [a,c,d,e] = b.bounds; rings = [[[a,c],[d,c],[d,e],[a,e]]]; boxes++;} else {rings = [ring]; facades++;}
      walls(b, rings, base, top, false); roof(rings, top); count++; continue;
    }
    if (b.style?.shape && emitShaped(b, emit)) {count++; continue;}
    const crown = towerCrown(b);
    // Illustrative gable on small rectangular homes (four-point outer ring, ≤ 250 m², not `flat`); a tagged gabled
    // roof on any four-point ring uses the same gable. Everything else: pyramid when tagged, otherwise flat.
    if (rings.length === 1 && rings[0].length === 4 && ((b.style?.kind===1 && !b.roof && !b.flat && ringArea(rings[0])<=250) || b.roof?.shape === 'gable')) {walls(b, rings, base, top); gableRoof(rings[0], top, triangle);}
    else if (crown?.setback) {
      const split = base + (top - base) * TOWER.setback;
      walls(b, rings, base, split); roof(rings, split); walls(b, [crown.setback], split, top, false);
      if (crown.penthouse) {roof([crown.setback], top); code = 5; walls({style: {kind: 5}}, [crown.penthouse], top, top + TOWER.penthouseHeight, false); roof([crown.penthouse], top + TOWER.penthouseHeight);}
      else roof([crown.setback], top);
    } else {
      // A tagged height includes its roof, so a pyramid's eaves sit `roof:height` below it.
      const rise = b.roof?.shape === 'pyramid' ? b.roof.height : 0;
      walls(b, rings, base, top - rise); roof(rings, top - rise, rise);
      if (crown?.penthouse) {code = 5; walls({style: {kind: 5}}, [crown.penthouse], top, top + TOWER.penthouseHeight, false); roof([crown.penthouse], top + TOWER.penthouseHeight);}
    }
    count++;
  }
  return {position: new Float32Array(pos), normal: new Float32Array(normal), uv: new Float32Array(uv), style:new Uint8Array(styles), count, facades, boxes, simplified: facades + boxes, omitted: candidates.length-count};
}
// Prototype G far field. Each building becomes a flat-shaded silhouette prism: its outer ring simplified (Visvalingam,
// dropping corners that enclose less than `tolerance`² m², at most `maxPoints` corners), walls plus a flat roof, no holes,
// no gable, no façade detail. Heights are the near-field heights, so a building keeps its massing when it changes LOD;
// a small gabled home's roof sits halfway up its near-field ridge. A ring that will not triangulate falls back to its bounds.
export function simplifyRing(ring, tolerance = 1.5, maxPoints = 10) {
  const r = ring.slice(), limit = tolerance * tolerance;
  const area = i => {const a = r[(i - 1 + r.length) % r.length], b = r[i], c = r[(i + 1) % r.length]; return Math.abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1])) / 2;};
  while (r.length > 3) {
    let min = Infinity, at = -1;
    for (let i = 0; i < r.length; i++) {const v = area(i); if (v < min) {min = v; at = i;}}
    if (min >= limit && r.length <= maxPoints) break;
    r.splice(at, 1);
  }
  return r;
}
export function buildImpostors(world, budget = {vertices: 3000, buildings: Infinity}, {tolerance = 1.5, maxPoints = 10} = {}) {
  const pos = [], normal = [], uv = [], styles = []; let code = 0;
  const triangle = (a, b, c, n) => {pos.push(...a, ...b, ...c); normal.push(...n, ...n, ...n); uv.push(0,0,0,0,0,0); styles.push(code,32,code,32,code,32);};
  let count = 0, fallback = 0;
  // Walls from z0 to z1 and a cap: `roof` triangles, null (triangulate), or 'pyramid' rising `rise` over the centroid.
  function prism(ring, roof, z0, z1, rise = 0) {
    if (roof === 'pyramid') {const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      for (let i = 0; i < ring.length; i++) {const a = ring[i], c = ring[(i+1)%ring.length], mx = (a[0]+c[0])/2 - cx, my = (a[1]+c[1])/2 - cy, l = Math.hypot(mx, my, rise) || 1; triangle([...a, z1], [...c, z1], [cx, cy, z1 + rise], [mx/l, my/l, Math.hypot(mx, my)/l]);}}
    else if (z1 <= DETAIL.hiddenRoof) {const tris = roof || ShapeUtils.triangulateShape(ring.map(p => new Vector2(...p)), []); for (const t of tris) triangle(...t.map(i => [...ring[i], z1]), [0, 0, 1]);}
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], dx = c[0]-a[0], dy = c[1]-a[1], l = Math.hypot(dx, dy);
      if (l < 0.01) continue;
      const n = [dy/l, -dx/l, 0], p = [...a, z0], q = [...c, z0], r = [...c, z1], s = [...a, z1];
      triangle(p, q, r, n); triangle(p, r, s, n);
    }
  }
  const emit = (a, b2, c, n, k) => {code = k; triangle(a, b2, c, n);};
  for (const p of [...world.buildings.filter(b => b.bridge), ...(world.bridges || [])]) if (pos.length / 3 + p.points.length * 30 <= budget.vertices) emitBridge(p, emit, false);
  // The far field uses outlines, not their parts; past the vertex budget a silhouette becomes its bounding box.
  const outlines = world.buildings.filter(b => !b.part && !b.bridge);
  let reserveBox = outlines.length * DETAIL.box;
  for (const b of outlines) {
    reserveBox -= DETAIL.box;
    if (count >= budget.buildings || pos.length / 3 + DETAIL.box > budget.vertices) break;
    code = b.style?.kind || 0;
    if (pos.length / 3 + 2 * DETAIL.box + reserveBox > budget.vertices) {const [a, c, d, e] = b.bounds; prism([[a,c],[d,c],[d,e],[a,e]], [[0,1,2],[0,2,3]], 0, b.height); fallback++; count++; continue;}
    // Spires, domes and minarets are skyline shapes too: shaped buildings keep their massing, at fewer segments.
    if (b.style?.shape && pos.length / 3 + 700 <= budget.vertices && emitShaped(b, emit, 8)) {count++; continue;}
    let ring = simplifyRing(b.rings[0], tolerance, maxPoints), roof = ShapeUtils.triangulateShape(ring.map(p => new Vector2(...p)), []);
    if (!roof.length) {const [a, c, d, e] = b.bounds; ring = [[a,c],[d,c],[d,e],[a,e]]; roof = [[0,1,2],[0,2,3]]; fallback++;}
    const len = (p, q) => Math.hypot(q[0]-p[0], q[1]-p[1]), o = b.rings[0];
    const gabled = b.style?.kind === 1 && !b.flat && b.rings.length === 1 && o.length === 4 && ringArea(o) <= 250;
    const crown = towerCrown(b);
    const h = gabled ? b.height + GABLE_RISE * Math.min(len(o[0], o[1]), len(o[1], o[2])) / 2 : crown?.setback ? b.height * TOWER.setback : b.height;
    prism(ring, roof, 0, h);
    // Skyline shapes are what the far field is for: a tower's crown, and the two tallest parts of a multi-part building
    // (a pyramid where tagged), each simplified to ≤ maxPoints. Everything else stays one block.
    if (crown?.setback) {const r = simplifyRing(crown.setback, tolerance, maxPoints); prism(r, null, h, b.height);}
    if (crown?.penthouse) {code = 5; prism(crown.penthouse, [[0,1,2],[0,2,3]], b.height, b.height + TOWER.penthouseHeight); code = b.style?.kind || 0;}
    for (const p of (b.partList || []).filter(p => p.height > h + 3).sort((a, c) => c.height - a.height).slice(0, 2)) {
      const r = simplifyRing(p.rings[0], tolerance, maxPoints);
      if (pos.length / 3 + r.length * 12 > budget.vertices) break;
      const rise = p.roof?.shape === 'pyramid' ? p.roof.height : 0;
      prism(r, rise ? 'pyramid' : null, h, p.height - rise, rise);
    }
    count++;
  }
  return {position: new Float32Array(pos), normal: new Float32Array(normal), uv: new Float32Array(uv), style: new Uint8Array(styles), count, fallback, omitted: outlines.length - count};
}
// Ground surfaces and trees from the same OSM response (v0.1.19; every green cover since v0.1.36). Surface codes,
// shared with the road shader: 1 grass/park/garden/pitch/meadow, 2 wood/forest, 3 water (lakes, riverbanks, and rivers,
// streams and canals drawn as strips), 4 parking, 5 plaza/pedestrian area, 10 wetland, 11 farmland/orchard/plantation,
// 12 sand/beach/bare ground, 13 scrub/heath. Codes 0 and 6–9 are roads, footways and curbs. Large covers are clipped
// to the loaded area and simplified rather than dropped. Trees: OSM natural=tree nodes, natural=tree_row every 8 m,
// and — illustrative, like windows — jittered grids inside parks, woods, orchards and wetlands, plus, in a village
// or the countryside (context.js), a scatter on open ground away from roads and buildings. The climate (climate.js)
// sets the palm and conifer shares, tree size and scatter density: dense in rainforest, low scrub in deserts. Each tree is [x, y, height, crown radius,
// mapped (1) or illustrative (0), shape]. Shape from OSM species/genus/leaf_type: 0 broadleaf, 1 conifer, 2 palm.
export const EXTRAS = Object.freeze({areas: 1500, areaPoints: 1200, clip: 1000, rivers: 800, trees: 2500, perArea: 300, spacing: 14, woodSpacing: 9, orchardSpacing: 9, wetSpacing: 20, rowSpacing: 8, treeHeight: 8, scatter: {rural: 24, village: 28, suburb: 34, reach: 340, gap: 2.5}});
const has = (v, list) => list.includes(v);
const SURFACE = [
  [5, p => p.place === 'square' || (p.highway === 'pedestrian' && p.area === 'yes')],
  [4, p => p.amenity === 'parking' && !has(p.parking, ['underground','multi-storey','rooftop'])],
  [3, p => p.natural === 'water' || p.waterway === 'riverbank' || has(p.landuse, ['basin','reservoir','salt_pond','aquaculture'])],
  [10, p => p.natural === 'wetland' || p.landuse === 'paddy'],
  [2, p => p.landuse === 'forest' || p.natural === 'wood' || p.landcover === 'trees'],
  [13, p => has(p.natural, ['scrub','heath','shrubbery']) || p.landcover === 'scrub'],
  [11, p => has(p.landuse, ['farmland','orchard','vineyard','plantation','allotments','plant_nursery'])],
  [12, p => has(p.natural, ['beach','sand','bare_rock','scree','shingle','mud']) || has(p.landuse, ['farmyard','construction','brownfield','quarry','landfill'])],
  [1, p => has(p.leisure, ['park','garden','playground','pitch','dog_park','common','recreation_ground','golf_course']) || has(p.landuse, ['grass','recreation_ground','cemetery','meadow','village_green','flowerbed','greenfield']) || p.natural === 'grassland' || p.landcover === 'grass']];
// Painter's order: broad covers first, water over them, paved areas on top.
const ORDER = [11, 1, 13, 2, 10, 12, 3, 4, 5], rank = code => ORDER.indexOf(code);
export const surfaceCode = p => SURFACE.find(([, test]) => test(p))?.[0] || 0;
const PLANTED = p => has(p.leisure, ['park','garden','dog_park']) || has(p.landuse, ['recreation_ground','cemetery','village_green']);
const ORCHARD = p => has(p.landuse, ['orchard','plantation']);
const RIVER_WIDTH = {river: 14, canal: 8, stream: 3, drain: 2, ditch: 1.5, tidal_channel: 6};
// Sutherland–Hodgman against an axis-aligned square of half-size `h`: covers larger than the loaded area keep the part
// that matters instead of being dropped for their point count.
function clipRing(ring, h) {
  let out = ring;
  for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
    const input = out, inside = q => sign * q[axis] <= h; out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length], ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) {const t = (sign * h - a[axis]) / (b[axis] - a[axis]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);}
    }
    if (out.length < 3) return [];
  }
  return out;
}
const thin = (ring, step) => ring.filter((q, i) => i === 0 || Math.hypot(q[0] - ring[i - 1][0], q[1] - ring[i - 1][1]) >= step);
function fitRing(ring, budget) {
  let r = clipRing(ring, EXTRAS.clip);
  if (r.length > budget) r = thin(r, 2);
  if (r.length > budget) r = simplifyRing(r, 1.5, budget);
  return r.length >= 3 ? r : null;
}
const PALM = /palm|washingtonia|phoenix|syagrus|arecaceae|trachycarpus|roystonea|cocos/i, CONIFER = /pinus|picea|abies|cedrus|cupressus|juniperus|sequoia|pseudotsuga|araucaria|taxus|pine|spruce|fir\b|cedar|cypress/i;
export function treeShape(p) {
  const name = [p.species, p['species:en'], p.genus, p.taxon].filter(Boolean).join(' ');
  if (PALM.test(name) || p.leaf_type === 'palm') return 2;
  if (p.leaf_type === 'needleleaved' || CONIFER.test(name)) return 1;
  return 0;
}
// [default height, crown radius / height, height spread]. Untagged trees vary deterministically by position (±spread),
// so a row of mapped-but-untagged palms is no longer a row of identical 12 m poles; crown width varies separately ±15 %.
const SHAPE_SIZE = [[8, .32, .35], [10, .22, .3], [13, .13, .4]];
const hash = (x, y) => {const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s);};
function inRing(r, x, y) {let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) {const a = r[j], b = r[i]; if ((a[1] > y) !== (b[1] > y) && x < (b[0]-a[0]) * (y-a[1]) / (b[1]-a[1]) + a[0]) inside = !inside;} return inside;}
const inRings = (rings, x, y) => inRing(rings[0], x, y) && !rings.slice(1).some(r => inRing(r, x, y));
// Places worth naming from further away (v0.1.28): food and drink, and public landmarks. `kind` is 'food' or 'landmark'.
const FOOD_AMENITY = ['restaurant','cafe','fast_food','bar','pub','food_court','ice_cream','biergarten','marketplace'], FOOD_SHOP = ['bakery','deli','confectionery','coffee','pastry'];
const LANDMARK_AMENITY = ['townhall','library','theatre','cinema','place_of_worship','courthouse','arts_centre'], LANDMARK_TOURISM = ['museum','attraction','gallery'];
export function placeKind(t) {
  if (!t || !t.name) return null;
  if (FOOD_AMENITY.includes(t.amenity) || FOOD_SHOP.includes(t.shop)) return 'food';
  // Landmarks are kept strict: an explicit public-venue category, or a historic/heritage tag that is also notable enough
  // to have a Wikipedia or Wikidata entry. Downtown historic districts tag dozens of ordinary buildings historic=yes.
  const notable = !!(t.wikidata || t.wikipedia);
  if (LANDMARK_AMENITY.includes(t.amenity) || LANDMARK_TOURISM.includes(t.tourism) || ['cathedral','church','museum','train_station'].includes(t.building)) return 'landmark';
  if (notable && ((t.historic && t.historic !== 'no') || t.heritage || ['civic','government'].includes(t.building))) return 'landmark';
  return null;
}
export function parseExtras(features, origin = ORIGIN, buildings = [], {context = null, roads = [], scatter = true} = {}) {
  const areas = [], trees = [], places = [], local = p => toLocal(p, origin);
  // Climate profile (climate.js): palms, conifers, tree size and how many illustrative trees stand on open ground.
  const biome = context?.biome || climateProfile('Cfb'), tropical = biome.group === 'tropical', arid = biome.group === 'arid';
  const palmShare = p => tropical && ORCHARD(p) ? .85 : biome.palms, conifer = (x, y) => hash(x * 1.3, y * .7) < biome.conifers;
  const insideBuilding = (x, y) => buildings.some(b => x >= b.bounds[0] && x <= b.bounds[2] && y >= b.bounds[1] && y <= b.bounds[3] && inRings(b.rings, x, y));
  const treeHeight = (p, shape = 0, x = 0, y = 0) => {const h = parseFloat(p.height); return Number.isFinite(h) && h > 2 && h < 40 ? h : SHAPE_SIZE[shape][0] * (1 + (hash(x * 1.7, y * 2.3) * 2 - 1) * SHAPE_SIZE[shape][2]);};
  const crown = (h, shape, x, y) => h * SHAPE_SIZE[shape][1] * (.85 + .3 * hash(y * 3.1, x * .7));
  // Arid scrub (mesquite, saltbush) is low and wide; elsewhere the climate scales tree height.
  const illustrative = (x, y, shape, low = false) => {
    const shrub = arid && shape === 0, scale = shape === 2 ? 1 : biome.height;
    const h = shape === 2 ? 9 + hash(x, y) * 6 : shrub ? 2.2 + hash(x, y) * 2.3 : ((low ? 4 : 6) + hash(x, y) * (low ? 3 : 5)) * scale;
    trees.push([x, y, h, shape === 2 ? h * .13 : h * (shrub ? .5 : shape ? .22 : .28 + hash(y, x) * .1), 0, shape]);
  };
  let riverSegments = 0;
  for (const f of features) {
    const p = f.properties || {}, g = f.geometry; if (!g) continue;
    if (g.type === 'Point' && p.natural !== 'tree') {const kind = placeKind(p); if (kind && places.length < 600) {const [x, y] = local(g.coordinates); places.push({x, y, name: String(p.name).slice(0, 80), kind, id: f.id});} continue;}
    if (p.natural === 'tree' && g.type === 'Point') {const [x, y] = local(g.coordinates), shape = treeShape(p), h = treeHeight(p, shape, x, y); trees.push([x, y, h, crown(h, shape, x, y), 1, shape]); continue;}
    if (p.natural === 'tree_row' && g.type === 'LineString') {
      const pts = g.coordinates.map(local), shape = treeShape(p);
      for (let i = 1; i < pts.length; i++) {const [a, b] = [pts[i-1], pts[i]], l = Math.hypot(b[0]-a[0], b[1]-a[1]); for (let s = 0; s < l; s += EXTRAS.rowSpacing) {const x = a[0] + (b[0]-a[0]) * s / l, y = a[1] + (b[1]-a[1]) * s / l, h = treeHeight(p, shape, x, y); trees.push([x, y, h, crown(h, shape, x, y), 1, shape]);}}
      continue;
    }
    // Rivers, canals and streams mapped as lines: a water strip per segment, overlapping half a width at each end
    // so bends close. Culverts and tunnels stay hidden.
    if (RIVER_WIDTH[p.waterway] && (g.type === 'LineString' || g.type === 'MultiLineString') && !['yes','culvert'].includes(p.tunnel)) {
      const w = Math.min(80, Math.max(1, parseFloat(p.width) || RIVER_WIDTH[p.waterway])), lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
      for (const line of lines) {
        const pts = line.map(local);
        for (let i = 1; i < pts.length && riverSegments < EXTRAS.rivers; i++) {
          const a = pts[i-1], b = pts[i], l = Math.hypot(b[0]-a[0], b[1]-a[1]);
          if (l < .2 || Math.max(Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1])) > EXTRAS.clip + w) continue;
          const ux = (b[0]-a[0]) / l, uy = (b[1]-a[1]) / l, e = w / 2, nx = -uy * e, ny = ux * e;
          const ring = [[a[0]-ux*e+nx, a[1]-uy*e+ny], [a[0]-ux*e-nx, a[1]-uy*e-ny], [b[0]+ux*e-nx, b[1]+uy*e-ny], [b[0]+ux*e+nx, b[1]+uy*e+ny]];
          areas.push({code: 3, rings: [ring], bounds: [Math.min(...ring.map(q => q[0])), Math.min(...ring.map(q => q[1])), Math.max(...ring.map(q => q[0])), Math.max(...ring.map(q => q[1]))], id: f.id}); riverSegments++;
        }
      }
      continue;
    }
    const code = surfaceCode(p); if (!code || areas.length >= EXTRAS.areas) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const raw = poly.map(r => r.slice(0, -1).map(local));
      if (!raw.length || raw.flat().some(q => !q.every(Number.isFinite))) continue;
      const outer = fitRing(raw[0], EXTRAS.areaPoints); if (!outer) continue;
      const holes = raw.slice(1).map(r => fitRing(r, Math.max(8, Math.floor(EXTRAS.areaPoints / Math.max(1, raw.length))))).filter(Boolean);
      const rings = [outer, ...holes], pts = outer, bounds = [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))];
      areas.push({code, rings, bounds, id: f.id});
      const wet = code === 10, orchard = ORCHARD(p);
      if (PLANTED(p) || code === 2 || orchard || wet) {
        // Mangrove and swamp forest are wooded wetland: woodland spacing of low trees standing in the water.
        const wooded = wet && (has(p.wetland, ['mangrove','swamp']) || p.landuse === 'forest' || p.natural === 'wood');
        const step = wooded ? EXTRAS.woodSpacing : wet ? EXTRAS.wetSpacing : orchard ? EXTRAS.orchardSpacing : code === 2 ? EXTRAS.woodSpacing : EXTRAS.spacing, needle = p.leaf_type === 'needleleaved', palms = wet ? 0 : palmShare(p); let n = 0;
        const x0 = Math.max(bounds[0], -EXTRAS.clip), x1 = Math.min(bounds[2], EXTRAS.clip), y0 = Math.max(bounds[1], -EXTRAS.clip), y1 = Math.min(bounds[3], EXTRAS.clip);
        for (let x = Math.ceil(x0 / step) * step; x < x1 && n < EXTRAS.perArea; x += step) for (let y = Math.ceil(y0 / step) * step; y < y1 && n < EXTRAS.perArea; y += step) {
          const jx = x + (hash(x, y) - .5) * step * (orchard ? .15 : .7), jy = y + (hash(y, x) - .5) * step * (orchard ? .15 : .7);
          if (!inRings(rings, jx, jy) || insideBuilding(jx, jy)) continue;
          illustrative(jx, jy, needle || (!wet && !orchard && p.leaf_type !== 'broadleaved' && conifer(jx, jy)) ? 1 : hash(jy * .3, jx * .7) < palms ? 2 : 0, wet); n++;
        }
      }
    }
  }
  // Countryside scatter: OSM rarely maps the trees between fields and houses, and bare earth reads as a car park.
  const spacing = scatter && biome.density >= .03 && EXTRAS.scatter[context?.setting] / Math.sqrt(biome.density);
  if (spacing) {
    const reach = EXTRAS.scatter.reach, blocked = areas.filter(a => [3, 4, 5, 12].includes(a.code) || a.code === 2);
    const segments = []; for (const r of roads) for (let i = 1; i < r.points.length; i++) segments.push([r.points[i-1], r.points[i], r.width / 2 + EXTRAS.scatter.gap]);
    const nearRoad = (x, y) => segments.some(([a, b, m]) => {const dx = b[0]-a[0], dy = b[1]-a[1], l = dx*dx + dy*dy, t = l ? Math.max(0, Math.min(1, ((x-a[0])*dx + (y-a[1])*dy) / l)) : 0; return Math.hypot(x-a[0]-t*dx, y-a[1]-t*dy) < m;});
    for (let x = -reach; x <= reach; x += spacing) for (let y = -reach; y <= reach; y += spacing) {
      const jx = x + (hash(x + .5, y) - .5) * spacing * .8, jy = y + (hash(y, x + .5) - .5) * spacing * .8;
      if (jx * jx + jy * jy > reach * reach || hash(jx * .9, jy * 1.3) < .25) continue;
      if (blocked.some(a => jx >= a.bounds[0] && jx <= a.bounds[2] && jy >= a.bounds[1] && jy <= a.bounds[3] && inRings(a.rings, jx, jy)) || insideBuilding(jx, jy) || nearRoad(jx, jy)) continue;
      illustrative(jx, jy, hash(jy, jx * 1.9) < biome.palms ? 2 : conifer(jx, jy) ? 1 : 0);
    }
  }
  areas.sort((a, b) => rank(a.code) - rank(b.code)); trees.sort((a, b) => b[4] - a[4]);
  return {areas, places, trees: trees.slice(0, EXTRAS.trees).filter(t => t.every(Number.isFinite))};
}
export function parseExtrasRaw(raw, origin = ORIGIN, buildings = [], options = {}) {return parseExtras(osmtogeojson(raw, {flatProperties: true}).features, origin, buildings, options);}
// Green and water relations arrive in their own optional request (world.worker.js); merge them into a parsed square.
export function mergeExtras(world, extra) {
  const areas = [...(world.areas || []), ...extra.areas].slice(0, EXTRAS.areas).sort((a, b) => rank(a.code) - rank(b.code));
  const trees = [...(world.trees || []), ...extra.trees].sort((a, b) => b[4] - a[4]).slice(0, EXTRAS.trees);
  return Object.assign(world, {areas, trees});
}
// Flat triangulated surfaces near (x, y), each at a tiny code-ordered height above the ground plane so overlaps never z-fight.
// Surface parking (code 4) and plazas (code 5) also get a 0.4 m concrete curb strip (code 9) along their outer edge,
// appended after every fill so painter's order puts it on top. Parking fills carry (along, across) uv in metres
// relative to the lot's longest edge, which the shader uses to paint illustrative stall lines; OSM rarely maps stalls.
// Farmland (code 11) uses the same frame for crop rows along the field.
export function buildSurfaces(areas, x, y, radius, maxVertices = 30000) {
  const pos = [], style = [], uv = [], curbs = []; let count = 0;
  for (const a of areas) {
    if (distanceToBox(a.bounds, x, y) > radius) continue;
    const vectors = a.rings.map(r => r.map(q => new Vector2(...q))), tris = ShapeUtils.triangulateShape(vectors[0], vectors.slice(1)), flat = a.rings.flat();
    if (pos.length / 3 + tris.length * 3 > maxVertices) break;
    let ox = 0, oy = 0, ux = 1, uy = 0;
    if (a.code === 4 || a.code === 11) {
      const r = a.rings[0]; let best = 0;
      for (let k = 0; k < r.length; k++) {const p = r[k], q = r[(k + 1) % r.length], l = Math.hypot(q[0]-p[0], q[1]-p[1]); if (l > best) {best = l; ox = p[0]; oy = p[1]; ux = (q[0]-p[0]) / l; uy = (q[1]-p[1]) / l;}}
    }
    for (const t of tris) for (const i of t) {const [px, py] = flat[i]; pos.push(px, py, 0); style.push(a.code, 0); uv.push((px-ox)*ux + (py-oy)*uy, -(px-ox)*uy + (py-oy)*ux);}
    if (a.code === 4 || a.code === 5) curbs.push(a.rings[0]);
    count++;
  }
  for (const r of curbs) for (let k = 0; k < r.length; k++) {
    const p = r[k], q = r[(k + 1) % r.length], dx = q[0]-p[0], dy = q[1]-p[1], l = Math.hypot(dx, dy);
    if (l < .5 || pos.length / 3 + 6 > maxVertices) continue;
    const nx = -dy / l * .2, ny = dx / l * .2, v = [[p[0]+nx, p[1]+ny], [p[0]-nx, p[1]-ny], [q[0]-nx, q[1]-ny], [q[0]+nx, q[1]+ny]];
    for (const j of [0, 1, 2, 0, 2, 3]) {pos.push(v[j][0], v[j][1], 0); style.push(9, 0); uv.push(0, 0);}
  }
  const n = pos.length / 3;
  return {position: new Float32Array(pos), normal: new Float32Array(n * 3), uv: new Float32Array(uv), style: new Uint8Array(style), count};
}
// Nearest trees to (x, y) within `radius`, at most `max`, packed [x, y, h, r, shape] × n.
export function nearTrees(trees, x, y, radius, max = 700) {
  const near = [];
  for (const t of trees) {const d = Math.hypot(t[0] - x, t[1] - y); if (d <= radius) near.push([d, t]);}
  near.sort((a, b) => a[0] - b[0]);
  const out = new Float32Array(Math.min(max, near.length) * 5);
  near.slice(0, max).forEach(([, t], i) => out.set([t[0], t[1], t[2], t[3], t[5] || 0], i * 5));
  return out;
}
