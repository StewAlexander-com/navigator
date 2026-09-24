import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import {ORIGIN, LIMITS} from './world.js';
import {createChevron} from './chevron.js';
import {LOD} from './chunks.js';
export const TREES=Object.freeze({max:700,radius:220});
// Unit tree (1 m tall, crown radius 1): trunk to 40 % height, crown centred at 62 %. ~78 vertices, shared by every instance.
function treeModel(){
  const trunk=new THREE.CylinderGeometry(.07,.10,.45,3,1,true).rotateX(Math.PI/2).translate(0,0,.225),crown=new THREE.IcosahedronGeometry(1,1).scale(1,1,.36).translate(0,0,.62);
  const parts=[trunk.toNonIndexed(),crown],g=new THREE.BufferGeometry();let n=0;for(const p of parts)n+=p.attributes.position.count;
  const pos=new Float32Array(n*3),nor=new Float32Array(n*3),style=new Uint8Array(n*2);let at=0;
  parts.forEach((p,k)=>{p.computeVertexNormals();pos.set(p.attributes.position.array,at*3);nor.set(p.attributes.normal.array,at*3);for(let i=0;i<p.attributes.position.count;i++)style[(at+i)*2]=k+1;at+=p.attributes.position.count;});
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nor,3));g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(n*2),2));g.setAttribute('style',new THREE.BufferAttribute(style,2));return g;
}

