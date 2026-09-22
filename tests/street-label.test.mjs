import test from 'node:test';
import assert from 'node:assert/strict';
import {nearestStreet} from '../src/street-label.js';
import {createChunkIndex} from '../src/chunks.js';
const road=(name,y,highway='residential')=>({name,highway,width:6,points:[[-50,y],[50,y]],source:[y,0]});
test('street proximity uses position, retains names through chunks and never invents distant names',()=>{
 const roads=[road('Main Street',0),road('Garden Walk',20,'footway')];
 assert.equal(nearestStreet(roads,{x:0,y:2}).name,'Main Street');
 assert.equal(nearestStreet(roads,{x:0,y:20}).kind,'PATH');
 assert.equal(nearestStreet(roads,{x:0,y:70}),null);
 assert.equal(nearestStreet([road('',0,'path'),road('Other Street',8)],{x:0,y:0}).name,'Path name unavailable');
 const index=createChunkIndex({buildings:[],roads});assert.ok([...index.values()].some(c=>c.roads.some(r=>r.name==='Main Street')));
});
test('intersection hysteresis resists small GPS jitter but switches to a closer street',()=>{
 const roads=[road('First',0),road('Second',10)];const first=nearestStreet(roads,{x:0,y:4});
 assert.equal(nearestStreet(roads,{x:0,y:6},first).name,'First');
 assert.equal(nearestStreet(roads,{x:0,y:9},first).name,'Second');
 assert.equal(nearestStreet(roads,{x:0,y:80},first),null);
});

test('the reported demo position resolves West 2nd Street rather than the closer footway',async()=>{
 const {parseWorld,toLocal}=await import('../src/world.js');const fs=await import('node:fs');
 const world=parseWorld(JSON.parse(fs.readFileSync('public/osm-snapshot.json')));const [x,y]=toLocal([-118.24544,34.05154]);
 const result=nearestStreet(world.roads,{x,y},{key:'unnamed:footway'});
 assert.equal(result.name,'West 2nd Street');assert.equal(result.kind,'STREET');assert.equal(result.insideNamedStreet,true);
});
