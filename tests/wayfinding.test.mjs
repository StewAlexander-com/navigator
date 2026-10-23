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
