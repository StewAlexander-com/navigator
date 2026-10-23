import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {PIN_COLORS, signName} from './wayfinding-data.js';
// Signposts and street-level pins drawn from the Blender assets in public/models/wayfinding.glb (scripts/blender/wayfinding.py).
// Three draw calls while anything is shown: pins (instanced), sign poles (instanced), and every blade in one merged
// mesh textured from a single canvas atlas of street names. Nothing animates, so the render loop still idles.
// Signs are drawn 1.25× real size (illustrative, like the windows) so names read from across a junction.
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
const postMaterial = () => new THREE.ShaderMaterial({
  vertexShader: `attribute float part;varying vec3 vN;varying float vPart;void main(){vN=mat3(instanceMatrix)*normal;vPart=part;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
  fragmentShader: `precision highp float;varying vec3 vN;varying float vPart;
void main(){vec3 n=normalize(vN);float l=max(dot(n,${SUN}),0.);vec3 c=vPart<.75?vec3(.45,.95,.95):vec3(.16,.26,.30)*(.7+.6*l);gl_FragColor=vec4(c,1.);}`
});
const bladeMaterial = map => new THREE.ShaderMaterial({uniforms: {map: {value: map}},
  vertexShader: `varying vec2 vUv;varying vec3 vN;void main(){vUv=uv;vN=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `precision highp float;uniform sampler2D map;varying vec2 vUv;varying vec3 vN;
void main(){float l=max(dot(normalize(vN),${SUN}),0.);gl_FragColor=vec4(texture2D(map,vUv).rgb*(.88+.18*l),1.);}`
});
// glTF is Y-up; the world is Z-up (x east, y north). Vertex colour R becomes a one-component `part` tag.
function prepare(mesh) {
  const g = mesh.geometry.clone().rotateX(Math.PI / 2), c = g.attributes.color, n = g.attributes.position.count, part = new Float32Array(n);
  for (let i = 0; i < n; i++) part[i] = c ? c.getX(i) : 1;
  g.setAttribute('part', new THREE.BufferAttribute(part, 1)); g.deleteAttribute('color'); return g;
}
export function createWayfinding(scene, repaint) {
  let beacons = null, posts = null, blades = null, blade = null, atlasKey = '', pending = {beacons: [], signs: []};
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = WAYFINDING.rowPx * WAYFINDING.atlasRows;
  const atlas = new THREE.CanvasTexture(canvas); atlas.anisotropy = 4;
  const ready = new GLTFLoader().loadAsync(new URL('models/wayfinding.glb', document.baseURI).href).then(gltf => {
    const get = name => {let m = null; gltf.scene.traverse(o => {if (o.isMesh && (o.name === name || o.parent?.name === name)) m ??= o;}); return m && prepare(m);};
    const beacon = get('Beacon'), post = get('Signpost'); blade = get('Blade')?.toNonIndexed();
    if (!beacon || !post || !blade) throw new Error('Wayfinding model incomplete.');
    beacons = new THREE.InstancedMesh(beacon, beaconMaterial(), WAYFINDING.beacons);
    for (let i = 0; i < WAYFINDING.beacons; i++) beacons.setColorAt(i, new THREE.Color(1, 1, 1));
    posts = new THREE.InstancedMesh(post, postMaterial(), WAYFINDING.signs);
    blades = new THREE.Mesh(new THREE.BufferGeometry(), bladeMaterial(atlas));
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
      const text = signName(name); let size = 104; c.font = `650 ${size}px Inter,-apple-system,"Segoe UI",sans-serif`;
      while (size > 40 && c.measureText(text).width > 1024 - 90) {size -= 4; c.font = `650 ${size}px Inter,-apple-system,"Segoe UI",sans-serif`;}
      c.fillStyle = '#f5ffff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 512, y + h / 2 + 4);
    }));
    atlas.needsUpdate = true;
  }
  // `signs` from pickSignposts: {x, y, names: [a, b], bearings: [a, b], key}. Blades run along their street; both faces
  // read left to right; the bevelled rim samples the row's border colour.
  function setSigns(signs) {
    pending.signs = signs; if (!posts) return;
    const list = signs.slice(0, WAYFINDING.signs), key = list.map(s => s.key).join(';'), S = WAYFINDING.signScale;
    list.forEach((s, i) => {m.makeScale(S, S, S).setPosition(s.x, s.y, 0); posts.setMatrixAt(i, m);});
    posts.count = list.length; posts.instanceMatrix.needsUpdate = true;
    if (key !== atlasKey) {
      atlasKey = key; drawAtlas(list);
      const src = blade.attributes.position, nor = blade.attributes.normal, n = src.count, total = n * list.length * 2;
      const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), uv = new Float32Array(total * 2), v = new THREE.Vector3(), nv = new THREE.Vector3();
      const box = new THREE.Box3().setFromBufferAttribute(src), len = box.max.x - box.min.x, tall = box.max.z - box.min.z, rows = WAYFINDING.atlasRows;
      let k = 0;
      list.forEach((s, i) => s.bearings.forEach((bearing, j) => {
        const yaw = Math.atan2(Math.cos(bearing * Math.PI / 180), Math.sin(bearing * Math.PI / 180)), row = i * 2 + j;
        const t = new THREE.Matrix4().makeTranslation(s.x, s.y, WAYFINDING.bladeHeights[j] * S).multiply(new THREE.Matrix4().makeRotationZ(yaw)).multiply(new THREE.Matrix4().makeScale(S, S, S));
        for (let q = 0; q < n; q++, k++) {
          v.fromBufferAttribute(src, q); nv.fromBufferAttribute(nor, q);
          let u = (v.x - box.min.x) / len; if (nv.y > .5) u = 1 - u; if (Math.abs(nv.y) <= .5) u = .02;
          const along = Math.abs(nv.y) <= .5 ? .9 : (v.z - box.min.z) / tall;
          uv[k * 2] = u; uv[k * 2 + 1] = 1 - (row + 1 - along) / rows;
          v.applyMatrix4(t); nv.transformDirection(t); pos.set([v.x, v.y, v.z], k * 3); nrm.set([nv.x, nv.y, nv.z], k * 3);
        }
      }));
      blades.geometry.dispose(); const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      blades.geometry = g;
    }
    blades.visible = list.length > 0; repaint();
  }
  return {ready, setBeacons, setSigns,
    diagnostics: () => ({loaded: !!beacons, beacons: beacons?.count || 0, signs: posts?.count || 0, bladeVertices: blades?.geometry.attributes.position?.count || 0}),
    dispose() {for (const o of [beacons, posts, blades]) {o?.geometry.dispose(); o?.material.dispose();} atlas.dispose();}};
}
