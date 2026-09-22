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
test('horizontal chevron consumes resolved heading even when travel differs',()=>{
 const p={x:10,y:20,heading:90,travelBearing:0};const arrow=createChevron(p);
 assert.ok(Math.abs(arrow.group.position.x-14.5)<1e-8);assert.equal(arrow.group.position.y,20);assert.equal(arrow.group.position.z,CHEVRON.height);assert.equal(arrow.group.rotation.z,-Math.PI/2);assert.equal(arrow.diagnostics().bearing,90);assert.equal(CHEVRON.height,.75);
 p.heading=0;p.travelBearing=90;arrow.update();assert.equal(arrow.group.position.x,10);assert.equal(arrow.group.position.y,24.5);assert.equal(Math.abs(arrow.group.rotation.z),0);assert.equal(arrow.diagnostics().bearing,0);
 for(const part of arrow.group.children){assert.equal(part.material.depthTest,true);assert.equal(part.rotation.x,0);assert.equal(part.rotation.y,0);}
 assert.equal(arrow.group.children.length,4);assert.ok(arrow.diagnostics().vertices<300);arrow.dispose();
});

test('free-look view placement does not overwrite resolved compass direction',()=>{
 const p={x:0,y:0,heading:90,chevronHeading:180};const arrow=createChevron(p);assert.ok(Math.abs(arrow.group.position.x-4.5)<1e-8);assert.equal(arrow.diagnostics().bearing,180);assert.equal(arrow.group.rotation.z,-Math.PI);
 p.heading=0;arrow.update();assert.equal(arrow.group.position.y,4.5);assert.equal(arrow.diagnostics().bearing,180);p.chevronHeading=null;arrow.update();assert.equal(arrow.diagnostics().bearing,0);arrow.dispose();
});
