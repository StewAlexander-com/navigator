import {launchTestBrowser} from './test-browser.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {solarPosition} from '../src/sun.js';
const time=Date.parse('2026-09-21T19:00:00Z'),lat=34.0510824,lng=-118.2462058;
const expected=(solarPosition(time,lat,lng).azimuth+180)%360,raw=(expected-40+360)%360;
const browser=await launchTestBrowser();
try{
 const context=await browser.newContext({viewport:{width:390,height:844},permissions:['geolocation'],geolocation:{latitude:lat,longitude:lng,accuracy:8}});
 // Playwright fixes use host timestamps; restamp them into the controlled page clock.
 await context.addInitScript(()=>{const watch=navigator.geolocation.watchPosition.bind(navigator.geolocation);navigator.geolocation.watchPosition=(ok,error,options)=>watch(p=>ok({coords:p.coords,timestamp:Date.now()}),error,options);});
 const page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>requests.push(r.url()));
 await page.clock.install({time:new Date(time)});
 await page.goto('http://127.0.0.1:4173/navigator/');await page.waitForFunction(()=>window.navigatorDiagnostics?.().ready);
 await page.locator('#sun-open').click();assert.ok(await page.locator('#sun-measure').isDisabled());assert.match(await page.locator('#sun-conditions').innerText(),/Enable location/);await page.locator('#sun-close').click();
 await page.locator('#gps').click();await page.locator('#gps-enable').click();await page.waitForFunction(()=>window.navigatorDiagnostics().sensors.position==='on');
 await page.locator('#sun-open').click();
 await page.evaluate(raw=>{window.testRaw=raw;window.testBeta=0;window.testTimer=setInterval(()=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute',{alpha:(360-window.testRaw)%360,beta:window.testBeta,gamma:0,absolute:true})),150);},raw);
 await page.waitForFunction(()=>!document.getElementById('sun-measure').disabled);
 await page.waitForFunction(raw=>Math.abs(window.navigatorDiagnostics().player.heading-raw)<.2,raw);
 await page.locator('#sun-measure').click();let d=await page.evaluate(()=>window.navigatorDiagnostics());assert.ok(Math.abs(d.sun.observation.offset-40)<.1);assert.equal(d.sun.applied,false);assert.ok(Math.abs(d.player.heading-raw)<1);assert.equal(await page.locator('#sun-open').getAttribute('data-state'),'mismatch');
 await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/sun-disagreement-mobile.png'});
 await page.locator('#sun-apply').click();await page.waitForFunction(expected=>Math.abs(window.navigatorDiagnostics().player.heading-expected)<.2,expected);
 d=await page.evaluate(()=>window.navigatorDiagnostics());assert.equal(d.sun.applied,true);assert.ok(Math.abs(d.metrics.chevron.bearing-d.player.heading)<.2);assert.equal(await page.locator('#heading-source').innerText(),'SUN-ALIGNED');
 await page.screenshot({path:'test-results/sun-applied-mobile.png'});
 await page.locator('#sun-clear').click();await page.waitForFunction(raw=>Math.abs(window.navigatorDiagnostics().player.heading-raw)<.2,raw);assert.equal((await page.evaluate(()=>window.navigatorDiagnostics())).sun.applied,false);
 // Reapply then stop compass readings: stale input must remove the correction.
 await page.locator('#sun-measure').click();await page.locator('#sun-apply').click();await page.evaluate(()=>clearInterval(window.testTimer));await page.waitForFunction(()=>!window.navigatorDiagnostics().sun.applied);await page.waitForFunction(()=>document.getElementById('heading-source').textContent==='COMPASS');assert.ok(await page.locator('#sun-measure').isDisabled());
 // A fresh upright phone cannot make a shadow observation.
 await page.evaluate(()=>{window.testTimer=setInterval(()=>window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute',{alpha:0,beta:90,gamma:0,absolute:true})),150);});await page.waitForTimeout(500);assert.ok(await page.locator('#sun-measure').isDisabled());
 // Midnight: refresh the fix into the new clock; no correction may be offered.
 await page.clock.setSystemTime(new Date('2026-09-22T07:00:00Z'));await context.setGeolocation({latitude:lat,longitude:lng,accuracy:9});await page.waitForFunction(()=>document.getElementById('sun-conditions').textContent.includes('Sun too low'));assert.ok(await page.locator('#sun-measure').isDisabled());
 await page.screenshot({path:'test-results/sun-night-mobile.png'});await page.locator('#sun-close').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.navigatorDiagnostics?.().ready);assert.equal((await page.evaluate(()=>window.navigatorDiagnostics())).sun.observation,null);await page.locator('#sun-open').click();assert.match(await page.locator('#sun-conditions').innerText(),/Enable location/);
 assert.ok(requests.every(u=>u.startsWith('http://127.0.0.1:4173/')));assert.deepEqual(errors,[]);
 const result={expectedShadow:expected,rawCompass:raw,appliedSnapshot:d,offline:true,errors,requests};await fs.writeFile('test-results/sun-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
