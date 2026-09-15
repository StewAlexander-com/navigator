import {parseWorld, buildGeometry, LIMITS, BBOX} from './world.js';
let world;
async function download(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(35000), credentials: 'omit', referrerPolicy: 'no-referrer'});
  if(!response.ok) throw new Error(`Map service returned ${response.status}.`);
  const reader=response.body.getReader(); let size=0; const chunks=[];
  while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>LIMITS.responseBytes){await reader.cancel();throw new Error('Map response exceeds the 8 MiB limit.');}chunks.push(value);}
  const buffer=new Uint8Array(size);let at=0;for(const c of chunks){buffer.set(c,at);at+=c.length;}
  return {parsed:parseWorld(JSON.parse(new TextDecoder().decode(buffer))),size};
}
self.onmessage = async ({data}) => {
  const start = performance.now();
  try {
    let bytes, provider;
    if (data.type === 'load') {
      const url = data.live ? 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(`[out:json][timeout:25];(way[building](${BBOX});relation[building](${BBOX});way[highway](${BBOX}););out geom;`) : data.url;
      let result;
      try {result=await download(url);provider=data.live?'Overpass':'Bundled OSM';}
      catch(error){
        if(!data.live)throw error;
        const [south,west,north,east]=BBOX;
        result=await download(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${west},${south},${east},${north}`);provider='OSM API';
      }
      world=result.parsed;bytes=result.size;
    }
    if(!world)throw new Error('Load an area first.');
    const geometry=buildGeometry(world,data.x||0,data.y||0);
    self.postMessage({type:'ready', id:data.id, x:data.x||0, y:data.y||0, geometry, roads:data.type==='load'?world.roads:undefined, timestamp:world.timestamp, bytes, provider, ms:performance.now()-start, live:data.live}, [geometry.position.buffer,geometry.normal.buffer,geometry.uv.buffer]);
  }catch(error){self.postMessage({type:'error',id:data.id,message:error.message});}
};
