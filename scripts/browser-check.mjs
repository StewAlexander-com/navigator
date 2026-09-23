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
await page.keyboard.up('KeyW');assert.ok(Math.hypot(moving.player.x,moving.player.y)>10);assert.equal(moving.metrics.drawCalls,7);
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
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/mobile.png'});
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
d=await diag(gpsPage);assert.ok(Math.abs(d.player.travelBearing)<1,`course ${d.player.travelBearing}`);assert.equal(d.metrics.drawCalls,7);assert.ok(d.metrics.fps>0);
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
await gpsPage.setViewportSize({width:390,height:844});await gpsPage.waitForTimeout(300);await gpsPage.screenshot({path:'test-results/gps-mobile.png'});assert.equal(await gpsPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
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
await driveContext.addInitScript(()=>{const watchers=new Map();let nextId=0;
 window.__fix=c=>{const position={coords:{latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy??4,altitude:null,altitudeAccuracy:null,heading:c.heading??null,speed:c.speed??null},timestamp:Date.now()};for(const ok of watchers.values())ok(position);};
 navigator.geolocation.watchPosition=ok=>{watchers.set(++nextId,ok);return nextId;};navigator.geolocation.clearWatch=id=>{watchers.delete(id);};});
const drivePage=await driveContext.newPage();drivePage.on('pageerror',e=>driveErrors.push(e.message));drivePage.on('console',m=>{if(m.type()==='error')driveErrors.push(m.text());});drivePage.on('request',r=>driveRequests.push(r.url()));
await drivePage.goto('http://127.0.0.1:4173/navigator/');await drivePage.waitForFunction(()=>window.navigatorDiagnostics?.().ready,null,{timeout:20000});
await drivePage.locator('#gps').click();await drivePage.locator('#gps-enable').click();await drivePage.waitForTimeout(300);
await drivePage.evaluate(h=>window.__fix({latitude:h.latitude,longitude:h.longitude,accuracy:4,speed:0,heading:null}),HOME);
await drivePage.waitForFunction(()=>window.navigatorDiagnostics().sensors.fixes.accepted>=1,null,{timeout:10000});
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
const driveOverpass=driveRequests.filter(u=>u.startsWith('https://overpass-api.de/')).length;assert.ok(driveOverpass>=1&&driveOverpass<=5,`${driveOverpass} Overpass requests`);
assert.ok(driveRequests.filter(u=>!u.startsWith('http://127.0.0.1:4173/')).every(u=>u.startsWith('https://overpass-api.de/')));assert.deepEqual(driveErrors,[]);
await drivePage.locator('#stats-toggle').click();await drivePage.screenshot({path:'test-results/drive.png'});await driveContext.close();
const gps={firstFixMs,easeMs,final:await diag(gpsPage),drive:{frames:probe.length,maxStepM:maxStep,travelledM:travelled,overpassRequests:driveOverpass,heading:drive.player.heading,fixes:drive.sensors.fixes}};
const results={errors,badResponses,requests,moving,offline,viewport:{width:390,height:844},overflow,gps};await fs.writeFile('test-results/browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
await browser.close();
