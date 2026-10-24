import test from 'node:test';
import assert from 'node:assert/strict';
import {BRIDGE,SURFACE,bridgeProfile,bridgePieces,decksAt,standingHeight,underDeck,orientedBox,emitShaped,emitBridge} from '../src/structures.js';
import {buildingShape,buildingStyle} from '../src/building-style.js';
import {parseWorld,buildGeometry,buildImpostors} from '../src/world.js';
const mesh=(fn)=>{const tris=[];fn((a,b,c,n,code)=>tris.push({a,b,c,n,code}));return tris;};
const zs=t=>t.flatMap(x=>[x.a[2],x.b[2],x.c[2]]);
test('bridge decks rise from each end at a gentle grade to the layer clearance, short bridges stay low',()=>{
 const long=bridgeProfile(200),short=bridgeProfile(20),high=bridgeProfile(400,2);
 assert.equal(long(0),0);assert.equal(long(200),0);assert.equal(long(100),BRIDGE.clearance);
 assert.ok(short(10)<1,'a creek bridge stays under a metre');assert.equal(high(200),BRIDGE.clearance*2);
 for(let s=0;s<200;s+=.5)assert.ok(Math.abs(long(s+.5)-long(s))/.5<=BRIDGE.grade*1.5+1e-9,`grade at ${s}`);
});
test('bridge roads become deck pieces of at most 40 m; footbridges count, tunnels and bridge=no do not',()=>{
 const road=(bridge,extra={})=>({points:[[0,0],[120,0]],width:14,bridge,...extra});
 const pieces=bridgePieces([road('yes'),road('no'),road(undefined),road('yes',{tunnel:'yes'}),{...road('viaduct'),width:2,points:[[0,30],[30,30]]}]);
 assert.equal(pieces.filter(p=>p.width===14).length,3);assert.equal(pieces.filter(p=>p.width===2).length,1);
 for(const p of pieces){assert.ok(p.points.at(-1)[3]-p.points[0][3]<=BRIDGE.piece+8);assert.ok(p.bounds[1]<=-7||p.width===2);}
});
test('you climb onto a deck from its end and stay on the road when walking under it',()=>{
 const pieces=bridgePieces([{points:[[0,0],[200,0]],width:14,bridge:'yes'}]);
 assert.equal(decksAt(pieces,100,30).length,0);assert.ok(Math.abs(decksAt(pieces,100,0)[0]-BRIDGE.clearance)<1e-9);
 let z=0;for(let x=-5;x<=100;x+=.5)z=standingHeight(pieces,x,2,z);
 assert.ok(Math.abs(z-BRIDGE.clearance)<1e-9,'on the deck mid-span');
 z=0;for(let y=-30;y<=30;y+=.5)z=standingHeight(pieces,100,y,z);assert.equal(z,0,'crossing under mid-span');
 assert.equal(standingHeight(pieces,100,0,null),BRIDGE.clearance,'arriving on a bridge puts you on it');
 assert.ok(underDeck(pieces,100,0,1,0),'the bridge road strip is hidden');assert.ok(!underDeck(pieces,100,0,0,1),'a road crossing under stays');
 assert.ok(!underDeck(pieces,1,0,1,0),'the ramp foot at ground level stays');
});
test('deck geometry: asphalt top, parapets either side, piers only where the deck is high, nothing below ground',()=>{
 const [p]=bridgePieces([{points:[[0,0],[60,0]],width:10,bridge:'yes'}]).filter(q=>q.height>2);
 const tris=mesh(e=>emitBridge(p,e));
 assert.ok(tris.some(t=>t.code===SURFACE.deck&&t.n[2]===1));assert.ok(tris.some(t=>t.code===SURFACE.concrete&&t.n[2]===0));
 assert.ok(Math.min(...zs(tris))>=0);
 const parapetTop=Math.max(...zs(tris));assert.ok(Math.abs(parapetTop-(p.height+.02+BRIDGE.parapet))<1e-6);
 const far=mesh(e=>emitBridge(p,e,false));assert.ok(far.length<tris.length/2,'the far field drops parapets and piers');
});
test('OSM tags pick a building shape',()=>{
 assert.equal(buildingShape({building:'church'}),'church');assert.equal(buildingShape({building:'cathedral'}),'church');
 assert.equal(buildingShape({building:'yes',amenity:'place_of_worship',religion:'christian'}),'church');
 assert.equal(buildingShape({building:'yes',amenity:'place_of_worship',religion:'muslim'}),'mosque');assert.equal(buildingShape({building:'mosque'}),'mosque');
 assert.equal(buildingShape({building:'yes',amenity:'place_of_worship',religion:'shinto'}),'temple');assert.equal(buildingShape({building:'temple',religion:'hindu'}),null);
 assert.equal(buildingShape({building:'warehouse'}),'industrial');assert.equal(buildingShape({building:'barn'}),'barn');
 assert.equal(buildingShape({building:'silo'}),'silo');assert.equal(buildingShape({building:'storage_tank'}),'tank');
 assert.equal(buildingShape({building:'yes',amenity:'place_of_worship'}),null,'no religion: ordinary civic block');
 assert.equal(buildingShape({building:'yes'}),null);assert.equal(buildingShape({building:'house'}),null);
 assert.deepEqual(Object.keys(buildingStyle({building:'house'})).sort(),['evidence','floorHeight','kind','storefront'],'unshaped styles are unchanged');
 assert.equal(buildingStyle({building:'church',height:'30'}).tagged,true);
});
test('oriented box finds the long axis of a rotated footprint',()=>{
 const a=Math.PI/6,u=[Math.cos(a),Math.sin(a)],v=[-u[1],u[0]],ring=[[-15,-5],[15,-5],[15,5],[-15,5]].map(([x,y])=>[10+u[0]*x+v[0]*y,20+u[1]*x+v[1]*y]);
 const box=orientedBox(ring);assert.ok(Math.abs(box.L-30)<1e-6&&Math.abs(box.W-10)<1e-6);assert.ok(Math.abs(Math.abs(box.u[0]*u[0]+box.u[1]*u[1])-1)<1e-9);
 assert.ok(Math.hypot(box.c[0]-10,box.c[1]-20)<1e-6);
});
const nave=[[0,0],[30,0],[30,12],[0,12]];
const shaped=(shape,extra={})=>({rings:[extra.ring||nave],height:extra.height||12,style:{kind:6,shape,tagged:!!extra.tagged}});
test('a church has a slate gable over a stone nave and a west tower with a spire taller than the ridge',()=>{
 const tris=mesh(e=>assert.ok(emitShaped(shaped('church'),e)));
 const slate=tris.filter(t=>t.code===SURFACE.slate),stone=tris.filter(t=>t.code===SURFACE.stone);
 assert.ok(slate.length&&stone.length);
 const top=Math.max(...zs(slate)),apex=slate.flatMap(t=>[t.a,t.b,t.c]).find(p=>p[2]===top);
 const ridge=Math.max(...zs(slate.filter(t=>t.a[0]>12&&t.b[0]>12&&t.c[0]>12)));
 assert.ok(top>ridge*1.5,`spire ${top.toFixed(1)} m over ridge ${ridge.toFixed(1)} m`);
 assert.ok(apex[0]<10,'the tower stands at the west end');
 assert.ok(slate.some(t=>t.n[2]>.4&&t.n[2]<.8),'a steep roof pitch');
});
test('a mosque has a dome and a minaret; a temple a hipped tile roof with eaves past the walls',()=>{
 const m=mesh(e=>assert.ok(emitShaped(shaped('mosque'),e)));
 const dome=m.filter(t=>t.code===SURFACE.dome);assert.ok(dome.length>40);
 assert.ok(Math.max(...zs(m))>=16,'minaret');
 const t=mesh(e=>assert.ok(emitShaped(shaped('temple'),e)));const tile=t.filter(x=>x.code===SURFACE.tile);
 const xs=tile.flatMap(x=>[x.a[0],x.b[0],x.c[0]]);assert.ok(Math.min(...xs)<0&&Math.max(...xs)>30,'eaves overhang');
 assert.ok(tile.filter(x=>x.n[2]>0&&x.n[2]<.99).length>=6,'four hipped faces');
});
test('warehouses get a shallow metal gable, barns a tall one, silos a cylinder; odd shapes fall back',()=>{
 const w=mesh(e=>assert.ok(emitShaped(shaped('industrial'),e))),b=mesh(e=>assert.ok(emitShaped(shaped('barn'),e)));
 const rise=t=>Math.max(...zs(t.filter(x=>x.code===SURFACE.metal)))-Math.min(...zs(t.filter(x=>x.code===SURFACE.metal)));
 assert.ok(rise(w)<1.5&&rise(b)>4,`warehouse ${rise(w)} barn ${rise(b)}`);
 const round=Array.from({length:12},(_,i)=>[4*Math.cos(i/12*2*Math.PI),4*Math.sin(i/12*2*Math.PI)]);
 const s=mesh(e=>assert.ok(emitShaped(shaped('silo',{ring:round,height:6}),e)));assert.ok(Math.max(...zs(s))>=10&&s.every(t=>t.code===SURFACE.tank));
 const ell=[[0,0],[30,0],[30,10],[10,10],[10,30],[0,30]];assert.equal(emitShaped(shaped('industrial',{ring:ell}),()=>{}),false,'an L-shaped warehouse keeps its extrusion');
 assert.equal(emitShaped({...shaped('church'),hasParts:true},()=>{}),false,'mapped 3D parts win');
});
test('a parsed square draws bridges and shaped buildings near and far',()=>{
 const n=(id,lat,lon)=>({type:'node',id,lat,lon});
 const raw={elements:[n(1,34.05,-118.25),n(2,34.05,-118.2488),{type:'way',id:10,nodes:[1,2],tags:{highway:'primary',bridge:'yes'}},
  n(3,34.0503,-118.2497),n(4,34.0503,-118.2494),n(5,34.0504,-118.2494),n(6,34.0504,-118.2497),{type:'way',id:11,nodes:[3,4,5,6,3],tags:{building:'church'}}]};
 const world=parseWorld(raw,[-118.249,34.0505]);assert.ok(world.bridges.length>=2);
 const near=buildGeometry(world,0,0),codes=new Set([...near.style].filter((_,i)=>i%2===0));
 for(const c of [SURFACE.deck,SURFACE.concrete,SURFACE.stone,SURFACE.slate])assert.ok(codes.has(c),`near code ${c}`);
 assert.equal(near.count,1,'bridges do not use the building count');
 const far=buildImpostors(world),farCodes=new Set([...far.style].filter((_,i)=>i%2===0));assert.ok(farCodes.has(SURFACE.deck)&&farCodes.has(SURFACE.slate));
});
