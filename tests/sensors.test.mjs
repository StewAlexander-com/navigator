import test from 'node:test';
import assert from 'node:assert/strict';
import {compassHeading,smoothHeading,smoothPosition,headingDelta,evaluateFix,travelCourse,areaAround,areaCovers,insideBBox,SENSORS} from '../src/sensors.js';
import {ORIGIN,BBOX,LIMITS,toLocal,toLngLat,parseWorld} from '../src/world.js';
import fs from 'node:fs';
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(headingDelta(a,b))<tol,`${a} vs ${b}`);
test('compass heading from absolute orientation, flat and upright, with screen rotation',()=>{
 near(compassHeading({alpha:0,beta:0,gamma:0,absolute:true}),0);
 near(compassHeading({alpha:90,beta:0,gamma:0,absolute:true}),270);
 near(compassHeading({alpha:270,beta:0,gamma:0,absolute:true}),90);
 near(compassHeading({alpha:0,beta:90,gamma:0,absolute:true}),0);
 near(compassHeading({alpha:270,beta:90,gamma:0,absolute:true}),90);
 near(compassHeading({alpha:180,beta:70,gamma:0,absolute:true}),180);
 near(compassHeading({alpha:0,beta:0,gamma:0,absolute:true},90),90);
 near(compassHeading({alpha:0,beta:0,gamma:0,absolute:true},270),270);
 near(compassHeading({alpha:12,beta:0,gamma:0,webkitCompassHeading:45}),45);
 near(compassHeading({webkitCompassHeading:350},90),80);
 assert.equal(compassHeading({alpha:40,beta:0,gamma:0,absolute:false}),null);
 assert.equal(compassHeading({alpha:null,beta:null,gamma:null,absolute:true}),null);
});
test('heading smoothing takes the short way round and settles',()=>{
 near(smoothHeading(null,300,0),300);
 let h=350;for(let i=0;i<80;i++)h=smoothHeading(h,10,1/60);near(h,10,.5);
 const step=smoothHeading(350,10,1/60);assert.ok(step>350||step<10);
 assert.ok(Math.abs(headingDelta(350,10)-20)<1e-9&&Math.abs(headingDelta(10,350)+20)<1e-9);
});
test('position easing converges without overshoot and snaps large corrections',()=>{
 let p=[0,0];for(let i=0;i<60;i++)p=smoothPosition(p,[10,0],1/60);assert.ok(p[0]>8&&p[0]<=10);
 assert.deepEqual(smoothPosition([0,0],[100,0],1/60),[100,0]);
 assert.deepEqual(smoothPosition([3,4],[3,4],1/60),[3,4]);
});
test('fix filtering rejects inaccurate, out-of-order and implausible fixes',()=>{
 const first={lng:ORIGIN[0],lat:ORIGIN[1],accuracy:8,timestamp:1000};
 assert.equal(evaluateFix(null,first).accepted,true);
 assert.equal(evaluateFix(null,{...first,accuracy:SENSORS.maxAccuracy+1}).reason,'inaccurate');
 assert.equal(evaluateFix(null,{...first,accuracy:NaN}).reason,'inaccurate');
 assert.equal(evaluateFix(first,{...first,timestamp:900}).reason,'out-of-order');
 const [lng,lat]=toLngLat(0,400);
 assert.equal(evaluateFix(first,{lng,lat,accuracy:8,timestamp:2000}).reason,'implausible');
 assert.equal(evaluateFix(first,{lng,lat,accuracy:8,timestamp:2000},SENSORS.recoverAfter-1).reason,'implausible');
 assert.equal(evaluateFix(first,{lng,lat,accuracy:8,timestamp:2000},SENSORS.recoverAfter).reason,'recovered');
 assert.equal(evaluateFix(first,{lng,lat,accuracy:8,timestamp:1000+SENSORS.staleFixMs}).accepted,true);
 const [lng2,lat2]=toLngLat(0,12);assert.equal(evaluateFix(first,{lng:lng2,lat:lat2,accuracy:8,timestamp:2000}).accepted,true);
});
test('travel course prefers a moving receiver course, else displacement beyond noise',()=>{
 const a={lng:ORIGIN[0],lat:ORIGIN[1],accuracy:5,timestamp:0};
 assert.deepEqual(travelCourse(null,a),{bearing:null,anchor:a});
 const [lng,lat]=toLngLat(1,0);const tiny={lng,lat,accuracy:5,timestamp:1000};
 assert.equal(travelCourse(a,tiny).bearing,null);assert.equal(travelCourse(a,tiny).anchor,a);
 const [lng2,lat2]=toLngLat(6,0);const east={lng:lng2,lat:lat2,accuracy:5,timestamp:2000};
 near(travelCourse(a,east).bearing,90,1e-6);assert.equal(travelCourse(a,east).anchor,east);
 near(travelCourse(a,{...tiny,speed:1.2,heading:200}).bearing,200);
 assert.equal(travelCourse(a,{...tiny,speed:.1,heading:200}).bearing,null);
});
test('GPS areas are 800 m squares that re-anchor before the view radius leaves them',()=>{
 const bbox=areaAround(ORIGIN);
 const [w,s]=toLocal([bbox[1],bbox[0]]),[e,n]=toLocal([bbox[3],bbox[2]]);
 assert.ok(Math.abs(w+LIMITS.area)<.2&&Math.abs(e-LIMITS.area)<.2&&Math.abs(s+LIMITS.area)<.2&&Math.abs(n-LIMITS.area)<.2);
 assert.ok(insideBBox(ORIGIN,bbox));assert.ok(!insideBBox(toLngLat(0,500),bbox));
 assert.ok(areaCovers(0,0,bbox,ORIGIN));assert.ok(areaCovers(LIMITS.area-LIMITS.radius-1,0,bbox,ORIGIN));assert.ok(!areaCovers(LIMITS.area-LIMITS.radius+1,0,bbox,ORIGIN));
 assert.ok(areaCovers(0,0,BBOX,ORIGIN));assert.ok(!areaCovers(0,200,BBOX,ORIGIN));
 const small=areaAround(ORIGIN,LIMITS.areaFallback);assert.ok(small[2]<bbox[2]&&small[0]>bbox[0]);
});
test('parsing with a moved origin shifts local geometry exactly',()=>{
 const raw=JSON.parse(fs.readFileSync(new URL('../public/osm-snapshot.json',import.meta.url)));
 const origin=toLngLat(100,-50);const a=parseWorld(raw),b=parseWorld(raw,origin);
 assert.deepEqual(b.origin,origin);assert.equal(a.buildings.length,b.buildings.length);
 const pa=a.buildings[0].rings[0][0],pb=b.buildings[0].rings[0][0];
 // Sub-millimetre agreement: the two tangent planes differ only through cos(lat) over 50 m.
 assert.ok(Math.abs(pa[0]-100-pb[0])<1e-3&&Math.abs(pa[1]+50-pb[1])<1e-3);
 const back=toLocal(toLngLat(3,-7,origin),origin);assert.ok(Math.abs(back[0]-3)<1e-6&&Math.abs(back[1]+7)<1e-6);
});

test('spring-back takes the shortest arc after multiple full look-around turns',()=>{
 for(const turns of [-10,-3,-1,0,1,3,10]){
  const current=350+360*turns;
  assert.equal(headingDelta(current,10),20);
  assert.equal(headingDelta(10,current),-20);
  const next=smoothHeading(current,10,.016);
  assert.ok(next>350&&next<360);
 }
});
