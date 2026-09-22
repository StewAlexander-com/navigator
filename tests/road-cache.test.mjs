import test from 'node:test';
import assert from 'node:assert/strict';
import {ROAD_CACHE,plan,tile,distance,parsePackage,inside,activeRoads} from '../src/road-packages.js';
import {RoadCacheEngine} from '../src/road-cache-engine.js';
const center=[.05,.05],t=tile(0,1800,900),raw={elements:[{type:'way',id:1,tags:{highway:'residential',name:'Test Street'},geometry:[{lon:.04,lat:.05},{lon:.06,lat:.05}]}]};
class Store{meta=new Map();payload=new Map();settings=new Map();async list(){return [...this.meta.values()];}async get(id){return this.payload.get(id);}async setting(id){return this.settings.get(id);}async save(v){this.settings.set(v.id,structuredClone(v));}async put(m,payload){this.meta.set(m.id,structuredClone(m));this.payload.set(m.id,{id:m.id,...structuredClone(payload)});}async remove(id){this.meta.delete(id);this.payload.delete(id);}async clear(){this.meta.clear();this.payload.clear();this.settings.clear();}}
async function engine(store=new Store(),download=async()=>({raw,bytes:250})){const events=[];const e=new RoadCacheEngine({store,download,delay:0,emit:x=>events.push(x)});e.kick=()=>{};await e.init();e.setPosition(center,center,'demo');e.tiles=[t];return {e,store,events};}
test('25-mile radius and halfway refresh use metres and handle the antimeridian',()=>{
 assert.equal(ROAD_CACHE.radius,25*1609.344);assert.equal(ROAD_CACHE.refreshDistance,ROAD_CACHE.radius/2);
 for(const c of [center,[-118.2462,34.051],[179.99,60],[-179.99,-30]]){const p=plan(c);assert.ok(p.length>0&&p.length<2000);assert.equal(new Set(p.map(t=>t.id)).size,p.length);assert.ok(p.every(t=>t.bbox[1]>=-180&&t.bbox[3]<=180.00001));}
 assert.throws(()=>plan([0,89]),/84/);
});
test('packages retain road names, reject partial results, clip external geometry, and have bounded active output',()=>{
 const roads=parsePackage(raw,t,center);assert.equal(roads[0].name,'Test Street');assert.equal(roads[0].width,14);
 assert.equal(activeRoads(roads,center,center).length,1);
 assert.throws(()=>parsePackage({...raw,remark:'timeout'},t,center),/incomplete/);
 const big={elements:[{...raw.elements[0],geometry:[{lon:-1,lat:.05},{lon:1,lat:.05}]}]};
 for(const r of parsePackage(big,t,center))for(const p of r.points){assert.ok(p[0]>=t.bbox[1]&&p[0]<=t.bbox[3]);assert.ok(distance(p,center)<=ROAD_CACHE.radius);}
});
test('completed areas resume without another request and corrupted stored payloads are rejected',async()=>{
 const {e,store}=await engine();await e.run();assert.equal(store.meta.size,1);assert.ok(store.payload.size);assert.equal(e.status().complete,1);
 let calls=0;const next=await engine(store,async()=>{calls++;return {raw,bytes:250};});await next.e.run();assert.equal(calls,0);
 store.payload.set(t.id,{id:t.id,json:'corrupt'});await next.e.view();assert.equal(store.meta.size,0);assert.equal(store.payload.size,0);
});
test('halfway recentering cancels stale data and eviction deletes disk and memory records',async()=>{
 const {e,store}=await engine();await e.run();const old=[...e.center];e.setPosition([.15,.05],center,'demo');assert.deepEqual(e.center,old);e.setPosition([.3,.05],center,'demo');assert.notDeepEqual(e.center,old);
 e.point=[2,2];await e.purge();assert.equal(e.records.size,0);assert.equal(store.meta.size,0);assert.equal(store.payload.size,0);
 let finish;const pending=await engine(new Store(),()=>new Promise(r=>finish=r));const work=pending.e.run();while(!finish)await new Promise(r=>setTimeout(r,0));pending.e.setPosition([2,2],center,'demo');finish({raw,bytes:250});await work;assert.equal(pending.store.meta.size,0);
});
test('oversized areas split; throttling defers globally; quota leaves installed data intact',async()=>{
 const split=await engine(new Store(),async()=>{throw Object.assign(new Error('dense'),{split:true});});await split.e.run();assert.equal(split.e.tiles.length,4);assert.ok(split.e.tiles.every(x=>x.level===1));
 const retry=await engine(new Store(),async()=>{throw Object.assign(new Error('429'),{retryMs:60000});});await retry.e.run();assert.ok(retry.e.retryAt>Date.now());assert.equal(retry.e.failed.size,0);clearTimeout(retry.e.timer);
 const quota=await engine();quota.e.records.set('retained',{id:'retained',bbox:[.1,.1,.2,.2],bounds:null,bytes:ROAD_CACHE.diskBytes,fetchedAt:Date.now(),full:true});await quota.e.run();assert.equal(quota.e.paused,true);assert.equal(quota.store.payload.size,0);assert.ok(quota.e.records.has('retained'));
});
test('conservative boundary eviction removes packages rather than retaining out-of-range roads',async()=>{
 const {e,store}=await engine();await e.run();const entry=e.records.get(t.id);assert.ok(inside(entry.bounds,center));e.point=[.42,.05];await e.purge();for(const r of e.records.values())if(r.bounds)assert.ok(inside(r.bounds,e.point));
});

