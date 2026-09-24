import {launchTestBrowser} from './test-browser.mjs';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {toLngLat,ORIGIN} from '../src/world.js';
const browser=await launchTestBrowser();
try{
 const context=await browser.newContext({viewport:{width:1440,height:900},permissions:['geolocation'],geolocation:{longitude:ORIGIN[0],latitude:ORIGIN[1],accuracy:49}});
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>requests.push(r.url()));
 await page.goto('http://127.0.0.1:4173/navigator/');await page.waitForFunction(()=>window.navigatorDiagnostics?.().ready);
 await page.locator('#gps').click();await page.locator('#gps-enable').click();await page.waitForFunction(()=>window.navigatorDiagnostics().sensors.position==='on');
 const samples=[];
 for(const [x,y] of [[0,0],[60,0],[120,0],[120,60],[60,100],[0,100],[-60,100],[-60,40],[0,0]]){
  const [longitude,latitude]=toLngLat(x,y);await context.setGeolocation({longitude,latitude,accuracy:49});
  await page.waitForFunction(([x,y])=>{const d=window.navigatorDiagnostics();return Math.hypot(d.player.x-x,d.player.y-y)<1&&!d.busy;},[x,y]);
  await page.waitForTimeout(200);const d=await page.evaluate(()=>window.navigatorDiagnostics());samples.push(d);
  assert.equal(d.area.live,false);assert.equal(d.metrics.drawCalls,11);assert.ok(d.metrics.stream.resident<=28);assert.ok(d.metrics.vertices<=90000);assert.ok(d.metrics.buildings<=160);assert.ok(d.metrics.roadVertices<=18000);
 }
 const final=samples.at(-1);assert.ok(final.metrics.stream.evicted>0);assert.ok(final.metrics.stream.promoted>0);assert.ok(final.metrics.disposedBuffers>0);assert.equal(final.sensors.fixes.rejected,0);
 const disposed=final.metrics.disposedBuffers;await page.waitForTimeout(1000);assert.equal((await page.evaluate(()=>window.navigatorDiagnostics())).metrics.disposedBuffers,disposed);
 await fs.mkdir('test-results',{recursive:true});await page.locator('#stats-toggle').click();await page.screenshot({path:'test-results/stream-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/stream-mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.ok((await page.locator('#measurements').innerText()).includes('Resident chunks'));assert.ok(requests.every(u=>u.startsWith('http://127.0.0.1:4173/')));assert.deepEqual(errors,[]);
 const result={samples,errors,requests};await fs.writeFile('test-results/stream-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify({samples:samples.map(d=>({player:d.player,stream:d.metrics.stream,disposedBuffers:d.metrics.disposedBuffers,drawCalls:d.metrics.drawCalls})),errors},null,2));
}finally{await browser.close();}
