import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import {ORIGIN, LIMITS} from './world.js';
import {createChevron} from './chevron.js';

const vertexShader = `varying vec3 local; varying vec3 norm; varying vec2 facade;
void main(){local=position;norm=normal;facade=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragmentShader = `precision highp float;
uniform vec2 eye; uniform float radius; uniform float kind;
varying vec3 local; varying vec3 norm; varying vec2 facade;
void main(){
 float d=distance(local.xy,eye);if(d>radius)discard;
 vec3 fog=vec3(.69,.75,.79); vec3 color=vec3(.64,.67,.69);
 if(kind<.5){
  float lighting=.72+.28*abs(dot(normalize(norm),normalize(vec3(-.4,-.7,1.))));
  color*=lighting;
  if(abs(norm.z)<.5){
   vec2 cell=fract(facade/vec2(3.4,3.2));
   float window=step(.19,cell.x)*step(cell.x,.73)*step(.22,cell.y)*step(cell.y,.79)*step(1.,local.z);
   float frame=step(.15,cell.x)*step(cell.x,.77)*step(.18,cell.y)*step(cell.y,.83)*step(1.,local.z);
   color=mix(color,vec3(.79,.81,.81)*lighting,frame);
   color=mix(color,vec3(.22,.27,.30)*lighting,window);
   color*=1.-.08*step(.96,cell.y);
  }
 }else if(kind<1.5){
   color=vec3(.46,.49,.51);
   vec2 tile=abs(fract(local.xy/2.)-.5);color*=1.-.10*step(.48,max(tile.x,tile.y));
 }else{color=vec3(.25,.29,.32);}
 float haze=smoothstep(radius*.25,radius*.94,d);
 gl_FragColor=vec4(mix(color,fog,haze),1.);
}`;
export function createWorldLayer(player, metrics, onChevronAnchor=null) {
  let renderer, scene, camera, building, ground, roads, map, chevron;
  const anchor=new THREE.Vector4();
  const eye=new THREE.Vector2(), projection=new THREE.Matrix4(), localMatrix=new THREE.Matrix4();
  // Local metres → Mercator. Re-anchoring a GPS area moves the origin; geometry arrives already relative to it.
  function setOrigin(origin){const mc=maplibregl.MercatorCoordinate.fromLngLat(origin), s=mc.meterInMercatorCoordinateUnits();localMatrix.makeTranslation(mc.x,mc.y,0).scale(new THREE.Vector3(s,-s,s));map?.triggerRepaint();}
  setOrigin(ORIGIN);
  const materials=[0,1,2].map(kind=>new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms:{eye:{value:eye},radius:{value:LIMITS.radius},kind:{value:kind}},side:THREE.DoubleSide}));
  function geometry(data){const g=new THREE.BufferGeometry();for(const [key,size] of [['position',3],['normal',3],['uv',2]])g.setAttribute(key,new THREE.BufferAttribute(data[key],size));return g;}
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
      metrics.geometryBytes=data.position.byteLength+data.normal.byteLength+data.uv.byteLength;
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
