import test from 'node:test';
import assert from 'node:assert/strict';
import {koppenAt, climateAt, climateProfile} from '../src/climate.js';
import {parseExtras} from '../src/world.js';

test('the bundled Köppen–Geiger map tells places at the same latitude apart', () => {
  for (const [name, point, koppen, label] of [
    ['Tagbilaran, Bohol', [123.85, 9.65], 'Af', 'tropical rainforest'],
    ['Coober Pedy', [134.7544, -29.0135], 'BWh', 'hot desert'],
    ['Mebane, NC', [-79.3492, 36.0992], 'Cfa', 'humid subtropical'],
    ['Mesa, AZ', [-111.8315, 33.4152], 'BWh', 'hot desert'],
    ['Los Angeles', [-118.2475, 34.0505], 'Csb', 'mediterranean'],
    ['London', [-0.1276, 51.5072], 'Cfb', 'oceanic'],
    ['Moscow', [37.6173, 55.7558], 'Dfb', 'continental'],
    ['Tromsø', [18.9553, 69.6492], 'Dfc', 'subarctic'],
    ['Cairo', [31.2357, 30.0444], 'BWh', 'hot desert'],
    ['Manaus', [-60.0217, -3.119], 'Af', 'tropical rainforest'],
  ]) {
    const c = climateAt(point);
    assert.deepEqual([c.koppen, c.label], [koppen, label], name);
  }
});
test('coasts and small islands in an ocean cell use the nearest land cell; open ocean falls back to latitude', () => {
  assert.ok(koppenAt([-157.8583, 21.3069]), 'Honolulu');
  assert.equal(koppenAt([-150, 0]), null);
  assert.equal(climateAt([-150, 0]).group, 'tropical');
  assert.equal(climateAt([-30, 50]).label, 'oceanic');
});
test('the climate sets the tree mix: desert scrub is sparse and low, subtropical forest has some pines', () => {
  const scatter = koppen => parseExtras([], [0, 0], [], {context: {setting: 'rural', biome: climateProfile(koppen)}, roads: []}).trees;
  const desert = scatter('BWh'), tropics = scatter('Af'), southeast = scatter('Cfa'), ice = scatter('EF');
  assert.ok(desert.length * 3 < tropics.length, `${desert.length} desert vs ${tropics.length} tropical trees`);
  assert.ok(desert.filter(t => t[5] === 0).every(t => t[2] <= 4.5), 'desert shrubs');
  assert.ok(southeast.some(t => t[5] === 1) && southeast.filter(t => t[5] === 0).length > southeast.length / 2 && !southeast.some(t => t[5] === 2), 'mostly broadleaf, some pine, no palms');
  assert.equal(ice.length, 0);
  const wood = {properties: {landuse: 'forest', leaf_type: 'broadleaved'}, geometry: {type: 'Polygon', coordinates: [[[0, 0], [.001, 0], [.001, .001], [0, .001], [0, 0]]]}};
  assert.ok(!parseExtras([wood], [0, 0], [], {context: {setting: 'rural', biome: climateProfile('Dfc')}, scatter: false}).trees.some(t => t[5] === 1), 'a mapped broadleaf wood stays broadleaf');
});
test('a desert town has earth between its buildings and low untagged buildings', async () => {
  const {areaContext} = await import('../src/context.js');
  const {height} = await import('../src/world.js');
  const block = Array.from({length: 60}, (_, i) => ({area: 1000, centre: [(i % 10) * 25 - 112, Math.floor(i / 10) * 25 - 50], tall: false}));
  assert.equal(areaContext({footprints: block, lat: 33.4152, lng: -111.8315}).ground, .75);
  assert.equal(areaContext({footprints: block, lat: 51.5, lng: -.13}).ground, 0);
  assert.equal(height({building: 'yes'}, {area: 200, countryside: true}), 6.5);
});
test('homes in a dry climate have flat roofs unless OSM tags a roof shape', async () => {
  const {parseWorld} = await import('../src/world.js');
  const home = (id, lat, lon, tags = {}) => ({type: 'way', id, tags: {building: 'house', ...tags}, geometry: [[0, 0], [0, .0001], [.0001, .0001], [.0001, 0], [0, 0]].map(([a, b]) => ({lat: lat + a, lon: lon + b}))});
  const at = ([lng, lat]) => parseWorld({elements: [home(1, lat, lng), home(2, lat + .0003, lng, {'roof:shape': 'gabled'}), {type: 'way', id: 3, tags: {highway: 'residential'}, geometry: [{lat, lon: lng - .001}, {lat, lon: lng + .001}]}]}, [lng, lat]).buildings;
  const desert = at([-111.8315, 33.4152]), southeast = at([-79.3492, 36.0992]);
  assert.deepEqual(desert.map(b => !!b.flat), [true, false]);
  assert.deepEqual(southeast.map(b => !!b.flat), [false, false]);
});
