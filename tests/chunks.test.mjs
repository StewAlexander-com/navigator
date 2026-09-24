import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createChunkStream,CHUNKS} from '../src/chunks.js';
import {parseWorld,LIMITS} from '../src/world.js';
const real=parseWorld(JSON.parse(fs.readFileSync(new URL('../public/osm-snapshot.json',import.meta.url))));
function grid(){const buildings=[];for(let x=-6;x<=6;x++)for(let y=-6;y<=6;y++){const a=x*128+30,b=y*128+30;buildings.push({rings:[[[a,b],[a+20,b],[a+20,b+20],[a,b+20]]],bounds:[a,b,a+20,b+20],height:12,id:`${x}:${y}`});}return {buildings,roads:[]};}
test('real OSM walk stays bounded and reuses resident geometry without retransferring it',()=>{
 const cache=createChunkStream(real);let previous;
 for(const [x,y,h] of [[0,0,0],[0,30,0],[0,100,0],[120,100,90],[120,-100,180],[0,0,0]]){
  const r=cache.update(x,y,h);assert.ok(r.stream.resident<=CHUNKS.active+CHUNKS.prefetch);assert.ok(r.stream.active<=CHUNKS.active);assert.ok(r.stream.prefetched<=4);
  if(r.geometry){assert.ok(r.geometry.position.length/3<=LIMITS.vertices);assert.ok(r.geometry.count<=LIMITS.buildings);assert.ok(r.geometry.position.every(Number.isFinite));assert.ok(r.roads.length*6<=18000);}
  const again=cache.update(x,y,h);assert.equal(again.geometry,undefined);assert.equal(again.roads,undefined);assert.equal(again.stream.cacheBytes,r.stream.cacheBytes);previous=r;
 }
 assert.ok(previous.stream.evicted>0);
});
test('prefetch follows direction, promotes on approach, and evicts behind a long path',()=>{
 const stream=createChunkStream(grid());const north=stream.update(0,0,0);assert.ok(north.stream.prefetched>0);for(const id of north.stream.prefetchIds)assert.ok(Number(id.split(':')[1])>=0);
 const south=stream.update(0,0,180);for(const id of south.stream.prefetchIds)assert.ok(Number(id.split(':')[1])<0);assert.ok(south.stream.evicted>0);
 let last;for(let y=0;y>=-500;y-=24)last=stream.update(0,y,180);
 assert.ok(last.stream.promoted>0);assert.ok(last.stream.evicted>0);assert.ok(!last.stream.activeIds.includes('0:0'));assert.ok(last.stream.resident<=28);
});
test('empty selections release prior geometry and a fresh empty world emits an empty replacement',()=>{
 const stream=createChunkStream(grid());stream.update(0,0,0);const empty=stream.update(10000,10000,0);assert.equal(empty.geometry.position.length,0);assert.equal(empty.stream.resident,0);assert.deepEqual(empty.roads,[]);assert.ok(empty.stream.evicted>0);
 assert.equal(createChunkStream({buildings:[],roads:[]}).update(0,0).geometry.position.length,0);
});
test('dense chunks enforce aggregate vertex, building and road budgets',()=>{
 const world=grid();world.buildings=world.buildings.flatMap(b=>Array.from({length:50},(_,i)=>({...b,id:b.id+'/'+i})));world.roads=Array.from({length:2000},(_,i)=>({points:[[i%12,0],[i%12,20]],width:5}));
 const r=createChunkStream(world).update(0,0,45);assert.ok(r.geometry.count<=160);assert.ok(r.geometry.position.length/3<=90000);assert.ok(r.roads.length*6<=14400);assert.ok(r.geometry.omitted>0);
});
test('a large footprint intersecting the radius is considered even if its owning cell lies outside it',()=>{
 const world={buildings:[{rings:[[[100,-20],[900,-20],[900,20],[100,20]]],bounds:[100,-20,900,20],height:10,id:'long'}],roads:[]};const r=createChunkStream(world).update(0,0);assert.equal(r.geometry.count,1);
});
test('Prototype G: near chunks get full extrusion, far chunks silhouettes, with hysteresis and downgrade instead of omission',async()=>{
 const {LOD}=await import('../src/chunks.js');const {simplifyRing,buildImpostors}=await import('../src/world.js');
 const r=createChunkStream(real).update(0,0,38);assert.ok(r.stream.lod.near>0&&r.stream.lod.far>0);assert.ok(r.far.count>0&&r.far.position.length/3<=LOD.farVertices&&r.far.count<=LOD.farBuildings);assert.ok(r.far.position.every(Number.isFinite));
 assert.equal(new Set([...r.stream.activeIds]).size,r.stream.lod.near);
 // Hysteresis: moving just past the near boundary keeps a full chunk; moving past the hysteresis band releases it.
 const one={buildings:[{rings:[[[0,0],[20,0],[20,20],[0,20]]],bounds:[0,0,20,20],height:12,id:'a'}],roads:[]},h=createChunkStream(one);
 assert.equal(h.update(0,-(LOD.near+CHUNKS.margin-1),0).stream.lod.near,1);assert.equal(h.update(0,-(LOD.near+LOD.hysteresis-2),0).stream.lod.near,1);
 const out=h.update(0,-(LOD.near+LOD.hysteresis+2),0);assert.equal(out.stream.lod.near,0);assert.equal(out.stream.lod.far,1);
 assert.equal(h.update(0,-(LOD.near+LOD.hysteresis-2),0).stream.lod.near,0,'re-entry needs the near boundary, not the hysteresis edge');
 // Dense world: chunks over the full-detail budget are downgraded to silhouettes, not dropped.
 const dense={buildings:[],roads:[]};for(let x=-3;x<=2;x++)for(let y=-3;y<=2;y++)for(let i=0;i<20;i++){const a=x*128+4+i*6,b=y*128+4;dense.buildings.push({rings:[[[a,b],[a+5,b],[a+5,b+120],[a,b+120]]],bounds:[a,b,a+5,b+120],height:12,id:`${x}:${y}:${i}`});}
 for(let x=-3;x<=2;x++)for(let y=-3;y<=2;y++){const a=x*128+1,b=y*128+1;dense.buildings.push({rings:[[[a,b],[a+126,b],[a+126,b+126],[a,b+126]]],bounds:[a,b,a+126,b+126],height:3,id:`${x}:${y}:plaza`});}
 const d=createChunkStream(dense).update(0,0,45);assert.ok(d.stream.lod.downgraded>0,JSON.stringify(d.stream.lod));assert.ok(d.far.count>0);assert.ok(d.geometry.count<=LIMITS.buildings);
 // Silhouette geometry: a 40-point circle simplifies to at most 10 corners; walls + roof only.
 const circle=Array.from({length:40},(_,i)=>[Math.cos(i/40*2*Math.PI)*10,Math.sin(i/40*2*Math.PI)*10]);assert.ok(simplifyRing(circle).length<=10);
 const box={buildings:[{rings:[[[0,0],[10,0],[10,10],[0,10]]],bounds:[0,0,10,10],height:9}]};const g=buildImpostors(box);assert.equal(g.position.length/3,4*6+2*3);assert.equal(Math.max(...g.position.filter((_,i)=>i%3===2)),9);
});
