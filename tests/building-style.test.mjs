import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildingStyle,contextLanduse,storefrontEdge,nearestRoadClass,BUILDING_STYLES} from '../src/building-style.js';
import {parseWorld,buildGeometry,height,hasHeightTag,GABLE_RISE,LIMITS} from '../src/world.js';
import {createChunkStream} from '../src/chunks.js';
// Real Overpass response (2026-09-23, OSM base 2026-09-22T08:45:51Z) for the 800 m square Navigator requests around
// Elizabeth Lane, Mebane, NC: 153 buildings, 151 of them bare building=yes from microsoft/BuildingFootprints, no
// height/levels/addr tags, two landuse=residential polygons. © OpenStreetMap contributors, ODbL.
const MEBANE=[-79.3491509,36.099202];
const mebane=()=>parseWorld(JSON.parse(fs.readFileSync(new URL('./fixtures/mebane-800m.json',import.meta.url))),MEBANE);
test('explicit structure wins over neighborhood; commercial and unknown are not offices',()=>{
 assert.equal(buildingStyle({building:'apartments'},{landuse:'industrial'}).kind,2);
 assert.equal(buildingStyle({building:'warehouse'},{landuse:'residential'}).kind,5);
 assert.equal(buildingStyle({building:'commercial'}).kind,0);
 assert.equal(buildingStyle({building:'yes'}).kind,0);
 assert.equal(buildingStyle({building:'yes',office:'government'}).kind,4);
 assert.equal(buildingStyle({building:'yes',amenity:'courthouse'}).kind,6);
 assert.equal(buildingStyle({building:'church'},{landuse:'retail'}).kind,6);
});
test('mixed use preserves residential upper floors and only real shop cues add frontage',()=>{
 const s=buildingStyle({building:'apartments',shop:'bakery','building:levels':'4'},{height:12.8});assert.equal(s.kind,2);assert.ok(s.storefront);assert.equal(s.floorHeight,3.2);
 assert.equal(buildingStyle({building:'apartments',shop:'no'}).storefront,false);
 assert.equal(buildingStyle({building:'yes','building:use':'residential;retail'}).kind,2);
 assert.equal(buildingStyle({building:'industrial',shop:'hardware'}).storefront,false);
});
test('landuse fallback is marked inferred, excludes polygon holes, and never uses city names',()=>{
 assert.equal(buildingStyle({building:'yes'},{landuse:'residential',height:7,area:120}).kind,1);
 assert.equal(buildingStyle({building:'yes'},{landuse:'residential',height:40,area:120}).kind,2);
 assert.equal(buildingStyle({building:'yes'},{landuse:'retail'}).evidence,'landuse inference');
 assert.equal(buildingStyle({building:'yes','addr:city':'Los Angeles'}).kind,0);
 const zones=[{use:'residential',rings:[[[0,0],[100,0],[100,100],[0,100]],[[40,40],[60,40],[60,60],[40,60]]]}];
 assert.equal(contextLanduse(zones,[10,10,20,20]),'residential');assert.equal(contextLanduse(zones,[45,45,55,55]),null);
});
test('shopfront is confined to one street-facing outer edge and packed bytes survive streaming',()=>{
 const b={rings:[[[0,0],[20,0],[20,15],[0,15]]],bounds:[0,0,20,15],height:12.8,style:buildingStyle({building:'apartments',shop:'bakery'}),id:'mixed'};
 const roads=[{points:[[-10,-5],[30,-5]],highway:'residential',width:5}];b.frontEdge=storefrontEdge(b,roads);assert.equal(b.frontEdge,0);assert.equal(storefrontEdge(b,[]),-1);
 const g=buildGeometry({buildings:[b]});assert.ok(g.style instanceof Uint8Array);assert.equal(g.style.length,g.position.length/3*2);
 assert.equal([...g.style].filter((x,i)=>i%2===0&&x===10).length,6);
 const streamed=createChunkStream({buildings:[b],roads}).update(0,0).geometry;assert.deepEqual(streamed.style,g.style);
});
test('real OSM styles survive ingestion instead of defaulting every building to office',()=>{
 const world=parseWorld(JSON.parse(fs.readFileSync(new URL('../public/osm-snapshot.json',import.meta.url))));
 const kinds=new Set(world.buildings.map(b=>b.style.kind));for(const k of [0,2,3,4,5,6])assert.ok(kinds.has(k));
 assert.ok(world.buildings.filter(b=>b.style.kind===4).length<world.buildings.length/4);
});
test('untagged heights: 12 m stays the default except for small footprints in residential context and house-like types',()=>{
 assert.equal(height({building:'yes'}),12);assert.equal(height({building:'yes'},{residential:false,area:100}),12);assert.equal(height({building:'yes'},{residential:true,area:400}),12);
 assert.equal(height({building:'yes'},{residential:true,area:146}),6.5);assert.equal(height({},{residential:true,area:146}),6.5);assert.equal(height({building:'commercial'},{residential:true,area:100}),24);
 assert.ok(Math.abs(height({building:'yes','building:levels':'3'},{residential:true,area:100})-9.6)<1e-9);assert.equal(height({building:'house'}),7);assert.equal(height({building:'detached'}),7);assert.equal(height({building:'garage'}),3);assert.equal(height({building:'bungalow'}),4);
 assert.equal(hasHeightTag({building:'yes'}),false);assert.equal(hasHeightTag({height:'9'}),true);assert.equal(hasHeightTag({'building:levels':'2'}),true);assert.equal(hasHeightTag({height:'tall'}),false);
});
test('a default height no longer makes the residential landuse home rule unreachable; explicit tags still win',()=>{
 const s=buildingStyle({building:'yes'},{landuse:'residential',height:6.5,area:146,heightDefault:true});assert.equal(s.kind,1);assert.equal(s.evidence,'footprint inference');assert.equal(s.floorHeight,2.9);
 assert.equal(buildingStyle({building:'yes'},{landuse:'residential',height:12,area:400,heightDefault:true}).kind,2);
 assert.equal(buildingStyle({building:'yes'},{landuse:'residential',height:7,area:120}).evidence,'landuse inference');
 assert.equal(buildingStyle({building:'yes','building:levels':'4'},{landuse:'residential',height:12.8,area:146,heightDefault:false}).kind,2);
 assert.equal(buildingStyle({building:'warehouse'},{landuse:'residential',height:6.5,area:146,heightDefault:true}).kind,5);
 assert.equal(buildingStyle({building:'house'}).floorHeight,2.9);assert.equal(buildingStyle({building:'apartments'}).floorHeight,3.2);assert.equal(buildingStyle({building:'house','building:levels':'2'},{height:6.4}).floorHeight,3.2);
});
test('road-context fallback needs a small-footprint square, a residential/service street, a small untagged footprint and no commercial cue',()=>{
 const home={landuse:null,height:6.5,area:146,heightDefault:true,nearRoad:'residential',prior:true};
 assert.equal(buildingStyle({building:'yes'},home).kind,1);assert.equal(buildingStyle({building:'yes'},home).evidence,'footprint inference');
 for(const road of ['service','unclassified','living_street'])assert.equal(buildingStyle({building:'yes'},{...home,nearRoad:road}).kind,1);
 for(const road of ['primary','secondary','tertiary','motorway',null])assert.equal(buildingStyle({building:'yes'},{...home,nearRoad:road}).kind,0);
 assert.equal(buildingStyle({building:'yes'},{...home,prior:false}).kind,0);assert.equal(buildingStyle({building:'yes'},{...home,heightDefault:false}).kind,0);assert.equal(buildingStyle({building:'yes'},{...home,area:300}).kind,0);
 assert.equal(buildingStyle({building:'yes'},{...home,landuse:'retail'}).kind,3);assert.equal(buildingStyle({building:'yes',shop:'bakery'},home).kind,3);assert.equal(buildingStyle({building:'yes',office:'yes'},home).kind,4);assert.equal(buildingStyle({building:'yes',amenity:'toilets'},home).kind,0);
 assert.equal(buildingStyle({building:'commercial'},home).kind,0);
 const roads=[{points:[[-100,-30],[100,-30]],highway:'residential',width:14},{points:[[-100,200],[100,200]],highway:'primary',width:14},{points:[[0,-100],[0,100]],highway:'footway',width:2}];
 assert.equal(nearestRoadClass([-5,0,5,10],roads),'residential');assert.equal(nearestRoadClass([-5,150,5,160],roads),'primary');assert.equal(nearestRoadClass([-5,80,5,90],roads),null);assert.equal(nearestRoadClass([-5,0,5,10],roads,20),null);
});
test('the real Mebane square becomes mostly homes while the bundled Los Angeles snapshot is classified exactly as before',()=>{
 const m=mebane();assert.equal(m.buildings.length,153);assert.equal(m.prior,true);
 assert.ok(m.kinds[1]>=120,`homes ${m.kinds[1]}`);assert.equal(m.kinds[4],0);assert.equal(m.kinds[6],5);assert.equal(m.kinds.reduce((a,b)=>a+b,0),153);
 const homes=m.buildings.filter(b=>b.style.kind===1);assert.ok(homes.every(b=>b.height===6.5&&b.style.floorHeight===2.9&&b.style.evidence==='footprint inference'));
 assert.ok(homes.filter(b=>b.frontEdge>=0).length>homes.length*.9,'homes face a street');
 // Every other Mebane style is a tagged church/chapel/place of worship or a larger footprint; nothing is inferred as an office.
 assert.ok(m.buildings.filter(b=>b.style.kind===6).every(b=>b.style.evidence!=='footprint inference'));
 const la=parseWorld(JSON.parse(fs.readFileSync(new URL('../public/osm-snapshot.json',import.meta.url))));
 assert.deepEqual(la.kinds,[47,0,26,28,3,13,5]);assert.equal(la.prior,false);assert.ok(la.buildings.every(b=>b.style.evidence!=='footprint inference'));
 assert.equal(buildGeometry(la,0,0).position.length/3,6903);
});
test('rectangular homes get a gable roof within the vertex estimate; other footprints and styles keep flat roofs',()=>{
 const ring=[[0,0],[14,0],[14,10],[0,10]],home={rings:[ring],bounds:[0,0,14,10],height:6.5,style:{kind:1,floorHeight:2.9,storefront:false},frontEdge:0,id:'h'};
 const g=buildGeometry({buildings:[home]});assert.equal(g.position.length/3,42);
 let top=0;for(let i=2;i<g.position.length;i+=3)top=Math.max(top,g.position[i]);assert.ok(Math.abs(top-(6.5+GABLE_RISE*10))<1e-4,`ridge ${top}`);
 const roofNormals=[];for(let i=0;i<g.normal.length;i+=9)if(g.position[i+2]>6.5||g.position[i+5]>6.5||g.position[i+8]>6.5)roofNormals.push([g.normal[i],g.normal[i+1],g.normal[i+2]]);
 assert.ok(roofNormals.length===6);assert.ok(roofNormals.filter(n=>n[2]>.5).length===4&&roofNormals.filter(n=>Math.abs(n[2])<1e-6).length===2);
 assert.ok(roofNormals.every(n=>Math.abs(Math.hypot(...n)-1)<1e-4));
 // Door edge code 17 (kind 1 + 16) on the six wall vertices of the front edge, never the shopfront code 9.
 assert.equal([...g.style].filter((x,i)=>i%2===0&&x===17).length,6);assert.equal([...g.style].filter((x,i)=>i%2===0&&x===9).length,0);
 for(const other of [{...home,style:{kind:0,floorHeight:3.2}},{...home,style:{kind:2,floorHeight:3.2}},{...home,rings:[[[0,0],[14,0],[14,10],[7,12],[0,10]]]},{...home,rings:[[[0,0],[20,0],[20,15],[0,15]]],bounds:[0,0,20,15]}]){
  const f=buildGeometry({buildings:[other]});let t=0;for(let i=2;i<f.position.length;i+=3)t=Math.max(t,f.position[i]);assert.equal(t,6.5);
 }
 const shop={...home,style:{kind:1,floorHeight:2.9,storefront:true}};assert.equal([...buildGeometry({buildings:[shop]}).style].filter((x,i)=>i%2===0&&x===9).length,6);
 // A square of 160 gabled homes stays far inside the vertex budget.
 const many={buildings:Array.from({length:160},(_,i)=>({...home,rings:[ring.map(p=>[p[0]+(i%16)*20,p[1]+Math.floor(i/16)*20])],bounds:[(i%16)*20,Math.floor(i/16)*20,(i%16)*20+14,Math.floor(i/16)*20+10],id:i}))};
 const all=buildGeometry(many,160,100);assert.equal(all.count,160);assert.ok(all.position.length/3<=160*42&&all.position.length/3<LIMITS.vertices/10);
 const m=mebane();const mg=buildGeometry(m,0,0);assert.ok(mg.position.every(Number.isFinite));assert.ok(mg.position.length/3<LIMITS.vertices);
});
