import test from 'node:test';
import assert from 'node:assert/strict';
import {findJunctions, pickSignposts, nextCrossing, pinPose, signName} from '../src/wayfinding-data.js';

const grid = [
  {name: 'Main Street', width: 14, points: [[-100, 0], [0, 0], [60, 0], [100, 0]]},
  {name: 'First Avenue', width: 14, points: [[0, -100], [0, 0], [0, 100]]},
  {name: 'Second Avenue', width: 14, points: [[60, -100], [60, 0], [60, 100]]},
  {name: 'Alley path', width: 2, points: [[30, -10], [30, 0]]}
];

test('junctions are shared nodes of differently named carriageways; footways are ignored', () => {
  const j = findJunctions(grid);
  assert.equal(j.length, 2);
  assert.deepEqual(j.map(x => x.streets.map(s => s.name).sort().join('+')).sort(), ['First Avenue+Main Street', 'Main Street+Second Avenue']);
});

test('nodes of a dual carriageway within 15 m merge into one junction', () => {
  const j = findJunctions([...grid, {name: 'First Avenue', width: 14, points: [[8, -100], [8, 0], [8, 100]]}, {name: 'Main Street', width: 14, points: [[0, 0], [8, 0]]}]);
  assert.equal(j.filter(x => Math.abs(x.x) < 10).length, 1);
});

test('signposts favour junctions ahead and stand on the corner nearest the viewer', () => {
  const player = {x: 30, y: -20, heading: 90};
  const [first] = pickSignposts(findJunctions(grid), player);
  assert.ok(first.names.includes('Second Avenue'));
  assert.ok(first.x < 60 && first.y < 0, `corner ${first.x},${first.y}`);
  assert.equal(pickSignposts(findJunctions(grid), {x: 500, y: 500, heading: 0}).length, 0);
});

test('the next crossing is the nearest junction ahead on the current street', () => {
  const j = findJunctions(grid);
  assert.deepEqual(nextCrossing(j, {x: 20, y: 0, heading: 90}, 'Main Street'), {name: 'Second Avenue', distance: 40});
  assert.equal(nextCrossing(j, {x: 20, y: 0, heading: 90}, 'Other Street'), null);
  assert.equal(nextCrossing(j, {x: 20, y: 0, heading: 270}, 'Main Street').name, 'First Avenue');
});

test('pins grow with distance but always top out below the lowest name height', () => {
  assert.ok(pinPose(120).s > pinPose(10).s);
  for (const d of [1, 30, 80, 500]) {const p = pinPose(d); assert.ok(p.lift + p.s < 2.4, `pin top ${p.lift + p.s} at ${d} m`);}
});

