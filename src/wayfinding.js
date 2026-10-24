import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {PIN_COLORS, SIGN, signName, signScale, signZ} from './wayfinding-data.js';
// Signposts and street-level pins drawn from the Blender assets in public/models/wayfinding.glb (scripts/blender/wayfinding.py).
// Three draw calls while anything is shown: pins (instanced), sign poles (instanced), and every blade in one merged
// mesh textured from a single canvas atlas of street names. Nothing animates, so the render loop still idles.
// Signs are drawn 1.25× real size (illustrative, like the windows) so names read from across a junction; the shaders
// turn oblique blades toward the eye and grow distant signposts (SIGN in wayfinding-data.js), so names stay readable.
export const WAYFINDING = Object.freeze({beacons: 2, signs: 3, signScale: 1.25, bladeHeights: [3.38, 2.92], atlasRows: 6, rowPx: 172, drawCalls: 3});
const SUN = 'normalize(vec3(-.65,-.35,.48))';
const beaconMaterial = () => new THREE.ShaderMaterial({
  vertexShader: `attribute float part;varying vec3 vN;varying vec3 vC;varying float vPart;
void main(){vec3 base=instanceMatrix[3].xyz;float s=length(instanceMatrix[0].xyz);vec3 w;
 if(part<.25)w=vec3(base.xy+position.xy*(.9+s*.35),.06);else w=base+position*s;
 vN=normal;vC=instanceColor;vPart=part;gl_Position=projectionMatrix*modelViewMatrix*vec4(w,1.);}`,
  fragmentShader: `precision highp float;varying vec3 vN;varying vec3 vC;varying float vPart;
void main(){vec3 n=normalize(vN);float l=max(dot(n,${SUN}),0.);vec3 c=vC*(.66+.48*l)+vec3(.10)*pow(1.-abs(n.z),2.);
 if(vPart>.25&&vPart<.75)c=mix(vC,vec3(1.),.6);else if(vPart<.25)c=mix(vC,vec3(1.),.3);gl_FragColor=vec4(c,1.);}`
});
const f = x => x.toFixed(4);
const signUniforms = eye => ({eye: {value: eye}});
// Distance growth shared by posts and blades (signScale and signZ in wayfinding-data.js).
const GROW = `uniform vec2 eye;float signScale(vec2 at){return clamp(distance(at,eye)/${f(SIGN.readDistance)},1.,${f(SIGN.grow)});}
float signZ(float z,float k){return z<${f(SIGN.collar)}?z*(${f(SIGN.eye)}+${f(SIGN.collar - SIGN.eye)}*k)/${f(SIGN.collar)}:${f(SIGN.eye)}+(z-${f(SIGN.eye)})*k;}`;
const postMaterial = eye => new THREE.ShaderMaterial({uniforms: signUniforms(eye),
  vertexShader: `${GROW}attribute float part;varying vec3 vN;varying float vPart;
void main(){vN=mat3(instanceMatrix)*normal;vPart=part;vec4 w=instanceMatrix*vec4(position,1.);vec2 foot=instanceMatrix[3].xy;
 float k=signScale(foot);w.xy=foot+(w.xy-foot)*k;w.z=signZ(w.z,k);gl_Position=projectionMatrix*modelViewMatrix*w;}`,
  fragmentShader: `precision highp float;varying vec3 vN;varying float vPart;
void main(){vec3 n=normalize(vN);float l=max(dot(n,${SUN}),0.);vec3 c=vPart<.75?vec3(.45,.95,.95):vec3(.16,.26,.30)*(.7+.6*l);gl_FragColor=vec4(c,1.);}`
});
// Blade vertices are blade-local (pole axis at the origin); `pivot` is the signpost foot plus the blade height and `yaw`
// the street direction. Same turn as bladeYaw() in wayfinding-data.js.
const bladeMaterial = (map, eye) => new THREE.ShaderMaterial({uniforms: {map: {value: map}, ...signUniforms(eye)},
  vertexShader: `${GROW}attribute vec3 pivot;attribute float yaw;varying vec2 vUv;varying vec3 vN;const float PI=3.14159265;
void main(){vec2 to=eye-pivot.xy;float th=mod(atan(to.y,to.x)-yaw,PI)-PI*.5;
 float r=yaw+th*smoothstep(${f(SIGN.turnFrom * Math.PI / 180)},PI*.5,abs(th)),c=cos(r),s=sin(r),k=signScale(pivot.xy);
 vec3 p=position*k;p.xy=vec2(c*p.x-s*p.y,s*p.x+c*p.y);vN=vec3(c*normal.x-s*normal.y,s*normal.x+c*normal.y,normal.z);
 vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(vec3(pivot.xy,signZ(pivot.z,k))+p,1.);}`,
  fragmentShader: `precision highp float;uniform sampler2D map;varying vec2 vUv;varying vec3 vN;
void main(){float l=max(dot(normalize(vN),${SUN}),0.);gl_FragColor=vec4(texture2D(map,vUv).rgb*(.88+.18*l),1.);}`
});
// glTF is Y-up; the world is Z-up (x east, y north). Vertex colour R becomes a one-component `part` tag.
function prepare(mesh) {
  const g = mesh.geometry.clone().rotateX(Math.PI / 2), c = g.attributes.color, n = g.attributes.position.count, part = new Float32Array(n);
  for (let i = 0; i < n; i++) part[i] = c ? c.getX(i) : 1;
  g.setAttribute('part', new THREE.BufferAttribute(part, 1)); g.deleteAttribute('color'); return g;
}
export function createWayfinding(scene, repaint, eye) {
  let beacons = null, posts = null, blades = null, blade = null, atlasKey = '', shown = [], pending = {beacons: [], signs: []};
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = WAYFINDING.rowPx * WAYFINDING.atlasRows;
  const atlas = new THREE.CanvasTexture(canvas); atlas.anisotropy = 8;
  const ready = new GLTFLoader().loadAsync(new URL('models/wayfinding.glb', document.baseURI).href).then(gltf => {
    const get = name => {let m = null; gltf.scene.traverse(o => {if (o.isMesh && (o.name === name || o.parent?.name === name)) m ??= o;}); return m && prepare(m);};
    const beacon = get('Beacon'), post = get('Signpost'); blade = get('Blade')?.toNonIndexed();
    if (!beacon || !post || !blade) throw new Error('Wayfinding model incomplete.');
    beacons = new THREE.InstancedMesh(beacon, beaconMaterial(), WAYFINDING.beacons);
    for (let i = 0; i < WAYFINDING.beacons; i++) beacons.setColorAt(i, new THREE.Color(1, 1, 1));
    posts = new THREE.InstancedMesh(post, postMaterial(eye), WAYFINDING.signs);
    blades = new THREE.Mesh(new THREE.BufferGeometry(), bladeMaterial(atlas, eye));
    beacons.count = posts.count = 0; blades.visible = false;
    for (const o of [beacons, posts, blades]) {o.frustumCulled = false; scene.add(o);}
    blades.renderOrder = 2;
    setBeacons(pending.beacons); setSigns(pending.signs);
  }).catch(error => {console.warn('Wayfinding assets unavailable:', error.message);});
  const m = new THREE.Matrix4(), color = new THREE.Color();
  // `list`: {x, y, s, lift, kind, visited} for the food/landmark names on screen. Discovered places dim toward grey.
  function setBeacons(list) {
    pending.beacons = list; if (!beacons) return;
    list.slice(0, WAYFINDING.beacons).forEach((b, i) => {
      m.makeScale(b.s, b.s, b.s).setPosition(b.x, b.y, b.lift); beacons.setMatrixAt(i, m);
      color.set(PIN_COLORS[b.kind] || PIN_COLORS.landmark); if (b.visited) color.lerp(new THREE.Color(.62, .66, .68), .6);
      beacons.setColorAt(i, color);
    });
    beacons.count = Math.min(list.length, WAYFINDING.beacons); beacons.instanceMatrix.needsUpdate = true; beacons.instanceColor.needsUpdate = true; repaint();
  }
  function drawAtlas(signs) {
    const c = canvas.getContext('2d'), h = WAYFINDING.rowPx; c.clearRect(0, 0, canvas.width, canvas.height);
    signs.forEach((s, i) => s.names.forEach((name, j) => {
      const y = (i * 2 + j) * h; c.fillStyle = '#163843'; c.fillRect(0, y, 1024, h);
      c.strokeStyle = '#6fe9e6'; c.lineWidth = 8; c.strokeRect(14, y + 14, 1024 - 28, h - 28);
      const text = signName(name); let size = 116; c.font = `650 ${size}px Inter,-apple-system,"Segoe UI",sans-serif`;
      while (size > 40 && c.measureText(text).width > 1024 - 90) {size -= 4; c.font = `650 ${size}px Inter,-apple-system,"Segoe UI",sans-serif`;}
      c.fillStyle = '#f5ffff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 512, y + h / 2 + 4);
    }));
    atlas.needsUpdate = true;
  }
  // `signs` from pickSignposts: {x, y, names: [a, b], bearings: [a, b], key}. Blades run along their street (turned
  // toward the eye when oblique, in the shader); both faces read left to right; the bevelled rim samples the row's border colour.
  function setSigns(signs) {
    pending.signs = signs; if (!posts) return;
    const list = signs.slice(0, WAYFINDING.signs), key = list.map(s => s.key).join(';'), S = WAYFINDING.signScale;
    list.forEach((s, i) => {m.makeScale(S, S, S).setPosition(s.x, s.y, 0); posts.setMatrixAt(i, m);});
    posts.count = list.length; posts.instanceMatrix.needsUpdate = true; shown = list;
    if (key !== atlasKey) {
      atlasKey = key; drawAtlas(list);
      const src = blade.attributes.position, nor = blade.attributes.normal, n = src.count, total = n * list.length * 2;
      const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), uv = new Float32Array(total * 2), pivot = new Float32Array(total * 3), yaws = new Float32Array(total), v = new THREE.Vector3(), nv = new THREE.Vector3();
      const box = new THREE.Box3().setFromBufferAttribute(src), len = box.max.x - box.min.x, tall = box.max.z - box.min.z, rows = WAYFINDING.atlasRows;
      let k = 0;
      list.forEach((s, i) => s.bearings.forEach((bearing, j) => {
        const yaw = Math.atan2(Math.cos(bearing * Math.PI / 180), Math.sin(bearing * Math.PI / 180)), row = i * 2 + j;
        const z = WAYFINDING.bladeHeights[j] * S;
        for (let q = 0; q < n; q++, k++) {
          v.fromBufferAttribute(src, q); nv.fromBufferAttribute(nor, q);
          let u = (v.x - box.min.x) / len; if (nv.y > .5) u = 1 - u; if (Math.abs(nv.y) <= .5) u = .02;
          const along = Math.abs(nv.y) <= .5 ? .9 : (v.z - box.min.z) / tall;
          uv[k * 2] = u; uv[k * 2 + 1] = 1 - (row + 1 - along) / rows;
          pos.set([v.x * S, v.y * S, v.z * S], k * 3); nrm.set([nv.x, nv.y, nv.z], k * 3); pivot.set([s.x, s.y, z], k * 3); yaws[k] = yaw;
        }
      }));
      blades.geometry.dispose(); const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('pivot', new THREE.BufferAttribute(pivot, 3)); g.setAttribute('yaw', new THREE.BufferAttribute(yaws, 1));
      blades.geometry = g;
    }
    blades.visible = list.length > 0; repaint();
  }
  return {ready, setBeacons, setSigns,
    // Where each shown blade's name is drawn this frame (grown with distance, as in the shader), for browser checks.
    diagnostics: () => ({loaded: !!beacons, beacons: beacons?.count || 0, signs: posts?.count || 0, bladeVertices: blades?.geometry.attributes.position?.count || 0,
      posts: shown.map(s => {const k = signScale(Math.hypot(s.x - eye.x, s.y - eye.y)); return {names: s.names.map(signName), x: s.x, y: s.y, scale: k, heights: WAYFINDING.bladeHeights.map(h => signZ(h * WAYFINDING.signScale, k)), text: SIGN.textHeight * k};})}),
    dispose() {for (const o of [beacons, posts, blades]) {o?.geometry.dispose(); o?.material.dispose();} atlas.dispose();}};
}
