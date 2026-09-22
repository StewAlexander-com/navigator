import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {parseWorld} from '../src/world.js';
import {createChunkIndex} from '../src/chunks.js';
import {createSectorLookup,boxDistance} from '../src/sectors.js';
const world=parseWorld(JSON.parse(await fs.readFile('public/osm-snapshot.json'))),graph=JSON.parse(await fs.readFile('public/osm-sectors.json'));
const index=createChunkIndex(world),all=[...index.values()],lookup=createSectorLookup(graph),points=[];
for(let y=-240;y<=240;y+=24)for(let x=-240;x<=240;x+=24)points.push([x,y]);
const order=(a,b)=>a.d-b.d||a.id.localeCompare(b.id);
const radius=(x,y)=>all.map(c=>({id:c.id,d:boxDistance(c.bounds,x,y)})).sort(order).filter(c=>c.d<=308).map(c=>c.id);
const sector=(x,y)=>{const result=lookup.query(x,y,308);return (result.chunkIds||[...index.keys()]).map(id=>({id,d:boxDistance(index.get(id).bounds,x,y)})).sort(order).filter(c=>c.d<=308).map(c=>c.id);};
for(const [x,y] of points)assert.deepEqual(sector(x,y),radius(x,y),`query ${x},${y}`);
for(let n=0;n<3;n++)for(const [x,y] of points){radius(x,y);sector(x,y);}
const runs=20;let t=performance.now();for(let n=0;n<runs;n++)for(const [x,y] of points)radius(x,y);const radiusMs=performance.now()-t;
t=performance.now();for(let n=0;n<runs;n++)for(const [x,y] of points)sector(x,y);const sectorMs=performance.now()-t;
const result={queries:points.length*runs,parityPoints:points.length,chunks:all.length,sectors:graph.sectors.length,radiusTotalMs:radiusMs,sectorTotalMs:sectorMs,radiusMeanMs:radiusMs/(runs*points.length),sectorMeanMs:sectorMs/(runs*points.length)};
await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/sector-benchmark.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
