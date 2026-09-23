import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {depthInside,locateBuilding,indoorVerdict,INDOOR} from '../src/indoor.js';
import {parseWorld} from '../src/world.js';
const box=(x0,y0,x1,y1,extra={})=>({rings:[[[x0,y0],[x1,y0],[x1,y1],[x0,y1]]],bounds:[x0,y0,x1,y1],height:6.5,id:`${x0}:${y0}`,name:'',style:{kind:1},...extra});
test('edge depth and footprint lookup, including holes and bounds rejection',()=>{
 const b=box(0,0,20,30);assert.equal(depthInside(b.rings,[10,15]),10);assert.equal(depthInside(b.rings,[2,15]),2);assert.equal(depthInside(b.rings,[10,29]),1);
 const court={...b,rings:[b.rings[0],[[8,12],[12,12],[12,18],[8,18]]]};assert.equal(depthInside(court.rings,[10,10]),2);
 const found=locateBuilding([box(100,100,110,110),b],[10,15]);assert.equal(found.id,'0:0');assert.equal(found.depth,10);assert.equal(found.kind,1);
 assert.equal(locateBuilding([b],[25,15]),null);assert.equal(locateBuilding([court],[10,15]),null);assert.equal(locateBuilding([b],[NaN,1]),null);assert.equal(locateBuilding([],[1,1]),null);
});
test('the verdict is gated on depth relative to accuracy, hidden when moving, and names the building when OSM does',()=>{
 const deep={id:'a',name:'',kind:1,depth:10};
 assert.equal(indoorVerdict(deep,5).level,'likely');assert.equal(indoorVerdict(deep,5).text,'You are probably inside a home');
 assert.equal(indoorVerdict(deep,10).level,'likely');assert.equal(indoorVerdict(deep,25).level,'maybe');assert.equal(indoorVerdict(deep,25).text,'You may be inside a home');
 assert.equal(indoorVerdict(deep,40),null);assert.equal(indoorVerdict(deep,5,27),null);assert.equal(indoorVerdict(deep,5,INDOOR.maxSpeed).level,'likely');assert.equal(indoorVerdict(deep,5,null).level,'likely');
 assert.equal(indoorVerdict(null,5),null);assert.equal(indoorVerdict(deep,NaN),null);assert.equal(indoorVerdict(deep,0),null);
 assert.equal(indoorVerdict({...deep,kind:0},5).text,'You are probably inside a building');assert.equal(indoorVerdict({...deep,kind:6,name:'Lambs Chapel'},5).text,'You are probably inside Lambs Chapel');assert.equal(indoorVerdict({...deep,kind:4},12).text,'You may be inside an office building');
});
test('a real Mebane house: standing at its centre is "probably inside" with a good fix, unknown with a poor one, and a road is outside',()=>{
 const MEBANE=[-79.3491509,36.099202];const world=parseWorld(JSON.parse(fs.readFileSync(new URL('./fixtures/mebane-800m.json',import.meta.url))),MEBANE);
 const house=world.buildings.find(b=>b.id==='way/1179878853');assert.equal(house.style.kind,1);const centre=[(house.bounds[0]+house.bounds[2])/2,(house.bounds[1]+house.bounds[3])/2];
 const located=locateBuilding(world.buildings,centre);assert.equal(located.id,house.id);assert.ok(located.depth>4&&located.depth<7,`depth ${located.depth}`);
 assert.equal(indoorVerdict(located,4).level,'likely');assert.equal(indoorVerdict(located,12).level,'maybe');assert.equal(indoorVerdict(located,40),null);
 assert.equal(locateBuilding(world.buildings,[0,0]),null);
 const chapel=world.buildings.find(b=>b.name==='Lambs Chapel');assert.ok(chapel);assert.equal(chapel.style.kind,6);
 const inChapel=locateBuilding(world.buildings,[(chapel.bounds[0]+chapel.bounds[2])/2,(chapel.bounds[1]+chapel.bounds[3])/2]);assert.ok(inChapel===null||indoorVerdict(inChapel,5).text==='You are probably inside Lambs Chapel');
});
