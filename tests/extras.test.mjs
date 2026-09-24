import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseWorld,parseExtras,parseExtrasRaw,buildSurfaces,nearTrees,EXTRAS} from '../src/world.js';
const pt=(x,y)=>[x/111319.49079327358/Math.cos(34.0510824*Math.PI/180)-118.2462058,y/111319.49079327358+34.0510824];
const poly=(props,pts)=>({id:'w'+Math.random(),properties:props,geometry:{type:'Polygon',coordinates:[[...pts,pts[0]].map(p=>pt(...p))]}});
test('surfaces are classified, planted areas get illustrative trees outside buildings, mapped trees come first',()=>{
 const sq=(x,y,s)=>[[x,y],[x+s,y],[x+s,y+s],[x,y+s]];
 const building={rings:[sq(40,40,30)],bounds:[40,40,70,70]};
 const f=[poly({leisure:'park'},sq(0,0,100)),poly({amenity:'parking'},sq(200,0,40)),poly({amenity:'parking',parking:'underground'},sq(300,0,40)),poly({natural:'water'},sq(0,200,30)),poly({highway:'pedestrian',area:'yes'},sq(100,200,30)),poly({landuse:'forest'},sq(400,400,60)),
  {id:'n1',properties:{natural:'tree',height:'12'},geometry:{type:'Point',coordinates:pt(150,150)}},{id:'r',properties:{natural:'tree_row'},geometry:{type:'LineString',coordinates:[pt(0,300),pt(40,300)]}}];
 const e=parseExtras(f,undefined,[building]);
 assert.deepEqual(e.areas.map(a=>a.code),[1,2,3,4,5]);// underground parking dropped; sorted by code
 assert.equal(e.trees[0][4],1);assert.equal(e.trees[0][2],12);const mapped=e.trees.filter(t=>t[4]).length;assert.ok(mapped>=6&&mapped<=7,`mapped ${mapped}`);
 const park=e.trees.filter(t=>!t[4]&&t[0]<100&&t[1]<100);assert.ok(park.length>20&&park.length<=EXTRAS.perArea);
 assert.ok(park.every(([x,y])=>!(x>=40&&x<=70&&y>=40&&y<=70)),'no illustrative tree inside a building');
 assert.ok(e.trees.every(t=>t.every(Number.isFinite)));
 // Deterministic: the same input places the same trees.
 assert.deepEqual(parseExtras(f,undefined,[building]).trees,e.trees);
 const s=buildSurfaces(e.areas,0,0,300);assert.ok(s.count>=3);assert.equal(s.position.length/3*2,s.style.length);assert.ok(s.position.every(Number.isFinite));
 const zs=new Set();for(let i=2;i<s.position.length;i+=3)zs.add(+s.position[i].toFixed(3));assert.ok([...zs].every(z=>z<0),'surfaces sit below the road plane');
 const near=nearTrees(e.trees,0,0,120,10);assert.equal(near.length,40);
});
test('bundled LA extras parse within budget and roads carry one-way tags',()=>{
 const world=parseWorld(JSON.parse(fs.readFileSync(new URL('../public/osm-snapshot.json',import.meta.url))));
 const t=performance.now(),e=parseExtrasRaw(JSON.parse(fs.readFileSync(new URL('../public/osm-extras.json',import.meta.url))),world.origin,world.buildings);
 assert.ok(e.areas.length>100&&e.areas.length<=EXTRAS.areas);assert.ok(e.trees.filter(t=>t[4]).length>=250);assert.ok(e.trees.length<=EXTRAS.trees);assert.ok(performance.now()-t<500);
 const spring=world.roads.find(r=>r.name==='South Spring Street'&&r.width===14);assert.equal(spring.oneway,true);
 assert.ok(world.roads.some(r=>r.width===14&&r.oneway===false));
});
