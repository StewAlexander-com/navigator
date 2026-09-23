import test from 'node:test';
import assert from 'node:assert/strict';
import {LAYOUT,intersects,freeIntervals,place,placedRect,overlapCount} from '../src/layout.js';
const vp={width:400,height:800};const box=(x,y,w,h)=>({x,y,w,h});
test('a pill in free space keeps its designed position; obstacles outside its column do not count',()=>{
 const pill=box(100,300,200,40);
 assert.deepEqual(place(pill,[box(0,0,400,80),box(0,700,400,100)],vp),{y:300,scale:1,moved:false,shrunk:false});
 assert.deepEqual(place(pill,[box(320,290,60,60)],vp),{y:300,scale:1,moved:false,shrunk:false});
 assert.equal(intersects(box(0,0,10,10),box(10,10,5,5)),false);assert.equal(intersects(box(0,0,10,10),box(9,9,5,5)),true);
});
test('a blocked pill moves to the nearest free slot in its column, below or above, and stays inside the viewport',()=>{
 const pill=box(100,300,200,40),block=box(50,290,300,60);
 const down=place(pill,[block],vp);assert.equal(down.moved,true);assert.equal(down.scale,1);assert.equal(down.y,290+60+LAYOUT.gap);
 const up=place(box(100,330,200,40),[box(50,335,300,600),box(50,60,300,270)],vp);assert.equal(up.y,60-LAYOUT.gap-40);
 const tie=place(box(100,300,200,40),[block,box(50,50,300,10)],vp);assert.equal(tie.y,356,'ties move down');
 const stack=place(box(100,300,200,40),[block,box(50,356,300,40)],vp);assert.equal(stack.y,244,'the slot above is nearer than the one below two obstacles');
 assert.deepEqual(freeIntervals(pill,[block],vp),[[LAYOUT.edge,290-LAYOUT.gap],[350+LAYOUT.gap,800-LAYOUT.edge]]);
 const low=place(box(100,790,200,40),[],vp);assert.equal(low.y,800-LAYOUT.edge-40);assert.equal(low.moved,true);
});
test('with no slot tall enough the pill shrinks into the largest gap, centred, never below the minimum scale',()=>{
 const pill=box(100,300,200,40),tight=[box(0,0,400,280),box(0,310,400,490)];
 const p=place(pill,tight,vp);assert.equal(p.shrunk,true);assert.ok(p.scale<1&&p.scale>=LAYOUT.minScale);
 // The 30 px gap leaves 18 px between margins: the pill wants 45 % but the floor is 60 %, centred on the gap.
 assert.equal(p.scale,LAYOUT.minScale);const shown=placedRect(pill,p);assert.equal(shown.h,40*LAYOUT.minScale);assert.ok(Math.abs((shown.y+shown.h/2)-295)<1e-9);
 const roomy=place(pill,[box(0,0,400,200),box(0,240,400,560)],vp);assert.equal(roomy.shrunk,true);assert.ok(Math.abs(roomy.scale-28/40)<1e-9);assert.ok(Math.abs(placedRect(pill,roomy).y-(206+(28-28)/2))<1e-9);
 const hopeless=place(pill,[box(0,0,400,800)],vp);assert.equal(hopeless.scale,LAYOUT.minScale);assert.equal(hopeless.shrunk,true);
 const almost=place(pill,[box(0,0,400,280),box(0,350,400,450)],vp);assert.deepEqual(almost,{y:300,scale:1,moved:false,shrunk:false});
 const squeeze=place(pill,[box(0,0,400,296),box(0,350,400,450)],vp);assert.equal(squeeze.scale,1);assert.equal(squeeze.moved,true);assert.equal(squeeze.y,302);
});
test('overlap count sees every intersecting pair',()=>{
 assert.equal(overlapCount([box(0,0,10,10),box(20,20,10,10),box(40,40,10,10)]),0);
 assert.equal(overlapCount([box(0,0,10,10),box(5,5,10,10),box(8,8,10,10)]),3);
 assert.equal(overlapCount([]),0);
});
