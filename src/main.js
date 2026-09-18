import * as maplibregl from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {createWorldLayer} from './renderer.js';
import {updateTravelBearing} from './chevron.js';
import {createPositioning} from './positioning.js';
import {smoothHeading, smoothPosition, headingDelta, areaCovers, SENSORS} from './sensors.js';
import {ORIGIN, BBOX, LIMITS, toLngLat, toLocal, boundedPosition} from './world.js';
import './style.css';

const $=id=>document.getElementById(id);
maplibregl.setWorkerUrl(mapWorkerUrl);
maplibregl.setWorkerCount(1);
const player={x:0,y:0,heading:38,pitch:0,travelBearing:null};
// The loaded OSM area. `origin` is the local metre frame; GPS re-anchors it when the view radius leaves `bbox`.
const area={origin:ORIGIN,bbox:BBOX,live:false,radius:null,provider:'Bundled OSM'};
// GPS target pose. The render loop eases the player toward `target`; `rawHeading` is the latest compass reading.
const gps={target:null,rawHeading:null,failedAt:-Infinity};
const metrics={renderedFrames:0,drawCalls:0,vertices:0,triangles:0,buildings:0,geometryBytes:0,roadVertices:0,frameMs:null,fps:null,queryMs:null,responseBytes:null};
const keys=new Set();let ready=false,worldLayer,roads=[],busy=false,lastBuild=[0,0],requestId=0,frameId=0,lastTime=0,uiTime=0,noticeTimer,drag=null,offlineReady=false;
const worker=new Worker(new URL('./world.worker.js',import.meta.url),{type:'module'});
const started=performance.now();
function notice(message,timeout=0){clearTimeout(noticeTimer);$('notice').textContent=message;if(timeout)noticeTimer=setTimeout(()=>{$('notice').textContent='';},timeout);}
// `live` refreshes the fixed LA box; `center` downloads a square around a GPS fix; neither → bundled snapshot.
function request({live=false,center=null,radius=null}={}){if(busy)return false;busy=true;$('refresh').disabled=true;worker.postMessage({type:'load',id:++requestId,url:new URL('osm-snapshot.json',document.baseURI).href,live,center,radius,x:center?0:player.x,y:center?0:player.y});if(center)notice('Downloading the OpenStreetMap area around you…');else if(live)notice('Refreshing this area from OpenStreetMap…');return true;}
const map=new maplibregl.Map({container:'map',style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#b0bfc9'}}]},center:ORIGIN,zoom:18,pitch:90,maxPitch:95,centerClampedToGround:false,interactive:false,attributionControl:false,pixelRatio:Math.min(devicePixelRatio,1.5),maxTileCacheSize:16,renderWorldCopies:false,canvasContextAttributes:{antialias:false,preserveDrawingBuffer:false}});
function fitView(){map.setVerticalFieldOfView(innerWidth<700?65:45);if(ready)camera();}
fitView();addEventListener('resize',fitView);
map.on('load',()=>{worldLayer=createWorldLayer(player,metrics);map.addLayer(worldLayer);camera();request();});
map.on('error',e=>{console.error(e.error);notice('The 3D view encountered an error. Reload to try again.');});
map.getCanvas().addEventListener('webglcontextlost',e=>{e.preventDefault();stop();notice('Graphics context lost. Reload the page to restore this area.');});
function camera(){const h=player.heading*Math.PI/180,eye=toLngLat(player.x,player.y,area.origin),ahead=toLngLat(player.x+Math.sin(h)*20,player.y+Math.cos(h)*20,area.origin);map.jumpTo(map.calculateCameraOptionsFromTo(eye,1.65,ahead,1.65+Math.tan(player.pitch*Math.PI/180)*20));}
const positioning=createPositioning({
 onFix(fix,course){
  gps.target=toLocal([fix.lng,fix.lat],area.origin);
  if(course!==null)player.travelBearing=course;
  if(positioning.state.fixes.accepted===1){[player.x,player.y]=gps.target;camera();notice(`Location found (±${Math.round(fix.accuracy)} m). ${positioning.state.compass==='on'?'Turn to look around.':'Drag to look around.'}`,6000);}
  ensureAreaCovers(fix);start();
 },
 onHeading(){gps.rawHeading=positioning.state.rawHeading;if(Math.abs(headingDelta(player.heading,gps.rawHeading))>SENSORS.idleHeading)start();},
 onError(kind){notice(kind==='denied'?'Location permission was denied. Manual exploration continues.':kind==='unavailable'?'Location is unavailable right now. Waiting for a fix…':'No location fix yet. Move to open sky or wait.',6000);},
 onState:applyMode
});
// Download a new square when the 180 m view radius would leave the loaded data. The bundled LA snapshot is preferred when it covers the fix.
function ensureAreaCovers(fix){
 const [x,y]=toLocal([fix.lng,fix.lat],area.origin);
 if(areaCovers(x,y,area.bbox,area.origin))return;
 if(busy||performance.now()-gps.failedAt<SENSORS.reanchorRetryMs)return;
 const [bx,by]=toLocal([fix.lng,fix.lat],ORIGIN);
 if(areaCovers(bx,by,BBOX,ORIGIN))request();else request({center:[fix.lng,fix.lat]});
}
function reanchor(origin,bbox){
 const ll=toLngLat(player.x,player.y,area.origin);
 const targetLL=gps.target?toLngLat(...gps.target,area.origin):null;
 area.origin=origin;area.bbox=bbox;
 [player.x,player.y]=toLocal(ll,origin);if(targetLL)gps.target=toLocal(targetLL,origin);
 worldLayer.setOrigin(origin);
}
worker.onmessage=({data})=>{
 if(data.id!==requestId)return;busy=false;$('refresh').disabled=false;
 if(data.type==='error'){gps.failedAt=performance.now();notice(ready?(data.oversized?'This area is too dense for the 8 MiB cap. Nearby streets stay empty beyond the loaded data.':'Area download unavailable. Your current area is still usable.'):'Could not load the bundled area. Reload when online.');$('refresh-info').textContent=data.message;return;}
 if(data.roads){
  if(data.origin.join()!==area.origin.join()||data.bbox.join()!==area.bbox.join())reanchor(data.origin,data.bbox);
  area.live=data.live;area.radius=data.radius;area.provider=data.provider;roads=data.roads;worldLayer.setRoads(roads);metrics.responseBytes=data.bytes;
  $('area-name').textContent=data.radius?'Live area around you':'Downtown Los Angeles';
  $('data-state').textContent=`${data.live?'Live '+data.provider:'Bundled OSM'} · ${data.timestamp?data.timestamp.slice(0,10):data.radius?'this session':'fixed LA area'}${data.radius?` · ${data.radius*2} m square`:''}`;
 }
 worldLayer.setBuildings(data.geometry);lastBuild=[data.x,data.y];
 if(Math.hypot(player.x-data.x,player.y-data.y)>12){busy=true;worker.postMessage({type:'rebuild',id:++requestId,x:player.x,y:player.y});}
 metrics.queryMs=data.ms;
 if(!ready){metrics.firstViewMs=performance.now()-started;ready=true;notice('Drag to look. Use the arrows or W A S D to explore, or enable your location.',7000);}
 else if(data.roads)notice(data.radius?`OpenStreetMap area loaded around you (${data.provider}).`:'OpenStreetMap area refreshed for this session.',5000);
 updateUI();drawMini();camera();if(positioning.state.mode==='gps')start();
};
worker.onerror=()=>{busy=false;$('refresh').disabled=false;notice('Map processing failed. Reload to restart the worker.');};
function drawMini(){
 const c=$('minimap').getContext('2d'),size=240,scale=.65;c.clearRect(0,0,size,size);c.fillStyle='#b9c3c8';c.fillRect(0,0,size,size);c.save();c.translate(120,120);c.scale(scale,-scale);c.translate(-player.x,-player.y);
 c.strokeStyle='#edf1f2';c.lineCap='round';c.lineJoin='round';for(const road of roads){c.lineWidth=road.width; c.beginPath();road.points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke();}
 if(gps.target&&positioning.state.mode==='gps'){c.fillStyle='#2b8fa326';c.strokeStyle='#2b8fa3';c.lineWidth=1.5;c.beginPath();c.arc(gps.target[0],gps.target[1],Math.max(positioning.state.accuracy||0,1.5),0,Math.PI*2);c.fill();c.stroke();}
 c.restore();
 c.save();c.translate(120,120);c.rotate(player.heading*Math.PI/180);c.fillStyle='#45dbdd44';c.beginPath();c.moveTo(0,0);c.arc(0,0,38,-Math.PI*.7,-Math.PI*.3);c.closePath();c.fill();c.fillStyle='#075963';c.strokeStyle='#8afff5';c.lineWidth=2;c.beginPath();c.moveTo(0,-13);c.lineTo(8,10);c.lineTo(0,6);c.lineTo(-8,10);c.closePath();c.fill();c.stroke();c.restore();
}
function applyMode(){
 const s=positioning.state,live=s.mode==='gps',compass=live&&s.compass==='on';
 document.body.dataset.mode=s.mode;document.body.dataset.heading=compass?'compass':'manual';
 $('gps').classList.toggle('on',live);$('gps').setAttribute('aria-pressed',String(live));$('gps-label').textContent=live?(s.position==='on'?`Live GPS · ±${Math.round(s.accuracy)} m`:s.position==='paused'?'GPS paused':'Waiting for GPS…'):'Use my location';
 $('gps-toggle').textContent=live?'Stop using my location':'Use my location';
 $('position-label').textContent=live?(s.position==='on'?`GPS POSITION · ±${Math.round(s.accuracy)} m`:'GPS POSITION · WAITING FOR FIX'):'VIRTUAL POSITION · GPS OFF';
 $('heading-source').textContent=compass?(s.compassAccuracy!==null?`COMPASS ±${Math.round(s.compassAccuracy)}°`:'COMPASS'):live?({waiting:'COMPASS…',denied:'COMPASS DENIED',unavailable:'NO COMPASS',paused:'PAUSED'}[s.compass]||'MANUAL LOOK'):'MANUAL';
 $('reset').title=live?'Snap to the latest GPS fix':'Return to starting point';$('reset-label').textContent=live?'Snap':'Recenter';
 if(live&&!compass&&s.compass!=='waiting'&&!applyMode.warned){applyMode.warned=true;notice(s.compass==='denied'?'Motion & orientation access was denied. Drag or use the turn buttons to look around.':s.compass==='unavailable'?'No absolute compass is available here. Drag or use the turn buttons to look around.':'',6000);}
 if(!live)applyMode.warned=false;
 updateUI();
}
function updateUI(){const h=(player.heading%360+360)%360;const [lng,lat]=toLngLat(player.x,player.y,area.origin),s=positioning.state;$('heading').textContent=String(Math.round(h)%360).padStart(3,'0')+'°';$('cardinal').textContent=['N','NE','E','SE','S','SW','W','NW'][Math.round(h/45)%8];$('coordinates').textContent=`${Math.abs(lat).toFixed(5)}° ${lat<0?'S':'N'}  ${Math.abs(lng).toFixed(5)}° ${lng<0?'W':'E'}`;$('fps').textContent=metrics.fps?`${metrics.fps.toFixed(0)} fps`:'idle';
 const entries=[['Frame interval',metrics.frameMs?`${metrics.frameMs.toFixed(1)} ms`:'Move to measure'],['World draw calls',`${metrics.drawCalls} / 7`],['Building vertices',`${metrics.vertices.toLocaleString()} / 90,000`],['Road vertices',`${metrics.roadVertices.toLocaleString()} / 18,000`],['Loaded buildings',`${metrics.buildings} / 160`],['Geometry buffers',`${(metrics.geometryBytes/1048576).toFixed(2)} MiB`],['Fetch + worker processing',metrics.queryMs?`${metrics.queryMs.toFixed(0)} ms`:'—'],['OSM response',metrics.responseBytes?`${(metrics.responseBytes/1048576).toFixed(2)} MiB`:'—'],['Loaded area',area.radius?`${area.radius*2} m square · ${area.provider}`:'Fixed LA box · '+area.provider],['JS heap',performance.memory?`${(performance.memory.usedJSHeapSize/1048576).toFixed(1)} MiB`:'Unavailable'],['GPU memory','Unavailable'],
  ['GPS accuracy',s.mode!=='gps'?'Sensors off':s.accuracy!==null?`±${s.accuracy.toFixed(0)} m · ${s.fixes.accepted} used / ${s.fixes.rejected} rejected${s.fixes.lastReason&&s.fixes.lastReason!=='ok'?' ('+s.fixes.lastReason+')':''}`:'Waiting for fix'],['Fix interval',s.fixIntervalMs?`${s.fixIntervalMs.toFixed(0)} ms`:'—'],['Compass',s.mode!=='gps'?'Off':s.compass==='on'?(s.compassAccuracy!==null?`±${s.compassAccuracy.toFixed(0)}° · ${s.headingEvents} events`:`${s.headingEvents} events · accuracy not reported`):s.compass]];
 $('measurements').replaceChildren(...entries.flatMap(([label,value])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;return[dt,dd];}));}
function loop(now){frameId=0;if(!ready||document.hidden)return;const dt=Math.min((now-lastTime)/1000,.05);const interval=now-lastTime;lastTime=now;
 if(interval>0&&interval<200){metrics.frameMs=metrics.frameMs?metrics.frameMs*.9+interval*.1:interval;metrics.fps=1000/metrics.frameMs;}
 const live=positioning.state.mode==='gps',compass=live&&positioning.state.compass==='on'&&gps.rawHeading!==null;
 if(compass)player.heading=smoothHeading(player.heading,gps.rawHeading,dt);
 else player.heading+=(Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')))*65*dt;
 player.pitch=Math.max(-20,Math.min(4,player.pitch+(Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown')))*25*dt));
 let settled=true;
 if(live){
  if(gps.target){[player.x,player.y]=smoothPosition([player.x,player.y],gps.target,dt);settled=Math.hypot(gps.target[0]-player.x,gps.target[1]-player.y)<SENSORS.idlePosition;}
  if(compass&&Math.abs(headingDelta(player.heading,gps.rawHeading))>SENSORS.idleHeading)settled=false;
 }else{
  let f=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),s=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));const length=Math.hypot(f,s);if(length>1){f/=length;s/=length;}
  const h=player.heading*Math.PI/180,nx=player.x+(Math.sin(h)*f+Math.cos(h)*s)*3*dt,ny=player.y+(Math.cos(h)*f-Math.sin(h)*s)*3*dt;
  const oldX=player.x,oldY=player.y;
  [player.x,player.y]=boundedPosition(nx,ny);updateTravelBearing(player,player.x-oldX,player.y-oldY);if(Math.hypot(nx,ny)>LIMITS.movement)notice('Edge of this prototype area. Turn back or recenter.',2000);
 }
 camera();
 if(!busy&&Math.hypot(player.x-lastBuild[0],player.y-lastBuild[1])>12){busy=true;worker.postMessage({type:'rebuild',id:++requestId,x:player.x,y:player.y});}
 if(now-uiTime>200){updateUI();drawMini();uiTime=now;}
 if(keys.size||!settled)frameId=requestAnimationFrame(loop);else{metrics.fps=null;updateUI();drawMini();}
}
function start(){if(!frameId&&ready){lastTime=performance.now();frameId=requestAnimationFrame(loop);}}
function stop(){keys.clear();if(frameId)cancelAnimationFrame(frameId);frameId=0;document.querySelectorAll('.controls button').forEach(b=>b.classList.remove('active'));metrics.fps=null;}
const supported=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);
addEventListener('keydown',e=>{if(!supported.has(e.code)||$('guide').open||$('gps-dialog').open||e.metaKey||e.ctrlKey||e.altKey)return;e.preventDefault();keys.add(e.code);start();});addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',stop);
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();positioning.pause();}else{positioning.resume();start();}});
for(const button of document.querySelectorAll('[data-key]')){button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(button.dataset.key);button.classList.add('active');start();});button.addEventListener('lostpointercapture',()=>{keys.delete(button.dataset.key);button.classList.remove('active');});}
$('map').addEventListener('pointerdown',e=>{if(!ready)return;drag={x:e.clientX,y:e.clientY,id:e.pointerId};$('map').setPointerCapture(e.pointerId);});
// While the compass owns the heading, dragging only adjusts pitch.
$('map').addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;if(document.body.dataset.heading!=='compass')player.heading+=(e.clientX-drag.x)*.18;player.pitch=Math.max(-20,Math.min(4,player.pitch-(e.clientY-drag.y)*.12));drag.x=e.clientX;drag.y=e.clientY;camera();updateUI();drawMini();});$('map').addEventListener('lostpointercapture',()=>{drag=null;});
$('reset').onclick=()=>{stop();
 if(positioning.state.mode==='gps'){player.pitch=0;if(gps.target){[player.x,player.y]=gps.target;}if(positioning.state.course!==null)player.travelBearing=positioning.state.course;camera();drawMini();updateUI();start();notice(gps.target?'Snapped to the latest GPS fix.':'Waiting for a GPS fix.',2500);return;}
 Object.assign(player,{x:0,y:0,heading:38,pitch:0,travelBearing:null});camera();drawMini();updateUI();if(!busy){busy=true;worker.postMessage({type:'rebuild',id:++requestId,x:0,y:0});}notice('Returned to the starting point.',2500);};
