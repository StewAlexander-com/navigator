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
test('v0.1.23 label point: stays on the current street for any view that sees it, hides only when none of it is ahead',async()=>{
 const {streetSegments,labelPoint,LABEL}=await import('../src/street-label.js');
 // Standing on an east–west street; a crossing north–south street at x = 30.
 const roads=[{name:'Main Street',highway:'residential',width:14,points:[[-100,0],[100,0]]},{name:'Cross Street',highway:'residential',width:14,points:[[30,-100],[30,100]]}];
 const player={x:0,y:0},street=nearestStreet(roads,player),segs=streetSegments(roads,street,player);
 assert.equal(street.name,'Main Street');assert.equal(segs.length,1,'only the current street');
 // Looking along the street, level: 40 m ahead on it.
 let p=labelPoint(segs,{x:0,y:0,heading:90,pitch:0});assert.ok(Math.abs(p[0]-LABEL.ahead)<1e-6&&Math.abs(p[1])<1e-6);
 // Looking down (the old version hid the pill here): the point where the view meets the ground.
 p=labelPoint(segs,{x:0,y:0,heading:90,pitch:-20});assert.ok(Math.abs(p[0]-1.65/Math.tan(20*Math.PI/180))<1e-6&&p[2]<LABEL.lift);
 // Looking up: still on the street ahead.
 assert.ok(labelPoint(segs,{x:0,y:0,heading:90,pitch:4})[0]>30);
 // Turned 60° away: nearest point of the street still ahead of the camera.
 p=labelPoint(segs,{x:0,y:0,heading:30,pitch:0});assert.ok(p&&p[0]*Math.sin(Math.PI/6)+p[1]*Math.cos(Math.PI/6)>=LABEL.minAhead-1e-9&&Math.abs(p[1])<=7,`turned ${p}`);
 // Looking straight across the street you stand on: its far half is in view, so the label sits on it, low and close.
 p=labelPoint(segs,{x:0,y:0,heading:0,pitch:0});assert.ok(p&&p[1]>=LABEL.minAhead-1e-9&&p[1]<=7&&p[2]<1.65,`across ${p}`);
 // Standing 20 m off the street and facing away from it: nothing ahead.
 assert.equal(labelPoint(segs,{x:0,y:20,heading:0,pitch:0}),null);
 // Behind the camera only → null.
 assert.equal(labelPoint([[-100,0,-10,0,7]],{x:0,y:0,heading:90,pitch:0}),null);
 assert.equal(p=labelPoint(segs,{x:0,y:0,heading:90,pitch:0})[2],LABEL.lift);
 assert.equal(labelPoint([], {x:0,y:0,heading:0}),null);
});
