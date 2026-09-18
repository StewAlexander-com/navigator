import {parseWorld, buildGeometry, LIMITS, BBOX, ORIGIN} from './world.js';
import {areaAround} from './sensors.js';
let world;
async function download(url, origin) {
  const response = await fetch(url, {signal: AbortSignal.timeout(35000), credentials: 'omit', referrerPolicy: 'no-referrer'});
  if(!response.ok) throw new Error(`Map service returned ${response.status}.`);
  const reader=response.body.getReader(); let size=0; const chunks=[];
  while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>LIMITS.responseBytes){await reader.cancel();throw Object.assign(new Error('Map response exceeds the 8 MiB limit.'),{oversized:true});}chunks.push(value);}
  const buffer=new Uint8Array(size);let at=0;for(const c of chunks){buffer.set(c,at);at+=c.length;}
  return {parsed:parseWorld(JSON.parse(new TextDecoder().decode(buffer)),origin),size};
}
const overpassUrl=([south,west,north,east])=>'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(`[out:json][timeout:25];(way[building](${south},${west},${north},${east});relation[building](${south},${west},${north},${east});way[highway](${south},${west},${north},${east}););out geom;`);
const osmApiUrl=([south,west,north,east])=>`https://api.openstreetmap.org/api/0.6/map.json?bbox=${west},${south},${east},${north}`;
// Live areas try Overpass, then the OSM API. Both providers reveal the bounding box to that service.
async function downloadLive(bbox, origin) {
  try {return {...await download(overpassUrl(bbox),origin),provider:'Overpass'};}
  catch(error){
    if(error.oversized)throw error;
    return {...await download(osmApiUrl(bbox),origin),provider:'OSM API'};
  }
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
        result = await download(data.url, ORIGIN); result.provider = 'Bundled OSM';
      }
      world = result.parsed; world.bbox = bbox; world.radius = radius; bytes = result.size; provider = result.provider;
    }
    if(!world)throw new Error('Load an area first.');
    const geometry=buildGeometry(world,data.x||0,data.y||0);
    self.postMessage({type:'ready', id:data.id, x:data.x||0, y:data.y||0, geometry, roads:data.type==='load'?world.roads:undefined, origin:world.origin, bbox:world.bbox, radius:world.radius, timestamp:world.timestamp, bytes, provider, ms:performance.now()-start, live:data.live||!!data.center}, [geometry.position.buffer,geometry.normal.buffer,geometry.uv.buffer]);
  }catch(error){self.postMessage({type:'error',id:data.id,message:error.message,oversized:!!error.oversized});}
};