function toggleGps(){if(positioning.state.mode==='gps'){positioning.disable();gps.target=null;gps.rawHeading=null;[player.x,player.y]=boundedPosition(player.x,player.y);camera();drawMini();notice('Location off. Manual exploration within 120 m of the loaded area center.',5000);}else{$('guide').close();$('gps-dialog').showModal();}}
$('gps').onclick=toggleGps;$('gps-toggle').onclick=toggleGps;$('gps-cancel').onclick=()=>$('gps-dialog').close();
$('gps-enable').onclick=()=>{$('gps-dialog').close();stop();positioning.enable().then(ok=>{if(ok)notice('Waiting for your location…');});};
$('menu').onclick=()=>{stop();$('guide').showModal();};$('close-guide').onclick=()=>$('guide').close();
$('refresh').onclick=()=>request(area.live&&area.radius?{center:area.origin,radius:area.radius}:{live:true});
$('stats-toggle').onclick=()=>{const hidden=!$('stats').hidden;$('stats').hidden=hidden;$('stats-toggle').setAttribute('aria-expanded',String(!hidden));updateUI();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else notice('For a full-screen view on iPhone, use Share → Add to Home Screen.',6000);}catch{notice('Fullscreen is unavailable in this browser.',4000);}};
let installPrompt;addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install').hidden=false;});$('install').onclick=async()=>{await installPrompt?.prompt();installPrompt=null;$('install').hidden=true;};
if('serviceWorker'in navigator&&import.meta.env.PROD){navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{offlineReady=true;$('offline-status').textContent='App and bundled area are ready offline. Live and GPS areas last only for this session. iPhone: Share → Add to Home Screen.';}).catch(()=>{$('offline-status').textContent='Offline setup failed. Keep this tab online and reload to retry.';});}else $('offline-status').textContent='Offline caching is enabled in the production build.';
applyMode();
// Read-only diagnostic snapshot. Sensor state is exposed for testing; no camera APIs exist in Prototype B.
window.navigatorDiagnostics=()=>({player:{...player},metrics:{...metrics},ready,busy,offlineReady,limits:LIMITS,area:{...area},gps:{target:gps.target?[...gps.target]:null,rawHeading:gps.rawHeading},sensors:JSON.parse(JSON.stringify(positioning.state))});
