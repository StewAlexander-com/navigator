import {buildGeometry,buildImpostors,LIMITS} from './world.js';
import {createSectorLookup} from './sectors.js';
// Prototype E: uniform spatial buckets, not the later ingest-time street-sector graph.
export const CHUNKS=Object.freeze({size:128,active:24,prefetch:4,margin:12,vertices:9000,buildings:16,roadVertices:600});
// Prototype G level of detail, per chunk. Chunks within `near` m (kept until `near + hysteresis`) get full extrusion;
// the rest out to `far` get silhouette prisms. A near chunk that would exceed the full-detail budget is downgraded to
// silhouettes instead of being omitted. `fade` is the distance band over which the near shader removes façade detail,
// so the geometry swap at the boundary changes shape only slightly, not surface. All far chunks share one draw call.
export const LOD=Object.freeze({near:120,hysteresis:24,far:300,fade:[90,150],farChunks:40,farVertices:40000,farBuildings:900,chunkVertices:3000,chunkBuildings:120});
const distance=(b,x,y)=>Math.hypot(Math.max(b[0]-x,0,x-b[2]),Math.max(b[1]-y,0,y-b[3]));
const bytes=g=>g.position.byteLength+g.normal.byteLength+g.uv.byteLength+g.style.byteLength;
export function createChunkIndex(world,prepared=null){
 const index=new Map();
 if(prepared){for(const c of prepared)index.set(c.id,{id:c.id,x:c.x,y:c.y,bounds:c.bounds,buildings:c.buildingIndices.map(i=>world.buildings[i]),roads:c.roadSegments.map(([r,i])=>({points:[world.roads[r].points[i],world.roads[r].points[i+1]],width:world.roads[r].width,name:world.roads[r].name,highway:world.roads[r].highway,oneway:world.roads[r].oneway,lanes:world.roads[r].lanes,source:[r,i]}))});return index;}
 function bucket(bounds){
  const cx=Math.floor((bounds[0]+bounds[2])/2/CHUNKS.size),cy=Math.floor((bounds[1]+bounds[3])/2/CHUNKS.size),id=`${cx}:${cy}`;
  let c=index.get(id);if(!c){c={id,x:(cx+.5)*CHUNKS.size,y:(cy+.5)*CHUNKS.size,bounds:[...bounds],buildings:[],roads:[]};index.set(id,c);}
  c.bounds=[Math.min(c.bounds[0],bounds[0]),Math.min(c.bounds[1],bounds[1]),Math.max(c.bounds[2],bounds[2]),Math.max(c.bounds[3],bounds[3])];return c;
 }
 for(const b of world.buildings)bucket(b.bounds).buildings.push(b);
 for(const [roadIndex,road] of world.roads.entries())for(let i=1;i<road.points.length;i++){
  const a=road.points[i-1],b=road.points[i],half=road.width/2;
  bucket([Math.min(a[0],b[0])-half,Math.min(a[1],b[1])-half,Math.max(a[0],b[0])+half,Math.max(a[1],b[1])+half]).roads.push({points:[a,b],width:road.width,name:road.name,highway:road.highway,oneway:road.oneway,lanes:road.lanes,source:[roadIndex,i-1]});
 }
 return index;
}
export function createChunkStream(world,graph=null){
 const index=createChunkIndex(world,graph?.chunks),lookup=graph?createSectorLookup(graph):null,cache=new Map();let loaded=0,evicted=0,hits=0,promoted=0,lastPrefetch=new Set(),lastActive=null;
 // Numeric payload estimate only; JS object/string/Map overhead is engine-dependent.
 const sourceNumericBytes=world.buildings.reduce((n,b)=>n+8*(b.rings.reduce((sum,ring)=>sum+ring.length*2,0)+8),0)+world.roads.reduce((n,road)=>n+8*(road.points.length*2+1),0);
 function prepare(c){
  if(cache.has(c.id)){hits++;return cache.get(c.id);}
  const geometry=buildGeometry(c,c.x,c.y,{vertices:CHUNKS.vertices,buildings:CHUNKS.buildings});
  const roads=c.roads.slice(0,CHUNKS.roadVertices/6);
  const entry={geometry,roads,bytes:bytes(geometry)};cache.set(c.id,entry);loaded++;return entry;
 }
 const farCache=new Map(),full=new Set();let farLoaded=0,lastKey=null;
 function prepareFar(c){if(farCache.has(c.id))return farCache.get(c.id);const geometry=buildImpostors(c,{vertices:LOD.chunkVertices,buildings:LOD.chunkBuildings});const entry={geometry,bytes:bytes(geometry)};farCache.set(c.id,entry);farLoaded++;return entry;}
 function merge(entries){let length=0,count=0;for(const g of entries){length+=g.position.length;count+=g.count;}
  const out={position:new Float32Array(length),normal:new Float32Array(length),uv:new Float32Array(length/3*2),style:new Uint8Array(length/3*2),count,simplified:0,omitted:0};
  let at=0;for(const g of entries){out.position.set(g.position,at);out.normal.set(g.normal,at);out.uv.set(g.uv,at/3*2);out.style.set(g.style,at/3*2);at+=g.position.length;out.simplified+=g.simplified||0;out.omitted+=g.omitted||0;}return out;}
 return {update(x,y,heading=0){
  const start=performance.now(),h=heading*Math.PI/180,fx=x+Math.sin(h)*(LOD.near+CHUNKS.size/2),fy=y+Math.cos(h)*(LOD.near+CHUNKS.size/2);
  const lookupStart=performance.now(),query=lookup?.query(x,y,LOD.far+CHUNKS.size);
  const selected=query?.chunkIds?query.chunkIds.map(id=>index.get(id)):[...index.values()];
  const candidates=selected.map(c=>({c,d:distance(c.bounds,x,y)})).sort((a,b)=>a.d-b.d||a.c.id.localeCompare(b.c.id));
  const lookupMs=performance.now()-lookupStart;
  // Hysteresis: a chunk already drawn in full stays full until it is `hysteresis` m beyond the near boundary.
  const near=candidates.filter(v=>v.d<=LOD.near+CHUNKS.margin||(full.has(v.c.id)&&v.d<=LOD.near+LOD.hysteresis)),active=near.slice(0,CHUNKS.active).map(v=>v.c),activeIds=new Set(active.map(c=>c.id));
  const ahead=candidates.filter(v=>!activeIds.has(v.c.id)&&v.d<=LOD.near+CHUNKS.size&&(v.c.x-x)*Math.sin(h)+(v.c.y-y)*Math.cos(h)>0).sort((a,b)=>distance(a.c.bounds,fx,fy)-distance(b.c.bounds,fx,fy)||a.c.id.localeCompare(b.c.id)).slice(0,CHUNKS.prefetch).map(v=>v.c);
  const keep=new Set([...activeIds,...ahead.map(c=>c.id)]);
  // Dropping the only cached references releases CPU geometry; the renderer disposes replaced GPU buffers.
  for(const id of cache.keys())if(!keep.has(id)){cache.delete(id);evicted++;}
  for(const c of active){if(lastPrefetch.has(c.id)&&cache.has(c.id))promoted++;prepare(c);}
  // Full-detail budget: whole chunks in distance order; one that does not fit is downgraded to silhouettes, not dropped.
  const nearEntries=[],downgraded=[];let length=0,count=0;
  for(const c of active){const g=cache.get(c.id).geometry;if(length/3+g.position.length/3>LIMITS.vertices||count+g.count>LIMITS.buildings){downgraded.push(c);continue;}nearEntries.push(c);length+=g.position.length;count+=g.count;}
  full.clear();for(const c of nearEntries)full.add(c.id);
  const farList=[...downgraded,...near.slice(CHUNKS.active).map(v=>v.c),...candidates.filter(v=>!activeIds.has(v.c.id)&&v.d>LOD.near+CHUNKS.margin&&v.d<=LOD.far).map(v=>v.c)].slice(0,LOD.farChunks+downgraded.length);
  const farIds=new Set(farList.map(c=>c.id));
  for(const id of farCache.keys())if(!farIds.has(id)&&!activeIds.has(id))farCache.delete(id);
  const farEntries=[];let farVertices=0,farBuildings=0,farOmitted=0;
  for(const c of farList){const g=prepareFar(c).geometry;if(farVertices+g.position.length/3>LOD.farVertices||farBuildings+g.count>LOD.farBuildings){farOmitted+=g.count+g.omitted;continue;}farEntries.push(c);farVertices+=g.position.length/3;farBuildings+=g.count;farOmitted+=g.omitted;}
  const key=nearEntries.map(c=>c.id).join('|')+'#'+farEntries.map(c=>c.id).sort().join('|'),changed=key!==lastKey;lastKey=key;lastActive=key;
  let geometry,far,roads;
  if(changed){
   geometry=merge(nearEntries.map(c=>cache.get(c.id).geometry));
   far=merge(farEntries.map(c=>farCache.get(c.id).geometry));far.omitted=farOmitted;far.downgraded=downgraded.length;
   // Roads keep the original 180 m reach whatever the building LOD: nearest chunks first, at most `active` chunks of them.
   roads=candidates.filter(v=>v.d<=LIMITS.radius+CHUNKS.margin).slice(0,CHUNKS.active).flatMap(v=>(cache.get(v.c.id)?.roads)||v.c.roads.slice(0,CHUNKS.roadVertices/6));
  }
  for(const c of ahead)prepare(c);lastPrefetch=new Set(ahead.map(c=>c.id));
  const cacheBytes=[...cache.values()].reduce((n,c)=>n+c.bytes,0),farBytes=[...farCache.values()].reduce((n,c)=>n+c.bytes,0),activeBytes=nearEntries.reduce((n,c)=>n+cache.get(c.id).bytes,0)+farEntries.reduce((n,c)=>n+farCache.get(c.id).bytes,0),roadBytes=Math.min(near.length,CHUNKS.active)*CHUNKS.roadVertices*32;
  return {geometry,far,roads,stream:{lookupMode:query?.chunkIds?'sector graph':'radius fallback',lookupMs,sectorsVisited:query?.visited||0,sectorCount:graph?.sectors.length||0,candidateChunks:candidates.length,graphBytes:graph?.bytes||0,active:nearEntries.length,prefetched:ahead.length,resident:cache.size,activeIds:nearEntries.map(c=>c.id),prefetchIds:[...lastPrefetch],indexed:index.size,omittedChunks:Math.max(0,farList.length-farEntries.length),loaded,evicted,hits,promoted,cacheBytes:cacheBytes+farBytes,activeBytes,roadBytes,sourceNumericBytes,geometryEstimateBytes:cacheBytes+farBytes+2*(activeBytes+roadBytes),
   lod:{near:nearEntries.length,far:farEntries.length,downgraded:downgraded.length,farResident:farCache.size,farLoaded,impostorBuildings:farBuildings,impostorVertices:farVertices,impostorOmitted:farOmitted,farBytes,nearRadius:LOD.near,farRadius:LOD.far},queryMs:performance.now()-start}};
 }};
}
