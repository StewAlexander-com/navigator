// Compact visual cues, not a claim about surveyed façades or current occupancy.
export const BUILDING_STYLES=['neutral','home','apartments','storefront','office','utility','civic'];
const homes=new Set(['house','detached','semidetached_house','terrace','bungalow','cabin','farm']);
const homesMany=new Set(['apartments','residential','dormitory','hotel']);
const utility=new Set(['industrial','warehouse','garage','garages','parking','shed','barn','hangar','roof','bridge','construction','vacant']);
const civic=new Set(['civic','public','government','school','university','hospital','church','cathedral','chapel','mosque','synagogue','temple','train_station']);
const civicUses=new Set(['school','university','college','hospital','courthouse','townhall','police','fire_station','library','place_of_worship']);
const shops=new Set(['restaurant','cafe','fast_food','pub','bar','bank','pharmacy']);
const present=v=>!!v&&!['no','vacant','disused'].includes(v);
export function buildingStyle(tags,{landuse=null,height=12,area=0}={}){
 const b=String(tags.building||'yes').toLowerCase(),uses=String(tags['building:use']||'').toLowerCase().split(';');
 const shop=present(tags.shop)||shops.has(tags.amenity)||uses.includes('retail');
 let kind=0,evidence='unknown';
 if(homes.has(b))kind=1;
 else if(homesMany.has(b))kind=2;
 else if(b==='retail')kind=3;
 else if(b==='office')kind=4;
 else if(utility.has(b))kind=5;
 else if(civic.has(b))kind=6;
 if(kind)evidence='building tag';
 // A shop in apartments does not turn the upper floors into an office or shop.
 if(!kind){
  if(uses.includes('residential')||uses.includes('apartments'))kind=2;
  else if(civicUses.has(tags.amenity))kind=6;
  else if(uses.includes('industrial')||uses.includes('warehouse'))kind=5;
  else if(uses.includes('office')||present(tags.office))kind=4;
  else if(shop)kind=3;
  if(kind)evidence='use tag';
 }
 // Generic commercial is not proof of an office. Explicit unusual types remain neutral.
 if(!kind&&['yes','building'].includes(b)&&landuse){
  if(landuse==='residential')kind=height<=10&&area<=250?1:2;
  else if(landuse==='retail')kind=3;
  else if(landuse==='industrial')kind=5;
  if(kind)evidence='landuse inference';
 }
 const levels=Number(tags['building:levels']);
 const floorHeight=Number.isFinite(levels)&&levels>0?Math.max(2.4,Math.min(6,height/levels)):3.2;
 return {kind,evidence,storefront:kind===3||(shop&&[0,1,2,4].includes(kind)),floorHeight};
}
export function containsPoint(rings,p){
 function ring(r){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
 return ring(rings[0])&&!rings.slice(1).some(ring);
}
export function contextLanduse(zones,bounds){const point=[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2];return zones.find(z=>containsPoint(z.rings,point))?.use||null;}
// At most one street-facing edge; no storefronts on every courtyard/back wall.
export function storefrontEdge(building,roads){
 if(!building.style?.storefront||building.rings[0].length>128)return -1;
 const ring=building.rings[0],bounds=building.bounds,candidates=[];
 for(const r of roads){if(['footway','steps','path','cycleway'].includes(r.highway))continue;
  for(let j=1;j<r.points.length;j++){const c=r.points[j-1],d=r.points[j];
   if(Math.max(c[0],d[0])<bounds[0]-35||Math.min(c[0],d[0])>bounds[2]+35||Math.max(c[1],d[1])<bounds[1]-35||Math.min(c[1],d[1])>bounds[3]+35)continue;
   candidates.push([c,d]);if(candidates.length>=64)break;
  }if(candidates.length>=64)break;
 }
 let best=35*35,index=-1;
 for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],p=[(a[0]+b[0])/2,(a[1]+b[1])/2];
  for(const [c,d] of candidates){const dx=d[0]-c[0],dy=d[1]-c[1],n=dx*dx+dy*dy,t=n?Math.max(0,Math.min(1,((p[0]-c[0])*dx+(p[1]-c[1])*dy)/n)):0,q=(p[0]-c[0]-t*dx)**2+(p[1]-c[1]-t*dy)**2;if(q<best){best=q;index=i;}}
 }
 return index;
}