test('halfway boundary is exactly 12.5 miles, not 12.5 kilometres',async()=>{
 const {e}=await engine();const origin=[...e.center],degrees=m=>m/(6371008.8*Math.PI/180);
 e.setPosition([origin[0],origin[1]+degrees(ROAD_CACHE.refreshDistance-1)],origin,'demo');assert.deepEqual(e.center,origin);
 e.setPosition([origin[0],origin[1]+degrees(ROAD_CACHE.refreshDistance+1)],origin,'demo');assert.notDeepEqual(e.center,origin);
});
test('compressed local payloads round-trip and corrupt compression is rejected',async()=>{
 const {encodePayload,decodePayload}=await import('../src/road-cache-engine.js');const json=JSON.stringify(Array(100).fill(raw));const p=await encodePayload(json);assert.ok(p.bytes<json.length);assert.equal(await decodePayload(p),json);await assert.rejects(()=>decodePayload({encoding:'gzip',data:new Uint8Array([1,2,3])}));
});

test('a long journey reuses overlap and cannot accumulate out-of-radius road payloads',async()=>{
 const {decodePayload}=await import('../src/road-cache-engine.js');
 const {e,store}=await engine(new Store(),async t=>{const [s,w,n,east]=t.bbox,lat=(s+n)/2;return {bytes:100,raw:{elements:[{type:'way',id:1,tags:{highway:'residential',name:'Journey Street'},geometry:[{lon:w+(east-w)*.3,lat},{lon:w+(east-w)*.7,lat}]}]}};});
 e.tiles=plan(center);let maximum=0;
 for(let step=0;step<10;step++){
  const point=[center[0]+step*.1,center[1]];e.setPosition(point,point,'demo');await e.run();
  for(let n=0;n<200&&e.tiles.some(t=>!e.usable(e.records.get(t.id))&&!e.retired.has(t.id)&&!e.failed.has(t.id));n++)await e.run();
  maximum=Math.max(maximum,e.records.size);assert.ok(e.records.size<120);
  for(const m of await store.list()){const roads=JSON.parse(await decodePayload(await store.get(m.id)));for(const r of roads)for(const p of r.points)assert.ok(distance(p,point)<=ROAD_CACHE.radius+.01);}
 }
 assert.ok(e.evicted>0);assert.ok(maximum>20);
});
test('oversized network bodies are cancelled before parsing',async()=>{
 const {fetchRoadPackage}=await import('../src/road-cache-engine.js');const original=globalThis.fetch;let cancelled=false;
 globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(ROAD_CACHE.responseBytes+1));},cancel(){cancelled=true;}}));
 try{await assert.rejects(()=>fetchRoadPackage(t,new AbortController().signal),e=>e.split);assert.equal(cancelled,true);}finally{globalThis.fetch=original;}
});

test('replanning preserves adaptive subdivisions so completed overlap is reused',async()=>{
 const {children,refinePlan}=await import('../src/road-packages.js');const pieces=children(t),refined=refinePlan([t],pieces,center);assert.deepEqual(refined.map(x=>x.id),pieces.map(x=>x.id));
 const {e}=await engine();e.tiles=pieces;e.setPosition(center,center,'demo',true);assert.ok(e.tiles.some(x=>x.id===pieces[0].id));assert.ok(!e.tiles.some(x=>x.id===t.id));
});
