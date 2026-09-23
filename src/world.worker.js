import {parseWorld, LIMITS, BBOX, ORIGIN, toLocal} from './world.js';
import {areaAround, areaCovers} from './sensors.js';
import {createChunkStream} from './chunks.js';
import {validateSectorGraph} from './sectors.js';
let world,stream;
// Retry-After may be seconds or an HTTP date; anything unparseable falls back to 60 s.
function retryAfterMs(response){const raw=response.headers.get('retry-after');if(!raw)return 60000;const seconds=Number(raw);if(Number.isFinite(seconds))return Math.max(1000,seconds*1000);const at=Date.parse(raw);return Number.isFinite(at)?Math.max(1000,at-Date.now()):60000;}
async function download(url, origin, fingerprint=false) {
  const response = await fetch(url, {signal: AbortSignal.timeout(35000), credentials: 'omit', referrerPolicy: 'no-referrer'});
  if(!response.ok) throw Object.assign(new Error(`Map service returned ${response.status}.`),{status:response.status,retryMs:[429,503].includes(response.status)?retryAfterMs(response):null,dense:response.status===504});
  const reader=response.body.getReader(); let size=0; const chunks=[];
  while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>LIMITS.responseBytes){await reader.cancel();throw Object.assign(new Error('Map response exceeds the 8 MiB limit.'),{oversized:true});}chunks.push(value);}
  const buffer=new Uint8Array(size);let at=0;for(const c of chunks){buffer.set(c,at);at+=c.length;}
  let sourceHash=null;
  // Manual exploration also works on non-secure origins where WebCrypto is absent.
  if(fingerprint&&globalThis.crypto?.subtle){try{sourceHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');}catch{/* The index is optional; retain radius lookup. */}}
  let parsed;try{parsed=parseWorld(JSON.parse(new TextDecoder().decode(buffer)),origin);}catch(error){if(/Incomplete or oversized/.test(error.message))error.dense=true;throw error;}
  return {parsed,size,sourceHash};
}
const overpassUrl=([south,west,north,east])=>'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(`[out:json][timeout:25];(way[building](${south},${west},${north},${east});relation[building](${south},${west},${north},${east});way[highway](${south},${west},${north},${east});way[landuse~"^(residential|retail|industrial)$"](${south},${west},${north},${east});relation[landuse~"^(residential|retail|industrial)$"](${south},${west},${north},${east}););out geom;`);
const osmApiUrl=([south,west,north,east])=>`https://api.openstreetmap.org/api/0.6/map.json?bbox=${west},${south},${east},${north}`;
// Live areas try Overpass, then the OSM API. Both providers reveal the bounding box to that service.
// A rate limit (429/503) means slow down, not switch providers; an oversized or dense (504/timeout) square means shrink it.
async function downloadLive(bbox, origin) {
  try {return {...await download(overpassUrl(bbox),origin),provider:'Overpass'};}
  catch(error){
    if(error.oversized||error.retryMs||error.dense)throw error;
    return {...await download(osmApiUrl(bbox),origin),provider:'OSM API'};
  }
}
// Download the square of `radius` around `center`; a dense or oversized response steps down through the smaller
// half-sizes (1,000 → 400 → 250 m); only a dense square that fails at the smallest size falls to the OSM API.
async function downloadSquare(center, radius){
  const sizes=[radius,...[LIMITS.area,LIMITS.areaFallback].filter(r=>r<radius)];
  for(let i=0;i<sizes.length;i++){
    const bbox=areaAround(center,sizes[i]);
    try {return {...await downloadLive(bbox,center),bbox,radius:sizes[i]};}
    catch(error){
      if(!(error.oversized||error.dense)||i===sizes.length-1){
        if(error.dense&&!error.oversized&&i===sizes.length-1)return {...await download(osmApiUrl(bbox),center),provider:'OSM API',bbox,radius:sizes[i]};
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
async function fetchSquare(center,radius){const r=await downloadSquare(center,radius);const square={bbox:r.bbox,origin:center,radius:r.radius,parsed:r.parsed,bytes:r.size,provider:r.provider,timestamp:r.parsed.timestamp};remember(square);return square;}
self.onmessage = async ({data}) => {
  const start = performance.now();
  if (data.type === 'prefetch') {
    let mine=null;
    try {
      if(prefetching)await prefetching.catch(()=>{});
      if(covering(data.fix||data.center)){self.postMessage({type:'prefetched',id:data.id,cached:true});return;}
      prefetching=mine=fetchSquare(data.center,data.radius||LIMITS.area);
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
        const square=hit||await fetchSquare(data.center,data.radius||LIMITS.area);
        cached=!!hit;origin=square.origin;radius=square.radius;bbox=square.bbox;
        result={parsed:square.parsed,size:square.bytes,provider:square.provider};
      } else if (data.live) {
        result = await downloadLive(BBOX, ORIGIN);
      } else {
        result = await download(data.url, ORIGIN, true); result.provider = 'Bundled OSM';
        result.graph = await loadSectors(data.url,result.parsed,result.sourceHash);
      }
      world = result.parsed; stream = createChunkStream(world,result.graph); world.bbox = bbox; world.radius = radius; bytes = result.size; provider = result.provider;
    }
    if(!world)throw new Error('Load an area first.');
    const result=stream.update(data.x||0,data.y||0,data.heading||0),g=result.geometry;
    self.postMessage({type:'ready',id:data.id,x:data.x||0,y:data.y||0,heading:data.heading||0,...result,areaLoaded:data.type==='load',origin:world.origin,bbox:world.bbox,radius:world.radius,timestamp:world.timestamp,kinds:world.kinds,prior:world.prior,bytes,provider,cached,ms:performance.now()-start,live:data.live||!!data.center},g?[g.position.buffer,g.normal.buffer,g.uv.buffer,g.style.buffer]:[]);
  }catch(error){self.postMessage({type:'error',id:data.id,message:error.message,oversized:!!error.oversized,retryMs:error.retryMs||null});}
};
