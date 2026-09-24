// Drive simulation: the render-loop position pipeline against a synthetic receiver with realistic delivery.
// Truth drives a straight road (then a 90° turn) at `speed`; fixes carry ±σ noise, 100–400 ms latency, ±150 ms
// arrival jitter and occasional batched delivery (a 1 s stall, then two fixes together). Reports camera glitches:
// frames moving backwards along the road, the worst single-frame jump, and the along/cross-track error to truth.
import {SENSORS,smoothPosition,deadReckon,snapDistanceFor,evaluateFix,createTrack} from '../src/sensors.js';
const FRAME=1000/60;
function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function gauss(r){return Math.sqrt(-2*Math.log(1-r()))*Math.cos(2*Math.PI*r());}
function truthAt(t,speed){const turn=30;// seconds straight north, then east
 if(t<=turn)return {p:[0,speed*t],course:0};return {p:[speed*(t-turn),speed*turn],course:90};}
export function simulate({pipeline,speed,seconds=60,sigma=2.5,seed=1,speedless=false}){
 const r=rng(seed),M=111319.49079327358,fixes=[];
 // Receiver fixes at 1 Hz (receiver clock); each delivered after latency+jitter; 8 % stall 1 s and arrive with the next.
 let stallUntil=-1;
 for(let k=1;k<=seconds;k++){const t=k*1000,tr=truthAt(t/1000,speed);let arrive=t+100+r()*300+(r()-.5)*300;
  if(r()<.08)stallUntil=arrive+1000;if(arrive<stallUntil)arrive=stallUntil+r()*40;
  fixes.push({t,arrive,x:tr.p[0]+gauss(r)*sigma,y:tr.p[1]+gauss(r)*sigma,speed:speedless?null:speed+gauss(r)*.2,course:speedless?null:tr.course+gauss(r)*2,accuracy:5});}
 fixes.sort((a,b)=>a.arrive-b.arrive);
 const toFix=f=>({lng:f.x/M,lat:f.y/M,accuracy:f.accuracy,timestamp:f.t,speed:f.speed,heading:f.course});
 let player=null,prev=null,last=null,fixAt=0,interval=null,course=null,spd=null,track=createTrack(),i=0,rejected=0;
 let backward=0,maxJump=0,maxBack=0,errs=[],cross=[];let lastPos=null;
 for(let now=1000;now<seconds*1000+500;now+=FRAME){
  while(i<fixes.length&&fixes[i].arrive<=now){const f=fixes[i++],fx=toFix(f),v=evaluateFix(prev,fx,0);
   if(!v.accepted){rejected++;continue;}
   if(prev)interval=fx.timestamp-prev.timestamp;prev=fx;last=f;fixAt=now;spd=f.speed;course=f.course;
   track.update([f.x,f.y],f.t,{speed:f.speed,course:f.course,arrival:now,snap:snapDistanceFor(spd,interval)});
   if(!player)player=[f.x,f.y];}
  if(!player)continue;
  let aim;
  if(pipeline==='baseline')aim=deadReckon([last.x,last.y],spd,course,(now-fixAt)/1000);
  else aim=track.predict(now,SENSORS.positionTau);
  player=smoothPosition(player,aim,FRAME/1000,SENSORS.positionTau,snapDistanceFor(spd,interval));
  const tr=truthAt(now/1000,speed),dir=tr.course===0?[0,1]:[1,0];
  if(lastPos){const dx=player[0]-lastPos[0],dy=player[1]-lastPos[1],along=dx*dir[0]+dy*dir[1];const jump=Math.hypot(dx,dy)-speed*FRAME/1000;
   if(along<-0.01){backward++;maxBack=Math.max(maxBack,-along);}maxJump=Math.max(maxJump,jump);}
  lastPos=player;const e=[player[0]-tr.p[0],player[1]-tr.p[1]];if(Math.abs(now/1000-30)>4){errs.push(e[0]*dir[0]+e[1]*dir[1]);cross.push(Math.abs(e[0]*dir[1]-e[1]*dir[0]));}
 }
 const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,rms=a=>Math.sqrt(mean(a.map(v=>v*v))),p95=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length*.95)];
 return {pipeline,speedMph:+(speed*2.23694).toFixed(0),rejected,backwardFrames:backward,maxBackwardM:+maxBack.toFixed(2),maxExtraJumpM:+maxJump.toFixed(2),alongBiasM:+mean(errs).toFixed(2),alongRmsM:+rms(errs).toFixed(2),crossP95M:+p95(cross).toFixed(2)};
}
if(import.meta.url===`file://${process.argv[1]}`){
 const rows=[];for(const mph of [10,20,25,35,45,60])for(const pipeline of ['baseline','track']){const speed=mph/2.23694;const runs=[1,2,3,4,5].map(seed=>simulate({pipeline,speed,seed}));
  const agg=k=>+(runs.reduce((s,r)=>s+r[k],0)/runs.length).toFixed(2),max=k=>Math.max(...runs.map(r=>r[k]));
  rows.push({mph,pipeline,backwardFrames:agg('backwardFrames'),maxBackwardM:max('maxBackwardM'),maxExtraJumpM:max('maxExtraJumpM'),alongBiasM:agg('alongBiasM'),alongRmsM:agg('alongRmsM'),crossP95M:agg('crossP95M'),rejected:agg('rejected')});}
 console.table(rows);
}
