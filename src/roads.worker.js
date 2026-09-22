import {openRoadStore} from './road-store.js';
import {RoadCacheEngine} from './road-cache-engine.js';
let engine,latest,paused=false,clearRequested=false;
function position(data){if(engine.saved?.mode==='gps'&&data.mode==='demo'&&!data.force&&!engine.center){postMessage({type:'status',phase:'waiting for location',message:'Your saved road region is kept. Enable GPS or choose Cache this area.'});return;}engine.setPosition(data.point,data.origin,data.mode,data.force);}
self.onmessage=async({data})=>{
 if(data.type==='position'){latest=data;if(engine){try{position(data);}catch(e){postMessage({type:'status',phase:'unavailable',message:e.message});}}}
 if(data.type==='pause'){paused=true;engine?.pause();}
 if(data.type==='resume'){paused=false;engine?.resume();}
 if(data.type==='clear'){clearRequested=true;engine?.pause();if(engine&&!engine.readOnly){await engine.store.clear();postMessage({type:'cleared'});}else if(engine?.readOnly)postMessage({type:'status',phase:'shared cache',message:'Clear roads from the tab managing downloads, or close it and retry here.'});}
};
async function start(readOnly){const store=await openRoadStore();engine=new RoadCacheEngine({store,readOnly,emit:data=>postMessage(data)});await engine.init();if(clearRequested&&!readOnly){await store.clear();postMessage({type:'cleared'});return;}if(paused||navigator.onLine===false)engine.pause();if(latest)position(latest);}
// A browser-managed lock prevents two tabs from installing/evicting the same packages.
if(navigator.locks){navigator.locks.request('navigator-road-packages',{ifAvailable:true},async lock=>{await start(!lock);if(lock)await new Promise(()=>{});}).catch(e=>postMessage({type:'status',phase:'storage unavailable',message:e.message}));}
else postMessage({type:'status',phase:'storage unavailable',message:'This browser cannot coordinate local road downloads safely.'});
