import {launchTestBrowser} from './test-browser.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await launchTestBrowser();
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();const errors=[],requests=[],badResponses=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>requests.push(r.url()));page.on('response',r=>{if(r.status()>=400)badResponses.push([r.url(),r.status()]);});
await page.goto('http://127.0.0.1:4173/navigator/');
await page.waitForFunction(()=>window.navigatorDiagnostics?.().ready,null,{timeout:20000});
await page.waitForTimeout(1000);
await fs.mkdir('test-results',{recursive:true});
await page.screenshot({path:'test-results/desktop.png'});
await page.keyboard.down('KeyW');await page.waitForTimeout(5000);
const moving=await page.evaluate(()=>window.navigatorDiagnostics());
await page.keyboard.up('KeyW');assert.ok(Math.hypot(moving.player.x,moving.player.y)>10);assert.equal(moving.metrics.drawCalls,11);
// The startup progress strip has gone once the bundled area is ready.
assert.equal(moving.progress.visible,false);assert.equal(moving.progress.task,null);assert.equal(await page.locator('#progress').isVisible(),false);
await page.mouse.move(600,400);await page.mouse.down();await page.mouse.move(700,400);await page.mouse.up();
assert.ok(Math.abs((await page.evaluate(()=>window.navigatorDiagnostics())).player.travelBearing-38)<.01);
await page.locator('#reset').click();await page.keyboard.down('KeyD');await page.waitForTimeout(250);await page.keyboard.up('KeyD');
await page.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().metrics.chevron.bearing-38)<.1);
await page.locator('#reset').click();await page.keyboard.down('KeyS');await page.waitForTimeout(250);await page.keyboard.up('KeyS');
await page.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().metrics.chevron.bearing-38)<.1);
await page.locator('#reset').click();await page.waitForFunction(()=>!window.navigatorDiagnostics().busy);assert.equal((await page.evaluate(()=>window.navigatorDiagnostics())).player.x,0);
await page.mouse.move(600,400);await page.mouse.down();await page.mouse.move(750,400);await page.mouse.up();assert.ok((await page.evaluate(()=>window.navigatorDiagnostics())).player.heading>38);
await page.locator('#reset').click();await page.locator('#menu').click();assert.ok(await page.locator('#guide').isVisible());await page.keyboard.press('Escape');assert.equal(await page.locator('#guide').isVisible(),false);
await page.locator('#stats-toggle').click();assert.ok(await page.locator('#stats').isVisible());await page.locator('#stats-toggle').click();
await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await page.reload();try{await page.waitForFunction(()=>window.navigatorDiagnostics?.().ready,null,{timeout:12000});}catch(e){console.log(JSON.stringify({errors,badResponses,body:await page.locator('body').innerText(),diagnostics:await page.evaluate(()=>window.navigatorDiagnostics?.()),cache:await page.evaluate(async()=>Promise.all((await caches.keys()).map(async k=>[k,(await(await caches.open(k)).keys()).map(r=>r.url)])))}));throw e;}const offline=await page.evaluate(()=>window.navigatorDiagnostics());assert.ok(offline.ready);assert.ok(offline.street?.name);await context.setOffline(false);
await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);await page.screenshot({path:'test-results/mobile.png'});assert.equal((await page.evaluate(()=>window.navigatorDiagnostics())).layout.overlaps,0);assert.equal((await page.evaluate(()=>window.navigatorDiagnostics())).layout.fixedOverlaps,0);
await page.locator('[data-key="KeyW"]').hover();await page.mouse.down();await page.waitForTimeout(500);await page.mouse.up();assert.ok((await page.evaluate(()=>window.navigatorDiagnostics())).player.y>0);
await page.locator('#menu').click();await page.screenshot({path:'test-results/mobile-guide.png'});await page.locator('#close-guide').click();
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
await page.goto('http://127.0.0.1:4173/navigator/architecture.html');await page.screenshot({path:'test-results/architecture.png',fullPage:true});
assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);assert.ok(requests.every(url=>url.startsWith('http://127.0.0.1:4173/')));
// Prototype B: GPS + compass through the real Geolocation API (Playwright-supplied fixes) and synthetic absolute orientation events.
await context.close();
const HOME={latitude:34.0510824,longitude:-118.2462058};const diag=p=>p.evaluate(()=>window.navigatorDiagnostics());
const gpsContext=await browser.newContext({viewport:{width:1440,height:900},geolocation:{...HOME,accuracy:8},permissions:['geolocation']});
const gpsRequests=[],gpsErrors=[];
// A live re-anchor calls Overpass. The route answers with the bundled, real OSM snapshot so the check stays offline-deterministic.
await gpsContext.route('https://overpass-api.de/**',route=>route.fulfill({path:'public/osm-snapshot.json',contentType:'application/json'}));
const gpsPage=await gpsContext.newPage();gpsPage.on('pageerror',e=>gpsErrors.push(e.message));gpsPage.on('console',m=>{if(m.type()==='error')gpsErrors.push(m.text());});gpsPage.on('request',r=>gpsRequests.push(r.url()));
await gpsPage.goto('http://127.0.0.1:4173/navigator/');await gpsPage.waitForFunction(()=>window.navigatorDiagnostics?.().ready,null,{timeout:20000});
await gpsPage.locator('#gps').click();assert.ok(await gpsPage.locator('#gps-dialog').isVisible());await gpsPage.screenshot({path:'test-results/gps-dialog.png'});
const gpsStart=Date.now();await gpsPage.locator('#gps-enable').click();
try{await gpsPage.waitForFunction(()=>window.navigatorDiagnostics().sensors.fixes.accepted>=1,null,{timeout:10000});}catch(e){console.log(JSON.stringify({sensors:(await diag(gpsPage)).sensors,notice:await gpsPage.locator('#notice').innerText(),gpsErrors,permission:await gpsPage.evaluate(()=>navigator.permissions.query({name:'geolocation'}).then(p=>p.state))}));throw e;}const firstFixMs=Date.now()-gpsStart;
let d=await diag(gpsPage);assert.equal(d.sensors.mode,'gps');assert.equal(d.sensors.position,'on');assert.ok(Math.hypot(d.player.x,d.player.y)<.5);assert.equal(d.sensors.accuracy,8);
assert.equal(await gpsPage.locator('#position-label').innerText(),'GPS POSITION · ±8 M'.replace(' M',' m'));assert.equal(await gpsPage.locator('.controls .move').first().isVisible(),false);
// Walk 33 m north in one fix (after 2.5 s, a plausible pace): position must ease to the target and the chevron must show the northbound course.
await gpsPage.waitForTimeout(2500);await gpsContext.setGeolocation({latitude:HOME.latitude+.0003,longitude:HOME.longitude,accuracy:8});
const easeStart=Date.now();await gpsPage.waitForFunction(()=>window.navigatorDiagnostics().player.y>30,null,{timeout:10000});const easeMs=Date.now()-easeStart;
d=await diag(gpsPage);assert.ok(Math.abs(d.player.travelBearing)<1,`course ${d.player.travelBearing}`);assert.equal(d.metrics.drawCalls,11);assert.ok(d.metrics.fps>0);
// Compass: device upright (beta 90) with alpha 270 faces east. Dragging temporarily looks around, then returns to the compass heading.
await gpsPage.evaluate(()=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute',{alpha:270,beta:90,gamma:0,absolute:true})));
await gpsPage.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().player.heading-90)<.5,null,{timeout:5000});
d=await diag(gpsPage);assert.equal(d.sensors.headingSource,'compass');assert.equal(d.sensors.rawHeading,90);assert.equal(await gpsPage.locator('#heading-source').innerText(),'COMPASS');
await gpsPage.mouse.move(600,400);await gpsPage.mouse.down();await gpsPage.mouse.move(800,400);assert.ok(Math.abs((await diag(gpsPage)).player.heading-90)>20);await gpsPage.mouse.up();await gpsPage.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().player.heading-90)<.05);
const headingCheck=await diag(gpsPage);assert.ok(Math.abs(headingCheck.metrics.chevron.bearing-headingCheck.player.heading)<.1);assert.ok(Math.abs(headingCheck.player.travelBearing)<1);assert.equal(headingCheck.metrics.chevron.height,.75);
await gpsPage.evaluate(()=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute',{alpha:0,beta:90,gamma:0,absolute:true})));
await gpsPage.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().player.heading)<.5||window.navigatorDiagnostics().player.heading>359.5,null,{timeout:5000});
// An inaccurate fix is counted but never moves the view.
await gpsContext.setGeolocation({latitude:HOME.latitude+.0003,longitude:HOME.longitude+.001,accuracy:120});
await gpsPage.waitForFunction(()=>window.navigatorDiagnostics().sensors.fixes.rejected>=1,null,{timeout:5000});
d=await diag(gpsPage);assert.equal(d.sensors.fixes.lastReason,'inaccurate');assert.ok(Math.abs(d.player.x)<1);
// Walk north in 20 m steps at a plausible pace until the 180 m view radius leaves the bundled box; a live 800 m square must be re-anchored on the fix.
for(let i=4;i<=22;i+=2){await gpsContext.setGeolocation({latitude:HOME.latitude+i*.0001,longitude:HOME.longitude,accuracy:8});await gpsPage.waitForTimeout(650);}
await gpsPage.waitForFunction(()=>window.navigatorDiagnostics().area.live===true&&!window.navigatorDiagnostics().busy,null,{timeout:20000});
d=await diag(gpsPage);const north=(d.area.origin[1]-HOME.latitude)/.0001;assert.ok(north>=10&&north<=22&&Math.abs(d.area.origin[0]-HOME.longitude)<1e-9,`origin ${d.area.origin}`);assert.equal(d.area.radius,400);assert.ok(d.area.bbox[0]<HOME.latitude,'bbox spans south of the start');assert.equal(d.area.provider,'Overpass');const expectedY=(HOME.latitude+.0022-d.area.origin[1])*111319.49;assert.ok(Math.abs(d.player.y-expectedY)<12&&Math.abs(d.player.x)<1,`player ${d.player.x},${d.player.y} vs ${expectedY}`);assert.ok(d.metrics.buildings>0);assert.equal(d.sensors.fixes.rejected,1);
assert.ok(gpsRequests.filter(u=>!u.startsWith('http://127.0.0.1:4173/')).every(u=>u.startsWith('https://overpass-api.de/')));assert.equal(gpsRequests.filter(u=>u.startsWith('https://overpass-api.de/')).length,1);
await gpsPage.waitForTimeout(800);await gpsPage.locator('#stats-toggle').click();await gpsPage.screenshot({path:'test-results/gps.png'});await gpsPage.locator('#stats-toggle').click();
await gpsPage.setViewportSize({width:390,height:844});await gpsPage.waitForTimeout(300);await gpsPage.screenshot({path:'test-results/gps-mobile.png'});assert.equal(await gpsPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal((await diag(gpsPage)).layout.overlaps,0);assert.equal((await diag(gpsPage)).layout.fixedOverlaps,0);
// Stopping returns to manual controls at the current place.
await gpsPage.locator('#gps').click();d=await diag(gpsPage);assert.equal(d.sensors.mode,'manual');assert.equal(d.sensors.position,'off');
const before=(await diag(gpsPage)).player;await gpsPage.keyboard.down('KeyW');await gpsPage.waitForTimeout(400);await gpsPage.keyboard.up('KeyW');assert.ok(Math.hypot((await diag(gpsPage)).player.x-before.x,(await diag(gpsPage)).player.y-before.y)>.5);
assert.deepEqual(gpsErrors,[]);
// Denied geolocation permission: the app must stay usable in manual mode and say so.
const deniedContext=await browser.newContext({viewport:{width:1440,height:900}});const deniedPage=await deniedContext.newPage();const deniedErrors=[];deniedPage.on('pageerror',e=>deniedErrors.push(e.message));
await deniedPage.goto('http://127.0.0.1:4173/navigator/');await deniedPage.waitForFunction(()=>window.navigatorDiagnostics?.().ready,null,{timeout:20000});
await deniedPage.locator('#menu').click();await deniedPage.locator('#gps-toggle').click();await deniedPage.locator('#gps-enable').click();
await deniedPage.waitForFunction(()=>window.navigatorDiagnostics().sensors.error==='denied',null,{timeout:10000});
d=await diag(deniedPage);assert.equal(d.sensors.mode,'manual');assert.ok((await deniedPage.locator('#notice').innerText()).includes('denied'));
await deniedPage.keyboard.down('KeyW');await deniedPage.waitForTimeout(300);await deniedPage.keyboard.up('KeyW');assert.ok((await diag(deniedPage)).player.y>0);assert.deepEqual(deniedErrors,[]);
// Driving at 60 mph (27 m/s due north, 1 Hz, ±4 m). Playwright 1.62 drops coords.speed/heading, so fixes are dispatched
// through a page-side watchPosition shim that supplies them exactly. A synthetic in-car compass jitters ±30° at 10 Hz.
const driveContext=await browser.newContext({viewport:{width:1440,height:900},permissions:['geolocation']});const driveErrors=[],driveRequests=[];
await driveContext.route('https://overpass-api.de/**',route=>route.fulfill({path:'public/osm-snapshot.json',contentType:'application/json'}));
const fixShim=()=>{const watchers=new Map();let nextId=0;
 window.__fix=c=>{const position={coords:{latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy??4,altitude:null,altitudeAccuracy:null,heading:c.heading??null,speed:c.speed??null},timestamp:Date.now()};for(const ok of watchers.values())ok(position);};
 navigator.geolocation.watchPosition=ok=>{watchers.set(++nextId,ok);return nextId;};navigator.geolocation.clearWatch=id=>{watchers.delete(id);};};
await driveContext.addInitScript(fixShim);
const drivePage=await driveContext.newPage();drivePage.on('pageerror',e=>driveErrors.push(e.message));drivePage.on('console',m=>{if(m.type()==='error')driveErrors.push(m.text());});drivePage.on('request',r=>driveRequests.push(r.url()));
await drivePage.goto('http://127.0.0.1:4173/navigator/');await drivePage.waitForFunction(()=>window.navigatorDiagnostics?.().ready,null,{timeout:20000});
await drivePage.locator('#gps').click();await drivePage.locator('#gps-enable').click();await drivePage.waitForTimeout(300);
// Until the first fix the pill shows a tqdm-style acquisition strip with an elapsed clock.
const acquiring=await diag(drivePage);assert.equal(acquiring.progress.task,'gps');assert.equal(acquiring.progress.visible,true);assert.ok(acquiring.progress.label.includes('GPS'));assert.ok(/^\d\d:\d\d/.test(acquiring.progress.text),acquiring.progress.text);assert.ok(await drivePage.locator('#progress').isVisible());await drivePage.screenshot({path:'test-results/progress-gps.png'});
// GPS comes on already at speed: the 25-mile road plan must not start (driving hold) until a stop or an explicit tap.
await drivePage.evaluate(h=>window.__fix({latitude:h.latitude,longitude:h.longitude,accuracy:4,speed:27,heading:0}),HOME);
await drivePage.waitForFunction(()=>window.navigatorDiagnostics().sensors.fixes.accepted>=1,null,{timeout:10000});assert.notEqual((await diag(drivePage)).progress.task,'gps');
await drivePage.waitForFunction(()=>window.navigatorDiagnostics().roadCache.hold===true,null,{timeout:5000});assert.equal((await diag(drivePage)).roadCache.gpsPlanned,false);
// At 27 m/s the 122 m of runway left in the bundled box is under eight seconds of travel, so the next square is prefetched
// while the bundled area still covers the fix; the later edge swap must then reuse it instead of downloading at the edge.
await drivePage.waitForFunction(()=>window.navigatorDiagnostics().gps.prefetch!==null,null,{timeout:10000});
const prefetched=await diag(drivePage);assert.equal(prefetched.area.live,false,'prefetch happened while still in the bundled area');assert.equal(prefetched.gps.prefetch.radius,1000);assert.equal(driveRequests.filter(u=>u.startsWith('https://overpass-api.de/')).length,1);
// Per-frame probe in absolute metres north of HOME (independent of re-anchoring), plus the noisy compass.
await drivePage.evaluate(lat=>{window.__probe=[];const M=111319.49;(function sample(){const d=window.navigatorDiagnostics();window.__probe.push([performance.now(),d.player.y+(d.area.origin[1]-lat)*M,d.player.heading]);requestAnimationFrame(sample);})();
 let t=0;window.__compass=setInterval(()=>{t+=.1;window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute',{alpha:360-(90+30*Math.sin(t)),beta:0,gamma:0,absolute:true}));},100);},HOME.latitude);
await drivePage.waitForFunction(()=>window.navigatorDiagnostics().sensors.compass==='on',null,{timeout:5000});
const DRIVE_S=30,M=111319.49;
for(let s=1;s<=DRIVE_S;s++){await drivePage.evaluate(c=>window.__fix(c),{latitude:HOME.latitude+27*s/M,longitude:HOME.longitude,accuracy:4,speed:27,heading:0});await drivePage.waitForTimeout(1000);}
await drivePage.waitForTimeout(500);const drive=await diag(drivePage);const probe=await drivePage.evaluate(()=>{clearInterval(window.__compass);return window.__probe;});
assert.equal(drive.sensors.fixes.rejected,0,`rejected ${drive.sensors.fixes.rejected} (${drive.sensors.fixes.lastReason})`);assert.equal(drive.sensors.fixes.accepted,DRIVE_S+1);
assert.ok(drive.sensors.fixIntervalMs<1500,`fix interval ${drive.sensors.fixIntervalMs}`);assert.equal(drive.gps.speed,27);assert.equal(drive.gps.blend,1);
// The camera heading follows the 0° GPS course despite a compass swinging 60–120°; the chevron shares it.
assert.ok(Math.abs(((drive.player.heading%360)+540)%360-180)<5,`heading ${drive.player.heading}`);assert.ok(Math.abs(((drive.metrics.chevron.bearing%360)+540)%360-180)<5);
assert.equal(await drivePage.locator('#heading-source').innerText(),'GPS COURSE');
// Continuity: no per-frame teleport (the pre-fix failure mode was a 108 m snap every 4 s) and no backwards motion.
let maxStep=0,backwards=0;for(let i=1;i<probe.length;i++){const step=probe[i][1]-probe[i-1][1];maxStep=Math.max(maxStep,step);if(step<-0.05)backwards++;}
assert.ok(probe.length>DRIVE_S*10,`only ${probe.length} frames sampled`);assert.ok(maxStep<10,`max per-frame step ${maxStep} m`);assert.equal(backwards,0,`${backwards} backwards frames`);
const travelled=probe[probe.length-1][1]-probe[0][1];assert.ok(travelled>27*DRIVE_S*.8&&travelled<27*DRIVE_S*1.1,`travelled ${travelled} m`);
// 835 m at 60 mph: the prefetched 2 km square covers the whole drive, so exactly one download; the swap came from the session cache.
const driveOverpass=driveRequests.filter(u=>u.startsWith('https://overpass-api.de/')).length;assert.equal(driveOverpass,1,`${driveOverpass} Overpass requests`);
assert.equal(drive.area.live,true);assert.equal(drive.area.cached,true);assert.equal(drive.area.radius,1000);assert.equal(drive.gps.failures,0);assert.ok(drive.gps.prefetches>=1);
assert.ok(driveRequests.filter(u=>!u.startsWith('http://127.0.0.1:4173/')).every(u=>u.startsWith('https://overpass-api.de/')));assert.deepEqual(driveErrors,[]);
// The hold lasted the whole drive with no GPS-centred plan; the field guide's Cache this area tap releases it explicitly.
assert.equal(drive.roadCache.hold,true);assert.equal(drive.roadCache.gpsPlanned,false);
await drivePage.locator('#stats-toggle').click();await drivePage.screenshot({path:'test-results/drive.png'});
await drivePage.locator('#menu').click();await drivePage.locator('#road-cache-area').click();
const released=await diag(drivePage);assert.equal(released.roadCache.hold,false);assert.equal(released.roadCache.gpsPlanned,true);await driveContext.close();
// Rate limited: Overpass answers 429 with Retry-After 45. The app must wait at least that long, escalate nothing else, and never
// hit the OSM API as a second provider for a rate limit.
const limitContext=await browser.newContext({viewport:{width:1440,height:900},geolocation:{...HOME,accuracy:8},permissions:['geolocation']});const limitRequests=[],limitErrors=[];
// Retry-After is not CORS-safelisted; without Access-Control-Expose-Headers a cross-origin fetch cannot read it and the app uses 60 s.
await limitContext.route('https://overpass-api.de/**',route=>route.fulfill({status:429,headers:{'retry-after':'45','access-control-allow-origin':'*','access-control-expose-headers':'retry-after'},body:'rate limited'}));
await limitContext.route('https://api.openstreetmap.org/**',route=>route.fulfill({status:500,body:'must not be called'}));
const limitPage=await limitContext.newPage();limitPage.on('pageerror',e=>limitErrors.push(e.message));limitPage.on('console',m=>{if(m.type()==='error')limitErrors.push(m.text());});limitPage.on('request',r=>limitRequests.push(r.url()));
await limitPage.goto('http://127.0.0.1:4173/navigator/');await limitPage.waitForFunction(()=>window.navigatorDiagnostics?.().ready,null,{timeout:20000});
await limitPage.locator('#gps').click();await limitPage.locator('#gps-enable').click();await limitPage.waitForFunction(()=>window.navigatorDiagnostics().sensors.fixes.accepted>=1,null,{timeout:10000});
for(let i=4;i<=22;i+=2){await limitContext.setGeolocation({latitude:HOME.latitude+i*.0001,longitude:HOME.longitude,accuracy:8});await limitPage.waitForTimeout(650);}
await limitPage.waitForFunction(()=>window.navigatorDiagnostics().gps.failures>=1,null,{timeout:20000});
let limited=await diag(limitPage);assert.equal(limited.gps.failures,1);assert.equal(limited.gps.retryMs,45000);assert.ok(limited.gps.retryInMs>40000&&limited.gps.retryInMs<=45000,`retry in ${limited.gps.retryInMs}`);
assert.ok((await limitPage.locator('#notice').innerText()).includes('next attempt in 45 s'));assert.equal(limited.area.live,false);assert.ok(limited.metrics.buildings>0,'the bundled scene stays usable');
// Further fixes during the hold add no requests.
for(let i=24;i<=28;i+=2){await limitContext.setGeolocation({latitude:HOME.latitude+i*.0001,longitude:HOME.longitude,accuracy:8});await limitPage.waitForTimeout(650);}
assert.equal(limitRequests.filter(u=>u.startsWith('https://overpass-api.de/')).length,1);assert.equal(limitRequests.filter(u=>u.startsWith('https://api.openstreetmap.org/')).length,0);assert.deepEqual(limitErrors,[]);
await limitContext.close();
// Mebane, NC: a real tag-poor suburban square (tests/fixtures/mebane-800m.json, a genuine Overpass response, © OpenStreetMap
// contributors, ODbL) where every footprint is bare building=yes. Most must classify as homes, none as offices, and a
// 60 mph drive through it must not teleport the camera.
const MEBANE={latitude:36.099202,longitude:-79.3491509};
// Centre of OSM way/1179878853, a 173 m² building=yes footprint 30 m from the square centre that classifies as a home.
const HOUSE={latitude:36.0994689,longitude:-79.3492096};
const mebaneContext=await browser.newContext({viewport:{width:1440,height:900},permissions:['geolocation']});const mebaneErrors=[],mebaneRequests=[];
// The first Overpass answer is held for 1.5 s so the download progress strip can be observed while the request is in flight.
let mebaneAnswers=0;await mebaneContext.route('https://overpass-api.de/**',async route=>{if(mebaneAnswers++===0)await new Promise(r=>setTimeout(r,1500));await route.fulfill({path:/\(36\.\d+,-79\./.test(decodeURIComponent(route.request().url()))?'tests/fixtures/mebane-800m.json':'public/osm-snapshot.json',contentType:'application/json'});});
await mebaneContext.addInitScript(fixShim);
const mebanePage=await mebaneContext.newPage();mebanePage.on('pageerror',e=>mebaneErrors.push(e.message));mebanePage.on('console',m=>{if(m.type()==='error')mebaneErrors.push(m.text());});mebanePage.on('request',r=>mebaneRequests.push(r.url()));
await mebanePage.goto('http://127.0.0.1:4173/navigator/');await mebanePage.waitForFunction(()=>window.navigatorDiagnostics?.().ready,null,{timeout:20000});
await mebanePage.locator('#gps').click();await mebanePage.locator('#gps-enable').click();await mebanePage.waitForTimeout(300);
await mebanePage.evaluate(c=>window.__fix(c),{...HOUSE,accuracy:4,speed:0,heading:null});
await mebanePage.waitForFunction(()=>window.navigatorDiagnostics().progress.task==='area',null,{timeout:5000});await mebanePage.waitForTimeout(600);
const downloading=await diag(mebanePage);assert.equal(downloading.progress.visible,true);assert.ok(downloading.progress.label.startsWith('Downloading the OpenStreetMap area'),downloading.progress.label);assert.ok(/00:0\d/.test(downloading.progress.text),downloading.progress.text);assert.ok(await mebanePage.locator('#progress').isVisible());await mebanePage.screenshot({path:'test-results/progress-download.png'});
await mebanePage.waitForFunction(()=>{const d=window.navigatorDiagnostics();return d.area.live===true&&!d.busy&&d.area.kinds&&d.metrics.buildings>0;},null,{timeout:20000});await mebanePage.waitForTimeout(800);
let mb=await diag(mebanePage);assert.equal(mb.progress.visible,false);assert.equal(mb.progress.task,null);
// Indoor hint: a ±4 m fix at the house centre is "probably inside"; two ±40 m fixes there carry too little depth and the pill hides.
await mebanePage.waitForFunction(()=>window.navigatorDiagnostics().indoor.verdict?.level==='likely',null,{timeout:5000});
const inside=await diag(mebanePage);assert.equal(inside.indoor.visible,true);assert.equal(inside.indoor.located.id,'way/1179878853');assert.equal(inside.indoor.verdict.text,'You are probably inside a home');assert.ok(await mebanePage.locator('#indoor-pill').isVisible());assert.equal(await mebanePage.locator('#indoor-text').innerText(),'You are probably inside a home');assert.ok((await mebanePage.locator('#indoor-meta').innerText()).includes('HIGH CONFIDENCE'));
await mebanePage.screenshot({path:'test-results/indoor-hint.png'});
// Overlay layout: nothing floats on top of anything else at desktop, phone or short-phone sizes. Pills move to a free slot
// first (phone: the indoor pill is pushed below the notice at full size) and shrink only when no slot fits (short phone).
const layoutAt=async(w,h)=>{await mebanePage.setViewportSize({width:w,height:h});await mebanePage.waitForTimeout(600);const d=await diag(mebanePage);assert.equal(d.layout.overlaps,0,`${w}x${h}: ${d.layout.overlaps} overlapping overlays`);assert.equal(d.layout.fixedOverlaps,0,`${w}x${h}: fixed UI overlaps`);assert.equal(d.indoor.visible,true);assert.equal(await mebanePage.locator('#notice').isVisible(),true);return d.layout;};
const desktopLayout=await layoutAt(1440,900);assert.equal(desktopLayout.placements['indoor-pill'].scale,1);
const phoneLayout=await layoutAt(390,844);assert.equal(phoneLayout.placements['indoor-pill'].scale,1);assert.equal(phoneLayout.placements['indoor-pill'].moved,true);assert.ok(phoneLayout.placements['indoor-pill'].rect.y>=phoneLayout.placements.notice.rect.y+phoneLayout.placements.notice.rect.h);await mebanePage.screenshot({path:'test-results/layout-phone.png'});
const shortLayout=await layoutAt(390,600);assert.equal(shortLayout.placements['indoor-pill'].shrunk,true);assert.ok(shortLayout.placements['indoor-pill'].scale<1&&shortLayout.placements['indoor-pill'].scale>=.6,`scale ${shortLayout.placements['indoor-pill'].scale}`);await mebanePage.screenshot({path:'test-results/layout-short-phone.png'});
await mebanePage.setViewportSize({width:1440,height:900});await mebanePage.waitForTimeout(400);
for(let i=0;i<2;i++){await mebanePage.evaluate(c=>window.__fix(c),{...HOUSE,accuracy:40,speed:0,heading:null});await mebanePage.waitForTimeout(400);}
await mebanePage.waitForFunction(()=>window.navigatorDiagnostics().indoor.verdict===null,null,{timeout:5000});assert.equal(await mebanePage.locator('#indoor-pill').isVisible(),false);assert.equal((await diag(mebanePage)).indoor.located.id,'way/1179878853');assert.equal(mb.area.provider,'Overpass');assert.equal(mb.area.radius,400);assert.equal(mb.area.prior,true);
assert.equal(mb.area.kinds.reduce((a,b)=>a+b,0),153);assert.ok(mb.area.kinds[1]>=120,`homes ${mb.area.kinds}`);assert.equal(mb.area.kinds[4],0);assert.equal(mb.area.kinds[6],5);
assert.ok(mb.metrics.buildings>=20,`buildings ${mb.metrics.buildings}`);assert.equal(mb.metrics.drawCalls,11);assert.ok(mb.metrics.vertices<=90000);assert.ok(mb.metrics.fps===null||mb.metrics.fps>0);
await mebanePage.evaluate(()=>{document.getElementById('notice-text').textContent='';});await mebanePage.screenshot({path:'test-results/mebane.png'});
// Drive north out of Elizabeth Lane at 27 m/s for 12 s: every fix accepted, no per-frame step above 10 m, nothing backwards.
await mebanePage.evaluate(lat=>{window.__probe=[];const M=111319.49;(function sample(){const d=window.navigatorDiagnostics();window.__probe.push([performance.now(),d.player.y+(d.area.origin[1]-lat)*M]);requestAnimationFrame(sample);})();},MEBANE.latitude);
for(let s=1;s<=12;s++){await mebanePage.evaluate(c=>window.__fix(c),{latitude:HOUSE.latitude+27*s/M,longitude:HOUSE.longitude,accuracy:5,speed:27,heading:0});await mebanePage.waitForTimeout(1000);}
await mebanePage.waitForTimeout(500);mb=await diag(mebanePage);const mebaneProbe=await mebanePage.evaluate(()=>window.__probe);
let mebaneStep=0,mebaneBack=0;for(let i=1;i<mebaneProbe.length;i++){const step=mebaneProbe[i][1]-mebaneProbe[i-1][1];mebaneStep=Math.max(mebaneStep,step);if(step<-0.05)mebaneBack++;}
assert.equal(mb.sensors.fixes.rejected,0);assert.equal(mb.sensors.fixes.accepted,15);assert.equal(mb.indoor.verdict,null,'never "inside" while driving');assert.ok(mebaneProbe.length>100);assert.ok(mebaneStep<10,`max step ${mebaneStep}`);assert.equal(mebaneBack,0);
assert.ok(mebaneRequests.filter(u=>u.startsWith('https://overpass-api.de/')).length<=2);assert.ok(mebaneRequests.filter(u=>!u.startsWith('http://127.0.0.1:4173/')).every(u=>u.startsWith('https://overpass-api.de/')));assert.deepEqual(mebaneErrors,[]);
await mebaneContext.close();
const gps={firstFixMs,easeMs,final:await diag(gpsPage),drive:{frames:probe.length,maxStepM:maxStep,travelledM:travelled,overpassRequests:driveOverpass,heading:drive.player.heading,fixes:drive.sensors.fixes},mebane:{kinds:mb.area.kinds,buildings:mb.metrics.buildings,maxStepM:mebaneStep,frames:mebaneProbe.length}};
const results={errors,badResponses,requests,moving,offline,viewport:{width:390,height:844},overflow,gps};await fs.writeFile('test-results/browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
await browser.close();
