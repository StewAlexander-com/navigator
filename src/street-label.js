// Match the player to rendered road surfaces; no route or survey-accuracy claim.
export function nearestStreet(roads,player,previous=null){
 const candidates=[];
 for(const road of roads)for(let i=1;i<road.points.length;i++){
  const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;
  if(!l)continue;
  const t=Math.max(0,Math.min(1,((player.x-a[0])*dx+(player.y-a[1])*dy)/l));
  const distance=Math.hypot(player.x-a[0]-t*dx,player.y-a[1]-t*dy);
  const surfaceDistance=Math.max(0,distance-road.width/2);
  if(surfaceDistance>3)continue;
  const path=['footway','path','pedestrian','steps','cycleway','bridleway'].includes(road.highway);
  const name=String(road.name||'').trim(),key=name||`unnamed:${road.source?.[0]??road.highway}`;
  candidates.push({key,name:name||(path?'Path name unavailable':'Street name unavailable'),kind:path?'PATH':'STREET',distance,surfaceDistance,named:!!name,insideNamedStreet:!!name&&!path&&surfaceDistance===0});
 }
 candidates.sort((a,b)=>Number(b.insideNamedStreet)-Number(a.insideNamedStreet)||a.surfaceDistance-b.surfaceDistance||a.distance-b.distance||a.key.localeCompare(b.key));
 const best=candidates[0];if(!best)return null;
 // Keep the same street through small GPS fluctuations near an intersection.
 return candidates.find(c=>c.key===previous?.key&&(!best.insideNamedStreet||c.insideNamedStreet)&&c.surfaceDistance<=best.surfaceDistance+2)||best;
}
