import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.NAVIGATOR_URL||'http://127.0.0.1:4173/navigator/';
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},permissions:['geolocation'],geolocation:{latitude:34.0510824,longitude:-118.2462058,accuracy:8}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>window.navigatorDiagnostics?.().ready);
 const pill=page.locator('#street-pill');await pill.waitFor({state:'visible'});
 const demo=await page.evaluate(()=>window.navigatorDiagnostics());assert.ok(demo.street?.name);assert.equal(demo.metrics.drawCalls,7);
 assert.equal(await pill.evaluate(e=>getComputedStyle(e).pointerEvents),'none');assert.equal(await page.locator('#street-name').innerText(),demo.street.name);
 const box=await pill.boundingBox();assert.ok(box.x>0&&box.x+box.width<390);assert.ok(box.height<60);assert.ok(Math.abs(box.y+box.height/2-844/2)<2,'pill centers on the eye-level sightline');
 // A gesture beginning on the label must still reach the map.
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+60,box.y+box.height/2);await page.mouse.up();
 assert.ok((await page.evaluate(()=>window.navigatorDiagnostics())).player.heading>demo.player.heading+5);
 await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/street-pill-demo.png'});
 await page.locator('#gps').click();await page.locator('#gps-enable').click();await page.waitForFunction(()=>window.navigatorDiagnostics().sensors.position==='on');
 await page.evaluate(()=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute',{alpha:270,beta:90,gamma:0,absolute:true})));
 await page.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().player.heading-90)<.1);
 assert.equal(await page.locator('#street-name').innerText(),demo.street.name);await pill.waitFor({state:'visible'});
 await page.screenshot({path:'test-results/street-pill-gps.png'});
 await page.setViewportSize({width:1440,height:900});await page.screenshot({path:'test-results/street-pill-desktop.png'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({demoStreet:demo.street,liveStreet:(await page.evaluate(()=>window.navigatorDiagnostics())).street,box,errors}));
}finally{await browser.close();}
