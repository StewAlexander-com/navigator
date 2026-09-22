import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildingStyle,contextLanduse,storefrontEdge} from '../src/building-style.js';
import {parseWorld,buildGeometry} from '../src/world.js';
import {createChunkStream} from '../src/chunks.js';
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
