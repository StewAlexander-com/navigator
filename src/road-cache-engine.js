import {ROAD_CACHE,plan,children,query,distance,inside,boxDistance,parsePackage,roadBounds,activeRoads,descendant,refinePlan} from './road-packages.js';
export async function digest(json){if(!globalThis.crypto?.subtle)throw new Error('Secure storage verification is unavailable.');const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json));return Array.from(new Uint8Array(h),x=>x.toString(16).padStart(2,'0')).join('');}
export async function encodePayload(json){
 const bytes=new TextEncoder().encode(json);
 if(bytes.byteLength>16*1024*1024)throw Object.assign(new Error('Decoded road package exceeds 16 MiB.'),{split:true});
 if(typeof CompressionStream!=='undefined'){const data=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();return {encoding:'gzip',data,bytes:data.byteLength};}
 return {encoding:'utf8',data:bytes.buffer,bytes:bytes.byteLength};
}
export async function decodePayload(payload){
 if(typeof payload?.json==='string')return payload.json;
 if(!payload?.data)throw new Error('Missing road payload.');
 let stream=new Blob([payload.data]).stream();if(payload.encoding==='gzip')stream=stream.pipeThrough(new DecompressionStream('gzip'));else if(payload.encoding!=='utf8')throw new Error('Invalid road encoding.');
 const reader=stream.getReader(),parts=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16*1024*1024){await reader.cancel();throw new Error('Decoded road payload is oversized.');}parts.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return new TextDecoder().decode(bytes);
}
export async function fetchRoadPackage(t,signal){
 const response=await fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(query(t)),{signal,headers:{Accept:'application/json'},cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
 if(!response.ok){const retry=response.headers.get('retry-after');throw Object.assign(new Error(`OSM road service returned ${response.status}.`),{split:response.status===504,retryMs:response.status===429||response.status===503?Math.max(30000,Math.min(3600000,(Number(retry)||60)*1000)):null});}
 const reader=response.body.getReader(),parts=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>ROAD_CACHE.responseBytes)throw Object.assign(new Error('OSM road package exceeds 4 MiB.'),{split:true});parts.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}
 const buffer=new Uint8Array(bytes);let offset=0;for(const part of parts){buffer.set(part,offset);offset+=part.length;}
 let raw;try{raw=JSON.parse(new TextDecoder().decode(buffer));}catch{throw new Error('OSM returned invalid road data.');}
 return {raw,bytes};
}
export class RoadCacheEngine{
 constructor({store,emit,download=fetchRoadPackage,now=()=>Date.now(),delay=ROAD_CACHE.minRequestMs,readOnly=false}){Object.assign(this,{store,emit,download,now,delay,readOnly});this.generation=0;this.paused=false;this.running=false;this.records=new Map();this.failed=new Map();this.retries=new Map();this.lastRequest=0;this.retired=new Set();this.message='';this.downloadedBytes=0;this.evicted=0;
  // Decoded, hash-verified segments per in-range package. A package is gunzipped, hashed and parsed once per
  // session, not on every 25 m position update; entries leave the map with their record or when out of range.
  this.parsed=new Map();this.savedPlan=null;}
 async init(){this.records=new Map((await this.store.list()).map(m=>[m.id,m]));this.saved=await this.store.setting('plan');this.retryAt=this.saved?.retryAt||0;this.retries=new Map(this.saved?.retries||[]);this.failed=new Map(this.saved?.failed||[]);}
 setPosition(point,origin,mode,force=false){
 if(!point?.every(Number.isFinite)||!origin?.every(Number.isFinite))return;
 this.positionSerial=(this.positionSerial||0)+1;this.point=[...point];this.origin=[...origin];
 if(!this.center){const old=this.saved;if(old&&old.mode===mode&&distance(old.center,point)<ROAD_CACHE.refreshDistance){this.center=old.center;this.tiles=old.tiles;this.retired=new Set(old.retired||[]);}else{this.center=[...point];this.tiles=refinePlan(plan(point),[...(this.tiles||[]),...this.records.values()],point);}}
 else if(force||this.mode!==mode||distance(this.center,point)>=ROAD_CACHE.refreshDistance){this.center=[...point];this.tiles=refinePlan(plan(point),[...(this.tiles||[]),...this.records.values()],point);this.retired.clear();this.failed.clear();this.retries.clear();this.generation++;this.controller?.abort();}
 this.mode=mode;this.dirty=true;this.kick();
 }
 status(phase){const valid=this.tiles?.filter(t=>this.usable(this.records.get(t.id))).length||0;return {phase,message:this.message,total:this.tiles?.length||0,complete:valid,bytes:[...this.records.values()].reduce((n,r)=>n+r.bytes,0),packages:this.records.size,downloadedBytes:this.downloadedBytes,evicted:this.evicted,radiusMiles:25,refreshMiles:12.5,center:this.center,displacement:this.center&&this.point?distance(this.center,this.point):0,failed:this.failed.size,activeSegments:this.activeCount||0,paused:this.paused};}
 usable(r){return r&&this.now()-r.fetchedAt<ROAD_CACHE.maxAgeMs&&(r.full||r.planKey===JSON.stringify(this.center));}
 // The plan record only reaches IndexedDB when it differs from the last one written; position updates alone do not write.
 async save(){const plan={id:'plan',center:this.center,mode:this.mode,tiles:this.tiles,retired:[...this.retired],retryAt:this.retryAt||0,retries:[...this.retries],failed:[...this.failed]},json=JSON.stringify(plan);if(json===this.savedPlan)return;await this.store.save(plan);this.savedPlan=json;}
 async remove(id,retire=false){await this.store.remove(id);this.records.delete(id);this.parsed.delete(id);if(retire)this.retired.add(id);this.evicted++;}
 async purge(){for(const r of [...this.records.values()]){if(boxDistance(r.bbox,this.point)>ROAD_CACHE.radius||(r.bounds&&JSON.stringify(r.center)!==JSON.stringify(this.point)&&!inside(r.bounds,this.point))){await this.remove(r.id,true);}}}
 async cleanupSuperseded(){for(const r of [...this.records.values()]){const pieces=this.tiles.filter(t=>descendant(t,r));if(pieces.length&&pieces.every(t=>this.usable(this.records.get(t.id))))await this.remove(r.id);}}
 async view(){
  const origin=[...this.origin],point=[...this.point],roads=[];
  const parents=[...this.records.values()].filter(r=>this.tiles.some(t=>descendant(t,r)));
  const inRange=[...this.records.values()].filter(r=>!parents.some(p=>descendant(r,p))&&boxDistance(r.bbox,point)<=ROAD_CACHE.viewRadius).sort((a,b)=>boxDistance(a.bbox,point)-boxDistance(b.bbox,point));
  for(const id of [...this.parsed.keys()])if(!inRange.some(r=>r.id===id))this.parsed.delete(id);
  for(const r of inRange){
   let parsed=this.parsed.get(r.id);
   if(!parsed){try{const payload=await this.store.get(r.id),json=await decodePayload(payload);if(await digest(json)!==r.hash)throw new Error('Road integrity mismatch.');parsed=JSON.parse(json);this.parsed.set(r.id,parsed);}catch{if(!this.readOnly)await this.remove(r.id);continue;}}
   roads.push(...activeRoads(parsed,point,origin));roads.sort((a,b)=>a.viewDistance-b.viewDistance);roads.length=Math.min(roads.length,ROAD_CACHE.activeSegments);
  }
  if(JSON.stringify(origin)===JSON.stringify(this.origin)&&JSON.stringify(point)===JSON.stringify(this.point)){this.activeCount=roads.length;const signature=JSON.stringify({origin,roads});if(signature!==this.viewSignature){this.viewSignature=signature;this.emit({type:'roads',origin,roads});}}
 }
 pause(){this.paused=true;this.generation++;this.controller?.abort();clearTimeout(this.timer);this.emit({type:'status',...this.status('paused')});}
 resume(){this.paused=false;this.message='';this.failed.clear();this.retries.clear();this.kick();}
 kick(){clearTimeout(this.timer);if(!this.running)this.run().catch(error=>{this.message=error.message;this.paused=true;this.emit({type:'status',...this.status('storage unavailable')});});}
 async run(){
  if(this.running||!this.point)return;this.running=true;this.nextWake=0;const serial=this.positionSerial;
  try{
   if(!this.readOnly){await this.purge();await this.save();}await this.view();this.dirty=serial!==this.positionSerial;
   if(this.paused){this.emit({type:'status',...this.status('paused')});return;}
   if(this.readOnly){this.message='Another tab manages road downloads.';this.emit({type:'status',...this.status('shared cache')});return;}
   const pending=this.tiles.filter(t=>!this.usable(this.records.get(t.id))&&!this.retired.has(t.id)&&!this.failed.has(t.id)).sort((a,b)=>boxDistance(a.bbox,this.point)-boxDistance(b.bbox,this.point));
   if(!pending.length){this.emit({type:'status',...this.status(this.failed.size||this.retired.size?'partial coverage':'ready')});return;}
   if(this.now()<this.retryAt){this.emit({type:'status',...this.status('OSM retry pending')});this.nextWake=this.retryAt;return;}
   if(this.now()-this.lastRequest<this.delay){this.nextWake=this.lastRequest+this.delay;return;}
   const t=pending.find(t=>(this.retries.get(t.id)?.at||0)<=this.now());if(!t){this.nextWake=Math.min(...pending.map(t=>this.retries.get(t.id).at));this.emit({type:'status',...this.status('retrying unfinished areas')});return;}
   const generation=this.generation,center=[...this.center];this.controller=new AbortController();const timeout=setTimeout(()=>this.controller.abort(),35000);this.lastRequest=this.now();this.emit({type:'status',...this.status('downloading')});
   try{
    const {raw,bytes}=await this.download(t,this.controller.signal);this.downloadedBytes+=bytes;
    if(this.paused||generation!==this.generation)return;
    const roads=parsePackage(raw,t,this.point),json=JSON.stringify(roads),payload=await encodePayload(json),size=payload.bytes,hash=await digest(json);
    if(this.paused||generation!==this.generation)return;
    // No stale response may restore data beyond the current 25-mile boundary.
    const bounds=roadBounds(roads);if(bounds&&JSON.stringify(this.point)!==JSON.stringify(center)&&!inside(bounds,this.point)){this.retired.add(t.id);return;}
    const total=[...this.records.values()].reduce((n,r)=>n+r.bytes,0)-(this.records.get(t.id)?.bytes||0)+size;
    if(total>ROAD_CACHE.diskBytes){this.message='128 MiB local road budget reached; coverage is incomplete.';this.pause();return;}
    const meta={...t,bounds,center:[...this.point],planKey:JSON.stringify(this.center),full:inside(t.bbox,this.point,ROAD_CACHE.radius*.99),hash,bytes:size,fetchedAt:this.now()};
    await this.store.put(meta,payload);this.records.set(t.id,meta);this.parsed.set(t.id,roads);this.retries.delete(t.id);this.message='';await this.cleanupSuperseded();await this.view();this.emit({type:'status',...this.status('downloading')});
   }catch(error){
    if(this.paused||generation!==this.generation)return;
    this.message=error.message;
    if(error.name==='QuotaExceededError'){this.message='Device storage is full; installed in-range roads are kept.';this.pause();return;}
    if(error.split&&t.level<ROAD_CACHE.maxLevel){this.tiles=this.tiles.filter(x=>x.id!==t.id).concat(children(t).filter(x=>boxDistance(x.bbox,this.center)<=ROAD_CACHE.radius));await this.save();}
    else if(error.retryMs){this.retryAt=this.now()+error.retryMs;}
    else{const count=(this.retries.get(t.id)?.count||0)+1;this.retries.set(t.id,{count,at:this.now()+30000*2**(count-1)});if(count>=3||error.split)this.failed.set(t.id,error.message);}
    await this.save();
    this.emit({type:'status',...this.status('partial coverage')});
   }finally{clearTimeout(timeout);this.controller=null;}
  }finally{this.running=false;if(!this.paused&&!this.readOnly){const pending=this.tiles?.some(t=>!this.usable(this.records.get(t.id))&&!this.retired.has(t.id)&&!this.failed.has(t.id));if(pending||this.dirty){this.timer=setTimeout(()=>this.kick(),Math.max(this.delay,(this.retryAt||0)-this.now(),this.nextWake-this.now()));this.timer.unref?.();}}else if(this.dirty&&!this.paused)this.timer=setTimeout(()=>this.kick(),0);}
 }
}
