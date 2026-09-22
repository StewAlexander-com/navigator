import * as THREE from 'three';

export const CHEVRON = Object.freeze({distance:4.5, height:.75, drawCalls:4});
export function updateTravelBearing(player, dx, dy) {
  // Use the displacement actually accepted by the area boundary, not key intent.
  if (Math.hypot(dx,dy)>1e-5) player.travelBearing=(Math.atan2(dx,dy)*180/Math.PI+360)%360;
}
export function createChevron(player) {
  const group=new THREE.Group();
  group.scale.set(.55,.55,1);
  const shape=new THREE.Shape();
  shape.moveTo(-.85,-.48);shape.lineTo(0,.25);shape.lineTo(.85,-.48);
  shape.lineTo(.85,-.04);shape.lineTo(0,.73);shape.lineTo(-.85,-.04);shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:.07,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.025,bevelThickness:.012});
  geometry.translate(0,0,-.035);
  const bodyMaterial=new THREE.ShaderMaterial({
    vertexShader:'varying vec3 n;void main(){n=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'varying vec3 n;void main(){float light=.65+.35*abs(dot(normalize(n),normalize(vec3(-.3,-.5,1.))));gl_FragColor=vec4(vec3(.20,.96,.98)*light,.9);}',
    transparent:true,depthTest:true,depthWrite:true,side:THREE.DoubleSide,forceSinglePass:true
  });
  const body=new THREE.Mesh(geometry,bodyMaterial);body.renderOrder=11;body.frustumCulled=false;group.add(body);
  const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,25),new THREE.LineBasicMaterial({color:0xa1ffff,transparent:true,opacity:.8,depthTest:true,depthWrite:false}));
  edges.renderOrder=12;edges.frustumCulled=false;group.add(edges);
  const plane=new THREE.PlaneGeometry(2.6,2.3);
  const vertex='varying vec2 p;void main(){p=uv*vec2(2.6,2.3)-vec2(1.3,1.15);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
  const distance=`float segment(vec2 p,vec2 a,vec2 b){vec2 ab=b-a;return length(p-a-ab*clamp(dot(p-a,ab)/dot(ab,ab),0.,1.));}`;
  const glow=new THREE.Mesh(plane,new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:`varying vec2 p;${distance}void main(){float d=min(segment(p,vec2(-.8,-.25),vec2(0.,.48)),segment(p,vec2(0.,.48),vec2(.8,-.25)));float a=.24*exp(-d*d/ .09);if(a<.003)discard;gl_FragColor=vec4(.12,.95,1.,a);}`,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,forceSinglePass:true,blending:THREE.AdditiveBlending}));
  glow.position.z=-.055;glow.renderOrder=10;glow.frustumCulled=false;group.add(glow);
  const shadow=new THREE.Mesh(plane,new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:`varying vec2 p;${distance}void main(){float d=min(segment(p,vec2(-.8,-.25),vec2(0.,.48)),segment(p,vec2(0.,.48),vec2(.8,-.25)));float a=.26*exp(-d*d/.05);if(a<.003)discard;gl_FragColor=vec4(.02,.06,.07,a);}`,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,forceSinglePass:true}));
  shadow.position.z=.025-CHEVRON.height;shadow.renderOrder=9;shadow.frustumCulled=false;group.add(shadow);
  // Horizontal glyph below eye level: visible from above without tilting its plane.
  function update(){
    const view=player.heading*Math.PI/180, bearing=player.chevronHeading??player.heading;
    // Resolved compass direction is independent of an optional free-look camera.
    // Without a compass, manual view heading remains the fallback.
    group.position.set(player.x+Math.sin(view)*CHEVRON.distance,player.y+Math.cos(view)*CHEVRON.distance,CHEVRON.height);
    group.rotation.z=-bearing*Math.PI/180;
    group.updateMatrixWorld(true);
  }
  update();
  return {group,update,diagnostics:()=>({bearing:player.chevronHeading??player.heading,height:CHEVRON.height,distance:CHEVRON.distance,drawCalls:CHEVRON.drawCalls,vertices:geometry.attributes.position.count}),dispose(){geometry.dispose();edges.geometry.dispose();plane.dispose();for(const object of [body,edges,glow,shadow])object.material.dispose();}};
}
