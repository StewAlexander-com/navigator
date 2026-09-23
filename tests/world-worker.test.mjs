import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LIMITS,toLngLat} from '../src/world.js';
import {areaAround} from '../src/sensors.js';
// The world worker is plain ES: host it in Node with a stub `self` and a scripted `fetch` to test the live-area
// download rules (session cache, prefetch, Retry-After, dense-square step-down) without a browser.
const snapshot=fs.readFileSync(new URL('../public/osm-snapshot.json',import.meta.url),'utf8');
const messages=[];globalThis.self={postMessage:m=>messages.push(m)};
const fetched=[];let script=()=>({status:200,body:snapshot});
globalThis.fetch=async url=>{fetched.push(String(url));const r=script(String(url),fetched.length);return new Response(r.body??'',{status:r.status,headers:r.headers||{}});};
await import('../src/world.worker.js');
let id=0;
async function send(data){const before=messages.length;const mine=++id;await self.onmessage({data:{...data,id:mine}});return messages.slice(before).find(m=>m.id===mine&&m.type!=='progress');}
const overpass=u=>u.startsWith('https://overpass-api.de/'),osmApi=u=>u.startsWith('https://api.openstreetmap.org/');
const bboxOf=u=>decodeURIComponent(u).match(/way\[building\]\(([^)]+)\)/)[1].split(',').map(Number);
const center=toLngLat(0,3000);
test('a live square is downloaded once per session, reused for any fix it covers, and refreshed only on request',async()=>{
 fetched.length=0;script=()=>({status:200,body:snapshot});
 const first=await send({type:'load',center,radius:LIMITS.area,fix:center});assert.equal(first.type,'ready');assert.equal(first.cached,false);assert.equal(first.provider,'Overpass');assert.equal(first.radius,LIMITS.area);assert.equal(fetched.filter(overpass).length,1);
 const nearby=toLngLat(50,3050);const again=await send({type:'load',center:nearby,radius:LIMITS.area,fix:nearby});assert.equal(again.type,'ready');assert.equal(again.cached,true);assert.deepEqual(again.bbox,first.bbox);assert.equal(fetched.filter(overpass).length,1);
 const fresh=await send({type:'load',center,radius:LIMITS.area,fix:center,fresh:true});assert.equal(fresh.cached,false);assert.equal(fetched.filter(overpass).length,2);assert.equal(self.navigatorSquares().length,1);
 const far=toLngLat(0,3000+LIMITS.area);const beyond=await send({type:'load',center:far,radius:LIMITS.area,fix:far});assert.equal(beyond.cached,false);assert.equal(fetched.filter(overpass).length,3);assert.equal(self.navigatorSquares().length,2);
});
test('a prefetched square ahead of the car is swapped in through the ordinary load without a download',async()=>{
 fetched.length=0;
 const ahead=toLngLat(0,3000+2*LIMITS.area+500),fix=toLngLat(0,3000+2*LIMITS.area+300);
 const p=await send({type:'prefetch',center:ahead,radius:LIMITS.areaMax,fix});assert.equal(p.type,'prefetched');assert.equal(p.radius,LIMITS.areaMax);assert.deepEqual(p.bbox,areaAround(ahead,LIMITS.areaMax));assert.equal(fetched.filter(overpass).length,1);
 const again=await send({type:'prefetch',center:ahead,radius:LIMITS.areaMax,fix});assert.equal(again.cached,true);assert.equal(fetched.filter(overpass).length,1);
 const swap=await send({type:'load',center:fix,radius:LIMITS.area,fix});assert.equal(swap.type,'ready');assert.equal(swap.cached,true);assert.deepEqual(swap.bbox,p.bbox);assert.equal(swap.radius,LIMITS.areaMax);assert.equal(fetched.filter(overpass).length,1);
});
test('the session cache is bounded by count and by source bytes, oldest first',async()=>{
 fetched.length=0;
 for(let i=0;i<LIMITS.squares+2;i++){const c=toLngLat(20000+i*3000,0);await send({type:'load',center:c,radius:LIMITS.area,fix:c});}
 const kept=self.navigatorSquares();assert.ok(kept.length>=2&&kept.length<=LIMITS.squares,`${kept.length}`);assert.ok(kept.reduce((n,s)=>n+s.bytes,0)<=LIMITS.squareBytes);assert.ok(kept.length<LIMITS.squares+2);
 const oldest=toLngLat(20000,0);const reload=await send({type:'load',center:oldest,radius:LIMITS.area,fix:oldest});assert.equal(reload.cached,false);
});
test('a rate limit honours Retry-After and never falls through to the OSM API',async()=>{
 fetched.length=0;script=()=>({status:429,headers:{'retry-after':'45'}});
 const c=toLngLat(-40000,0);const r=await send({type:'load',center:c,radius:LIMITS.area,fix:c});
 assert.equal(r.type,'error');assert.equal(r.retryMs,45000);assert.equal(fetched.length,1);assert.ok(overpass(fetched[0]));assert.equal(fetched.some(osmApi),false);
 script=()=>({status:503,headers:{'retry-after':new Date(Date.now()+90000).toUTCString()}});const dated=await send({type:'load',center:c,radius:LIMITS.area,fix:c});assert.ok(dated.retryMs>85000&&dated.retryMs<=90000,`${dated.retryMs}`);
 script=()=>({status:429});const bare=await send({type:'load',center:c,radius:LIMITS.area,fix:c});assert.equal(bare.retryMs,60000);assert.equal(fetched.some(osmApi),false);
 const pre=await send({type:'prefetch',center:c,radius:LIMITS.area,fix:c});assert.equal(pre.type,'prefetch-error');assert.equal(pre.retryMs,60000);assert.equal(fetched.some(osmApi),false);
});
test('a dense square (504 or Overpass timeout remark) steps down 1,000 → 400 → 250 m on Overpass before any other provider',async()=>{
 fetched.length=0;script=(u,n)=>n===1?{status:504}:{status:200,body:snapshot};
 const c=toLngLat(-60000,0);const r=await send({type:'load',center:c,radius:LIMITS.areaMax,fix:c});assert.equal(r.type,'ready');assert.equal(r.radius,LIMITS.area);assert.equal(r.provider,'Overpass');
 assert.deepEqual(fetched.map(bboxOf),[areaAround(c,LIMITS.areaMax),areaAround(c,LIMITS.area)]);
 fetched.length=0;script=(u,n)=>n<=2?{status:200,body:JSON.stringify({elements:[],remark:'runtime error: Query timed out'})}:{status:200,body:snapshot};
 const d=toLngLat(-80000,0);const t=await send({type:'load',center:d,radius:LIMITS.areaMax,fix:d});assert.equal(t.type,'ready');assert.equal(t.radius,LIMITS.areaFallback);assert.equal(fetched.filter(overpass).length,3);assert.equal(fetched.some(osmApi),false);
 // Only when the smallest Overpass square is still dense does the OSM API get one attempt; other failures keep the original fallback.
 fetched.length=0;script=(u,n)=>osmApi(u)?{status:200,body:snapshot}:{status:504};
 const e=toLngLat(-100000,0);const last=await send({type:'load',center:e,radius:LIMITS.area,fix:e});assert.equal(last.type,'ready');assert.equal(last.provider,'OSM API');assert.equal(fetched.filter(overpass).length,2);assert.equal(fetched.filter(osmApi).length,1);
 fetched.length=0;script=(u,n)=>osmApi(u)?{status:200,body:snapshot}:{status:500};
 const f=toLngLat(-120000,0);const other=await send({type:'load',center:f,radius:LIMITS.area,fix:f});assert.equal(other.provider,'OSM API');assert.equal(fetched.filter(overpass).length,1);
});
test('loads and prefetches report download bytes, the parse phase and the build phase for the progress strip',async()=>{
 fetched.length=0;messages.length=0;script=()=>({status:200,body:snapshot,headers:{'content-length':String(Buffer.byteLength(snapshot))}});
 const c=toLngLat(-140000,0);const r=await send({type:'load',center:c,radius:LIMITS.area,fix:c});assert.equal(r.type,'ready');
 const progress=messages.filter(m=>m.type==='progress'&&m.id===r.id);const phases=progress.map(p=>p.phase);
 assert.ok(progress.length>=3);assert.ok(progress.every(p=>p.task==='load'));
 assert.ok(phases.indexOf('downloading')<phases.indexOf('parsing')&&phases.indexOf('parsing')<phases.indexOf('building'));assert.equal(phases.at(-1),'building');
 const lastDownload=progress.filter(p=>p.phase==='downloading').at(-1);assert.equal(lastDownload.bytes,Buffer.byteLength(snapshot));assert.equal(lastDownload.total,Buffer.byteLength(snapshot));
 for(let i=1;i<progress.length;i++)if(progress[i].phase==='downloading')assert.ok(progress[i].bytes>=progress[i-1].bytes);
 messages.length=0;const ahead=toLngLat(-160000,0);const p=await send({type:'prefetch',center:ahead,radius:LIMITS.area,fix:ahead});assert.equal(p.type,'prefetched');
 const pre=messages.filter(m=>m.type==='progress');assert.ok(pre.length>=2);assert.ok(pre.every(m=>m.task==='prefetch'&&m.id===p.id));assert.equal(pre.some(m=>m.phase==='building'),false);
 // A cache hit reports nothing to download.
 messages.length=0;const hit=await send({type:'load',center:ahead,radius:LIMITS.area,fix:ahead});assert.equal(hit.cached,true);assert.deepEqual(messages.filter(m=>m.type==='progress'&&m.id===hit.id).map(m=>m.phase),['building']);
});
