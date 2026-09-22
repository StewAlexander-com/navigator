import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseWorld} from '../src/world.js';
import {validateSectorGraph} from '../src/sectors.js';
const raw=await fs.readFile('public/osm-snapshot.json'),graph=JSON.parse(await fs.readFile('public/osm-sectors.json'));
if(!validateSectorGraph(graph,parseWorld(JSON.parse(raw)),createHash('sha256').update(raw).digest('hex')))throw new Error('Missing, stale or invalid sector graph. Run npm run ingest:sectors with the documented Python environment.');
console.log(`Sector graph matches snapshot: ${graph.sectors.length} sectors, ${graph.chunks.length} chunks.`);