test('sign names use street-sign abbreviations', () => {
  assert.equal(signName('West 2nd Street'), 'W 2nd St');
  assert.equal(signName('South Grand Avenue'), 'S Grand Ave');
  assert.equal(signName('Broadway'), 'Broadway');
});
test('sign blades are never seen edge-on: from every direction the face is within 42° of facing the eye', async () => {
  const {bladeYaw} = await import('../src/wayfinding-data.js');
  for (const street of [0, 30, 90, 137, 180]) {
    const yaw = Math.atan2(Math.cos(street * Math.PI / 180), Math.sin(street * Math.PI / 180));
    for (let a = 0; a < 360; a += .5) {
      const dx = Math.cos(a * Math.PI / 180), dy = Math.sin(a * Math.PI / 180), r = bladeYaw(yaw, dx, dy);
      const facing = Math.abs(-Math.sin(r) * dx + Math.cos(r) * dy);
      assert.ok(facing >= Math.cos(42 * Math.PI / 180), `street ${street}°, eye at ${a}°: face ${(Math.acos(facing) * 180 / Math.PI).toFixed(1)}° off`);
    }
  }
});
test('sign blades keep their street direction when seen face-on and turn smoothly, without jumps, as you walk around', async () => {
  const {bladeYaw, SIGN} = await import('../src/wayfinding-data.js');
  const yaw = .4, normal = yaw + Math.PI / 2;
  for (const off of [0, 10, 20, 30, SIGN.turnFrom - .5]) for (const side of [0, Math.PI]) for (const sign of [-1, 1]) {
    const a = normal + side + sign * off * Math.PI / 180;
    assert.ok(Math.abs(bladeYaw(yaw, Math.cos(a), Math.sin(a)) - yaw) < 1e-9, `${off}° off face-on`);
  }
  // Looking straight down the street, the blade faces you.
  const down = bladeYaw(yaw, Math.cos(yaw + .001), Math.sin(yaw + .001));
  assert.ok(Math.abs(Math.sin(down - yaw - Math.PI / 2)) < .01);
  // A blade looks the same rotated by 180° (both faces read left to right), so compare orientations modulo π.
  let prev = bladeYaw(yaw, 1, 0);
  for (let a = .25; a <= 360; a += .25) {
    const r = bladeYaw(yaw, Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180));
    const step = Math.abs(((r - prev) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2) * 180 / Math.PI;
    assert.ok(step < 1.5, `jump of ${step.toFixed(2)}° at ${a}°`); prev = r;
  }
});
test('street names stay readable at distance on a phone and a laptop, and are real size up close', async () => {
  const {signTextPixels, signScale, SIGN, WAYDATA} = await import('../src/wayfinding-data.js');
  for (const [height, fov] of [[844, SIGN.fov.phone], [667, SIGN.fov.phone], [800, SIGN.fov.wide], [1080, SIGN.fov.wide]]) {
    for (let d = 4; d <= 48; d += 1) assert.ok(signTextPixels(d, height, fov) >= 11, `${height} px viewport, ${d} m: ${signTextPixels(d, height, fov).toFixed(1)} px`);
    assert.ok(signTextPixels(WAYDATA.signRadius, height, fov) >= 4.5, 'a junction at the edge of the sign radius still shows as a sign');
  }
  assert.equal(signScale(5), 1); assert.equal(signScale(SIGN.readDistance), 1);
  assert.equal(signScale(500), SIGN.grow);
  assert.equal(signScale(2 * SIGN.readDistance), 2);
});
test('a grown sign stays low on screen and its pole stays on the ground', async () => {
  const {signZ, signScale, SIGN} = await import('../src/wayfinding-data.js');
  const blade = 3.38 * 1.25, near = Math.atan((blade - SIGN.eye) / SIGN.readDistance);
  for (const d of [12, 20, 30, 48, 80]) {
    const k = signScale(d), up = Math.atan((signZ(blade, k) - SIGN.eye) / d);
    assert.ok(up <= near + 1e-9, `${d} m: blade ${(up * 180 / Math.PI).toFixed(1)}° above the horizon`);
    assert.equal(signZ(0, k), 0);
    assert.ok(Math.abs(signZ(SIGN.collar - 1e-9, k) - signZ(SIGN.collar, k)) < 1e-6, 'pole meets the blades');
  }
  assert.equal(signZ(blade, 1), blade, 'real size up close');
});
test('a split carriageway gets one signpost per street pair, not one per mapped junction', () => {
  const road = (name, points) => ({name, width: 8, points});
  const roads = [road('Main Street', [[-200, 0], [0, 0], [200, 0]]), road('Main Street', [[-200, -19], [0, -19], [200, -19]]), road('Center Street', [[0, -200], [0, -19], [0, 0], [0, 120], [0, 200]]), road('Oak Avenue', [[-200, 120], [0, 120], [200, 120]])];
  const signs = pickSignposts(findJunctions(roads), {x: 0, y: 40, heading: 180});
  assert.equal(signs.filter(s => s.names.includes('Main Street')).length, 1);
  assert.equal(signs.length, 2, signs.map(s => s.key).join(' / '));
});
