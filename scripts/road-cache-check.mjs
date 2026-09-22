import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseWorld,toLngLat} from '../src/world.js';
const world=parseWorld(JSON.parse(await fs.readFile('public/osm-snapshot.json','utf8')));
const fixture={elements:world.roads.map((r,id)=>({type:'way',id,tags:{highway:r.highway,name:r.name},geometry:r.points.map(p=>{const [lon,lat]=toLngLat(...p);return {lon,lat};})}))};
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});let requests=0;
 await context.route('**/api/interpreter?*',async route=>{assert.ok(decodeURIComponent(route.request().url()).includes('navigator-road-packages'));requests++;await route.fulfill({json:fixture});});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.NAVIGATOR_URL||'http://127.0.0.1:4173/navigator/');
 await page.waitForFunction(()=>window.navigatorDiagnostics?.().roadCache.complete>=1);
 const first=await page.evaluate(()=>window.navigatorDiagnostics());assert.ok(first.roadCache.bytes>0);assert.equal(first.street.name,'South Spring Street');assert.equal(first.street.kind,'STREET');assert.equal(first.metrics.drawCalls,7);
 await page.locator('#menu').click();await page.locator('#road-cache-toggle').click();await page.waitForFunction(()=>window.navigatorDiagnostics().roadCache.phase==='paused');await page.locator('#close-guide').click();
 const installed=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('navigator-road-packages');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,q=db.transaction('meta').objectStore('meta').getAll();q.onsuccess=()=>{resolve(q.result);db.close();};};}));assert.ok(installed.length>=1);assert.ok(installed.every(m=>m.hash.length===64));
 await page.screenshot({path:'test-results/road-cache-mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 // Re-enable the saved preference without unpausing the running downloader, then restart offline.
 await page.evaluate(()=>localStorage.setItem('navigator-roads-enabled','true'));
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await page.reload();
 await page.waitForFunction(()=>window.navigatorDiagnostics?.().roadCache.packages>=1);assert.equal((await page.evaluate(()=>window.navigatorDiagnostics())).street.name,'South Spring Street');
 // A second tab must be read-only while the first owns storage.
 const second=await context.newPage();await second.goto(process.env.NAVIGATOR_URL||'http://127.0.0.1:4173/navigator/');await second.waitForFunction(()=>window.navigatorDiagnostics?.().roadCache.packages>=1);await second.close();
 await page.locator('#menu').click();await page.locator('#road-cache-clear').click();await page.waitForFunction(()=>window.navigatorDiagnostics().roadCache.phase==='cleared');
 const remaining=await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('navigator-road-packages');r.onsuccess=()=>{const db=r.result,tx=db.transaction(['meta','payload']);const m=tx.objectStore('meta').count(),p=tx.objectStore('payload').count();tx.oncomplete=()=>{resolve([m.result,p.result]);db.close();};};}));assert.deepEqual(remaining,[0,0]);assert.deepEqual(errors,[]);
 const result={requests,installedPackages:installed.length,first:first.roadCache,remaining,errors};await fs.writeFile('test-results/road-cache-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
