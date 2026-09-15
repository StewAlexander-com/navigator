import * as maplibregl from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {createWorldLayer} from './renderer.js';
import {updateTravelBearing} from './chevron.js';
import {ORIGIN, LIMITS, toLngLat, boundedPosition} from './world.js';
import './style.css';

const $=id=>document.getElementById(id);
maplibregl.setWorkerUrl(mapWorkerUrl);
maplibregl.setWorkerCount(1);
const player={x:0,y:0,heading:38,pitch:0,travelBearing:null};
const metrics={renderedFrames:0,drawCalls:0,vertices:0,triangles:0,buildings:0,geometryBytes:0,roadVertices:0,frameMs:null,fps:null,queryMs:null,responseBytes:null};
const keys=new Set();let ready=false,worldLayer,roads=[],busy=false,lastBuild=[0,0],requestId=0,frameId=0,lastTime=0,uiTime=0,noticeTimer,drag=null,offlineReady=false;
const worker=new Worker(new URL('./world.worker.js',import.meta.url),{type:'module'});
const started=performance.now();
function notice(message,timeout=0){clearTimeout(noticeTimer);$('notice').textContent=message;if(timeout)noticeTimer=setTimeout(()=>{$('notice').textContent='';},timeout);}
function request(live=false){if(busy)return;busy=true;$('refresh').disabled=true;worker.postMessage({type:'load',id:++requestId,url:new URL('osm-snapshot.json',document.baseURI).href,live,x:player.x,y:player.y});if(live)notice('Refreshing this area from OpenStreetMap…');}
const map=new maplibregl.Map({container:'map',style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#b0bfc9'}}]},center:ORIGIN,zoom:18,pitch:90,maxPitch:95,centerClampedToGround:false,interactive:false,attributionControl:false,pixelRatio:Math.min(devicePixelRatio,1.5),maxTileCacheSize:16,renderWorldCopies:false,canvasContextAttributes:{antialias:false,preserveDrawingBuffer:false}});
function fitView(){map.setVerticalFieldOfView(innerWidth<700?65:45);if(ready)camera();}
fitView();addEventListener('resize',fitView);
map.on('load',()=>{worldLayer=createWorldLayer(player,metrics);map.addLayer(worldLayer);camera();request();});
map.on('error',e=>{console.error(e.error);notice('The 3D view encountered an error. Reload to try again.');});
map.getCanvas().addEventListener('webglcontextlost',e=>{e.preventDefault();stop();notice('Graphics context lost. Reload the page to restore this area.');});
function camera(){const h=player.heading*Math.PI/180,eye=toLngLat(player.x,player.y),ahead=toLngLat(player.x+Math.sin(h)*20,player.y+Math.cos(h)*20);map.jumpTo(map.calculateCameraOptionsFromTo(eye,1.65,ahead,1.65+Math.tan(player.pitch*Math.PI/180)*20));}
worker.onmessage=({data})=>{
 if(data.id!==requestId)return;busy=false;$('refresh').disabled=false;
 if(data.type==='error'){notice(ready?'Refresh unavailable. Your current area is still usable.':'Could not load the bundled area. Reload when online.');$('refresh-info').textContent=data.message;return;}
 worldLayer.setBuildings(data.geometry);lastBuild=[data.x,data.y];
 if(Math.hypot(player.x-data.x,player.y-data.y)>12){busy=true;worker.postMessage({type:'rebuild',id:++requestId,x:player.x,y:player.y});}
 if(data.roads){roads=data.roads;worldLayer.setRoads(roads);metrics.responseBytes=data.bytes;$('data-state').textContent=`${data.live?'Live '+data.provider:'Bundled OSM'} · ${data.timestamp?data.timestamp.slice(0,10):'fixed LA area'}`;}
 metrics.queryMs=data.ms;
 if(!ready){metrics.firstViewMs=performance.now()-started;ready=true;notice('Drag to look. Use the arrows or W A S D to explore.',7000);}
 else if(data.roads)notice('OpenStreetMap area refreshed for this session.',5000);
 updateUI();drawMini();camera();
};
worker.onerror=()=>{busy=false;$('refresh').disabled=false;notice('Map processing failed. Reload to restart the worker.');};
function drawMini(){
 const c=$('minimap').getContext('2d'),size=240,scale=.65;c.clearRect(0,0,size,size);c.fillStyle='#b9c3c8';c.fillRect(0,0,size,size);c.save();c.translate(120,120);c.scale(scale,-scale);c.translate(-player.x,-player.y);
 c.strokeStyle='#edf1f2';c.lineCap='round';c.lineJoin='round';for(const road of roads){c.lineWidth=road.width; c.beginPath();road.points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke();}c.restore();
 c.save();c.translate(120,120);c.rotate(player.heading*Math.PI/180);c.fillStyle='#45dbdd44';c.beginPath();c.moveTo(0,0);c.arc(0,0,38,-Math.PI*.7,-Math.PI*.3);c.closePath();c.fill();c.fillStyle='#075963';c.strokeStyle='#8afff5';c.lineWidth=2;c.beginPath();c.moveTo(0,-13);c.lineTo(8,10);c.lineTo(0,6);c.lineTo(-8,10);c.closePath();c.fill();c.stroke();c.restore();
}
function updateUI(){const h=(player.heading%360+360)%360;const [lng,lat]=toLngLat(player.x,player.y);$('heading').textContent=String(Math.round(h)%360).padStart(3,'0')+'°';$('cardinal').textContent=['N','NE','E','SE','S','SW','W','NW'][Math.round(h/45)%8];$('coordinates').textContent=`${lat.toFixed(5)}° N  ${Math.abs(lng).toFixed(5)}° W`;$('fps').textContent=metrics.fps?`${metrics.fps.toFixed(0)} fps`:'idle';
 const entries=[['Frame interval',metrics.frameMs?`${metrics.frameMs.toFixed(1)} ms`:'Move to measure'],['World draw calls',`${metrics.drawCalls} / 7`],['Building vertices',`${metrics.vertices.toLocaleString()} / 90,000`],['Road vertices',`${metrics.roadVertices.toLocaleString()} / 18,000`],['Loaded buildings',`${metrics.buildings} / 160`],['Geometry buffers',`${(metrics.geometryBytes/1048576).toFixed(2)} MiB`],['Fetch + worker processing',metrics.queryMs?`${metrics.queryMs.toFixed(0)} ms`:'—'],['OSM response',metrics.responseBytes?`${(metrics.responseBytes/1048576).toFixed(2)} MiB`:'—'],['JS heap',performance.memory?`${(performance.memory.usedJSHeapSize/1048576).toFixed(1)} MiB`:'Unavailable'],['GPU memory','Unavailable'],['GPS / heading accuracy','Sensors off']];
 $('measurements').replaceChildren(...entries.flatMap(([label,value])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;return[dt,dd];}));}
function loop(now){frameId=0;if(!ready||document.hidden)return;const dt=Math.min((now-lastTime)/1000,.05);const interval=now-lastTime;lastTime=now;
 if(interval>0&&interval<200){metrics.frameMs=metrics.frameMs?metrics.frameMs*.9+interval*.1:interval;metrics.fps=1000/metrics.frameMs;}
 let f=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),s=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));const length=Math.hypot(f,s);if(length>1){f/=length;s/=length;}
 player.heading+=(Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')))*65*dt;
 player.pitch=Math.max(-20,Math.min(4,player.pitch+(Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown')))*25*dt));
 const h=player.heading*Math.PI/180,nx=player.x+(Math.sin(h)*f+Math.cos(h)*s)*3*dt,ny=player.y+(Math.cos(h)*f-Math.sin(h)*s)*3*dt;
 const oldX=player.x,oldY=player.y;
 [player.x,player.y]=boundedPosition(nx,ny);updateTravelBearing(player,player.x-oldX,player.y-oldY);if(Math.hypot(nx,ny)>LIMITS.movement)notice('Edge of this prototype area. Turn back or recenter.',2000);
 camera();
 if(!busy&&Math.hypot(player.x-lastBuild[0],player.y-lastBuild[1])>12){busy=true;worker.postMessage({type:'rebuild',id:++requestId,x:player.x,y:player.y});}
 if(now-uiTime>200){updateUI();drawMini();uiTime=now;}
 if(keys.size)frameId=requestAnimationFrame(loop);else{metrics.fps=null;updateUI();}
}
function start(){if(!frameId&&ready){lastTime=performance.now();frameId=requestAnimationFrame(loop);}}
function stop(){keys.clear();if(frameId)cancelAnimationFrame(frameId);frameId=0;document.querySelectorAll('.controls button').forEach(b=>b.classList.remove('active'));metrics.fps=null;}
const supported=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);
addEventListener('keydown',e=>{if(!supported.has(e.code)||$('guide').open||e.metaKey||e.ctrlKey||e.altKey)return;e.preventDefault();keys.add(e.code);start();});addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
for(const button of document.querySelectorAll('[data-key]')){button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(button.dataset.key);button.classList.add('active');start();});button.addEventListener('lostpointercapture',()=>{keys.delete(button.dataset.key);button.classList.remove('active');});}
$('map').addEventListener('pointerdown',e=>{if(!ready)return;drag={x:e.clientX,y:e.clientY,id:e.pointerId};$('map').setPointerCapture(e.pointerId);});
$('map').addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;player.heading+=(e.clientX-drag.x)*.18;player.pitch=Math.max(-20,Math.min(4,player.pitch-(e.clientY-drag.y)*.12));drag.x=e.clientX;drag.y=e.clientY;camera();updateUI();drawMini();});$('map').addEventListener('lostpointercapture',()=>{drag=null;});
$('reset').onclick=()=>{stop();Object.assign(player,{x:0,y:0,heading:38,pitch:0,travelBearing:null});camera();drawMini();updateUI();if(!busy){busy=true;worker.postMessage({type:'rebuild',id:++requestId,x:0,y:0});}notice('Returned to the starting point.',2500);};
$('menu').onclick=()=>{stop();$('guide').showModal();};$('close-guide').onclick=()=>$('guide').close();$('refresh').onclick=()=>request(true);
$('stats-toggle').onclick=()=>{const hidden=!$('stats').hidden;$('stats').hidden=hidden;$('stats-toggle').setAttribute('aria-expanded',String(!hidden));updateUI();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else notice('For a full-screen view on iPhone, use Share → Add to Home Screen.',6000);}catch{notice('Fullscreen is unavailable in this browser.',4000);}};
let installPrompt;addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install').hidden=false;});$('install').onclick=async()=>{await installPrompt?.prompt();installPrompt=null;$('install').hidden=true;};
if('serviceWorker'in navigator&&import.meta.env.PROD){navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{offlineReady=true;$('offline-status').textContent='App and bundled area are ready offline. Live refreshes last only for this session. iPhone: Share → Add to Home Screen.';}).catch(()=>{$('offline-status').textContent='Offline setup failed. Keep this tab online and reload to retry.';});}else $('offline-status').textContent='Offline caching is enabled in the production build.';
// Read-only diagnostic snapshot; no sensor or camera APIs exist in Prototype A.
window.navigatorDiagnostics=()=>({player:{...player},metrics:{...metrics},ready,busy,offlineReady,limits:LIMITS});