const vertexShader = `attribute vec2 style; varying vec3 local; varying vec3 norm; varying vec2 facade; varying vec2 buildingStyle; varying float height; varying float clump;
void main(){height=0.;clump=.5;local=position;norm=normal;facade=uv;buildingStyle=style;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
// Trees: one instanced low-poly model (3-sided trunk, 20-face crown); each instance matrix carries position and size.
// Per-instance shape (0 broadleaf, 1 conifer, 2 palm) morphs one shared unit model in the vertex shader, so three
// species shapes still cost one draw call. Each instance also gets a yaw, and crown vertices a stable radial jitter
// (hash of instance position + vertex position; shared corners hash alike, so the crown never cracks).
const treeVertexShader = `attribute vec2 style; attribute float shape; varying vec3 local; varying vec3 norm; varying vec2 facade; varying vec2 buildingStyle; varying float height; varying float clump;
float h1(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
float hv(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float nv(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hv(i),hv(i+vec3(1,0,0)),f.x),mix(hv(i+vec3(0,1,0)),hv(i+vec3(1,1,0)),f.x),f.y),mix(mix(hv(i+vec3(0,0,1)),hv(i+vec3(1,0,1)),f.x),mix(hv(i+vec3(0,1,1)),hv(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main(){
 vec3 p=position,n=normal;clump=.5;vec2 id=instanceMatrix[3].xy;float yaw=h1(vec3(id,1.))*6.2832,c=cos(yaw),s=sin(yaw);
 // Per-tree seed: a hashed offset into the noise field (nearby trees no longer sample neighbouring, similar noise),
 // plus independent crown stretch, lump strength and crown-height placement.
 vec3 seed=vec3(h1(vec3(id,3.)),h1(vec3(id,7.)),h1(vec3(id,11.)))*vec3(41.,59.,23.);
 float k1=h1(vec3(id,13.)),k2=h1(vec3(id,17.)),k3=h1(vec3(id,19.)),k4=h1(vec3(id,23.));
 if(style.x>1.5){
  vec3 q=p-vec3(0,0,.62);vec3 u=normalize(position-vec3(0,0,.62))*(1.8+k3*1.4)+seed;
  float lump=.55*nv(u)+.3*nv(u*2.1+4.7)+.15*nv(u*4.3+1.9);clump=lump;
  if(shape>1.5){
   // Palm: a small crown of drooping fronds. Radial spikes come from a high-frequency angular term, varied per tree.
   float a=atan(q.y,q.x),spike=pow(abs(sin(a*(3.5+floor(k1*2.)*.5)+k2*6.2832)),2.5);
   q.xy*=(.35+1.05*spike)*(.9+.3*lump);q.z=q.z*.09+.02-dot(q.xy,q.xy)*(.06+.03*k3);
   p=vec3(0,0,.94)+q;n=normalize(mix(n,normalize(vec3(q.xy,.8)),.7));
  }else{
   float j=1.+(lump-.5)*(.45+.35*k4);q.xy*=j*vec2(.85+.3*k1,.85+.3*k2);q.z*=shape>.5?1.:mix(1.,j,.5)*(.85+.3*k3);
   vec3 soft=normalize(q*vec3(1,1,2.6));n=normalize(mix(n,soft,.85));
   if(shape>.5){float t=clamp((q.z+.36)/.72,0.,1.);p=vec3(q.xy*(1.25-t)*1.1,.14+(q.z+.36)*1.25);n=normalize(vec3(n.xy,.5));}
   // Broadleaf: crown centre between 58 % and 70 % of height, so trunk-to-crown ratio differs tree to tree.
   else p=vec3(0,0,.58+.12*k2)+q;
  }
 }else if(shape>1.5){p.xy*=mix(.75,.42,p.z/.45);p.z*=1.98;}
 // Palms lean and curve a little (quadratic in height), trunk and crown together.
 if(shape>1.5){vec2 lean=(vec2(k1,k4)-.5)*1.6;p.xy+=lean*p.z*p.z;}
 p.xy=mat2(c,s,-s,c)*p.xy;n.xy=mat2(c,s,-s,c)*n.xy;
 vec4 w=instanceMatrix*vec4(p,1.);local=w.xyz;norm=normalize(mat3(instanceMatrix)*n);facade=id;buildingStyle=vec2(style.x,shape);height=p.z;gl_Position=projectionMatrix*modelViewMatrix*w;}`;
// Contact shadow: an 8-sided disc per tree, offset away from the art-direction sun and stretched along it.
const shadowVertexShader = `varying vec2 disc; varying vec3 local;
void main(){disc=position.xy;vec3 p=position;float r=instanceMatrix[0].x,h=instanceMatrix[2].z;p.xy*=r*1.05;p.x+=.65*h*.18;p.y+=.35*h*.18;p.x*=1.;vec4 w=vec4(instanceMatrix[3].xy+p.xy,.03,1.);local=w.xyz;gl_Position=projectionMatrix*modelViewMatrix*w;}`;
const shadowFragmentShader = `precision highp float;varying vec2 disc;varying vec3 local;uniform vec2 eye;uniform float radius;
void main(){float d=distance(local.xy,eye);if(d>radius)discard;float a=(1.-smoothstep(.35,1.,length(disc)))*.34*(1.-smoothstep(radius*.5,radius,d));gl_FragColor=vec4(.08,.07,.05,a);}`;
// Analytic material cues: no textures, shadow maps, reflection targets or extra passes.
// The afternoon light is art direction, independent of the measured compass/sun check.
const fragmentShader = `precision highp float;
uniform vec2 eye; uniform float radius; uniform float fogRadius; uniform vec2 fade; uniform float kind;
varying vec3 local; varying vec3 norm; varying vec2 facade; varying vec2 buildingStyle; varying float height; varying float clump;
float grain(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){
 float d=distance(local.xy,eye);if(d>radius)discard;
 vec3 fog=vec3(.90,.85,.77);
 vec3 sun=normalize(vec3(-.65,-.35,.48));
 vec3 view=normalize(vec3(eye,1.65)-local);
 vec3 color;
 // kind 0: full-detail buildings; kind 3: far-field silhouettes (same light, no façade); 1 ground; 2 roads.
 if(kind<.5||(kind>2.5&&kind<3.5)){
  vec3 n=normalize(norm);
  // Façade detail fades out across the LOD band so near and far buildings share one surface at the boundary.
  float detail=kind>2.5?0.:1.-smoothstep(fade.x,fade.y,d);
  float light=max(dot(n,sun),0.);
  // Neutral stone: warmth comes from incident sunlight, not a brown base pigment.
  vec3 illumination=vec3(.65,.69,.75)+vec3(.38,.31,.20)*light;
  color=vec3(.83,.84,.85)*illumination;
  float stoneHighlight=pow(max(dot(n,normalize(sun+view)),0.),20.)*light;
  color+=vec3(.16,.14,.10)*stoneHighlight;
  color*=mix(.72,1.,smoothstep(0.,5.,local.z));
  // Low three bits: style kind. 8: street-facing shopfront edge. 16: a home's street-facing door edge.
  float type=mod(buildingStyle.x,8.);
  float flag=floor(buildingStyle.x/8.+.001);
  // Homes get a darker roof (flat or gabled) so the roofline reads against pale walls.
  if(abs(n.z)>=.5&&type>.5&&type<1.5)color*=vec3(.60,.55,.52);
  if(abs(n.z)<.5&&detail>0.){
   float floorH=max(2.4,buildingStyle.y*.1);
   float bay=type<.5?4.8:type<1.5?3.8:type<2.5?3.2:type<3.5?4.2:type<4.5?2.8:type<5.5?6.:4.5;
   vec2 cell=fract(facade/vec2(bay,floorH));
   float window=step(.19,cell.x)*step(cell.x,.73)*step(.22,cell.y)*step(cell.y,.79)*step(1.,local.z);
   // Residential windows have more solid wall; offices alone get broad repeated glazing.
   if(type<.5)window*=step(.38,cell.y);
   else if(type<1.5)window=step(.32,cell.x)*step(cell.x,.62)*step(.34,cell.y)*step(cell.y,.74)*step(.7,local.z);
   else if(type<2.5)window=step(.30,cell.x)*step(cell.x,.66)*step(.30,cell.y)*step(cell.y,.75)*step(.7,local.z);
   else if(type>4.5&&type<5.5)window=0.;
   else if(type>5.5)window=step(.37,cell.x)*step(cell.x,.63)*step(.18,cell.y)*step(cell.y,.84)*step(.9,local.z);
   float frame=step(.15,cell.x)*step(cell.x,.77)*step(.18,cell.y)*step(cell.y,.83)*step(1.,local.z);
   frame=type>3.5&&type<4.5?frame:window;
   if(type>4.5&&type<5.5)color*=mix(1.,.92+.08*smoothstep(.02,.08,fract(facade.x/1.6)),detail);
   // Home walls: faint horizontal siding lines; a front door in the first bay of the street-facing edge replaces its window.
   float door=0.;
   if(type>.5&&type<1.5){
    color*=1.-.05*step(.5,fract(local.z/.3))*detail;
    if(flag>1.5){door=step(.32,cell.x)*step(cell.x,.62)*step(facade.x,bay)*step(local.z,2.1);window*=1.-door;frame*=1.-door;}
   }
   window*=detail;frame*=detail;door*=detail;
   color=mix(color,vec3(.92,.93,.94)*illumination,frame);
   color=mix(color,vec3(.30,.22,.16)*illumination,door);
   // An analytic sky/ground environment creates angle-dependent glass, not scene reflections.
   vec3 reflected=reflect(-view,n);
   float sky=smoothstep(-.12,.65,reflected.z);
   vec3 glass=mix(vec3(.18,.24,.27),vec3(.59,.72,.78),sky);
   float fresnel=1.-max(dot(n,view),0.);fresnel*=fresnel;
   glass=mix(glass,vec3(.94,.88,.74),.16*fresnel*light);
   float glint=pow(max(dot(reflected,sun),0.),24.);
   glass+=vec3(.85,.70,.45)*glint;
   // Recessed top edge gives each pane depth without geometry or shadow sampling.
   glass*=mix(.76,1.,smoothstep(.22,.34,cell.y));
   if(type>1.5&&type<2.5)glass=mix(glass,vec3(.49,.52,.51),.30);
   // Home panes: no sky tint or glint; a flat dark pane reads domestic rather than curtain-wall.
   else if(type>0.5&&type<1.5)glass=mix(glass,vec3(.34,.37,.36),.75);
   // Tagged retail/mixed use gets a ground-floor display and a shallow painted fascia.
   if(flag>.5&&flag<1.5&&local.z<floorH){
    window=step(.12,cell.x)*step(cell.x,.87)*step(.18,local.z)*step(local.z,floorH*.77)*detail;
    float fascia=step(floorH*.79,local.z)*step(local.z,floorH*.94);
    color=mix(color,vec3(.22,.34,.35)*illumination,fascia*detail);
   }
   color=mix(color,glass,window);
   color*=1.-.12*step(.96,cell.y)*detail;
  }
 }else if(kind<1.5){
   color=vec3(.64,.54,.40);
   vec2 tile=abs(fract(local.xy/2.)-.5);color*=1.-.10*step(.48,max(tile.x,tile.y));
 }else if(kind>3.5){
   // Trees: trunk darker at the base; crown lit, darker underneath (self-shadow), lighter at the top, tinted per
   // instance and broken up by a 0.4 m leaf-clump grain. Palms are yellower, conifers bluer and darker.
   vec3 n=normalize(norm);float light=max(dot(n,sun),0.);float h=fract(sin(dot(facade,vec2(12.9898,78.233)))*43758.5453);
   if(buildingStyle.x<1.5)color=mix(vec3(.24,.19,.15),vec3(.42,.34,.26),smoothstep(0.,.35,height))*(.72+.4*light)*(buildingStyle.y>1.5?1.25:1.);
   else{
    vec3 leaf=buildingStyle.y>1.5?mix(vec3(.36,.44,.20),vec3(.46,.50,.24),h):buildingStyle.y>.5?mix(vec3(.16,.28,.18),vec3(.22,.34,.21),h):mix(vec3(.23,.35,.17),vec3(.37,.46,.22),h);
    // Clump value comes from the vertex-shader fBm (interpolated, so no per-pixel noise cost or shimmer).
    float f=clamp(clump,0.,1.),near=1.-smoothstep(60.,120.,d);
    // Wrapped diffuse and a sky-bounce fill keep the underside a shaded green, not a near-black band.
    float wrap=clamp((dot(n,sun)+.4)/1.4,0.,1.),under=smoothstep(-.9,.5,n.z);
    color=leaf*(.60+.52*wrap)*mix(.88,1.05,under);
    color+=vec3(.035,.05,.06)*(1.-under);
    color*=mix(1.,.78+.44*f,near);
    color+=vec3(.08,.07,.03)*pow(wrap,4.)*under*(.6+.4*f);
   }
 }else{
   // Style x: 0 two-way road, 7 one-way road, 8 road of unknown direction, 6 footway, 1 grass, 2 wood, 3 water, 4 parking, 5 plaza. Style y: road width × 10.
   float surf=buildingStyle.x,width=buildingStyle.y*.1;
   float grazing=1.-max(view.z,0.);grazing*=grazing;
   float footprint=max(fwidth(local.x*14.),fwidth(local.y*14.));
   float detail=(1.-smoothstep(8.,38.,d))*(1.-smoothstep(.35,1.,footprint));
   if(surf<.5||surf>5.5||(surf>3.5&&surf<4.5)){
    color=surf>5.5&&surf<6.5?vec3(.60,.58,.54):surf>3.5?vec3(.34,.34,.32):vec3(.29,.29,.27);
    color+=vec3(.14,.105,.055)*grazing;
    color+=(grain(floor(local.xy*14.))-.5)*.035*detail;
    // Painted markings from the quad's (along, across) coordinates: double yellow centre and white edge lines on
    // roads at least 10 m wide, faded out by 90 m so they never shimmer. No geometry is added.
    // Painted markings from the quad's (along, across) coordinates, only on roads at least 10 m wide and faded out by
    // 90 m so they never shimmer. Two-way (0): double yellow centre. One-way (7): dashed white lane divider. Roads whose
    // direction is unknown (8, older cached road packages) and one-lane one-ways stay plain. No edge lines: overlapping
    // OSM ways at junctions would paint them across the carriageway. No geometry is added.
    if(width>9.5&&(surf<.5||(surf>6.5&&surf<7.5))){
     float across=facade.y*width*.5,paint=1.-smoothstep(40.,90.,d);
     // Antialiased with the screen-space footprint; lines thinner than a pixel fade instead of shimmering.
     float a=abs(across),aa=max(fwidth(across),1e-4),thin=clamp(.12/aa,0.,1.);
     if(surf<.5){float centre=smoothstep(.08-aa,.08+aa,a)*(1.-smoothstep(.2-aa,.2+aa,a));color=mix(color,vec3(.80,.66,.25),centre*paint*thin*.85);}
     else{float fa=max(fwidth(facade.x/9.),1e-4),dash=smoothstep(0.,fa,fract(facade.x/9.))*(1.-smoothstep(.33-fa,.33+fa,fract(facade.x/9.)));float lane=1.-smoothstep(.07-aa,.07+aa,a);color=mix(color,vec3(.86,.86,.82),lane*dash*paint*thin*.75);}
    }
    if(surf>5.5&&surf<6.5){float f=fract(facade.x/1.5),fw=max(fwidth(facade.x/1.5),1e-4);color*=1.-.10*smoothstep(.94-fw,.94+fw,f)*(1.-smoothstep(.3,.9,fw*8.));}
   }else if(surf<1.5){color=vec3(.41,.50,.28)*(1.+(grain(floor(local.xy*2.))-.5)*.14);}
   else if(surf<2.5){color=vec3(.29,.38,.22)*(1.+(grain(floor(local.xy*1.5))-.5)*.2);}
   else if(surf<3.5){vec3 reflected=reflect(-view,vec3(0,0,1));color=mix(vec3(.19,.30,.34),vec3(.58,.70,.76),smoothstep(-.1,.5,reflected.z)*.55+grazing*.35);color+=vec3(.85,.70,.45)*pow(max(dot(reflected,sun),0.),40.);}
   else{color=vec3(.70,.65,.56);vec2 tile=abs(fract(local.xy/1.2)-.5);color*=1.-.08*step(.46,max(tile.x,tile.y));}
   // Roads end at their own 180 m reach; blend them into the ground before it so no edge shows in the wider fog.
   color=mix(color,vec3(.64,.54,.40),smoothstep(radius*.72,radius,d));
 }
 float haze=smoothstep(fogRadius*.35,fogRadius*.98,d);
 gl_FragColor=vec4(mix(color,fog,haze*.94),1.);
}`;
export function createWorldLayer(player, metrics, onChevronAnchor=null) {
  let renderer, scene, camera, building, far, ground, roads, surfaces, trees, shadows, map, chevron;
  const anchor=new THREE.Vector4();
  const eye=new THREE.Vector2(), projection=new THREE.Matrix4(), localMatrix=new THREE.Matrix4();
  // Local metres → Mercator. Re-anchoring a GPS area moves the origin; geometry arrives already relative to it.
  function setOrigin(origin){const mc=maplibregl.MercatorCoordinate.fromLngLat(origin), s=mc.meterInMercatorCoordinateUnits();localMatrix.makeTranslation(mc.x,mc.y,0).scale(new THREE.Vector3(s,-s,s));map?.triggerRepaint();}
  setOrigin(ORIGIN);
  // Buildings, silhouettes and ground are cut off at the far LOD radius; roads keep 180 m. One fog curve spans all of them.
  const fade=new THREE.Vector2(...LOD.fade);
  // Materials: 0 buildings, 1 ground, 2 roads (180 m), 3 silhouettes, 4 surfaces (road shader, far radius), 5 trees.
  const materials=[0,1,2,3,2,4].map((kind,i)=>new THREE.ShaderMaterial({vertexShader:kind===4?treeVertexShader:vertexShader,fragmentShader,uniforms:{eye:{value:eye},radius:{value:i===2?LIMITS.radius:i===5?TREES.radius:LOD.far},fogRadius:{value:LOD.far},fade:{value:fade},kind:{value:kind}},side:kind===4?THREE.FrontSide:THREE.DoubleSide,defaultAttributeValues:{style:[0,32],shape:[0]}}));
  // Flat layers (ground, surfaces, roads) are drawn first, in order, without depth: painter's order replaces the
  // millimetre z offsets that flickered at distance. Buildings, trees and the chevron then depth-test normally over them.
  for(const i of [1,2,4]){materials[i].depthTest=false;materials[i].depthWrite=false;}
  const shadowMaterial=new THREE.ShaderMaterial({vertexShader:shadowVertexShader,fragmentShader:shadowFragmentShader,uniforms:{eye:{value:eye},radius:{value:TREES.radius}},transparent:true,depthWrite:false});
  function geometry(data){const g=new THREE.BufferGeometry();for(const [key,size] of [['position',3],['normal',3],['uv',2]])g.setAttribute(key,new THREE.BufferAttribute(data[key],size));g.setAttribute('style',new THREE.BufferAttribute(data.style||new Uint8Array(data.position.length/3*2),2));return g;}
  const layer={id:'osm-world',type:'custom',renderingMode:'3d',setOrigin,
    onAdd(m,gl){
      map=m;scene=new THREE.Scene();camera=new THREE.Camera();
      renderer=new THREE.WebGLRenderer({canvas:m.getCanvas(),context:gl});renderer.autoClear=false;
      ground=new THREE.Mesh(new THREE.PlaneGeometry(1200,1200),materials[1]);ground.position.z=-.04;ground.frustumCulled=false;ground.renderOrder=-3;scene.add(ground);
      chevron=createChevron(player);scene.add(chevron.group);metrics.chevron=chevron.diagnostics();
    },
    setBuildings(data){
      if(building){scene.remove(building);building.geometry.dispose();metrics.disposedBuffers=(metrics.disposedBuffers||0)+1;}
      building=new THREE.Mesh(geometry(data),materials[0]);building.frustumCulled=false;scene.add(building);
      metrics.vertices=data.position.length/3;metrics.buildings=data.count;metrics.simplified=data.simplified;metrics.omitted=data.omitted;
      metrics.geometryBytes=data.position.byteLength+data.normal.byteLength+data.uv.byteLength+(data.style?.byteLength||0);
      if(data.far){
        if(far){scene.remove(far);far.geometry.dispose();metrics.disposedBuffers=(metrics.disposedBuffers||0)+1;}
        far=new THREE.Mesh(geometry(data.far),materials[3]);far.frustumCulled=false;scene.add(far);
        metrics.impostors=data.far.count;metrics.impostorVertices=data.far.position.length/3;
        metrics.geometryBytes+=data.far.position.byteLength+data.far.normal.byteLength+data.far.uv.byteLength+data.far.style.byteLength;
      }
      map.triggerRepaint();
    },
    setRoads(data){
      if(roads){scene.remove(roads);roads.geometry.dispose();metrics.disposedBuffers=(metrics.disposedBuffers||0)+1;}
      // uv = (metres along the road, −1…1 across) and style = (surface, width × 10) let the shader paint markings.
      const p=[],uv=[],st=[];
      // Footways, then service roads, then carriageways: later triangles paint over earlier ones.
      for(const road of [...data].sort((a,b)=>a.width-b.width)){let along=0;for(let i=1;i<road.points.length;i++){
        const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.01)continue;
        if(p.length/3+6>18000)break;
        const x=-dy/len*road.width/2,y=dx/len*road.width/2,surf=road.width<=2?6:road.oneway===undefined?8:road.oneway?(road.lanes===1?8:7):0,w=Math.min(255,Math.round(road.width*10));
        const v=[[a[0]+x,a[1]+y,0],[a[0]-x,a[1]-y,0],[b[0]-x,b[1]-y,0],[b[0]+x,b[1]+y,0]],t=[[along,1],[along,-1],[along+len,-1],[along+len,1]];
        for(const j of [0,1,2,0,2,3]){p.push(...v[j]);uv.push(...t[j]);st.push(surf,w);}along+=len;
      }}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(new Float32Array(p.length),3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('style',new THREE.BufferAttribute(new Uint8Array(st),2));
      roads=new THREE.Mesh(g,materials[2]);roads.frustumCulled=false;roads.renderOrder=-1;scene.add(roads);metrics.roadVertices=p.length/3;
    },
    setSurfaces(data){
      if(surfaces){scene.remove(surfaces);surfaces.geometry.dispose();metrics.disposedBuffers=(metrics.disposedBuffers||0)+1;}
      surfaces=new THREE.Mesh(geometry(data),materials[4]);surfaces.frustumCulled=false;surfaces.renderOrder=-2;scene.add(surfaces);metrics.surfaceVertices=data.position.length/3;metrics.surfaces=data.count;map?.triggerRepaint();
    },
    // `packed` is [x, y, height, crown radius] × n. The instance buffer is allocated once at TREES.max and reused.
    setTrees(packed){
      if(!trees){
        const model=treeModel();model.setAttribute('shape',new THREE.InstancedBufferAttribute(new Float32Array(TREES.max),1));
        trees=new THREE.InstancedMesh(model,materials[5],TREES.max);trees.frustumCulled=false;scene.add(trees);
        const disc=new THREE.CircleGeometry(1,8);shadows=new THREE.InstancedMesh(disc,shadowMaterial,TREES.max);shadows.instanceMatrix=trees.instanceMatrix;shadows.frustumCulled=false;shadows.renderOrder=1;scene.add(shadows);
      }
      const m=new THREE.Matrix4(),n=Math.min(TREES.max,packed.length/5),shape=trees.geometry.attributes.shape;
      for(let i=0;i<n;i++){const [x,y,h,r,k]=packed.subarray(i*5,i*5+5);m.makeScale(r,r,h).setPosition(x,y,0);trees.setMatrixAt(i,m);shape.array[i]=k;}
      trees.count=shadows.count=n;trees.instanceMatrix.needsUpdate=true;shape.needsUpdate=true;metrics.trees=n;map?.triggerRepaint();
    },
    render(gl,args){
      eye.set(player.x,player.y);
      chevron.update();
      projection.fromArray(args.defaultProjectionData.mainMatrix);
      camera.projectionMatrix.copy(projection).multiply(localMatrix);
      if(onChevronAnchor){
        // Center the pill at the camera’s 1.65 m eye level, independently of the lower chevron.
        anchor.set(chevron.group.position.x,chevron.group.position.y,1.65,1).applyMatrix4(camera.projectionMatrix);
        onChevronAnchor({x:(anchor.x/anchor.w+1)*map.getCanvas().clientWidth/2,y:(1-anchor.y/anchor.w)*map.getCanvas().clientHeight/2,visible:anchor.w>0&&Math.abs(anchor.x)<anchor.w&&Math.abs(anchor.y)<anchor.w});
      }
      renderer.resetState();renderer.render(scene,camera);
      metrics.drawCalls=renderer.info.render.calls;metrics.triangles=renderer.info.render.triangles;metrics.renderedFrames++;
      metrics.chevron.bearing=player.chevronHeading??player.heading;
    },
    onRemove(){for(const object of [building,far,ground,roads,surfaces,trees,shadows])object?.geometry.dispose();chevron?.dispose();materials.forEach(m=>m.dispose());renderer?.dispose();}
  };return layer;
}
