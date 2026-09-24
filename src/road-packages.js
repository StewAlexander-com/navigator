// Roads-only OSM package geometry and coverage planning. Distances are metres.
// `driveSpeed`/`holdReleaseMs`: GPS enabled above 8 m/s defers the bulk plan until a minute of standstill or an explicit tap.
export const ROAD_CACHE=Object.freeze({radius:40233.6,refreshDistance:20116.8,step:.1,maxLevel:3,responseBytes:4*1024*1024,diskBytes:128*1024*1024,activeSegments:2400,viewRadius:300,minRequestMs:5000,maxAgeMs:7*86400000,driveSpeed:8,holdReleaseMs:60000});
const R=6371008.8,D=Math.PI/180;
export const wrap=x=>((x+180)%360+360)%360-180;
export function distance(a,b){const p=a[1]*D,q=b[1]*D,dl=wrap(b[0]-a[0])*D,dp=q-p;return 2*R*Math.asin(Math.min(1,Math.sqrt(Math.sin(dp/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(dl/2)**2)));}
// Azimuthal equidistant coordinates keep distance from the cache center exact.
export function local(p,c){const a=c[1]*D,b=p[1]*D,l=wrap(p[0]-c[0])*D,d=Math.acos(Math.max(-1,Math.min(1,Math.sin(a)*Math.sin(b)+Math.cos(a)*Math.cos(b)*Math.cos(l))));const k=d<1e-10?1:d/Math.sin(d);return [R*k*Math.cos(b)*Math.sin(l),R*k*(Math.cos(a)*Math.sin(b)-Math.sin(a)*Math.cos(b)*Math.cos(l))];}
function geographic(p,c){const rho=Math.hypot(...p);if(rho<1e-8)return [...c];const q=rho/R,a=c[1]*D,s=Math.sin(q),co=Math.cos(q);return [wrap(c[0]+Math.atan2(p[0]*s,rho*Math.cos(a)*co-p[1]*Math.sin(a)*s)/D),Math.asin(co*Math.sin(a)+p[1]*s*Math.cos(a)/rho)/D];}
export function tile(level,x,y){const step=ROAD_CACHE.step/2**level,n=Math.round(360/step);x=((x%n)+n)%n;return {id:`${level}/${x}/${y}`,level,x,y,bbox:[-90+y*step,-180+x*step,-90+(y+1)*step,-180+(x+1)*step]};}
export function corners(b){return [[b[1],b[0]],[b[3],b[0]],[b[3],b[2]],[b[1],b[2]]];}
export function boxDistance(b,c){const pts=corners(b).map(p=>local(p,c)),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);return Math.hypot(Math.max(Math.min(...xs),0,-Math.max(...xs)),Math.max(Math.min(...ys),0,-Math.max(...ys)));}
export function inside(b,c,r=ROAD_CACHE.radius){return corners(b).every(p=>distance(p,c)<=r);}
export function plan(center){
 if(!center.every(Number.isFinite)||Math.abs(center[1])>84)throw new Error('Road packages support locations between 84° south and north.');
 const dy=ROAD_CACHE.radius/(R*D),dx=dy/Math.cos((Math.abs(center[1])+dy)*D),out=[];
 for(let y=Math.floor((center[1]-dy+90)/.1);y<=Math.floor((center[1]+dy+90)/.1);y++)for(let x=Math.floor((center[0]-dx+180)/.1);x<=Math.floor((center[0]+dx+180)/.1);x++){
  const t=tile(0,x,y);if(boxDistance(t.bbox,center)<=ROAD_CACHE.radius+100)out.push(t);
 }
 return out.sort((a,b)=>boxDistance(a.bbox,center)-boxDistance(b.bbox,center));
}
export const children=t=>[tile(t.level+1,t.x*2,t.y*2),tile(t.level+1,t.x*2+1,t.y*2),tile(t.level+1,t.x*2,t.y*2+1),tile(t.level+1,t.x*2+1,t.y*2+1)];
export const descendant=(child,parent)=>child.level>parent.level&&Math.floor(child.x/2**(child.level-parent.level))===parent.x&&Math.floor(child.y/2**(child.level-parent.level))===parent.y;
export function refinePlan(tiles,known,center){return tiles.flatMap(t=>known.some(k=>descendant(k,t))?refinePlan(children(t).filter(c=>boxDistance(c.bbox,center)<=ROAD_CACHE.radius+100),known,center):[t]);}
export const query=t=>`[out:json][timeout:25][maxsize:33554432];/* navigator-road-packages */way[highway](${t.bbox.join(',')});out tags geom(${t.bbox.join(',')});`;
// Clip to a tile rectangle before retaining data; Overpass can include outside nodes.
function rectangle(a,b,bounds){let lo=0,hi=1;const dx=b[0]-a[0],dy=b[1]-a[1];for(const [p,q] of [[-dx,a[0]-bounds[1]],[dx,bounds[3]-a[0]],[-dy,a[1]-bounds[0]],[dy,bounds[2]-a[1]]]){if(!p){if(q<0)return null;}else{const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;}}return [[a[0]+lo*dx,a[1]+lo*dy],[a[0]+hi*dx,a[1]+hi*dy]];}
function circle(a,b,c,r){
 const p=local(a,c),q=local(b,c),dx=q[0]-p[0],dy=q[1]-p[1],aa=dx*dx+dy*dy;if(aa<1e-8)return null;
 const bb=2*(p[0]*dx+p[1]*dy),cc=p[0]*p[0]+p[1]*p[1]-r*r,disc=bb*bb-4*aa*cc;if(disc<0)return null;
 const lo=Math.max(0,(-bb-Math.sqrt(disc))/(2*aa)),hi=Math.min(1,(-bb+Math.sqrt(disc))/(2*aa));if(lo>=hi)return null;
 return [geographic([p[0]+lo*dx,p[1]+lo*dy],c),geographic([p[0]+hi*dx,p[1]+hi*dy],c)];
}
export function parsePackage(raw,t,center){
 if(!raw||raw.remark||!Array.isArray(raw.elements)||raw.elements.length>50000)throw Object.assign(new Error('OSM returned incomplete road data.'),{split:true});
 const roads=[];let points=0;
 for(const way of raw.elements){
  if(way.type!=='way'||!way.tags?.highway||!Array.isArray(way.geometry))continue;
  const h=way.tags.highway,width=['footway','path','steps','pedestrian','cycleway','bridleway'].includes(h)?2:h==='service'?5:14;
  for(let i=1;i<way.geometry.length;i++){
   const aa=way.geometry[i-1],bb=way.geometry[i];if(!aa||!bb)continue;
   const a=[aa.lon,aa.lat],b=[bb.lon,bb.lat];if(![...a,...b].every(Number.isFinite)||Math.abs(a[1])>90||Math.abs(b[1])>90)throw new Error('Invalid road coordinates.');
   const mid=(t.bbox[1]+t.bbox[3])/2;a[0]=mid+wrap(a[0]-mid);b[0]=mid+wrap(b[0]-mid);
   const segment=rectangle(a,b,t.bbox);if(!segment)continue;
   // A 5 cm inward margin avoids retaining endpoints outside the radius through roundoff.
   const clipped=circle(...segment,center,ROAD_CACHE.radius-.05);if(!clipped)continue;
   for(const p of clipped){p[0]=Math.max(t.bbox[1],Math.min(t.bbox[3],mid+wrap(p[0]-mid)));p[1]=Math.max(t.bbox[0],Math.min(t.bbox[2],p[1]));}
   if(clipped.some(p=>distance(p,center)>ROAD_CACHE.radius))continue;
   roads.push({id:`${way.id}:${i}`,name:String(way.tags.name||'').slice(0,255),highway:h,width,oneway:['yes','-1','true','1'].includes(String(way.tags.oneway))||['motorway','motorway_link'].includes(h)||way.tags.junction==='roundabout',lanes:parseInt(way.tags.lanes)||null,points:clipped});
   if(++points>60000)throw Object.assign(new Error('Dense road package needs smaller areas.'),{split:true});
  }
 }
 return roads;
}
export function roadBounds(roads){let s=90,w=180,n=-90,e=-180;for(const r of roads)for(const [x,y] of r.points){w=Math.min(w,x);e=Math.max(e,x);s=Math.min(s,y);n=Math.max(n,y);}return roads.length?[s,w,n,e]:null;}
export function activeRoads(roads,center,origin){
 const selected=[];
 for(const r of roads){const a=local(r.points[0],center),b=local(r.points[1],center),dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/length)):0,viewDistance=Math.hypot(a[0]+t*dx,a[1]+t*dy);if(viewDistance<=ROAD_CACHE.viewRadius)selected.push({...r,viewDistance});}
 return selected.sort((a,b)=>a.viewDistance-b.viewDistance).slice(0,ROAD_CACHE.activeSegments).map(r=>({...r,points:r.points.map(p=>{const m=111319.49079327358;return [wrap(p[0]-origin[0])*m*Math.cos(origin[1]*D),(p[1]-origin[1])*m];})}));
}
