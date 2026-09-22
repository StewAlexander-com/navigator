import {parseWorld, LIMITS, BBOX, ORIGIN} from './world.js';
import {areaAround} from './sensors.js';
import {createChunkStream} from './chunks.js';
import {validateSectorGraph} from './sectors.js';
let world,stream;
async function download(url, origin, fingerprint=false) {
  const response = await fetch(url, {signal: AbortSignal.timeout(35000), credentials: 'omit', referrerPolicy: 'no-referrer'});
  if(!response.ok) throw new Error(`Map service returned ${response.status}.`);
  const reader=response.body.getReader(); let size=0; const chunks=[];
  while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>LIMITS.responseBytes){await reader.cancel();throw Object.assign(new Error('Map response exceeds the 8 MiB limit.'),{oversized:true});}chunks.push(value);}
  const buffer=new Uint8Array(size);let at=0;for(const c of chunks){buffer.set(c,at);at+=c.length;}
  let sourceHash=null;
  // Manual exploration also works on non-secure origins where WebCrypto is absent.
  if(fingerprint&&globalThis.crypto?.subtle){try{sourceHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');}catch{/* The index is optional; retain radius lookup. */}}
  return {parsed:parseWorld(JSON.parse(new TextDecoder().decode(buffer)),origin),size,sourceHash};
}
const overpassUrl=([south,west,north,east])=>'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(`[out:json][timeout:25];(way[building](${south},${west},${north},${east});relation[building](${south},${west},${north},${east});way[highway](${south},${west},${north},${east});way[landuse~"^(residential|retail|industrial)$"](${south},${west},${north},${east});relation[landuse~"^(residential|retail|industrial)$"](${south},${west},${north},${east}););out geom;`);
const osmApiUrl=([south,west,north,east])=>`https://api.openstreetmap.org/api/0.6/map.json?bbox=${west},${south},${east},${north}`;
// Live areas try Overpass, then the OSM API. Both providers reveal the bounding box to that service.
async function downloadLive(bbox, origin) {
  try {return {...await download(overpassUrl(bbox),origin),provider:'Overpass'};}
  catch(error){
    if(error.oversized)throw error;
    return {...await download(osmApiUrl(bbox),origin),provider:'OSM API'};
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
self.onmessage = async ({data}) => {
  const start = performance.now();
  try {
    let bytes, provider, bbox = BBOX, origin = ORIGIN, radius = null;
    if (data.type === 'load') {
      let result;
      if (data.center) {
        // GPS area: a square around the fix. Dense cities can exceed the response cap; retry once with a smaller square.
        origin = data.center;
        radius = data.radius || LIMITS.area;
        bbox = areaAround(origin, radius);
        try {result = await downloadLive(bbox, origin);}
        catch(error){
          if(!error.oversized || radius <= LIMITS.areaFallback) throw error;
          radius = LIMITS.areaFallback; bbox = areaAround(origin, radius);
          result = await downloadLive(bbox, origin);
        }
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
    self.postMessage({type:'ready',id:data.id,x:data.x||0,y:data.y||0,heading:data.heading||0,...result,areaLoaded:data.type==='load',origin:world.origin,bbox:world.bbox,radius:world.radius,timestamp:world.timestamp,bytes,provider,ms:performance.now()-start,live:data.live||!!data.center},g?[g.position.buffer,g.normal.buffer,g.uv.buffer,g.style.buffer]:[]);
  }catch(error){self.postMessage({type:'error',id:data.id,message:error.message,oversized:!!error.oversized});}
};
