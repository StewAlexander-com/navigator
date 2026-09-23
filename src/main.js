import * as maplibregl from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {createWorldLayer} from './renderer.js';
import {updateTravelBearing} from './chevron.js';
import {createPositioning} from './positioning.js';
import {createSunCheck} from './sun-check.js';
import {smoothHeading, smoothPosition, headingDelta, areaCovers, edgeRunway, shouldPrefetch, liveSquare, retryDelay, deadReckon, snapDistanceFor, courseWeight, fuseHeading, SENSORS} from './sensors.js';
import {ORIGIN, BBOX, LIMITS, toLngLat, toLocal, boundedPosition} from './world.js';
import {nearestStreet} from './street-label.js';
import {distance as roadDistance, ROAD_CACHE} from './road-packages.js';
import {progressFraction, progressText, updateRate} from './progress.js';
import './style.css';

const $=id=>document.getElementById(id);
maplibregl.setWorkerUrl(mapWorkerUrl);
maplibregl.setWorkerCount(1);
const player={x:0,y:0,heading:38,pitch:0,travelBearing:null,chevronHeading:null};
// The loaded OSM area. `origin` is the local metre frame; GPS re-anchors it when the view radius leaves `bbox`.
const area={origin:ORIGIN,bbox:BBOX,live:false,radius:null,provider:'Bundled OSM',cached:false,kinds:null,prior:false};
// GPS target pose. The render loop eases the player toward `target`; `rawHeading` is the latest compass reading.
let sunCheck;
let followCompass=true;
let street=null,labelPosition=null,labelRoads=null;
let roadWorker=null,cacheRoads=null,baseRoads=[],lastRoadPoint=null,roadCacheState={phase:'starting',complete:0,total:0,bytes:0};
let roadCacheEnabled=true;try{roadCacheEnabled=localStorage.getItem('navigator-roads-enabled')!=='false';}catch{}
// Driving hold: when GPS comes on above ROAD_CACHE.driveSpeed before any GPS-centred plan exists, the 25-mile bulk
// download (69 tiles, minutes of "downloading") is not started. It resumes after a sustained stop or an explicit tap.
let roadHold=false,roadGpsPlanned=false,roadSlowSince=null;
function showRoadCache(){
 const r=roadCacheState,summary=!roadCacheEnabled?'Road downloads paused':roadHold?'Roads · paused while driving · tap Cache this area':`Roads · ${r.complete||0}/${r.total||0} areas · ${((r.bytes||0)/1048576).toFixed(1)} MiB · ${r.phase}`;
 $('road-cache-status').textContent=summary;$('road-cache-status').classList.toggle('downloading',roadCacheEnabled&&!roadHold&&r.phase==='downloading'&&r.total>0);$('road-cache-status').style.setProperty('--fill',r.total?`${Math.round((r.complete||0)/r.total*100)}%`:'0%');$('road-cache-detail').textContent=`${summary}. ${roadHold&&roadCacheEnabled?'The 25-mile road download waits while you are driving. Tap Cache this area / retry to start it now; it starts by itself after you have been stopped for a minute.':r.message||'25-mile target; downloads and coverage may be incomplete. Roads are stored on this device.'}`;
 $('road-cache-toggle').textContent=roadCacheEnabled?'Pause road downloads':'Resume road downloads';
}
function useRoads(){roads=cacheRoads?.length?cacheRoads:baseRoads;if(worldLayer&&ready)worldLayer.setRoads(roads);labelRoads=null;}
function sendRoadPosition(force=false){
 if(!roadWorker||!ready)return;const live=positioning.state.mode==='gps'&&!!positioning.state.lastFix,point=live?[positioning.state.lastFix.lng,positioning.state.lastFix.lat]:toLngLat(player.x,player.y,area.origin);
 if(live&&!force&&!roadGpsPlanned){
  const speed=gps.speed??0;if(speed<SENSORS.movingSpeed){roadSlowSince??=performance.now();}else roadSlowSince=null;
  if(!roadHold&&speed>=ROAD_CACHE.driveSpeed){roadHold=true;roadWorker.postMessage({type:'pause'});showRoadCache();return;}
  if(roadHold){if(roadSlowSince===null||performance.now()-roadSlowSince<ROAD_CACHE.holdReleaseMs)return;roadHold=false;if(roadCacheEnabled)roadWorker.postMessage({type:'resume'});showRoadCache();force=true;}
 }
 // At speed a position update every 25 m would run worker maintenance about once a second; space them by ~4 s of travel instead.
 const threshold=gps.speed>=5?Math.max(25,gps.speed*4):25;
 if(!force&&lastRoadPoint&&roadDistance(lastRoadPoint,point)<threshold)return;
 const mode=positioning.state.mode==='gps'||area.live?'gps':'demo';if(mode==='gps'&&live)roadGpsPlanned=true;
 lastRoadPoint=point;roadWorker.postMessage({type:'position',point,origin:area.origin,mode,force});
}
function startRoadCache(){
 roadHold=false;
 if(roadWorker&&roadCacheState.phase==='shared cache'){roadWorker.terminate();roadWorker=null;}
 if(roadWorker){roadWorker.postMessage({type:'resume'});sendRoadPosition(true);return;}
 roadWorker=new Worker(new URL('./roads.worker.js',import.meta.url),{type:'module'});
 roadWorker.onmessage=({data})=>{if(data.type==='status'){roadCacheState=data;showRoadCache();}else if(data.type==='roads'&&data.origin.join()===area.origin.join()){cacheRoads=data.roads;useRoads();updateUI();drawMini();map.triggerRepaint();}else if(data.type==='cleared'){roadWorker.terminate();roadWorker=null;cacheRoads=null;useRoads();roadCacheState={phase:'cleared'};showRoadCache();updateUI();}};
 roadWorker.onerror=()=>{roadCacheState={phase:'unavailable',message:'Road storage failed. The current scene remains available.'};showRoadCache();};
 if(!roadCacheEnabled)roadWorker.postMessage({type:'pause'});sendRoadPosition();
}

