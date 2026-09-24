import test from 'node:test';
import assert from 'node:assert/strict';
import {compassHeading,smoothHeading,smoothPosition,headingDelta,evaluateFix,travelCourse,areaAround,areaCovers,edgeRunway,shouldPrefetch,liveSquare,retryDelay,insideBBox,plausibleSpeed,snapDistanceFor,deadReckon,courseWeight,fuseHeading,SENSORS} from '../src/sensors.js';
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
// Straight-road drive through the real gate: v m/s, 1 Hz fixes, fixed accuracy, receiver speed reported.
function drive(v,accuracy,seconds=60,reportSpeed=true){
 let last=null,streak=0,accepted=0,maxJump=0,lastAccepted=null;
 for(let t=0;t<seconds;t++){const [lng,lat]=toLngLat(v*t,0);const fix={lng,lat,accuracy,timestamp:t*1000,speed:reportSpeed?v:null,heading:90};
  const verdict=evaluateFix(last,fix,streak);
  if(verdict.accepted){accepted++;streak=0;if(lastAccepted)maxJump=Math.max(maxJump,v*(t-lastAccepted.t));lastAccepted={t};last=fix;}else if(verdict.reason==='implausible')streak++;
 }
 return {accepted,maxJump};
}
test('plausibility gate scales with the receiver speed at driving pace and is the walking gate otherwise',()=>{
 assert.equal(plausibleSpeed(null),SENSORS.maxSpeed);assert.equal(plausibleSpeed(1.4),SENSORS.maxSpeed);assert.equal(plausibleSpeed(10),SENSORS.maxSpeed);
 assert.equal(plausibleSpeed(27),40.5);
 // 60 mph with a good receiver: every 1 Hz fix is accepted, so no 108 m "recovered" jumps.
 for(const accuracy of [3,5,6])assert.deepEqual(drive(27,accuracy),{accepted:60,maxJump:27});
 // Without a reported speed the original gate still rejects three of four fixes at that pace (documented baseline).
 assert.equal(drive(27,3,60,false).accepted,15);
 // Walking-pace drives are unchanged, and a 400 m jump remains implausible whatever speed is claimed for a 1 s gap.
 assert.deepEqual(drive(1.4,8),{accepted:60,maxJump:1.4});assert.deepEqual(drive(11,5),{accepted:60,maxJump:11});
 const first={lng:ORIGIN[0],lat:ORIGIN[1],accuracy:8,timestamp:1000};const [lng,lat]=toLngLat(0,400);
 assert.equal(evaluateFix(first,{lng,lat,accuracy:8,timestamp:2000,speed:0}).reason,'implausible');
 assert.equal(evaluateFix(first,{lng,lat,accuracy:8,timestamp:2000,speed:27}).reason,'implausible');
});
test('snap threshold grows with speed and fix interval, never below 45 m, and smoothPosition honours it',()=>{
 assert.equal(snapDistanceFor(null,1000),SENSORS.snapDistance);assert.equal(snapDistanceFor(1.4,1000),SENSORS.snapDistance);assert.equal(snapDistanceFor(15,1000),SENSORS.snapDistance);
 assert.equal(snapDistanceFor(27,1000),81);assert.equal(snapDistanceFor(27,2000),162);assert.equal(snapDistanceFor(27,null),81);
 const eased=smoothPosition([0,0],[60,0],1/60,SENSORS.positionTau,81);assert.ok(eased[0]>0&&eased[0]<5,`eased ${eased}`);
 assert.deepEqual(smoothPosition([0,0],[60,0],1/60),[60,0]);
});
test('dead reckoning advances along the course only above walking pace and stops after two seconds',()=>{
 assert.deepEqual(deadReckon([10,20],1.4,0,1),[10,20]);assert.deepEqual(deadReckon([10,20],null,0,1),[10,20]);assert.deepEqual(deadReckon([10,20],27,null,1),[10,20]);
 const [x,y]=deadReckon([0,0],27,0,1);assert.ok(Math.abs(x)<1e-9&&Math.abs(y-27)<1e-9);
 const [ex,ey]=deadReckon([0,0],27,90,.5);assert.ok(Math.abs(ex-13.5)<1e-9&&Math.abs(ey)<1e-9);
 assert.ok(Math.abs(deadReckon([0,0],27,0,5)[1]-27*SENSORS.reckonMaxS)<1e-9);assert.deepEqual(deadReckon([0,0],27,0,-1),[0,0]);
});
test('course fusion is off at walking pace, complete at 7 m/s or with a poor compass while moving, and blends on the circle',()=>{
 assert.equal(courseWeight(null),0);assert.equal(courseWeight(2.9),0);assert.equal(courseWeight(SENSORS.movingSpeed),0);assert.equal(courseWeight(SENSORS.fuseSpeed),1);assert.equal(courseWeight(27),1);
 assert.equal(courseWeight(5),.5);assert.equal(courseWeight(1,40),0);assert.equal(courseWeight(4,40),1);assert.equal(courseWeight(4,10),courseWeight(4));
 assert.equal(fuseHeading(120,90,0),120);near(fuseHeading(120,90,1),90);near(fuseHeading(350,10,.5),0);near(fuseHeading(null,90,.3),90);assert.equal(fuseHeading(120,null,1),120);
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
test('live squares stay 800 m on the fix at walking pace and grow, capped and led along the course, at speed',()=>{
 for(const [speed,course] of [[null,null],[0,90],[1.4,0],[2.9,45],[27,null]]){const s=liveSquare(ORIGIN,speed,course);assert.deepEqual(s.center,ORIGIN);assert.equal(s.radius,speed===27?LIMITS.areaMax:LIMITS.area);}
 assert.equal(liveSquare(ORIGIN,3,0).radius,LIMITS.area);assert.equal(liveSquare(ORIGIN,13,0).radius,700);assert.equal(liveSquare(ORIGIN,23,0).radius,LIMITS.areaMax);
 const north=liveSquare(ORIGIN,27,0),[nx,ny]=toLocal(north.center);assert.ok(Math.abs(nx)<1e-6&&Math.abs(ny-27*LIMITS.areaLeadS)<1e-6,`${nx},${ny}`);
 const east=liveSquare(ORIGIN,10,90,8),[ex,ey]=toLocal(east.center);assert.ok(Math.abs(ex-80)<1e-6&&Math.abs(ey)<1e-6);
 // The square ahead still covers the fix itself with the full view margin.
 assert.ok(areaCovers(...toLocal(ORIGIN,north.center),areaAround(north.center,north.radius),north.center));
});
test('edge runway and prefetch trigger: only above walking pace, eight seconds before the view radius leaves the square',()=>{
 const bbox=areaAround(ORIGIN);
 assert.ok(Math.abs(edgeRunway(0,0,bbox,ORIGIN)-(LIMITS.area-LIMITS.radius))<.2);assert.ok(Math.abs(edgeRunway(0,100,bbox,ORIGIN)-(LIMITS.area-LIMITS.radius-100))<.2);assert.ok(edgeRunway(0,230,bbox,ORIGIN)<0);
 assert.equal(shouldPrefetch(50,null),false);assert.equal(shouldPrefetch(50,1.4),false);assert.equal(shouldPrefetch(50,2.9),false);
 assert.equal(shouldPrefetch(99,3),true);assert.equal(shouldPrefetch(101,3),false);assert.equal(shouldPrefetch(215,27),true);assert.equal(shouldPrefetch(217,27),false);
 // A walker at the edge behaves as before: no prefetch, the ordinary swap at the edge.
 assert.equal(shouldPrefetch(-5,1.4),false);
});
test('live-area retry delay doubles from 30 s to a 5 min cap with ±20 % jitter and never undercuts Retry-After',()=>{
 const mid=()=>.5,low=()=>0,high=()=>1;
 assert.equal(retryDelay(1,0,mid),30000);assert.equal(retryDelay(2,0,mid),60000);assert.equal(retryDelay(3,0,mid),120000);assert.equal(retryDelay(4,0,mid),240000);assert.equal(retryDelay(5,0,mid),300000);assert.equal(retryDelay(9,0,mid),300000);
 assert.equal(retryDelay(1,0,low),24000);assert.equal(retryDelay(1,0,high),36000);assert.equal(retryDelay(0,0,mid),30000);
 assert.equal(retryDelay(1,45000,low),45000);assert.equal(retryDelay(1,45000,high),45000);assert.equal(retryDelay(3,45000,mid),120000);assert.equal(retryDelay(1,NaN,mid),30000);
 for(let i=0;i<50;i++){const d=retryDelay(1);assert.ok(d>=24000&&d<=36000);}
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
test('driving track: timestamp-keyed prediction removes backward steps and lag; walking returns the raw fix',async()=>{
 const {createTrack,SENSORS}=await import('../src/sensors.js');const {simulate}=await import('../scripts/drive-sim.mjs');
 const walk=createTrack();walk.update([1,2],1000,{speed:1.2,course:0,arrival:1200});walk.update([1.5,3],2000,{speed:1.2,course:0,arrival:2300});assert.deepEqual(walk.predict(2800,SENSORS.positionTau),[1.5,3]);
 // Batched delivery: an old fix delivered after a newer one is stale and cannot pull the prediction back.
 const t=createTrack();t.update([0,0],1000,{speed:10,course:0,arrival:1200});t.update([0,10],2000,{speed:10,course:0,arrival:2200});const before=t.predict(2700);
 assert.equal(t.update([0,9],1900,{speed:10,course:0,arrival:2700}).stale,true);assert.deepEqual(t.predict(2700),before);
 // Prediction runs on the receiver clock minus the observed latency: 0.5 s after delivery at 10 m/s is 5 m ahead.
 assert.ok(Math.abs(before[1]-15)<.6,`predicted ${before}`);
 // A real jump beyond 3 × the snap threshold restarts the track at the fix.
 assert.equal(t.update([0,500],3000,{speed:10,course:0,arrival:3200}).reset,true);assert.deepEqual(t.predict(3200),[0,500]);
 t.shift(5,-5);assert.deepEqual(t.predict(3200),[5,495]);
 for(const mph of [20,35,60]){const speed=mph/2.23694,base=simulate({pipeline:'baseline',speed,seed:3}),next=simulate({pipeline:'track',speed,seed:3});
  assert.ok(next.maxBackwardM<.1,`${mph} mph backward ${next.maxBackwardM}`);assert.ok(Math.abs(next.alongBiasM)<Math.abs(base.alongBiasM)/3,`${mph} mph lag ${next.alongBiasM} vs ${base.alongBiasM}`);assert.ok(next.alongRmsM<base.alongRmsM/2);}
});
