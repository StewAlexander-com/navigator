// Runtime reads an ingest-time graph; it never polygonizes streets or constructs edges.
const EPS=1e-5;
export const boxDistance=(b,x,y)=>Math.hypot(Math.max(b[0]-x,0,x-b[2]),Math.max(b[1]-y,0,y-b[3]));
function ringContains(r,x,y){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){
 const a=r[j],b=r[i],dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
 const t=len?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/len)):0;
 if(Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)<EPS)return true;
 if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
}return inside;}
function contains(s,x,y){return boxDistance(s.bounds,x,y)<EPS&&ringContains(s.rings[0],x,y)&&!s.rings.slice(1).some(r=>ringContains(r,x,y));}
export function validateSectorGraph(g,world,sourceHash){
 if(!g||g.version!==1||g.sourceSha256!==sourceHash||JSON.stringify(g.origin)!==JSON.stringify(world.origin)||!Array.isArray(g.sectors)||!g.sectors.length||!Array.isArray(g.chunks)||g.chunks.length>100000||g.sectors.length>100000||g.locator?.size!==128)return false;
 const bounds=b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<=b[2]&&b[1]<=b[3];
 if(!bounds(g.bounds))return false;
 const ids=new Set(g.chunks.map(c=>c.id));if(ids.size!==g.chunks.length)return false;
 for(const c of g.chunks){if(typeof c.id!=='string'||!bounds(c.bounds)||c.bounds[0]<g.bounds[0]||c.bounds[1]<g.bounds[1]||c.bounds[2]>g.bounds[2]||c.bounds[3]>g.bounds[3]||![c.x,c.y].every(Number.isFinite)||!Array.isArray(c.buildingIndices)||!Array.isArray(c.roadSegments)||c.buildingIndices.some(i=>!Number.isInteger(i)||!world.buildings[i])||c.roadSegments.some(([r,i])=>!Number.isInteger(r)||!Number.isInteger(i)||!world.roads[r]?.points[i]||!world.roads[r]?.points[i+1]))return false;}
 for(const [i,s] of g.sectors.entries()){
  if(!bounds(s.bounds)||!Array.isArray(s.rings)||!s.rings.length||s.rings.some(r=>r.length<4||r.some(p=>p.length!==2||!p.every(Number.isFinite)))||!Array.isArray(s.neighbors)||s.neighbors.some(j=>!Number.isInteger(j)||j===i||!g.sectors[j]?.neighbors?.includes(i))||!Array.isArray(s.chunks)||s.chunks.some(id=>!ids.has(id)))return false;
 }
 const connected=new Set([0]),pending=[0];for(let at=0;at<pending.length;at++)for(const j of g.sectors[pending[at]].neighbors)if(!connected.has(j)){connected.add(j);pending.push(j);}
 if(connected.size!==g.sectors.length)return false;
 const mapped=new Set(g.sectors.flatMap(s=>s.chunks));if(mapped.size!==ids.size)return false;
 const buildings=g.chunks.flatMap(c=>c.buildingIndices),roads=g.chunks.flatMap(c=>c.roadSegments.map(p=>p.join(':')));
 if(buildings.length!==world.buildings.length||new Set(buildings).size!==world.buildings.length||roads.length!==world.roads.reduce((n,r)=>n+Math.max(0,r.points.length-1),0)||new Set(roads).size!==roads.length)return false;
 if(!g.locator.cells||Object.values(g.locator.cells).some(ids=>!Array.isArray(ids)||ids.some(i=>!Number.isInteger(i)||!g.sectors[i])))return false;
 return true;
}
export function createSectorLookup(graph){
 let previous=0;const marks=new Uint32Array(graph.sectors.length);let generation=0;
 return {query(x,y,radius){
  if(boxDistance(graph.bounds,x,y)>radius+EPS)return {chunkIds:[],visited:0};
  // Outside the graph envelope, seed at the closest boundary point. The radius
  // is still measured from the real player position, not this clamped seed.
  const px=Math.max(graph.bounds[0]+EPS,Math.min(graph.bounds[2]-EPS,x)),py=Math.max(graph.bounds[1]+EPS,Math.min(graph.bounds[3]-EPS,y));
  let seed=contains(graph.sectors[previous],px,py)?previous:null;
  if(seed===null){const cell=`${Math.floor(px/graph.locator.size)}:${Math.floor(py/graph.locator.size)}`;seed=(graph.locator.cells[cell]||[]).find(i=>contains(graph.sectors[i],px,py));}
  if(seed==null)return {chunkIds:null,visited:0};previous=seed;
  if(++generation===0xffffffff){marks.fill(0);generation=1;}
  const queue=[seed],found=new Set();marks[seed]=generation;let visited=0;
  for(let at=0;at<queue.length;at++){
   const i=queue[at],s=graph.sectors[i];visited++;
   if(boxDistance(s.bounds,x,y)>radius+EPS)continue;
   for(const id of s.chunks)found.add(id);
   for(const neighbor of s.neighbors)if(marks[neighbor]!==generation){marks[neighbor]=generation;queue.push(neighbor);}
  }
  return {chunkIds:[...found],visited};
 }};
}
