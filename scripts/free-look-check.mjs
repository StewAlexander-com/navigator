import {launchTestBrowser} from './test-browser.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await launchTestBrowser();
try{
 const home={latitude:34.0510824,longitude:-118.2462058,accuracy:8};
 const context=await browser.newContext({viewport:{width:1440,height:900},geolocation:home,permissions:['geolocation']});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const diag=()=>page.evaluate(()=>window.navigatorDiagnostics());
 const compass=heading=>page.evaluate(h=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute',{alpha:(360-h)%360,beta:90,gamma:0,absolute:true})),heading);
 await page.goto('http://127.0.0.1:4173/navigator/');await page.waitForFunction(()=>window.navigatorDiagnostics?.().ready);
 assert.equal(await page.locator('#view-mode').isVisible(),false);
 await page.locator('#gps').click();await page.locator('#gps-enable').click();await page.waitForFunction(()=>window.navigatorDiagnostics().sensors.position==='on');
 await compass(90);await page.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().player.heading-90)<.2);
 assert.equal((await diag()).viewMode,'compass');assert.equal((await diag()).metrics.stream.lookupMode,'sector graph');assert.equal(await page.locator('.controls .turn').first().isVisible(),false);
 const drag=async()=>{await page.mouse.move(600,400);await page.mouse.down();await page.mouse.move(800,400);await page.mouse.up();};
 await drag();await page.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().player.heading-90)<.2);
 // Full circles in both directions while held, including a changed phone heading.
 for(const direction of [1,-1]){
  await page.mouse.move(direction===1?100:1300,450);await page.mouse.down();
  const initial=(await diag()).player.heading;
  await page.mouse.move(direction===1?1300:100,450,{steps:12});
  const held=(await diag()).player.heading;assert.ok((held-initial)*direction>360);
  await compass(180);await page.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().metrics.chevron.bearing-180)<.2);
  assert.equal((await diag()).player.heading,held);assert.equal((await diag()).sensors.rawHeading,180);
  assert.ok(Math.abs((await diag()).metrics.chevron.bearing-180)<1);
  await page.mouse.up();await page.waitForFunction(()=>Math.abs(((window.navigatorDiagnostics().player.heading-180+540)%360)-180)<.2);
  await compass(90);await page.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().player.heading-90)<.2);
 }
 // Real browser touch input on a phone viewport, including cancellation.
 await page.setViewportSize({width:390,height:844});const touch=await context.newCDPSession(page);
 await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true});
 for(const direction of [1,-1]){
  const initial=(await diag()).player.heading;
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:direction===1?20:370,y:480}]});
  for(let i=1;i<=10;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:direction===1?20+i*35:370-i*35,y:480}]});
  await page.waitForFunction(({initial,direction})=>Math.abs(window.navigatorDiagnostics().player.heading-initial-direction*350*360/(390*.8))<.2,{initial,direction});
  const held=(await diag()).player.heading;assert.ok((held-initial)*direction>360);
  await page.waitForTimeout(300);assert.equal((await diag()).player.heading,held);
  await touch.send('Input.dispatchTouchEvent',{type:direction===1?'touchEnd':'touchCancel',touchPoints:[]});
  await page.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().player.heading-90)<.2);
 }
 await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});await touch.detach();await page.setViewportSize({width:1440,height:900});
 console.log('Compass look-around: full circles both ways, held view, latest-heading return and touch release/cancel passed.');
 await page.locator('#view-mode').click();assert.equal(await page.locator('#heading-source').innerText(),'FREE LOOK');assert.equal(await page.locator('#view-mode').getAttribute('aria-pressed'),'true');assert.ok(await page.locator('.controls .turn').first().isVisible());
 await drag();let d=await diag();const freeHeading=d.player.heading;assert.ok(freeHeading>120);assert.equal(d.sensors.rawHeading,90);assert.equal(d.sensors.mode,'gps');assert.ok(Math.abs(d.metrics.chevron.bearing-90)<.2);
 await compass(180);await page.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().metrics.chevron.bearing-180)<.2);d=await diag();assert.equal(d.sensors.rawHeading,180);assert.equal(d.player.heading,freeHeading);
 await context.setGeolocation({...home,latitude:home.latitude+.00015});await page.waitForFunction(()=>window.navigatorDiagnostics().player.y>14);d=await diag();assert.equal(d.player.heading,freeHeading);assert.equal(d.sensors.rawHeading,180);
 await page.keyboard.down('ArrowLeft');await page.waitForTimeout(400);await page.keyboard.up('ArrowLeft');assert.ok((await diag()).player.heading<freeHeading-10);
 await fs.mkdir('test-results',{recursive:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/free-look-mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('#view-mode').click();await page.waitForFunction(()=>Math.abs(window.navigatorDiagnostics().player.heading-180)<.2);assert.equal((await diag()).viewMode,'compass');assert.equal(await page.locator('.controls .turn').first().isVisible(),false);
 await page.locator('#view-mode').click();await page.locator('#gps').click();assert.equal((await diag()).viewMode,'compass');assert.equal((await diag()).sensors.mode,'manual');assert.equal(await page.locator('#view-mode').isVisible(),false);
 assert.deepEqual(errors,[]);await fs.writeFile('test-results/free-look-results.json',JSON.stringify({freeHeading,freeSnapshot:d,final:await diag(),errors},null,2));console.log('GPS free look: default following, independent drag/turn, live position, resume compass and reset all passed.');
 // Missing or stale graph is optional: the same area must remain usable via radius fallback.
 const fallback=await browser.newContext();await fallback.route('**/osm-sectors.json',route=>route.fulfill({json:{version:1,sourceSha256:'stale'}}));const p=await fallback.newPage();await p.goto('http://127.0.0.1:4173/navigator/');await p.waitForFunction(()=>window.navigatorDiagnostics?.().ready);assert.equal((await p.evaluate(()=>window.navigatorDiagnostics())).metrics.stream.lookupMode,'radius fallback');console.log('Stale graph fallback passed.');
 const noCrypto=await browser.newContext();await noCrypto.route('**/assets/world.worker-*.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:"Object.defineProperty(globalThis,'crypto',{value:null});\n"+await response.text()});});const plain=await noCrypto.newPage();await plain.goto('http://127.0.0.1:4173/navigator/');await plain.waitForFunction(()=>window.navigatorDiagnostics?.().ready);assert.equal((await plain.evaluate(()=>window.navigatorDiagnostics())).metrics.stream.lookupMode,'radius fallback');console.log('Unavailable WebCrypto fallback passed.');
}finally{await browser.close();}