// `target` is the last accepted fix in local metres; `speed`/`course` come from the receiver and drive the
// speed-aware rules in sensors.js (dead reckoning, snap threshold, course fusion). `blend` is the current course weight.
// Live-area failures back off 30 s → 5 min (`failures`, `retryAt`, honouring Retry-After); `prefetch` is the square the
// worker already holds ahead of the car, if any, so the edge swap needs no download.
const gps={target:null,rawHeading:null,retryAt:-Infinity,failures:0,retryMs:0,fixAt:0,speed:null,course:null,blend:0,prefetch:null,prefetchId:0,prefetching:false,prefetchRetryAt:-Infinity,prefetches:0};
const metrics={renderedFrames:0,drawCalls:0,vertices:0,triangles:0,buildings:0,geometryBytes:0,roadVertices:0,frameMs:null,fps:null,queryMs:null,responseBytes:null};
const keys=new Set();let ready=false,worldLayer,roads=[],busy=false,lastBuild=[0,0],lastStreamHeading=38,requestId=0,frameId=0,lastTime=0,uiTime=0,noticeTimer,drag=null,offlineReady=false;
const worker=new Worker(new URL('./world.worker.js',import.meta.url),{type:'module'});
const started=performance.now();
// The notice pill holds a message and, beneath it, a tqdm-style progress strip for whatever the app is waiting on:
// the bundled or live area (download → parse → build, bytes and rate from the worker), a prefetch, or GPS acquisition.
// One task shows at a time; the elapsed clock ticks while it is visible and nothing runs once it is hidden.
const progress={task:null,label:'',bytes:0,total:null,fraction:null,detail:'',startedAt:0,rate:0,lastAt:0,lastBytes:0};let progressTimer=0;
function showNotice(){$('notice').hidden=!$('notice-text').textContent&&$('progress').hidden;}
function notice(message,timeout=0){clearTimeout(noticeTimer);$('notice-text').textContent=message;showNotice();if(timeout)noticeTimer=setTimeout(()=>{$('notice-text').textContent='';showNotice();},timeout);}
function beginProgress(task,label,detail=''){
 if(progress.task!==task)Object.assign(progress,{task,startedAt:performance.now(),bytes:0,total:null,fraction:null,rate:0,lastAt:0,lastBytes:0});
 progress.label=label;progress.detail=detail;$('progress').hidden=false;showNotice();renderProgress();
 if(!progressTimer)progressTimer=setInterval(renderProgress,250);
}
function updateProgress(task,{bytes=null,total=null,fraction=null,detail}={}){
 if(progress.task!==task)return;
 if(bytes!==null){progress.bytes=bytes;updateRate(progress,bytes,performance.now());}
 if(total!==null)progress.total=total;if(fraction!==null)progress.fraction=fraction;if(detail!==undefined)progress.detail=detail;
 renderProgress();
}
function endProgress(task){if(progress.task!==task)return;progress.task=null;$('progress').hidden=true;clearInterval(progressTimer);progressTimer=0;showNotice();}
function renderProgress(){
 if(progress.task===null)return;const f=progressFraction(progress),el=$('progress');
 el.classList.toggle('indeterminate',f===null);$('progress-fill').style.setProperty('--fill',f===null?'0%':`${Math.round(f*100)}%`);
 if(f===null)el.removeAttribute('aria-valuenow');else el.setAttribute('aria-valuenow',String(Math.round(f*100)));
 $('progress-label').textContent=progress.label;$('progress-meta').textContent=progressText({...progress,elapsedMs:performance.now()-progress.startedAt});
}
const PHASES={downloading:'',parsing:'parsing OSM data',building:'building geometry'};
// `live` refreshes the fixed LA box; `center` loads a square around (or ahead of) the GPS `fix`, reusing a square the worker
// already holds unless `fresh`; neither → bundled snapshot.
function request({live=false,center=null,radius=null,fix=null,fresh=false}={}){if(busy)return false;busy=true;$('refresh').disabled=true;worker.postMessage({type:'load',id:++requestId,url:new URL('osm-snapshot.json',document.baseURI).href,live,center,radius,fix,fresh,heading:player.travelBearing??player.heading,x:center?0:player.x,y:center?0:player.y});beginProgress('area',center?'Downloading the OpenStreetMap area around you':live?'Refreshing this area from OpenStreetMap':'Loading the bundled OpenStreetMap area');return true;}
const map=new maplibregl.Map({container:'map',style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e6cca8'}}]},center:ORIGIN,zoom:18,pitch:90,maxPitch:95,centerClampedToGround:false,interactive:false,attributionControl:false,pixelRatio:Math.min(devicePixelRatio,1.5),maxTileCacheSize:16,renderWorldCopies:false,canvasContextAttributes:{antialias:false,preserveDrawingBuffer:false}});
function fitView(){map.setVerticalFieldOfView(innerWidth<700?65:45);if(ready)camera();}
fitView();addEventListener('resize',fitView);
map.on('load',()=>{worldLayer=createWorldLayer(player,metrics,anchor=>{
 const pill=$('street-pill');pill.hidden=!anchor.visible||anchor.y-24<innerHeight*.35||anchor.y+24>innerHeight-170;
 pill.style.left=anchor.x+'px';pill.style.top=anchor.y+'px';
});map.addLayer(worldLayer);camera();request();});
map.on('error',e=>{console.error(e.error);notice('The 3D view encountered an error. Reload to try again.');});
map.getCanvas().addEventListener('webglcontextlost',e=>{e.preventDefault();stop();notice('Graphics context lost. Reload the page to restore this area.');});
function camera(){const h=player.heading*Math.PI/180,eye=toLngLat(player.x,player.y,area.origin),ahead=toLngLat(player.x+Math.sin(h)*20,player.y+Math.cos(h)*20,area.origin);map.jumpTo(map.calculateCameraOptionsFromTo(eye,1.65,ahead,1.65+Math.tan(player.pitch*Math.PI/180)*20));}
const positioning=createPositioning({
 onFix(fix,course){
  gps.target=toLocal([fix.lng,fix.lat],area.origin);gps.fixAt=performance.now();gps.speed=Number.isFinite(fix.speed)?fix.speed:null;gps.course=positioning.state.course;
  if(course!==null)player.travelBearing=course;
  if(positioning.state.fixes.accepted===1){[player.x,player.y]=gps.target;camera();notice(`Location found (±${Math.round(fix.accuracy)} m). ${positioning.state.compass==='on'?'Turn to look around.':'Drag to look around.'}`,6000);}
  ensureAreaCovers(fix);sendRoadPosition();start();
 },
 onHeading(){gps.rawHeading=positioning.state.rawHeading;sunCheck?.onHeading();const target=sunCheck?.heading(gps.rawHeading)??gps.rawHeading;if(Math.abs(headingDelta(player.chevronHeading??player.heading,target))>SENSORS.idleHeading||(followCompass&&!drag&&Math.abs(headingDelta(player.heading,target))>SENSORS.idleHeading))start();},
 onError(kind){notice(kind==='denied'?'Location permission was denied. Manual exploration continues.':kind==='unavailable'?'Location is unavailable right now. Waiting for a fix…':'No location fix yet. Move to open sky or wait.',6000);},
 onState(){
  // GPS acquisition: from the enabling tap until the first accepted fix the pill shows an elapsed clock and why fixes are still being waited for.
  const s=positioning.state;
  if(s.mode==='gps'&&s.position==='waiting'&&!s.lastFix)beginProgress('gps','Acquiring your GPS position',s.fixes.rejected?`last fix ±${Math.round(s.accuracy)} m ${s.fixes.lastReason==='inaccurate'?'(too inaccurate, need ±60 m)':`(${s.fixes.lastReason})`}`:s.error==='unavailable'?'receiver reports no position yet':s.error==='timeout'?'no fix yet — move to open sky':'');
  else endProgress('gps');
  sunCheck?.refresh();applyMode();
 }
});
sunCheck=createSunCheck({getSensors:()=>positioning.state,onChange(){applyMode();start();}});
// Download a new square when the 180 m view radius would leave the loaded data. The bundled LA snapshot is preferred when it covers the fix.
// At speed the square is larger and centred ahead (liveSquare), and the next one is prefetched before the edge is reached.
function ensureAreaCovers(fix){
 const [x,y]=toLocal([fix.lng,fix.lat],area.origin),point=[fix.lng,fix.lat];
 if(areaCovers(x,y,area.bbox,area.origin)){prefetchAhead(point,edgeRunway(x,y,area.bbox,area.origin));return;}
 if(busy||performance.now()<gps.retryAt)return;
 const [bx,by]=toLocal(point,ORIGIN);
 if(areaCovers(bx,by,BBOX,ORIGIN))request();else{const square=liveSquare(point,gps.speed,gps.course);request({center:square.center,radius:square.radius,fix:point});}
}
function prefetchAhead(point,runway){
 if(!shouldPrefetch(runway,gps.speed)||gps.prefetching||performance.now()<gps.prefetchRetryAt||performance.now()<gps.retryAt)return;
 if(gps.prefetch&&areaCovers(...toLocal(point,gps.prefetch.origin),gps.prefetch.bbox,gps.prefetch.origin))return;
 // The bundled LA box never needs a download: from a live square, skip the prefetch when the runway ends back inside it.
 const ahead=liveSquare(point,gps.speed,gps.course,LIMITS.prefetchLeadS),square=liveSquare(ahead.center,gps.speed,gps.course);
 if(area.live){const exit=liveSquare(point,gps.speed,gps.course,Math.max(0,runway+1)/gps.speed).center;if(areaCovers(...toLocal(exit,ORIGIN),BBOX,ORIGIN))return;}
 gps.prefetching=true;gps.prefetches++;worker.postMessage({type:'prefetch',id:++gps.prefetchId,center:square.center,radius:square.radius,fix:ahead.center});beginProgress('prefetch','Preparing the next area ahead');
}
function reanchor(origin,bbox){
 const ll=toLngLat(player.x,player.y,area.origin);
 const targetLL=gps.target?toLngLat(...gps.target,area.origin):null;
 area.origin=origin;area.bbox=bbox;
 [player.x,player.y]=toLocal(ll,origin);if(targetLL)gps.target=toLocal(targetLL,origin);
 worldLayer.setOrigin(origin);cacheRoads=null;lastRoadPoint=null;sendRoadPosition();
}
worker.onmessage=({data})=>{
 if(data.type==='progress'){
  if(data.task==='prefetch'?data.id===gps.prefetchId:data.id===requestId)updateProgress(data.task==='prefetch'?'prefetch':'area',{bytes:data.bytes??null,total:data.total??null,detail:PHASES[data.phase]??''});
  return;
 }
 if(data.type==='prefetched'||data.type==='prefetch-error'){
  if(data.id!==gps.prefetchId)return;gps.prefetching=false;endProgress('prefetch');
  if(data.type==='prefetched'){if(data.bbox)gps.prefetch={bbox:data.bbox,origin:data.origin,radius:data.radius};}
  else{gps.prefetchRetryAt=performance.now()+retryDelay(1,data.retryMs);if(data.retryMs)gps.retryAt=Math.max(gps.retryAt,performance.now()+data.retryMs);}
  return;
 }
 if(data.id!==requestId)return;busy=false;$('refresh').disabled=false;endProgress('area');
 if(data.type==='error'){
  // Exponential backoff with jitter; a Retry-After from the service is never undercut and no second provider is tried on a rate limit.
  gps.failures++;gps.retryMs=retryDelay(gps.failures,data.retryMs);gps.retryAt=performance.now()+gps.retryMs;
  notice(ready?(data.oversized?'This area is too dense for the 8 MiB cap. Nearby streets stay empty beyond the loaded data.':`Area download unavailable. Your current area is still usable; next attempt in ${Math.round(gps.retryMs/1000)} s.`):'Could not load the bundled area. Reload when online.');$('refresh-info').textContent=data.message;return;}
 if(data.areaLoaded){
  gps.failures=0;gps.retryMs=0;gps.retryAt=-Infinity;if(gps.prefetch&&gps.prefetch.bbox.join()===data.bbox.join())gps.prefetch=null;
  if(data.origin.join()!==area.origin.join()||data.bbox.join()!==area.bbox.join())reanchor(data.origin,data.bbox);
  area.live=data.live;area.radius=data.radius;area.provider=data.provider;area.cached=!!data.cached;area.kinds=data.kinds||null;area.prior=!!data.prior;metrics.responseBytes=data.bytes;
  $('area-name').textContent=data.radius?'Live area around you':'Downtown Los Angeles';
  $('data-state').textContent=`${data.live?'Live '+data.provider:'Bundled OSM'} · ${data.timestamp?data.timestamp.slice(0,10):data.radius?'this session':'fixed LA area'}${data.radius?` · ${data.radius*2} m square${data.cached?' · reused':''}`:''}`;
 }
 if(data.roads){baseRoads=data.roads;roads=cacheRoads?.length?cacheRoads:baseRoads;worldLayer.setRoads(roads);}
 if(data.geometry)worldLayer.setBuildings(data.geometry);metrics.stream=data.stream;lastBuild=[data.x,data.y];lastStreamHeading=data.heading;
 if(Math.hypot(player.x-data.x,player.y-data.y)>12){busy=true;worker.postMessage({type:'rebuild',id:++requestId,x:player.x,y:player.y,heading:player.travelBearing??player.heading});}
 metrics.queryMs=data.ms;
 if(!ready){metrics.firstViewMs=performance.now()-started;ready=true;startRoadCache();showRoadCache();notice('Drag to look. Use the arrows or W A S D to explore, or enable your location.',7000);}
 else if(data.areaLoaded)notice(data.radius?(data.cached?'OpenStreetMap area reused from this session.':`OpenStreetMap area loaded around you (${data.provider}).`):'OpenStreetMap area refreshed for this session.',5000);
 updateUI();drawMini();camera();if(positioning.state.mode==='gps')start();
};
worker.onerror=()=>{busy=false;$('refresh').disabled=false;endProgress('area');endProgress('prefetch');notice('Map processing failed. Reload to restart the worker.');};
function drawMini(){
 const c=$('minimap').getContext('2d'),size=240,scale=.65;c.clearRect(0,0,size,size);c.fillStyle='#b9c3c8';c.fillRect(0,0,size,size);c.save();c.translate(120,120);c.scale(scale,-scale);c.translate(-player.x,-player.y);
 c.strokeStyle='#edf1f2';c.lineCap='round';c.lineJoin='round';for(const road of roads){c.lineWidth=road.width; c.beginPath();road.points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke();}
 if(gps.target&&positioning.state.mode==='gps'){c.fillStyle='#2b8fa326';c.strokeStyle='#2b8fa3';c.lineWidth=1.5;c.beginPath();c.arc(gps.target[0],gps.target[1],Math.max(positioning.state.accuracy||0,1.5),0,Math.PI*2);c.fill();c.stroke();}
 c.restore();
 c.save();c.translate(120,120);c.rotate(player.heading*Math.PI/180);c.fillStyle='#45dbdd44';c.beginPath();c.moveTo(0,0);c.arc(0,0,38,-Math.PI*.7,-Math.PI*.3);c.closePath();c.fill();c.fillStyle='#075963';c.strokeStyle='#8afff5';c.lineWidth=2;c.beginPath();c.moveTo(0,-13);c.lineTo(8,10);c.lineTo(0,6);c.lineTo(-8,10);c.closePath();c.fill();c.stroke();c.restore();
}
function applyMode(){
 const s=positioning.state,live=s.mode==='gps',compass=live&&s.compass==='on'&&followCompass;
 if(!live||s.compass!=='on')player.chevronHeading=null;
 document.body.dataset.mode=s.mode;document.body.dataset.heading=compass?'compass':'manual';
 $('gps').classList.toggle('on',live);$('gps').setAttribute('aria-pressed',String(live));$('gps-label').textContent=live?(s.position==='on'?`Live GPS · ±${Math.round(s.accuracy)} m`:s.position==='paused'?'GPS paused':'Waiting for GPS…'):'Use my location';
 $('gps-toggle').textContent=live?'Stop using my location':'Use my location';
 $('position-label').textContent=live?(s.position==='on'?`GPS POSITION · ±${Math.round(s.accuracy)} m`:'GPS POSITION · WAITING FOR FIX'):'VIRTUAL POSITION · GPS OFF';
 $('view-mode').hidden=!live;$('view-mode').disabled=s.compass!=='on';$('view-mode').setAttribute('aria-pressed',String(!followCompass));$('view-mode').textContent=s.compass!=='on'?'View: manual':followCompass?'View: compass':'View: free look';
 $('heading-source').textContent=live&&!followCompass?'FREE LOOK':compass&&drag?'LOOK AROUND':compass&&sunCheck?.snapshot().applied?'SUN-ALIGNED':compass&&gps.blend>=.5?'GPS COURSE':compass?(s.compassAccuracy!==null?`COMPASS ±${Math.round(s.compassAccuracy)}°`:'COMPASS'):live?({waiting:'COMPASS…',denied:'COMPASS DENIED',unavailable:'NO COMPASS',paused:'PAUSED'}[s.compass]||'MANUAL LOOK'):'MANUAL';
 $('reset').title=live?'Snap to the latest GPS fix':'Return to starting point';$('reset-label').textContent=live?'Snap':'Recenter';
 if(live&&s.compass!=='on'&&s.compass!=='waiting'&&!applyMode.warned){applyMode.warned=true;notice(s.compass==='denied'?'Motion & orientation access was denied. Drag or use the turn buttons to look around.':s.compass==='unavailable'?'No absolute compass is available here. Drag or use the turn buttons to look around.':'',6000);}
 if(!live)applyMode.warned=false;
 updateUI();
}
function updateStreetLabel(){
 sendRoadPosition();
 if(labelRoads===roads&&labelPosition&&Math.hypot(player.x-labelPosition.x,player.y-labelPosition.y)<.75)return;
 street=nearestStreet(roads,player,labelRoads===roads?street:null);labelRoads=roads;labelPosition={x:player.x,y:player.y};
 $('street-kind').textContent=street?.kind||'STREET';$('street-name').textContent=street?.name||'Street not identified';
 $('street-pill').title=street?.name||'Street not identified';
}
function updateUI(){updateStreetLabel();const h=(player.heading%360+360)%360;const [lng,lat]=toLngLat(player.x,player.y,area.origin),s=positioning.state;$('heading').textContent=String(Math.round(h)%360).padStart(3,'0')+'°';$('cardinal').textContent=['N','NE','E','SE','S','SW','W','NW'][Math.round(h/45)%8];$('coordinates').textContent=`${Math.abs(lat).toFixed(5)}° ${lat<0?'S':'N'}  ${Math.abs(lng).toFixed(5)}° ${lng<0?'W':'E'}`;$('fps').textContent=metrics.fps?`${metrics.fps.toFixed(0)} fps`:'idle';
 const entries=[['Frame interval',metrics.frameMs?`${metrics.frameMs.toFixed(1)} ms`:'Move to measure'],['World draw calls',`${metrics.drawCalls} / 7`],['Building vertices',`${metrics.vertices.toLocaleString()} / 90,000`],['Road vertices',`${metrics.roadVertices.toLocaleString()} / 18,000`],['Loaded buildings',`${metrics.buildings} / 160`],['Chunks active / ahead',metrics.stream?`${metrics.stream.active} / ${metrics.stream.prefetched}`:'—'],['Resident chunks',metrics.stream?`${metrics.stream.resident} / 28`:'—'],['Cached building buffers',metrics.stream?`${(metrics.stream.cacheBytes/1048576).toFixed(2)} MiB`:'—'],['Geometry estimate',metrics.stream?`${(metrics.stream.geometryEstimateBytes/1048576).toFixed(2)} MiB`:'—'],['Evicted / promoted',metrics.stream?`${metrics.stream.evicted} / ${metrics.stream.promoted}`:'—'],['Lookup',metrics.stream?.lookupMode||'—'],['Sectors visited',metrics.stream?`${metrics.stream.sectorsVisited} / ${metrics.stream.sectorCount}`:'—'],['Candidate chunks',metrics.stream?`${metrics.stream.candidateChunks} / ${metrics.stream.indexed}`:'—'],['Lookup time',metrics.stream?`${metrics.stream.lookupMs.toFixed(3)} ms`:'—'],['Sector graph bytes',metrics.stream?`${(metrics.stream.graphBytes/1024).toFixed(1)} KiB`:'—'],['Chunk update',metrics.stream?`${metrics.stream.queryMs.toFixed(2)} ms`:'—'],['Disposed meshes',String(metrics.disposedBuffers||0)],['Omitted buildings / chunks',`${metrics.omitted||0} / ${metrics.stream?.omittedChunks||0}`],['Building styles (n/h/a/s/o/u/c)',area.kinds?area.kinds.join(' / ')+(area.prior?' · small-footprint square':''):'—'],['Source coordinate estimate',metrics.stream?`${(metrics.stream.sourceNumericBytes/1048576).toFixed(2)} MiB`:'—'],['Geometry buffers',`${(metrics.geometryBytes/1048576).toFixed(2)} MiB`],['Fetch + worker processing',metrics.queryMs?`${metrics.queryMs.toFixed(0)} ms`:'—'],['OSM response',metrics.responseBytes?`${(metrics.responseBytes/1048576).toFixed(2)} MiB`:'—'],['Loaded area',area.radius?`${area.radius*2} m square · ${area.provider}`:'Fixed LA box · '+area.provider],['JS heap',performance.memory?`${(performance.memory.usedJSHeapSize/1048576).toFixed(1)} MiB`:'Unavailable'],['GPU memory','Unavailable'],['Road package state',roadCacheState.phase],['Road packages',`${roadCacheState.complete||0} / ${roadCacheState.total||0}`],['Local road storage',`${((roadCacheState.bytes||0)/1048576).toFixed(2)} / 128 MiB`],['Cached road segments',`${roadCacheState.activeSegments||0} / 2400`],['Road packages evicted',String(roadCacheState.evicted||0)],
  ['GPS accuracy',s.mode!=='gps'?'Sensors off':s.accuracy!==null?`±${s.accuracy.toFixed(0)} m · ${s.fixes.accepted} used / ${s.fixes.rejected} rejected${s.fixes.lastReason&&s.fixes.lastReason!=='ok'?' ('+s.fixes.lastReason+')':''}`:'Waiting for fix'],['Fix interval',s.fixIntervalMs?`${s.fixIntervalMs.toFixed(0)} ms`:'—'],['GPS speed · course blend',s.mode!=='gps'?'—':`${gps.speed===null?'no speed':gps.speed.toFixed(1)+' m/s'} · ${Math.round(gps.blend*100)} % course`],['Compass bearing',s.rawHeading===null?'—':`${s.rawHeading.toFixed(1)}° (sensor)`],['Compass',s.mode!=='gps'?'Off':s.compass==='on'?(s.compassAccuracy!==null?`±${s.compassAccuracy.toFixed(0)}° · ${s.headingEvents} events`:`${s.headingEvents} events · accuracy not reported`):s.compass]];
 $('measurements').replaceChildren(...entries.flatMap(([label,value])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;return[dt,dd];}));}
function loop(now){frameId=0;if(!ready||document.hidden)return;const dt=Math.min((now-lastTime)/1000,.05);const interval=now-lastTime;lastTime=now;
 if(interval>0&&interval<200){metrics.frameMs=metrics.frameMs?metrics.frameMs*.9+interval*.1:interval;metrics.fps=1000/metrics.frameMs;}
 const live=positioning.state.mode==='gps',sensorCompass=live&&positioning.state.compass==='on'&&gps.rawHeading!==null,compass=sensorCompass&&followCompass&&!drag;
 // Above walking pace the camera heading blends from the compass toward the GPS course; below it this is the compass alone.
 gps.blend=live?courseWeight(gps.speed,positioning.state.compassAccuracy):0;
 const targetHeading=sensorCompass?fuseHeading(sunCheck.heading(gps.rawHeading),gps.course,gps.blend):null;
 if(sensorCompass)player.chevronHeading=smoothHeading(player.chevronHeading??player.heading,targetHeading,dt);else player.chevronHeading=null;
 if(compass)player.heading=smoothHeading(player.heading,targetHeading,dt);
 else player.heading+=(Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')))*65*dt;
 player.pitch=Math.max(-20,Math.min(4,player.pitch+(Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown')))*25*dt));
 let settled=true;
 if(live){
  if(gps.target){
   // Between fixes at speed, aim ahead of the last fix along the course so the camera glides instead of stepping.
   const aim=deadReckon(gps.target,gps.speed,gps.course,(now-gps.fixAt)/1000);
   [player.x,player.y]=smoothPosition([player.x,player.y],aim,dt,SENSORS.positionTau,snapDistanceFor(gps.speed,positioning.state.fixIntervalMs));settled=Math.hypot(aim[0]-player.x,aim[1]-player.y)<SENSORS.idlePosition;
  }
  if(compass&&Math.abs(headingDelta(player.heading,targetHeading))>SENSORS.idleHeading)settled=false;
  if(sensorCompass&&Math.abs(headingDelta(player.chevronHeading,targetHeading))>SENSORS.idleHeading)settled=false;
 }else{
  let f=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),s=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));const length=Math.hypot(f,s);if(length>1){f/=length;s/=length;}
  const h=player.heading*Math.PI/180,nx=player.x+(Math.sin(h)*f+Math.cos(h)*s)*3*dt,ny=player.y+(Math.cos(h)*f-Math.sin(h)*s)*3*dt;
  const oldX=player.x,oldY=player.y;
  [player.x,player.y]=boundedPosition(nx,ny);updateTravelBearing(player,player.x-oldX,player.y-oldY);if(Math.hypot(nx,ny)>LIMITS.movement)notice('Edge of this prototype area. Turn back or recenter.',2000);
 }
 camera();
 if(!busy&&(Math.hypot(player.x-lastBuild[0],player.y-lastBuild[1])>12||Math.abs(headingDelta(lastStreamHeading,player.travelBearing??player.heading))>45)){busy=true;worker.postMessage({type:'rebuild',id:++requestId,x:player.x,y:player.y,heading:player.travelBearing??player.heading});}
 if(now-uiTime>200){updateUI();drawMini();uiTime=now;}
 if(keys.size||!settled)frameId=requestAnimationFrame(loop);else{metrics.fps=null;updateUI();drawMini();}
}
function start(){if(!frameId&&ready){lastTime=performance.now();frameId=requestAnimationFrame(loop);}}
function stop(){if(drag){const id=drag.id;drag=null;if($('map').hasPointerCapture(id))$('map').releasePointerCapture(id);}keys.clear();if(frameId)cancelAnimationFrame(frameId);frameId=0;document.querySelectorAll('.controls button').forEach(b=>b.classList.remove('active'));metrics.fps=null;}
const supported=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);
addEventListener('keydown',e=>{if(!supported.has(e.code)||$('guide').open||$('gps-dialog').open||$('sun-dialog').open||e.metaKey||e.ctrlKey||e.altKey)return;e.preventDefault();keys.add(e.code);start();});addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',stop);addEventListener('focus',start);
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();positioning.pause();roadWorker?.postMessage({type:'pause'});}else{positioning.resume();if(roadCacheEnabled&&!roadHold)roadWorker?.postMessage({type:'resume'});start();}});
for(const button of document.querySelectorAll('[data-key]')){button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);keys.add(button.dataset.key);button.classList.add('active');start();});button.addEventListener('lostpointercapture',()=>{keys.delete(button.dataset.key);button.classList.remove('active');});}
// A compass-follow drag temporarily owns the view; release eases back to the latest sensor heading.
$('map').addEventListener('pointerdown',e=>{if(!ready||drag||e.button!==0||!e.isPrimary)return;drag={x:e.clientX,y:e.clientY,id:e.pointerId};$('map').setPointerCapture(e.pointerId);applyMode();});
$('map').addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;
 const peek=positioning.state.mode==='gps'&&positioning.state.compass==='on'&&followCompass;
 // A sweep across 80% of the viewport covers a full circle, in either direction, without a yaw limit.
 player.heading+=(e.clientX-drag.x)*(peek?360/Math.max(1,$('map').clientWidth*.8):.18);
 player.pitch=Math.max(-20,Math.min(4,player.pitch-(e.clientY-drag.y)*.12));drag.x=e.clientX;drag.y=e.clientY;camera();updateUI();drawMini();start();});
