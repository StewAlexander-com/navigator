import {buildingStyle,contextLanduse,storefrontEdge} from './building-style.js';
import osmtogeojson from 'osmtogeojson';
import {ShapeUtils, Vector2} from 'three';

export const ORIGIN = [-118.2462058, 34.0510824];
export const BBOX = [34.0477, -118.2490, 34.0538, -118.2417];
// `area` is the half-size of a live GPS download square; `areaFallback` is retried once when a dense area exceeds the response cap.
export const LIMITS = Object.freeze({radius: 180, movement: 120, area: 400, areaFallback: 250, vertices: 90000, buildings: 160, responseBytes: 8 * 1024 * 1024});
const M = 111319.49079327358;
// Local metres are east/north of an origin; the origin is the bundled LA point unless a GPS area re-anchors it.
export const toLocal = ([lng, lat], origin = ORIGIN) => [(lng - origin[0]) * M * Math.cos(origin[1] * Math.PI / 180), (lat - origin[1]) * M];
export const toLngLat = (x, y, origin = ORIGIN) => [origin[0] + x / (M * Math.cos(origin[1] * Math.PI / 180)), origin[1] + y / M];
export function height(tags) {
  const raw = String(tags.height || '');
  const explicit = parseFloat(raw) * (/ft|feet|'/.test(raw) ? 0.3048 : 1);
  const levels = parseFloat(tags['building:levels']);
  const fallback = {house: 7, residential: 12, apartments: 18, commercial: 24, industrial: 9, office: 30};
  return Math.min(180, Math.max(3, Number.isFinite(explicit) ? explicit : Number.isFinite(levels) ? levels * 3.2 : fallback[tags.building] || 12));
}
export function boundedPosition(x, y) {
  const length = Math.hypot(x, y);
  return length > LIMITS.movement ? [x * LIMITS.movement / length, y * LIMITS.movement / length] : [x, y];
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
    if (f.properties.building && f.properties.building !== 'no') {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
      for (const poly of polys) {
        const rings = poly.map(r => r.slice(0, -1).map(local)).filter(r => r.length >= 3);
        if (!rings.length || rings.flat().some(p => !p.every(Number.isFinite))) continue;
        if (rings.flat().length > 2000) continue;
        const points = rings[0];
        const bounds = [Math.min(...points.map(p=>p[0])), Math.min(...points.map(p=>p[1])), Math.max(...points.map(p=>p[0])), Math.max(...points.map(p=>p[1]))];
        const h=height(f.properties),area=Math.abs(points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-b[0]*a[1];},0))/2;
        buildings.push({rings,bounds,height:h,id:f.id,style:buildingStyle(f.properties,{height:h,area,landuse:contextLanduse(zones,bounds)})});
      }
    }
    if (f.properties.highway && f.geometry.type === 'LineString') {
      const width = ['footway', 'path', 'steps'].includes(f.properties.highway) ? 2 : f.properties.highway === 'service' ? 5 : 14;
      roads.push({points: f.geometry.coordinates.map(local), width, name: f.properties.name || '', highway:f.properties.highway, bridge:f.properties.bridge, tunnel:f.properties.tunnel, layer:f.properties.layer});
    }
  }
  for(const b of buildings)b.frontEdge=storefrontEdge(b,roads);
  if (!buildings.length) throw new Error('No usable building footprints returned.');
  return {buildings, roads, origin, timestamp: raw.osm3s?.timestamp_osm_base || null};
}
function distanceToBox(b, x, y) {return Math.hypot(Math.max(b[0]-x, 0, x-b[2]), Math.max(b[1]-y, 0, y-b[3]));}
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
    const vectors = rings.map(r=>r.map(p=>new Vector2(...p)));
    const roof = ShapeUtils.triangulateShape(vectors[0], vectors.slice(1));
    const flat = rings.flat();
    for(const t of roof) triangle(...t.map(i=>[...flat[i],b.height]),[0,0,1]);
    for(const ring of rings) for(let i=0;i<ring.length;i++) {
      code=(b.style?.kind||0)+(rings===b.rings&&ring===rings[0]&&i===b.frontEdge?8:0);
      const a = ring[i], b2 = ring[(i+1)%ring.length], dx=b2[0]-a[0], dy=b2[1]-a[1], l=Math.hypot(dx,dy);
      if(l<0.01) continue;
      const n=[dy/l,-dx/l,0], p=[...a,0], q=[...b2,0], r=[...b2,b.height], s=[...a,b.height];
      triangle(p,q,r,n,[0,0],[l,0],[l,b.height]); triangle(p,r,s,n,[0,0],[l,b.height],[0,b.height]);
    }
    count++;
  }
  return {position: new Float32Array(pos), normal: new Float32Array(normal), uv: new Float32Array(uv), style:new Uint8Array(styles), count, simplified, omitted: candidates.length-count};
}
