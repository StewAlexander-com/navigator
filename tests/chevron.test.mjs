import test from 'node:test';
import assert from 'node:assert/strict';
import {createChevron,updateTravelBearing,CHEVRON} from '../src/chevron.js';
test('travel bearing follows displacement and remains stable without movement',()=>{
 const p={heading:0,travelBearing:null};
 updateTravelBearing(p,0,2);assert.equal(p.travelBearing,0);
 updateTravelBearing(p,2,0);assert.equal(p.travelBearing,90);
 updateTravelBearing(p,0,-2);assert.equal(p.travelBearing,180);
 p.heading=42;updateTravelBearing(p,0,0);assert.equal(p.travelBearing,180);
 updateTravelBearing(p,-2,0);assert.equal(p.travelBearing,270);
});
test('world chevron stays ahead of view while pointing in travel direction',()=>{
 const p={x:10,y:20,heading:90,travelBearing:0};const arrow=createChevron(p);
 assert.ok(Math.abs(arrow.group.position.x-14.5)<1e-8);assert.equal(arrow.group.position.y,20);assert.equal(arrow.group.position.z,CHEVRON.height);assert.equal(Math.abs(arrow.group.rotation.z),0);
 p.heading=0;p.travelBearing=90;arrow.update();assert.equal(arrow.group.position.x,10);assert.equal(arrow.group.position.y,24.5);assert.equal(arrow.group.rotation.z,-Math.PI/2);
 for(const part of arrow.group.children){assert.equal(part.material.depthTest,true);}
 assert.equal(arrow.group.children.length,4);assert.ok(arrow.diagnostics().vertices<300);arrow.dispose();
});
