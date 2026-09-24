import test from 'node:test';
import assert from 'node:assert/strict';
import {namedAnchors,occluders,visibleLabels,infoRows,fetchInfo} from '../src/building-labels.js';
const box=(id,x,y,w,h,extra={})=>({id,rings:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]],bounds:[x,y,x+w,y+h],height:20,...extra});
test('only named buildings get anchors, on the outside of the chosen wall',()=>{
 const b=[box('way/1',10,-10,20,20,{name:'Hall',info:true,frontEdge:3}),box('way/2',40,-10,10,10)];
 const a=namedAnchors(b,0,0);assert.equal(a.length,1);assert.equal(a[0].name,'Hall');assert.equal(a[0].info,true);
 // Edge 3 runs from (10,10) to (10,-10): the west wall; the anchor sits 0.6 m west of it and faces west.
 assert.ok(Math.abs(a[0].x-9.4)<1e-9&&Math.abs(a[0].y)<1e-9&&a[0].nx<0,JSON.stringify(a[0]));assert.ok(a[0].z>=2.4&&a[0].z<=5);
});
test('visibility: only next to the building (5 m, widened to 7 m), in front, facing, not occluded',()=>{
 const hall=box('way/1',10,-10,20,20,{name:'Hall',frontEdge:3}),other=box('way/2',10,20,20,20,{name:'Annex',frontEdge:3});
 const a=namedAnchors([hall,other],0,0),o=occluders([hall,other],0,0);
 assert.deepEqual(visibleLabels(a,o,{x:6,y:0,heading:90}).map(v=>v.name),['Hall'],'4 m from the wall');
 assert.deepEqual(visibleLabels(a,o,{x:3.5,y:0,heading:90}).map(v=>v.name),['Hall'],'6.5 m: widened to 7 m when nothing is within 5');
 assert.equal(visibleLabels(a,o,{x:0,y:0,heading:90}).length,0,'10 m away: nothing');
 assert.equal(visibleLabels(a,o,{x:6,y:0,heading:270}).length,0,'behind the camera');
 assert.equal(visibleLabels(a,o,{x:6,y:-40,heading:0}).length,0,'far along the street');
 const wall=box('way/9',7,-3,1,6);assert.equal(visibleLabels(namedAnchors([hall],0,0),occluders([hall,wall],0,0),{x:5,y:0,heading:90}).length,0,'occluded');
 // Standing 3 m from both walls: at most two pills, nearest first.
 const near=visibleLabels(a,o,{x:7,y:10,heading:90});assert.ok(near.length<=2);
});
test('info rows join the address, skip generic building types and link safely',()=>{
 const rows=infoRows({'addr:housenumber':'200','addr:street':'North Spring Street',building:'government','building:levels':'28',start_date:'1928',wikipedia:'en:Los Angeles City Hall',website:'javascript:alert(1)',name:'City Hall'});
 assert.deepEqual(rows[0],['Address','200 North Spring Street']);
 assert.ok(rows.some(r=>r[0]==='Building type'&&r[1]==='government'));assert.ok(rows.some(r=>r[0]==='Floors'&&r[1]==='28'));
 assert.equal(rows.find(r=>r[0]==='Website')[2],null,'no non-http links');assert.match(rows.find(r=>r[0]==='Wikipedia')[2],/^https:\/\/en\.wikipedia\.org\/wiki\/Los_Angeles_City_Hall$/);
 assert.equal(infoRows({building:'yes'}).length,0);
});
test('fetchInfo asks the OSM API for exactly that element',async()=>{
 let url;const tags=await fetchInfo('way/123',undefined,async u=>{url=u;return {ok:true,json:async()=>({elements:[{tags:{name:'X'}}]})};});
 assert.equal(url,'https://api.openstreetmap.org/api/0.6/way/123.json');assert.deepEqual(tags,{tags:{name:'X'},url:'https://www.openstreetmap.org/way/123'});
 await assert.rejects(fetchInfo('way/1;drop',undefined,async()=>({})),/Not an OSM element/);
});
