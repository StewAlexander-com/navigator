import {buildingStyle,contextLanduse,storefrontEdge,nearestRoadClass,residentialRoads,BUILDING_STYLES} from './building-style.js';
import osmtogeojson from 'osmtogeojson';
import {ShapeUtils, Vector2} from 'three';

export const ORIGIN = [-118.2462058, 34.0510824];
export const BBOX = [34.0477, -118.2490, 34.0538, -118.2417];
// `area` is the half-size of a live GPS download square; `areaFallback` is retried once when a dense area exceeds the response cap.
// Above walking pace the half-size grows `areaPerSpeed` metres per m/s to `areaMax`, the centre leads the fix by `areaLeadS`
// seconds of travel, the next square is prefetched `prefetchLeadS` seconds (at least `prefetchMargin` metres) before the edge,
// and the worker keeps the last `squares` parsed squares (at most `squareBytes` of source responses) for the session.
export const LIMITS = Object.freeze({radius: 180, movement: 120, area: 400, areaFallback: 250, areaMax: 1000, areaPerSpeed: 30, areaLeadS: 6, prefetchLeadS: 8, prefetchMargin: 100, squares: 8, squareBytes: 16 * 1024 * 1024, vertices: 90000, buildings: 160, responseBytes: 8 * 1024 * 1024});
const M = 111319.49079327358;
// Local metres are east/north of an origin; the origin is the bundled LA point unless a GPS area re-anchors it.
export const toLocal = ([lng, lat], origin = ORIGIN) => [(lng - origin[0]) * M * Math.cos(origin[1] * Math.PI / 180), (lat - origin[1]) * M];
export const toLngLat = (x, y, origin = ORIGIN) => [origin[0] + x / (M * Math.cos(origin[1] * Math.PI / 180)), origin[1] + y / M];
// True when OSM carries a usable height or level count; otherwise `height()` returns a documented default.
export const hasHeightTag = tags => Number.isFinite(parseFloat(String(tags.height || ''))) || Number.isFinite(parseFloat(tags['building:levels']));
// Deterministic defaults by building type. A bare `building=yes` is 12 m unless it is a small footprint (≤ 250 m²) in
// residential context, where two storeys (6.5 m) is the honest guess; house-like types and outbuildings have their own.
export function height(tags, {residential = false, area = Infinity} = {}) {
  const raw = String(tags.height || '');
  const explicit = parseFloat(raw) * (/ft|feet|'/.test(raw) ? 0.3048 : 1);
  const levels = parseFloat(tags['building:levels']);
  const fallback = {house: 7, detached: 7, semidetached_house: 7, terrace: 7, bungalow: 4, cabin: 4, garage: 3, garages: 3, shed: 3, residential: 12, apartments: 18, commercial: 24, industrial: 9, office: 30};
  const small = residential && area <= 250 && ['yes', 'building', undefined].includes(tags.building) ? 6.5 : null;
  return Math.min(180, Math.max(3, Number.isFinite(explicit) ? explicit : Number.isFinite(levels) ? levels * 3.2 : fallback[tags.building] || small || 12));
}
// True when OSM tags carry more than a name (address, type, levels, dates…); read by the building pills' ⓘ button.
const INFO_TAGS=['addr:housenumber','addr:housename','addr:street','addr:block','addr:block_number','building:levels','height','start_date','architect','operator','website','wikipedia','wikidata','description','amenity','shop','office','tourism','heritage','opening_hours','building:use'];
const hasInfoTags=t=>INFO_TAGS.some(k=>t[k])||(t.building&&!['yes','building'].includes(t.building));
const ringArea = points => Math.abs(points.reduce((sum, a, i) => {const b = points[(i + 1) % points.length]; return sum + a[0] * b[1] - b[0] * a[1];}, 0)) / 2;
export function boundedPosition(x, y) {
  const length = Math.hypot(x, y);
  return length > LIMITS.movement ? [x * LIMITS.movement / length, y * LIMITS.movement / length] : [x, y];
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
  for (const {f,rings,bounds,area} of footprints) {
    const landuse=contextLanduse(zones,bounds),nearRoad=landuse?null:nearestRoadClass(bounds,roads);
    const residential=landuse==='residential'||(!landuse&&prior&&residentialRoads.has(nearRoad));
    const h=height(f.properties,{residential,area}),heightDefault=!hasHeightTag(f.properties);
    buildings.push({rings,bounds,height:h,id:f.id,name:String(f.properties.name||'').slice(0,80),info:hasInfoTags(f.properties),kind:placeKind(f.properties),style:buildingStyle(f.properties,{height:h,area,landuse,heightDefault,nearRoad,prior})});
  }
  for(const b of buildings)b.frontEdge=storefrontEdge(b,roads);
  if (!buildings.length) throw new Error('No usable building footprints returned.');
  const kinds=BUILDING_STYLES.map(()=>0);for(const b of buildings)kinds[b.style.kind]++;
  const extras = parseExtras(features, origin, buildings);
  return {buildings, roads, origin, kinds, prior, areas: extras.areas, trees: extras.trees, places: extras.places, timestamp: raw.osm3s?.timestamp_osm_base || null};
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
export function buildGeometry(world, x = 0, y = 0, budget = LIMITS) {
  const pos = [], normal = [], uv = [], styles=[];let code=0,floor=32;
  function triangle(a,b,c,n,ta=[0,0],tb=[0,0],tc=[0,0]) {pos.push(...a,...b,...c); normal.push(...n,...n,...n); uv.push(...ta,...tb,...tc);styles.push(code,floor,code,floor,code,floor);}
  const candidates = world.buildings.filter(b => distanceToBox(b.bounds,x,y) <= LIMITS.radius).sort((a,b)=>distanceToBox(a.bounds,x,y)-distanceToBox(b.bounds,x,y));
  let count = 0, simplified = 0;
  for (const b of candidates) {
    if (count >= budget.buildings) break;
    let rings = b.rings;code=b.style?.kind||0;floor=Math.round((b.style?.floorHeight||3.2)*10);
    const required = rings.reduce((s,r)=>s+r.length*9,0)+rings.length*6;
    if (pos.length/3 + required > budget.vertices) {
      const [a,c,d,e] = b.bounds; rings = [[[a,c],[d,c],[d,e],[a,e]]]; simplified++;
      if (pos.length/3 + 36 > budget.vertices) break;
    }
    // Illustrative gable on small rectangular homes (four-point outer ring, ≤ 250 m², not simplified); everything else keeps its flat roof.
    if (b.style?.kind===1 && rings===b.rings && rings.length===1 && rings[0].length===4 && ringArea(rings[0])<=250) gableRoof(rings[0], b.height, triangle);
    else {
      const vectors = rings.map(r=>r.map(p=>new Vector2(...p)));
      const roof = ShapeUtils.triangulateShape(vectors[0], vectors.slice(1));
      const flat = rings.flat();
      for(const t of roof) triangle(...t.map(i=>[...flat[i],b.height]),[0,0,1]);
    }
    for(const ring of rings) for(let i=0;i<ring.length;i++) {
      // +8 marks the street-facing shopfront edge, +16 a home's street-facing door edge; both leave the style kind in the low bits.
      code=(b.style?.kind||0)+(rings===b.rings&&ring===rings[0]&&i===b.frontEdge?(b.style?.storefront?8:16):0);
      const a = ring[i], b2 = ring[(i+1)%ring.length], dx=b2[0]-a[0], dy=b2[1]-a[1], l=Math.hypot(dx,dy);
      if(l<0.01) continue;
      const n=[dy/l,-dx/l,0], p=[...a,0], q=[...b2,0], r=[...b2,b.height], s=[...a,b.height];
      triangle(p,q,r,n,[0,0],[l,0],[l,b.height]); triangle(p,r,s,n,[0,0],[l,b.height],[0,b.height]);
    }
    count++;
  }
  return {position: new Float32Array(pos), normal: new Float32Array(normal), uv: new Float32Array(uv), style:new Uint8Array(styles), count, simplified, omitted: candidates.length-count};
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
export function buildImpostors(world, budget = {vertices: 3000, buildings: 64}, {tolerance = 1.5, maxPoints = 10} = {}) {
  const pos = [], normal = [], uv = [], styles = []; let code = 0;
  const triangle = (a, b, c, n) => {pos.push(...a, ...b, ...c); normal.push(...n, ...n, ...n); uv.push(0,0,0,0,0,0); styles.push(code,32,code,32,code,32);};
  let count = 0, fallback = 0;
  for (const b of world.buildings) {
    if (count >= budget.buildings) break;
    code = b.style?.kind || 0;
    let ring = simplifyRing(b.rings[0], tolerance, maxPoints), roof = ShapeUtils.triangulateShape(ring.map(p => new Vector2(...p)), []);
    if (!roof.length) {const [a, c, d, e] = b.bounds; ring = [[a,c],[d,c],[d,e],[a,e]]; roof = [[0,1,2],[0,2,3]]; fallback++;}
    if (pos.length / 3 + ring.length * 6 + roof.length * 3 > budget.vertices) break;
    const len = (p, q) => Math.hypot(q[0]-p[0], q[1]-p[1]), o = b.rings[0];
    const gabled = b.style?.kind === 1 && b.rings.length === 1 && o.length === 4 && ringArea(o) <= 250;
    const h = gabled ? b.height + GABLE_RISE * Math.min(len(o[0], o[1]), len(o[1], o[2])) / 2 : b.height;
    for (const t of roof) triangle(...t.map(i => [...ring[i], h]), [0, 0, 1]);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length], dx = c[0]-a[0], dy = c[1]-a[1], l = Math.hypot(dx, dy);
      if (l < 0.01) continue;
      const n = [dy/l, -dx/l, 0], p = [...a, 0], q = [...c, 0], r = [...c, h], s = [...a, h];
      triangle(p, q, r, n); triangle(p, r, s, n);
    }
    count++;
  }
  return {position: new Float32Array(pos), normal: new Float32Array(normal), uv: new Float32Array(uv), style: new Uint8Array(styles), count, fallback, omitted: world.buildings.length - count};
}
// Ground surfaces and trees from the same OSM response (v0.1.19). Surface codes, shared with the road shader:
// 1 grass/park/garden/pitch, 2 wood/scrub, 3 water, 4 parking, 5 plaza/pedestrian area. Codes 0 and 6 are asphalt
// roads and footways. Trees: OSM natural=tree nodes, natural=tree_row every 8 m, and — illustrative, like windows —
// a jittered 14 m grid (9 m in woods) inside parks, gardens, cemeteries, recreation grounds and woods, never inside
// a building footprint. Each tree is [x, y, height, crown radius, mapped (1) or illustrative (0), shape].
// Shape from OSM species/genus/leaf_type: 0 broadleaf, 1 conifer, 2 palm. Untagged trees are broadleaf.
export const EXTRAS = Object.freeze({areas: 600, areaPoints: 400, trees: 2500, perArea: 80, spacing: 14, woodSpacing: 9, rowSpacing: 8, treeHeight: 8});
const SURFACE = [[1, p => ['park','garden','playground','pitch','dog_park'].includes(p.leisure) || ['grass','recreation_ground','cemetery','meadow','village_green','flowerbed'].includes(p.landuse) || p.natural === 'grassland'],
  [2, p => p.landuse === 'forest' || ['wood','scrub'].includes(p.natural)], [3, p => p.natural === 'water'], [4, p => p.amenity === 'parking' && !['underground','multi-storey','rooftop'].includes(p.parking)],
  [5, p => p.place === 'square' || (p.highway === 'pedestrian' && p.area === 'yes')]];
const PLANTED = p => ['park','garden','dog_park'].includes(p.leisure) || ['recreation_ground','cemetery','village_green'].includes(p.landuse);
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
export function parseExtras(features, origin = ORIGIN, buildings = []) {
  const areas = [], trees = [], places = [], local = p => toLocal(p, origin);
  const insideBuilding = (x, y) => buildings.some(b => x >= b.bounds[0] && x <= b.bounds[2] && y >= b.bounds[1] && y <= b.bounds[3] && inRings(b.rings, x, y));
  const treeHeight = (p, shape = 0, x = 0, y = 0) => {const h = parseFloat(p.height); return Number.isFinite(h) && h > 2 && h < 40 ? h : SHAPE_SIZE[shape][0] * (1 + (hash(x * 1.7, y * 2.3) * 2 - 1) * SHAPE_SIZE[shape][2]);};
  const crown = (h, shape, x, y) => h * SHAPE_SIZE[shape][1] * (.85 + .3 * hash(y * 3.1, x * .7));
  for (const f of features) {
    const p = f.properties || {}, g = f.geometry; if (!g) continue;
    if (g.type === 'Point' && p.natural !== 'tree') {const kind = placeKind(p); if (kind && places.length < 600) {const [x, y] = local(g.coordinates); places.push({x, y, name: String(p.name).slice(0, 80), kind, id: f.id});} continue;}
    if (p.natural === 'tree' && g.type === 'Point') {const [x, y] = local(g.coordinates), shape = treeShape(p), h = treeHeight(p, shape, x, y); trees.push([x, y, h, crown(h, shape, x, y), 1, shape]); continue;}
    if (p.natural === 'tree_row' && g.type === 'LineString') {
      const pts = g.coordinates.map(local), shape = treeShape(p);
      for (let i = 1; i < pts.length; i++) {const [a, b] = [pts[i-1], pts[i]], l = Math.hypot(b[0]-a[0], b[1]-a[1]); for (let s = 0; s < l; s += EXTRAS.rowSpacing) {const x = a[0] + (b[0]-a[0]) * s / l, y = a[1] + (b[1]-a[1]) * s / l, h = treeHeight(p, shape, x, y); trees.push([x, y, h, crown(h, shape, x, y), 1, shape]);}}
      continue;
    }
    const code = SURFACE.find(([, test]) => test(p))?.[0]; if (!code || areas.length >= EXTRAS.areas) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const rings = poly.map(r => r.slice(0, -1).map(local)).filter(r => r.length >= 3);
      if (!rings.length || rings.flat().length > EXTRAS.areaPoints || rings.flat().some(q => !q.every(Number.isFinite))) continue;
      const pts = rings[0], bounds = [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))];
      areas.push({code, rings, bounds, id: f.id});
      if (PLANTED(p) || code === 2) {
        const step = code === 2 ? EXTRAS.woodSpacing : EXTRAS.spacing, shape = p.leaf_type === 'needleleaved' ? 1 : 0; let n = 0;
        for (let x = Math.ceil(bounds[0] / step) * step; x < bounds[2] && n < EXTRAS.perArea; x += step) for (let y = Math.ceil(bounds[1] / step) * step; y < bounds[3] && n < EXTRAS.perArea; y += step) {
          const jx = x + (hash(x, y) - .5) * step * .7, jy = y + (hash(y, x) - .5) * step * .7;
          if (!inRings(rings, jx, jy) || insideBuilding(jx, jy)) continue;
          const h = 6 + hash(jx, jy) * 5; trees.push([jx, jy, h, h * (shape ? .22 : .28 + hash(jy, jx) * .1), 0, shape]); n++;
        }
      }
    }
  }
  // Water and plazas last so they draw over grass they sit in; mapped trees before illustrative ones.
  areas.sort((a, b) => a.code - b.code); trees.sort((a, b) => b[4] - a[4]);
  return {areas, places, trees: trees.slice(0, EXTRAS.trees).filter(t => t.every(Number.isFinite))};
}
export function parseExtrasRaw(raw, origin = ORIGIN, buildings = []) {return parseExtras(osmtogeojson(raw, {flatProperties: true}).features, origin, buildings);}
// Flat triangulated surfaces near (x, y), each at a tiny code-ordered height above the ground plane so overlaps never z-fight.
// Surface parking (code 4) and plazas (code 5) also get a 0.4 m concrete curb strip (code 9) along their outer edge,
// appended after every fill so painter's order puts it on top. Parking fills carry (along, across) uv in metres
// relative to the lot's longest edge, which the shader uses to paint illustrative stall lines; OSM rarely maps stalls.
export function buildSurfaces(areas, x, y, radius, maxVertices = 30000) {
  const pos = [], style = [], uv = [], curbs = []; let count = 0;
  for (const a of areas) {
    if (distanceToBox(a.bounds, x, y) > radius) continue;
    const vectors = a.rings.map(r => r.map(q => new Vector2(...q))), tris = ShapeUtils.triangulateShape(vectors[0], vectors.slice(1)), flat = a.rings.flat();
    if (pos.length / 3 + tris.length * 3 > maxVertices) break;
    let ox = 0, oy = 0, ux = 1, uy = 0;
    if (a.code === 4) {
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
