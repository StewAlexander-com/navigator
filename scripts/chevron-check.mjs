import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:900,height:700}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await fs.mkdir('test-results',{recursive:true});
 await page.goto('http://127.0.0.1:5173/navigator/tests/chevron.html');
 await page.waitForFunction(()=>window.checkOcclusion);
 const isolated={};for(const [name,value] of [['clear',false],['full',true],['partial','partial'],['behind','behind']])isolated[name]=await page.evaluate(v=>window.checkOcclusion(v),value);
 assert.ok(isolated.clear.cyan>100);assert.equal(isolated.full.cyan,0);assert.ok(isolated.partial.cyan>0&&isolated.partial.cyan<isolated.clear.cyan);assert.equal(isolated.behind.cyan,isolated.clear.cyan);
 await page.goto('http://127.0.0.1:5173/navigator/tests/chevron-world.html');await page.waitForFunction(()=>window.checkWorldOcclusion);
 const clear=await page.evaluate(()=>window.checkWorldOcclusion(false));await page.screenshot({path:'test-results/chevron-world-clear.png'});
 const blocked=await page.evaluate(()=>window.checkWorldOcclusion(true));await page.screenshot({path:'test-results/chevron-world-blocked.png'});
 const restored=await page.evaluate(()=>window.checkWorldOcclusion(false));
 assert.ok(clear.cyan>100);assert.equal(blocked.cyan,0);assert.equal(restored.cyan,clear.cyan);assert.equal(blocked.metrics.drawCalls,11);assert.deepEqual(errors,[]);
 const result={isolated,world:{clear,blocked,restored},errors};await fs.writeFile('test-results/chevron-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
