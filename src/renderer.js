import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import {ORIGIN, LIMITS} from './world.js';
import {createChevron} from './chevron.js';

const vertexShader = `attribute vec2 style; varying vec3 local; varying vec3 norm; varying vec2 facade; varying vec2 buildingStyle;
void main(){local=position;norm=normal;facade=uv;buildingStyle=style;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
// Analytic material cues: no textures, shadow maps, reflection targets or extra passes.
// The afternoon light is art direction, independent of the measured compass/sun check.
const fragmentShader = `precision highp float;
uniform vec2 eye; uniform float radius; uniform float kind;
varying vec3 local; varying vec3 norm; varying vec2 facade; varying vec2 buildingStyle;
float grain(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){
 float d=distance(local.xy,eye);if(d>radius)discard;
 vec3 fog=vec3(.90,.85,.77);
 vec3 sun=normalize(vec3(-.65,-.35,.48));
 vec3 view=normalize(vec3(eye,1.65)-local);
 vec3 color;
 if(kind<.5){
  vec3 n=normalize(norm);
  float light=max(dot(n,sun),0.);
  // Neutral stone: warmth comes from incident sunlight, not a brown base pigment.
  vec3 illumination=vec3(.65,.69,.75)+vec3(.38,.31,.20)*light;
  color=vec3(.83,.84,.85)*illumination;
  float stoneHighlight=pow(max(dot(n,normalize(sun+view)),0.),20.)*light;
  color+=vec3(.16,.14,.10)*stoneHighlight;
  color*=mix(.72,1.,smoothstep(0.,5.,local.z));
  if(abs(n.z)<.5){
   float type=mod(buildingStyle.x,8.);
   float floorH=max(2.4,buildingStyle.y*.1);
   float bay=type<.5?4.8:type<1.5?3.8:type<2.5?3.2:type<3.5?4.2:type<4.5?2.8:type<5.5?6.:4.5;
   vec2 cell=fract(facade/vec2(bay,floorH));
   float window=step(.19,cell.x)*step(cell.x,.73)*step(.22,cell.y)*step(cell.y,.79)*step(1.,local.z);
   // Residential windows have more solid wall; offices alone get broad repeated glazing.
   if(type<.5)window*=step(.38,cell.y);
   else if(type<2.5)window=step(.30,cell.x)*step(cell.x,.66)*step(.30,cell.y)*step(cell.y,.75)*step(.7,local.z);
   else if(type>4.5&&type<5.5)window=0.;
   else if(type>5.5)window=step(.37,cell.x)*step(cell.x,.63)*step(.18,cell.y)*step(cell.y,.84)*step(.9,local.z);
   float frame=step(.15,cell.x)*step(cell.x,.77)*step(.18,cell.y)*step(cell.y,.83)*step(1.,local.z);
   frame=type>3.5&&type<4.5?frame:window;
   if(type>4.5&&type<5.5)color*=.92+.08*smoothstep(.02,.08,fract(facade.x/1.6));
   color=mix(color,vec3(.92,.93,.94)*illumination,frame);
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
   if(type>0.5&&type<2.5)glass=mix(glass,vec3(.49,.52,.51),.30);
   // Tagged retail/mixed use gets a ground-floor display and a shallow painted fascia.
   if(buildingStyle.x>7.5&&local.z<floorH){
    window=step(.12,cell.x)*step(cell.x,.87)*step(.18,local.z)*step(local.z,floorH*.77);
    float fascia=step(floorH*.79,local.z)*step(local.z,floorH*.94);
    color=mix(color,vec3(.22,.34,.35)*illumination,fascia);
   }
   color=mix(color,glass,window);
   color*=1.-.12*step(.96,cell.y);
  }
 }else if(kind<1.5){
   color=vec3(.64,.54,.40);
   vec2 tile=abs(fract(local.xy/2.)-.5);color*=1.-.10*step(.48,max(tile.x,tile.y));
 }else{
   color=vec3(.29,.29,.27);
   // Broad, restrained grazing sheen reads as worn aggregate rather than a wet mirror.
   float grazing=1.-max(view.z,0.);grazing*=grazing;
   color+=vec3(.14,.105,.055)*grazing;
   float footprint=max(fwidth(local.x*14.),fwidth(local.y*14.));
   float detail=(1.-smoothstep(8.,38.,d))*(1.-smoothstep(.35,1.,footprint));
   color+=(grain(floor(local.xy*14.))-.5)*.035*detail;
 }
 float haze=smoothstep(radius*.35,radius*.98,d);
 gl_FragColor=vec4(mix(color,fog,haze*.94),1.);
}`;
export function createWorldLayer(player, metrics, onChevronAnchor=null) {
  let renderer, scene, camera, building, ground, roads, map, chevron;
  const anchor=new THREE.Vector4();
  const eye=new THREE.Vector2(), projection=new THREE.Matrix4(), localMatrix=new THREE.Matrix4();
  // Local metres → Mercator. Re-anchoring a GPS area moves the origin; geometry arrives already relative to it.
  function setOrigin(origin){const mc=maplibregl.MercatorCoordinate.fromLngLat(origin), s=mc.meterInMercatorCoordinateUnits();localMatrix.makeTranslation(mc.x,mc.y,0).scale(new THREE.Vector3(s,-s,s));map?.triggerRepaint();}
  setOrigin(ORIGIN);
  const materials=[0,1,2].map(kind=>new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms:{eye:{value:eye},radius:{value:LIMITS.radius},kind:{value:kind}},side:THREE.DoubleSide,defaultAttributeValues:{style:[0,32]}}));
  function geometry(data){const g=new THREE.BufferGeometry();for(const [key,size] of [['position',3],['normal',3],['uv',2]])g.setAttribute(key,new THREE.BufferAttribute(data[key],size));g.setAttribute('style',new THREE.BufferAttribute(data.style||new Uint8Array(data.position.length/3*2),2));return g;}
  const layer={id:'osm-world',type:'custom',renderingMode:'3d',setOrigin,
    onAdd(m,gl){
      map=m;scene=new THREE.Scene();camera=new THREE.Camera();
      renderer=new THREE.WebGLRenderer({canvas:m.getCanvas(),context:gl});renderer.autoClear=false;
      ground=new THREE.Mesh(new THREE.PlaneGeometry(1200,1200),materials[1]);ground.position.z=-.04;ground.frustumCulled=false;scene.add(ground);
      chevron=createChevron(player);scene.add(chevron.group);metrics.chevron=chevron.diagnostics();
    },
    setBuildings(data){
      if(building){scene.remove(building);building.geometry.dispose();metrics.disposedBuffers=(metrics.disposedBuffers||0)+1;}
      building=new THREE.Mesh(geometry(data),materials[0]);building.frustumCulled=false;scene.add(building);
      metrics.vertices=data.position.length/3;metrics.buildings=data.count;metrics.simplified=data.simplified;metrics.omitted=data.omitted;
      metrics.geometryBytes=data.position.byteLength+data.normal.byteLength+data.uv.byteLength+(data.style?.byteLength||0);
      map.triggerRepaint();
    },
    setRoads(data){
      if(roads){scene.remove(roads);roads.geometry.dispose();metrics.disposedBuffers=(metrics.disposedBuffers||0)+1;}
      const p=[];
      for(const road of data)for(let i=1;i<road.points.length;i++){
        const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<.01)continue;
        if(p.length/3+6>18000)break;
        const x=-dy/len*road.width/2,y=dx/len*road.width/2;
        const v=[[a[0]+x,a[1]+y,0],[a[0]-x,a[1]-y,0],[b[0]-x,b[1]-y,0],[b[0]+x,b[1]+y,0]];
        for(const j of [0,1,2,0,2,3])p.push(...v[j]);
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(new Float32Array(p.length),3));g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(p.length/3*2),2));
      roads=new THREE.Mesh(g,materials[2]);roads.frustumCulled=false;scene.add(roads);metrics.roadVertices=p.length/3;
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
    onRemove(){for(const object of [building,ground,roads])object?.geometry.dispose();chevron?.dispose();materials.forEach(m=>m.dispose());renderer?.dispose();}
  };return layer;
}
