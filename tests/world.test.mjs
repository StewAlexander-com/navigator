import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseWorld,buildGeometry,height,boundedPosition,LIMITS,toLocal,toLngLat} from '../src/world.js';
const world=parseWorld(JSON.parse(fs.readFileSync(new URL('../public/osm-snapshot.json',import.meta.url))));
test('real OSM snapshot yields finite geometry across exploration boundary',()=>{
 assert.ok(world.buildings.length>10);assert.ok(world.roads.length>10);
 for(const [x,y] of [[0,0],[120,0],[-120,0],[0,120],[0,-120]]){
  const g=buildGeometry(world,x,y);assert.ok(g.count>0);assert.ok(g.position.every(Number.isFinite));assert.ok(g.position.length/3<=LIMITS.vertices);assert.ok(g.count<=LIMITS.buildings);
 }
});
test('overloaded geometry obeys building and vertex limits',()=>{
 const rings=[Array.from({length:1000},(_,i)=>[Math.cos(i*Math.PI/500)*15,Math.sin(i*Math.PI/500)*15])];
 const dense={buildings:Array.from({length:300},(_,i)=>({rings,bounds:[-15,-15,15,15],height:20,id:i}))};
 const g=buildGeometry(dense);assert.ok(g.position.length/3<=LIMITS.vertices);assert.ok(g.count<=LIMITS.buildings);assert.ok(g.simplified>0||g.omitted>0);
});
test('out-of-radius buildings are not submitted',()=>{
 const g=buildGeometry({buildings:[{rings:[[[500,500],[510,500],[510,510],[500,510]]],bounds:[500,500,510,510],height:20}]});assert.equal(g.count,0);assert.equal(g.position.length,0);
});
test('polygon courtyard remains empty in roof triangulation',()=>{
 const g=buildGeometry({buildings:[{rings:[[[-10,-10],[10,-10],[10,10],[-10,10]],[[-3,-3],[-3,3],[3,3],[3,-3]]],bounds:[-10,-10,10,10],height:12}]});
 let area=0;for(let i=0;i<g.position.length;i+=9){if(g.normal[i+2]!==1)continue;const p=g.position;area+=Math.abs((p[i+3]-p[i])*(p[i+7]-p[i+1])-(p[i+6]-p[i])*(p[i+4]-p[i+1]))/2;}assert.equal(area,364);
});
test('heights and movement boundaries are deterministic',()=>{assert.equal(height({height:'100 ft'}),30.48);assert.equal(height({'building:levels':'5'}),16);assert.equal(height({building:'house'}),7);assert.equal(height({height:'99999'}),180);assert.equal(Math.round(Math.hypot(...boundedPosition(1000,1000))),120);const p=toLocal(toLngLat(30,-40));assert.ok(Math.abs(p[0]-30)<1e-6);assert.ok(Math.abs(p[1]+40)<1e-6);});
test('partial Overpass responses fail rather than being shown as complete',()=>{assert.throws(()=>parseWorld({elements:[],remark:'runtime error: timeout'}));});
