import {parseWorld, parseExtrasRaw, mergeExtras, buildSurfaces, nearTrees, LIMITS, BBOX, ORIGIN, toLocal} from './world.js';
import {LOD} from './chunks.js';
import {namedAnchors,occluders,attachPlaces} from './building-labels.js';
import {areaAround, areaCovers} from './sensors.js';
import {createChunkStream} from './chunks.js';
import {validateSectorGraph} from './sectors.js';
import {locateBuilding} from './indoor.js';
let world,stream,extrasAt=null,at=[0,0];
// Surfaces and trees are rebuilt only after 40 m of movement or a new area; trees reach 220 m, surfaces the far LOD radius.
export const EXTRA_VIEW=Object.freeze({trees:700,treeRadius:220,surfaceVertices:30000,refresh:40});
function extras(x,y,force){
 if(!world?.areas||(!force&&extrasAt&&Math.hypot(x-extrasAt[0],y-extrasAt[1])<EXTRA_VIEW.refresh))return null;
 extrasAt=[x,y];const surfaces=buildSurfaces(world.areas,x,y,LOD.far,EXTRA_VIEW.surfaceVertices),trees=nearTrees(world.trees,x,y,EXTRA_VIEW.treeRadius,EXTRA_VIEW.trees);
 return {surfaces,trees,areaCount:world.areas.length,treeCount:world.trees.length,mappedTrees:world.trees.filter(t=>t[4]).length};
}
async function loadExtras(url,parsed){
 try{const response=await fetch(new URL('osm-extras.json',url),{signal:AbortSignal.timeout(6000),credentials:'omit'});if(!response.ok)return;
  const text=await response.text();if(text.length>2*1024*1024)return;const e=parseExtrasRaw(JSON.parse(text),parsed.origin,parsed.buildings,{context:parsed.context,roads:parsed.roads});parsed.areas=e.areas;parsed.trees=e.trees;parsed.places=e.places;}catch{/* Surfaces and trees are optional. */}
}
// Retry-After may be seconds or an HTTP date; anything unparseable falls back to 60 s.
function retryAfterMs(response){const raw=response.headers.get('retry-after');if(!raw)return 60000;const seconds=Number(raw);if(Number.isFinite(seconds))return Math.max(1000,seconds*1000);const at=Date.parse(raw);return Number.isFinite(at)?Math.max(1000,at-Date.now()):60000;}
// `report` receives {phase, bytes, total} at most every ~120 ms while a body streams, then once for the parse phase.
// Content-Length is passed through as read; a compressed body makes it smaller than the decoded byte count (main.js handles that).
async function download(url, origin, fingerprint=false, report=null) {
  const response = await fetch(url, {signal: AbortSignal.timeout(35000), credentials: 'omit', referrerPolicy: 'no-referrer'});
  if(!response.ok) throw Object.assign(new Error(`Map service returned ${response.status}.`),{status:response.status,retryMs:[429,503].includes(response.status)?retryAfterMs(response):null,dense:response.status===504});
  const total=Number(response.headers.get('content-length'))||null;let reportedAt=0;
  const reader=response.body.getReader(); let size=0; const chunks=[];
  while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>LIMITS.responseBytes){await reader.cancel();throw Object.assign(new Error('Map response exceeds the 8 MiB limit.'),{oversized:true});}chunks.push(value);if(report&&performance.now()-reportedAt>120){reportedAt=performance.now();report({phase:'downloading',bytes:size,total});}}
  report?.({phase:'downloading',bytes:size,total});report?.({phase:'parsing',bytes:size,total});
  const buffer=new Uint8Array(size);let at=0;for(const c of chunks){buffer.set(c,at);at+=c.length;}
  let sourceHash=null;
  // Manual exploration also works on non-secure origins where WebCrypto is absent.
  if(fingerprint&&globalThis.crypto?.subtle){try{sourceHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');}catch{/* The index is optional; retain radius lookup. */}}
  let parsed;try{parsed=parseWorld(JSON.parse(new TextDecoder().decode(buffer)),origin);}catch(error){if(/Incomplete or oversized/.test(error.message))error.dense=true;throw error;}
  return {parsed,size,sourceHash};
}
// Every land cover the scene can draw (see SURFACE in world.js), plus the land uses that classify buildings.
const GREEN_LANDUSE='residential|retail|industrial|grass|recreation_ground|cemetery|forest|meadow|village_green|flowerbed|greenfield|farmland|orchard|vineyard|plantation|allotments|plant_nursery|paddy|farmyard|basin|reservoir|salt_pond|aquaculture|construction|brownfield|quarry|landfill';
const GREEN_LEISURE='park|garden|playground|pitch|dog_park|common|recreation_ground|golf_course';
const GREEN_NATURAL='water|wood|scrub|heath|shrubbery|grassland|wetland|beach|sand|bare_rock|scree|shingle|mud';
const overpassUrl=([south,west,north,east])=>'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(`[out:json][timeout:25];(way[building](${south},${west},${north},${east});way["building:part"](${south},${west},${north},${east});relation[building](${south},${west},${north},${east});way[highway](${south},${west},${north},${east});way[landuse~"^(${GREEN_LANDUSE})$"](${south},${west},${north},${east});way[leisure~"^(${GREEN_LEISURE})$"](${south},${west},${north},${east});relation[leisure~"^(park|garden)$"](${south},${west},${north},${east});way[natural~"^(${GREEN_NATURAL}|tree_row)$"](${south},${west},${north},${east});way[landcover~"^(trees|grass|scrub)$"](${south},${west},${north},${east});way[waterway~"^(riverbank|river|canal|stream|drain|ditch|tidal_channel)$"](${south},${west},${north},${east});node[place~"^(city|town|suburb|quarter|village|hamlet|neighbourhood|isolated_dwelling|farm|locality)$"](around:4000,${(south+north)/2},${(west+east)/2});way[amenity=parking](${south},${west},${north},${east});way[place=square](${south},${west},${north},${east});node[natural=tree](${south},${west},${north},${east});node[amenity~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|biergarten|marketplace|townhall|library|theatre|cinema|place_of_worship|courthouse|arts_centre)$"][name](${south},${west},${north},${east});node[shop~"^(bakery|deli|confectionery|coffee|pastry)$"][name](${south},${west},${north},${east});node[tourism~"^(museum|attraction|gallery)$"][name](${south},${west},${north},${east});node[historic][name](${south},${west},${north},${east});relation[landuse~"^(residential|retail|industrial)$"](${south},${west},${north},${east}););out geom;`);
// Large forests, wetlands, lakes and riverbanks are usually multipolygon relations, often far bigger than the square.
// They come in a second, optional request started when the main one finishes (not in parallel, which could take
// Overpass's second slot and rate-limit the main load) and never awaited by it, under its own byte cap and timeout, so one huge relation
// can never fail an area load; without it the scene still has every cover mapped as a simple way.
const coverUrl=([south,west,north,east])=>'https://overpass-api.de/api/interpreter?data='+encodeURIComponent(`[out:json][timeout:20];(relation[type=multipolygon][landuse~"^(${GREEN_LANDUSE})$"](${south},${west},${north},${east});relation[type=multipolygon][natural~"^(${GREEN_NATURAL})$"](${south},${west},${north},${east});relation[type=multipolygon][leisure~"^(${GREEN_LEISURE})$"](${south},${west},${north},${east});relation[type=multipolygon][waterway=riverbank](${south},${west},${north},${east}););out geom;`);
const COVER=Object.freeze({bytes:4*1024*1024,timeoutMs:30000});
async function downloadCover(bbox){
 const response=await fetch(coverUrl(bbox),{signal:AbortSignal.timeout(COVER.timeoutMs),credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)return null;
 const reader=response.body.getReader(),chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>COVER.bytes){await reader.cancel();return null;}chunks.push(value);}
 const buffer=new Uint8Array(size);let at=0;for(const c of chunks){buffer.set(c,at);at+=c.length;}
 return JSON.parse(new TextDecoder().decode(buffer));
}
const osmApiUrl=([south,west,north,east])=>`https://api.openstreetmap.org/api/0.6/map.json?bbox=${west},${south},${east},${north}`;
// Live areas try Overpass, then the OSM API. Both providers reveal the bounding box to that service.
// A rate limit (429/503) means slow down, not switch providers; an oversized or dense (504/timeout) square means shrink it.
async function downloadLive(bbox, origin, report=null) {
  try {return {...await download(overpassUrl(bbox),origin,false,report),provider:'Overpass'};}
  catch(error){
    if(error.oversized||error.retryMs||error.dense)throw error;
    return {...await download(osmApiUrl(bbox),origin,false,report),provider:'OSM API'};
  }
}
// Download the square of `radius` around `center`; a dense or oversized response steps down through the smaller
// half-sizes (1,000 → 400 → 250 m); only a dense square that fails at the smallest size falls to the OSM API.
async function downloadSquare(center, radius, report=null){
  const sizes=[radius,...[LIMITS.area,LIMITS.areaFallback].filter(r=>r<radius)];
  for(let i=0;i<sizes.length;i++){
    const bbox=areaAround(center,sizes[i]);
    try {return {...await downloadLive(bbox,center,report),bbox,radius:sizes[i]};}
    catch(error){
      if(!(error.oversized||error.dense)||i===sizes.length-1){
        if(error.dense&&!error.oversized&&i===sizes.length-1)return {...await download(osmApiUrl(bbox),center,false,report),provider:'OSM API',bbox,radius:sizes[i]};
        throw error;
      }
    }
  }
}
async function loadSectors(url,world,hash){
 if(!hash)return null;
 try{
  const response=await fetch(new URL('osm-sectors.json',url),{signal:AbortSignal.timeout(4000),credentials:'omit'});if(!response.ok)return null;
  const text=await response.text();if(text.length>4*1024*1024)return null;
  const graph=JSON.parse(text);if(!validateSectorGraph(graph,world,hash))return null;graph.bytes=new TextEncoder().encode(text).byteLength;return graph;
 }catch{return null;}
}
// Session cache of parsed live squares, most recent last. Driving back over a road costs no download, and a
// prefetched square is swapped in through the ordinary load path without a fetch.
const squares=[];let prefetching=null;
const covering=point=>squares.slice().reverse().find(s=>areaCovers(...toLocal(point,s.origin),s.bbox,s.origin));
function remember(square){const i=squares.findIndex(s=>s.bbox.join()===square.bbox.join());if(i>=0)squares.splice(i,1);squares.push(square);
 const total=()=>squares.reduce((n,s)=>n+s.bytes,0);while(squares.length>1&&(squares.length>LIMITS.squares||total()>LIMITS.squareBytes))squares.shift();}
