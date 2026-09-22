import {buildGeometry,LIMITS} from './world.js';
import {createSectorLookup} from './sectors.js';
// Prototype E: uniform spatial buckets, not the later ingest-time street-sector graph.
export const CHUNKS=Object.freeze({size:128,active:24,prefetch:4,margin:12,vertices:9000,buildings:16,roadVertices:600});
const distance=(b,x,y)=>Math.hypot(Math.max(b[0]-x,0,x-b[2]),Math.max(b[1]-y,0,y-b[3]));
const bytes=g=>g.position.byteLength+g.normal.byteLength+g.uv.byteLength;
export function createChunkIndex(world,prepared=null){
 const index=new Map();
 if(prepared){for(const c of prepared)index.set(c.id,{id:c.id,x:c.x,y:c.y,bounds:c.bounds,buildings:c.buildingIndices.map(i=>world.buildings[i]),roads:c.roadSegments.map(([r,i])=>({points:[world.roads[r].points[i],world.roads[r].points[i+1]],width:world.roads[r].width,name:world.roads[r].name,highway:world.roads[r].highway,source:[r,i]}))});return index;}
 function bucket(bounds){
  const cx=Math.floor((bounds[0]+bounds[2])/2/CHUNKS.size),cy=Math.floor((bounds[1]+bounds[3])/2/CHUNKS.size),id=`${cx}:${cy}`;
  let c=index.get(id);if(!c){c={id,x:(cx+.5)*CHUNKS.size,y:(cy+.5)*CHUNKS.size,bounds:[...bounds],buildings:[],roads:[]};index.set(id,c);}
  c.bounds=[Math.min(c.bounds[0],bounds[0]),Math.min(c.bounds[1],bounds[1]),Math.max(c.bounds[2],bounds[2]),Math.max(c.bounds[3],bounds[3])];return c;
 }
 for(const b of world.buildings)bucket(b.bounds).buildings.push(b);
 for(const [roadIndex,road] of world.roads.entries())for(let i=1;i<road.points.length;i++){
  const a=road.points[i-1],b=road.points[i],half=road.width/2;
  bucket([Math.min(a[0],b[0])-half,Math.min(a[1],b[1])-half,Math.max(a[0],b[0])+half,Math.max(a[1],b[1])+half]).roads.push({points:[a,b],width:road.width,name:road.name,highway:road.highway,source:[roadIndex,i-1]});
 }
 return index;
}
export function createChunkStream(world,graph=null){
 const index=createChunkIndex(world,graph?.chunks),lookup=graph?createSectorLookup(graph):null,cache=new Map();let loaded=0,evicted=0,hits=0,promoted=0,lastPrefetch=new Set(),lastActive=null;
 // Numeric payload estimate only; JS object/string/Map overhead is engine-dependent.
 const sourceNumericBytes=world.buildings.reduce((n,b)=>n+8*(b.rings.reduce((sum,ring)=>sum+ring.length*2,0)+5),0)+world.roads.reduce((n,road)=>n+8*(road.points.length*2+1),0);
 function prepare(c){
  if(cache.has(c.id)){hits++;return cache.get(c.id);}
  const geometry=buildGeometry(c,c.x,c.y,{vertices:CHUNKS.vertices,buildings:CHUNKS.buildings});
  const roads=c.roads.slice(0,CHUNKS.roadVertices/6);
  const entry={geometry,roads,bytes:bytes(geometry)};cache.set(c.id,entry);loaded++;return entry;
 }
 return {update(x,y,heading=0){
  const start=performance.now(),h=heading*Math.PI/180,fx=x+Math.sin(h)*(LIMITS.radius+CHUNKS.size/2),fy=y+Math.cos(h)*(LIMITS.radius+CHUNKS.size/2);
  const lookupStart=performance.now(),query=lookup?.query(x,y,LIMITS.radius+CHUNKS.size);
  const selected=query?.chunkIds?query.chunkIds.map(id=>index.get(id)):[...index.values()];
  const candidates=selected.map(c=>({c,d:distance(c.bounds,x,y)})).sort((a,b)=>a.d-b.d||a.c.id.localeCompare(b.c.id));
  const lookupMs=performance.now()-lookupStart;
  const near=candidates.filter(v=>v.d<=LIMITS.radius+CHUNKS.margin),active=near.slice(0,CHUNKS.active).map(v=>v.c),activeIds=new Set(active.map(c=>c.id));
  const ahead=candidates.filter(v=>!activeIds.has(v.c.id)&&v.d<=LIMITS.radius+CHUNKS.size&&(v.c.x-x)*Math.sin(h)+(v.c.y-y)*Math.cos(h)>0).sort((a,b)=>distance(a.c.bounds,fx,fy)-distance(b.c.bounds,fx,fy)||a.c.id.localeCompare(b.c.id)).slice(0,CHUNKS.prefetch).map(v=>v.c);
  const keep=new Set([...activeIds,...ahead.map(c=>c.id)]);
  // Dropping the only cached references releases CPU geometry; the renderer disposes replaced GPU buffers.
  for(const id of cache.keys())if(!keep.has(id)){cache.delete(id);evicted++;}
  for(const c of active){if(lastPrefetch.has(c.id)&&cache.has(c.id))promoted++;prepare(c);}
  // Under pressure, a new distance order can change which whole chunks fit.
  const totals=active.reduce((n,c)=>{const g=cache.get(c.id).geometry;return [n[0]+g.count,n[1]+g.position.length/3];},[0,0]);
  const ordered=totals[0]>LIMITS.buildings||totals[1]>LIMITS.vertices;
  const key=(ordered?[...activeIds]:[...activeIds].sort()).join('|'),changed=key!==lastActive;lastActive=key;
  let geometry,roads;
  if(changed){
   const all=active.map(c=>cache.get(c.id)),entries=[];let length=0,count=0,simplified=0,omitted=0;
   for(const e of all){
    if(length/3+e.geometry.position.length/3>LIMITS.vertices||count+e.geometry.count>LIMITS.buildings){omitted+=e.geometry.count+e.geometry.omitted;continue;}
    entries.push(e);length+=e.geometry.position.length;count+=e.geometry.count;simplified+=e.geometry.simplified;omitted+=e.geometry.omitted;
   }
   geometry={position:new Float32Array(length),normal:new Float32Array(length),uv:new Float32Array(length/3*2),count,simplified,omitted};
   let at=0;for(const e of entries){geometry.position.set(e.geometry.position,at);geometry.normal.set(e.geometry.normal,at);geometry.uv.set(e.geometry.uv,at/3*2);at+=e.geometry.position.length;}
   roads=all.flatMap(e=>e.roads);
  }
  for(const c of ahead)prepare(c);lastPrefetch=new Set(ahead.map(c=>c.id));
  const cacheBytes=[...cache.values()].reduce((n,c)=>n+c.bytes,0),activeBytes=active.reduce((n,c)=>n+cache.get(c.id).bytes,0),roadBytes=active.reduce((n,c)=>n+cache.get(c.id).roads.length*6*32,0);
  return {geometry,roads,stream:{lookupMode:query?.chunkIds?'sector graph':'radius fallback',lookupMs,sectorsVisited:query?.visited||0,sectorCount:graph?.sectors.length||0,candidateChunks:candidates.length,graphBytes:graph?.bytes||0,active:active.length,prefetched:ahead.length,resident:cache.size,activeIds:[...activeIds],prefetchIds:[...lastPrefetch],indexed:index.size,omittedChunks:near.length-active.length,loaded,evicted,hits,promoted,cacheBytes,activeBytes,roadBytes,sourceNumericBytes,geometryEstimateBytes:cacheBytes+2*(activeBytes+roadBytes),queryMs:performance.now()-start}};
 }};
}