function endLook(e){if(!drag||e.pointerId!==drag.id)return;drag=null;applyMode();start();}
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('map').addEventListener(event,endLook);
$('reset').onclick=()=>{stop();
 if(positioning.state.mode==='gps'){player.pitch=0;if(gps.target){[player.x,player.y]=gps.target;}if(positioning.state.course!==null)player.travelBearing=positioning.state.course;camera();drawMini();updateUI();start();notice(gps.target?'Snapped to the latest GPS fix.':'Waiting for a GPS fix.',2500);return;}
 Object.assign(player,{x:0,y:0,heading:38,pitch:0,travelBearing:null,chevronHeading:null});camera();drawMini();updateUI();if(!busy){busy=true;worker.postMessage({type:'rebuild',id:++requestId,x:0,y:0,heading:player.heading});}notice('Returned to the starting point.',2500);};
$('view-mode').onclick=()=>{followCompass=!followCompass;applyMode();start();notice(followCompass?'View follows the compass again.':'Free look: drag or use turn buttons. GPS still moves your position.',4000);};
function toggleGps(){if(positioning.state.mode==='gps'){followCompass=true;positioning.disable();gps.target=null;gps.rawHeading=null;gps.speed=null;gps.course=null;gps.blend=0;gps.prefetch=null;[player.x,player.y]=boundedPosition(player.x,player.y);camera();drawMini();notice('Location off. Manual exploration within 120 m of the loaded area center.',5000);}else{$('guide').close();$('gps-dialog').showModal();}}
$('gps').onclick=toggleGps;$('gps-toggle').onclick=toggleGps;$('gps-cancel').onclick=()=>$('gps-dialog').close();
$('gps-enable').onclick=()=>{$('gps-dialog').close();followCompass=true;stop();positioning.enable().then(ok=>{if(ok)notice('Waiting for your location…');});};
$('road-cache-toggle').onclick=()=>{roadCacheEnabled=!roadCacheEnabled;try{localStorage.setItem('navigator-roads-enabled',String(roadCacheEnabled));}catch{}if(roadCacheEnabled)startRoadCache();else roadWorker?.postMessage({type:'pause'});showRoadCache();};
$('road-cache-area').onclick=()=>{roadCacheEnabled=true;startRoadCache();sendRoadPosition(true);showRoadCache();};
$('road-cache-clear').onclick=()=>{roadCacheEnabled=false;try{localStorage.setItem('navigator-roads-enabled','false');}catch{}if(!roadWorker)startRoadCache();roadWorker.postMessage({type:'clear'});showRoadCache();};
$('menu').onclick=()=>{stop();$('guide').showModal();};$('close-guide').onclick=()=>$('guide').close();
$('refresh').onclick=()=>request(area.live&&area.radius?{center:area.origin,radius:area.radius,fresh:true}:{live:true});
$('stats-toggle').onclick=()=>{const hidden=!$('stats').hidden;$('stats').hidden=hidden;$('stats-toggle').setAttribute('aria-expanded',String(!hidden));updateUI();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else notice('For a full-screen view on iPhone, use Share → Add to Home Screen.',6000);}catch{notice('Fullscreen is unavailable in this browser.',4000);}};
addEventListener('offline',()=>roadWorker?.postMessage({type:'pause'}));addEventListener('online',()=>{if(roadCacheEnabled&&!roadHold)roadWorker?.postMessage({type:'resume'});});
let installPrompt;addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install').hidden=false;});$('install').onclick=async()=>{await installPrompt?.prompt();installPrompt=null;$('install').hidden=true;};
if('serviceWorker'in navigator&&import.meta.env.PROD){navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{offlineReady=true;$('offline-status').textContent='App and bundled area are ready offline. Live building areas last for this session; downloaded road packages stay on this device. iPhone: Share → Add to Home Screen.';}).catch(()=>{$('offline-status').textContent='Offline setup failed. Keep this tab online and reload to retry.';});}else $('offline-status').textContent='Offline caching is enabled in the production build.';
applyMode();
// Read-only diagnostic snapshot. Sensor state is exposed for testing; no camera APIs exist in Prototype E.
window.navigatorDiagnostics=()=>({player:{...player},viewMode:followCompass?'compass':'free',metrics:{...metrics},ready,busy,offlineReady,roadCache:{...roadCacheState,hold:roadHold,gpsPlanned:roadGpsPlanned},progress:{task:progress.task,label:progress.label,bytes:progress.bytes,total:progress.total,fraction:progressFraction(progress),detail:progress.detail,visible:!$('progress').hidden,text:$('progress-meta').textContent},street:street?{...street}:null,limits:LIMITS,area:{...area},gps:{target:gps.target?[...gps.target]:null,rawHeading:gps.rawHeading,speed:gps.speed,course:gps.course,blend:gps.blend,failures:gps.failures,retryMs:gps.retryMs,retryInMs:gps.retryAt===-Infinity?null:Math.max(0,gps.retryAt-performance.now()),prefetch:gps.prefetch,prefetching:gps.prefetching,prefetches:gps.prefetches},sun:sunCheck.snapshot(),sensors:JSON.parse(JSON.stringify(positioning.state))});
