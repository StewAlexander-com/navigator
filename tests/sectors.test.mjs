import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {parseWorld} from '../src/world.js';
import {createChunkIndex,createChunkStream} from '../src/chunks.js';
import {createSectorLookup,boxDistance,validateSectorGraph} from '../src/sectors.js';
const raw=fs.readFileSync(new URL('../public/osm-snapshot.json',import.meta.url)),world=parseWorld(JSON.parse(raw));
const graph=JSON.parse(fs.readFileSync(new URL('../public/osm-sectors.json',import.meta.url))),hash=createHash('sha256').update(raw).digest('hex');
test('precomputed graph matches source and reconstructs identical chunk memberships',()=>{
 assert.equal(validateSectorGraph(graph,world,hash),true);assert.equal(validateSectorGraph(graph,world,'stale'),false);
 const rawIndex=createChunkIndex(world),prepared=createChunkIndex(world,graph.chunks);assert.equal(rawIndex.size,prepared.size);
 for(const [id,c] of rawIndex){const p=prepared.get(id);assert.deepEqual(p.bounds,c.bounds);assert.deepEqual(p.buildings,c.buildings);assert.deepEqual(p.roads,c.roads);}
 const disconnected=structuredClone(graph);disconnected.sectors.forEach(s=>s.neighbors=[]);assert.equal(validateSectorGraph(disconnected,world,hash),false);
 const incomplete=structuredClone(graph);incomplete.chunks[0].buildingIndices=[];assert.equal(validateSectorGraph(incomplete,world,hash),false);
 const broken=structuredClone(graph);broken.sectors[0].neighbors.push(99999);assert.equal(validateSectorGraph(broken,world,hash),false);
});
test('sector traversal matches radius scan across source envelope, edge crossings and varied radii',()=>{
 const lookup=createSectorLookup(graph),index=createChunkIndex(world),all=[...index.values()];
 let random=17;const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/2**32;};
 const points=graph.sectors.flatMap(s=>s.rings[0].filter((_,i)=>i%5===0));
 for(let i=0;i<200;i++)points.push([graph.bounds[0]-100+next()*(graph.bounds[2]-graph.bounds[0]+200),graph.bounds[1]-100+next()*(graph.bounds[3]-graph.bounds[1]+200)]);
 for(const [x,y] of points)for(const radius of [0,50,192,308]){
  const q=lookup.query(x,y,radius);const actual=(q.chunkIds||[...index.keys()]).filter(id=>boxDistance(index.get(id).bounds,x,y)<=radius).sort();
  const expected=all.filter(c=>boxDistance(c.bounds,x,y)<=radius).map(c=>c.id).sort();assert.deepEqual(actual,expected,`at ${x},${y} r=${radius}`);
 }
});
test('graph streaming preserves active geometry and prefetch output versus radius fallback',()=>{
 const old=createChunkStream(world),next=createChunkStream(world,graph);
 for(const [x,y,h] of [[0,0,38],[60,0,90],[120,0,90],[120,60,0],[0,100,270],[-60,0,180],[0,0,0]]){
  const a=old.update(x,y,h),b=next.update(x,y,h);assert.equal(b.stream.lookupMode,'sector graph');assert.deepEqual(b.stream.activeIds,a.stream.activeIds);assert.deepEqual(b.stream.prefetchIds,a.stream.prefetchIds);assert.deepEqual(b.geometry,a.geometry);assert.deepEqual(b.roads,a.roads);
 }
});