// Diagnostics hook for tests; not part of the message protocol.
self.navigatorSquares=()=>squares.map(s=>({bbox:s.bbox,radius:s.radius,bytes:s.bytes}));
async function fetchSquare(center,radius,report=null){const r=await downloadSquare(center,radius,report);
 // The square is shown at once; its relations fill in when they arrive (an 'extras' message if it is still on screen).
 downloadCover(r.bbox).then(raw=>{if(!raw?.elements?.length)return;mergeExtras(r.parsed,parseExtrasRaw(raw,r.parsed.origin,r.parsed.buildings,{context:r.parsed.context,scatter:false}));r.parsed.covered=true;
  if(world===r.parsed){const e=extras(at[0],at[1],true);if(e)self.postMessage({type:'extras',extras:e},[e.surfaces.position.buffer,e.surfaces.normal.buffer,e.surfaces.uv.buffer,e.surfaces.style.buffer,e.trees.buffer]);}}).catch(()=>{/* Relations are optional. */});
 const square={bbox:r.bbox,origin:center,radius:r.radius,parsed:r.parsed,bytes:r.size,provider:r.provider,timestamp:r.parsed.timestamp};remember(square);return square;}
self.onmessage = async ({data}) => {
  const start = performance.now();
  const report=p=>self.postMessage({type:'progress',id:data.id,task:data.type,...p});
  // Indoor hint: which loaded footprint contains the fix, if any. Only meaningful in the current world's local frame.
  if (data.type === 'locate') {self.postMessage({type:'located',id:data.id,located:world&&Array.isArray(data.origin)&&data.origin.join()===world.origin.join()?locateBuilding(world.buildings,[data.x,data.y]):null});return;}
  if (data.type === 'prefetch') {
    let mine=null;
    try {
      if(prefetching)await prefetching.catch(()=>{});
      if(covering(data.fix||data.center)){self.postMessage({type:'prefetched',id:data.id,cached:true});return;}
      prefetching=mine=fetchSquare(data.center,data.radius||LIMITS.area,report);
      const square=await mine;
      self.postMessage({type:'prefetched',id:data.id,bbox:square.bbox,origin:square.origin,radius:square.radius,bytes:square.bytes,provider:square.provider,ms:performance.now()-start});
    }catch(error){self.postMessage({type:'prefetch-error',id:data.id,message:error.message,retryMs:error.retryMs||null});}
    finally{if(prefetching===mine)prefetching=null;}
    return;
  }
  try {
    let bytes, provider, bbox = BBOX, origin = ORIGIN, radius = null, cached = false;
    if (data.type === 'load') {
      let result;
      if (data.center) {
        // GPS area: a square around the fix (or ahead of it at speed). A prefetch already in flight may cover it.
        if(prefetching)await prefetching.catch(()=>{});
        const hit=data.fresh?null:covering(data.fix||data.center);
        const square=hit||await fetchSquare(data.center,data.radius||LIMITS.area,report);
        // Stepping to the next area by hand keeps only that square: the one behind is dropped to stay lean.
        if(data.lean)squares.splice(0,squares.length,square);
        cached=!!hit;origin=square.origin;radius=square.radius;bbox=square.bbox;
        result={parsed:square.parsed,size:square.bytes,provider:square.provider};
      } else if (data.live) {
        result = await downloadLive(BBOX, ORIGIN, report);
      } else {
        result = await download(data.url, ORIGIN, true, report); result.provider = 'Bundled OSM';
        result.graph = await loadSectors(data.url,result.parsed,result.sourceHash);
        await loadExtras(data.url,result.parsed);
      }
      world = result.parsed; stream = createChunkStream(world,result.graph); world.bbox = bbox; world.radius = radius; bytes = result.size; provider = result.provider;
      report({phase:'building',bytes,total:null});
    }
    if(!world)throw new Error('Load an area first.');
    at=[data.x||0,data.y||0];const result=stream.update(data.x||0,data.y||0,data.heading||0),g=result.geometry,f=result.far,e=extras(data.x||0,data.y||0,data.type==='load');if(e)result.extras=e;if(!world.placesAttached){attachPlaces(world.buildings,world.places||[]);world.placesAttached=true;}if(data.type==='load')result.bridges=(world.bridges||[]).map(p=>({points:p.points,width:p.width,bounds:p.bounds}));result.labels={anchors:namedAnchors(world.buildings,data.x||0,data.y||0,undefined,world.roads),blockers:occluders(world.buildings,data.x||0,data.y||0)};
    self.postMessage({type:'ready',id:data.id,x:data.x||0,y:data.y||0,heading:data.heading||0,...result,areaLoaded:data.type==='load',origin:world.origin,bbox:world.bbox,radius:world.radius,timestamp:world.timestamp,kinds:world.kinds,prior:world.prior,context:world.context,bytes,provider,cached,ms:performance.now()-start,live:data.live||!!data.center},[...(g?[g.position.buffer,g.normal.buffer,g.uv.buffer,g.style.buffer]:[]),...(f?[f.position.buffer,f.normal.buffer,f.uv.buffer,f.style.buffer]:[]),...(e?[e.surfaces.position.buffer,e.surfaces.normal.buffer,e.surfaces.uv.buffer,e.surfaces.style.buffer,e.trees.buffer]:[])]);
  }catch(error){self.postMessage({type:'error',id:data.id,message:error.message,oversized:!!error.oversized,retryMs:error.retryMs||null});}
};
