import test from 'node:test';
import assert from 'node:assert/strict';
import {areaContext, isCountryside} from '../src/context.js';
import {parseExtras, surfaceCode, EXTRAS, height} from '../src/world.js';
import {buildingStyle} from '../src/building-style.js';
import {climateProfile} from '../src/climate.js';

const tropics = climateProfile('Af'), oceanic = climateProfile('Cfb');

const homesAt = (n, area, spread) => Array.from({length: n}, (_, i) => ({area, centre: [(i % 10) * spread - 4.5 * spread, Math.floor(i / 10) * spread - 2 * spread], tall: false}));
test('area context: city, town, suburb, village and rural from coverage, density and the nearest settlement', () => {
  assert.equal(areaContext({footprints: homesAt(60, 1000, 25)}).setting, 'city');
  assert.equal(areaContext({footprints: homesAt(40, 600, 40)}).setting, 'town');
  assert.equal(areaContext({footprints: homesAt(90, 160, 30)}).setting, 'suburb');
  assert.equal(areaContext({footprints: homesAt(12, 80, 45)}).setting, 'village');
  assert.equal(areaContext({footprints: homesAt(2, 60, 80)}).setting, 'rural');
  assert.equal(areaContext({footprints: homesAt(3, 60, 60), places: [{place: 'hamlet', name: 'Upper Hamlet', x: 300, y: 0}]}).setting, 'village');
  assert.equal(areaContext({footprints: []}).ground, 1);
  const mesa = areaContext({lat: 33.4152, lng: -111.8315});
  assert.equal(mesa.biome.koppen, 'BWh'); assert.equal(mesa.climate, 'hot desert');
  assert.equal(isCountryside({setting: 'village'}) && isCountryside({setting: 'rural'}) && !isCountryside({setting: 'suburb'}), true);
});
test('every green and wet cover maps to a surface, and big covers are clipped to the area instead of dropped', () => {
  for (const [tags, code] of [[{natural: 'wetland'}, 10], [{landuse: 'farmland'}, 11], [{landuse: 'orchard'}, 11], [{landuse: 'plantation'}, 11], [{natural: 'beach'}, 12], [{natural: 'heath'}, 13], [{natural: 'scrub'}, 13], [{landuse: 'forest'}, 2], [{landcover: 'trees'}, 2], [{leisure: 'nature_reserve'}, 0], [{landuse: 'meadow'}, 1], [{waterway: 'riverbank'}, 3], [{landuse: 'reservoir'}, 3]]) assert.equal(surfaceCode(tags), code, JSON.stringify(tags));
  // A 6 km forest ring with 3,000 points: far over the point budget, but clipped to the ±1 km area and simplified.
  const M = 111320, ring = Array.from({length: 3000}, (_, i) => {const a = i / 3000 * Math.PI * 2; return [Math.cos(a) * 3000 / M, Math.sin(a) * 3000 / M];}); ring.push(ring[0]);
  const square = [[-500, -500], [500, -500], [500, 500], [-500, 500], [-500, -500]].map(([x, y]) => [x / M, y / M]);
  const {areas, trees} = parseExtras([{properties: {landuse: 'forest'}, geometry: {type: 'Polygon', coordinates: [ring, square]}}], [0, 0]);
  assert.equal(areas.length, 1); assert.ok(areas[0].rings[0].length <= EXTRAS.areaPoints);
  assert.ok(areas[0].rings[0].every(([x, y]) => Math.abs(x) <= EXTRAS.clip + 1e-6 && Math.abs(y) <= EXTRAS.clip + 1e-6));
  assert.equal(areas[0].rings.length, 2, 'the clearing survives as a hole');
  assert.ok(trees.length > 0 && trees.every(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) > 500), 'woodland trees outside the clearing');
});
test('rivers and streams mapped as lines become water strips; culverts stay hidden; paint order puts water over grass', () => {
  const line = (waterway, extra = {}) => ({properties: {waterway, ...extra}, geometry: {type: 'LineString', coordinates: [[0, 0], [0, .001], [.001, .002]]}});
  const meadow = {properties: {landuse: 'meadow'}, geometry: {type: 'Polygon', coordinates: [[[-.002, -.002], [.002, -.002], [.002, .002], [-.002, .002], [-.002, -.002]]]}};
  const {areas} = parseExtras([line('river'), line('stream', {tunnel: 'culvert'}), meadow], [0, 0]);
  const water = areas.filter(a => a.code === 3);
  assert.equal(water.length, 2); assert.ok(areas.indexOf(water[0]) > areas.findIndex(a => a.code === 1));
  const w = Math.hypot(water[0].rings[0][0][0] - water[0].rings[0][1][0], water[0].rings[0][0][1] - water[0].rings[0][1][1]);
  assert.ok(Math.abs(w - 14) < .01, `river strip ${w} m`);
});
test('countryside: untagged footprints are low homes or sheds, not 12 m glazed blocks; tropical plantations are palms', () => {
  assert.equal(height({building: 'yes'}, {area: 90, countryside: true}), 4);
  assert.equal(height({building: 'yes'}, {area: 600, countryside: true}), 6.5);
  assert.equal(height({building: 'yes'}, {area: 90}), 12);
  assert.equal(height({building: 'hut'}), 3.5);
  assert.equal(height({building: 'residential'}, {area: 90, countryside: true}), 4, 'a mapped village house tagged residential');
  assert.equal(height({building: 'residential'}, {area: 90}), 12);
  assert.equal(buildingStyle({building: 'yes'}, {area: 90, heightDefault: true, countryside: true}).kind, 1);
  assert.equal(buildingStyle({building: 'yes'}, {area: 900, heightDefault: true, countryside: true}).kind, 5);
  assert.equal(buildingStyle({building: 'yes', shop: 'convenience'}, {area: 90, heightDefault: true, countryside: true}).kind, 3);
  assert.equal(buildingStyle({building: 'yes', amenity: 'school'}, {area: 900, heightDefault: true, countryside: true}).kind, 6);
  assert.equal(buildingStyle({building: 'yes'}, {area: 90, heightDefault: true}).kind, 0);
  const grove = {properties: {landuse: 'plantation'}, geometry: {type: 'Polygon', coordinates: [[[0, 0], [.001, 0], [.001, .001], [0, .001], [0, 0]]]}};
  const palms = parseExtras([grove], [0, 0], [], {context: {setting: 'rural', biome: tropics}, scatter: false}).trees;
  assert.ok(palms.length > 20 && palms.filter(t => t[5] === 2).length / palms.length > .6, 'mostly palms');
  assert.equal(parseExtras([grove], [0, 0], [], {context: {setting: 'rural', biome: oceanic}, scatter: false}).trees.filter(t => t[5] === 2).length, 0);
});
test('countryside scatter fills open ground but never roads, buildings or water; a city gets none', () => {
  const roads = [{points: [[-400, 0], [400, 0]], width: 6}];
  const house = {rings: [[[50, 50], [60, 50], [60, 60], [50, 60]]], bounds: [50, 50, 60, 60]};
  const rural = parseExtras([], [0, 0], [house], {context: {setting: 'rural', biome: tropics}, roads}).trees;
  assert.ok(rural.length > 200, `${rural.length} trees`);
  assert.ok(rural.every(([x, y]) => Math.abs(y) >= 3 + EXTRAS.scatter.gap - 1e-9 && !(x >= 50 && x <= 60 && y >= 50 && y <= 60)));
  assert.ok(rural.some(t => t[5] === 2) && rural.some(t => t[5] === 0), 'palms and broadleaf in the tropics');
  assert.equal(parseExtras([], [0, 0], [], {context: {setting: 'city', biome: oceanic}, roads}).trees.length, 0);
});
test('a mangrove (wetland tagged as forest) is wetland ground with woodland-density low trees', () => {
  const ring = [[[0, 0], [.001, 0], [.001, .001], [0, .001], [0, 0]]], cover = tags => parseExtras([{properties: tags, geometry: {type: 'Polygon', coordinates: ring}}], [0, 0], [], {scatter: false});
  const mangrove = cover({landuse: 'forest', natural: 'wetland', wetland: 'mangrove'}), marsh = cover({natural: 'wetland', wetland: 'marsh'});
  assert.equal(mangrove.areas[0].code, 10);
  assert.ok(mangrove.trees.length > 2 * marsh.trees.length, `${mangrove.trees.length} vs ${marsh.trees.length}`);
  assert.ok(mangrove.trees.every(t => t[2] <= 7));
});
test('in the countryside road widths follow the road class; a city keeps its boulevards', async () => {
  const {parseWorld, COUNTRY_WIDTH} = await import('../src/world.js');
  const way = (id, highway, lat) => ({type: 'way', id, tags: {highway}, geometry: [{lat, lon: 0}, {lat, lon: .002}]});
  const hut = {type: 'way', id: 9, tags: {building: 'hut'}, geometry: [[0, 0], [0, .0001], [.0001, .0001], [.0001, 0], [0, 0]].map(([a, b]) => ({lat: .0004 + a, lon: .0004 + b}))};
  const w = parseWorld({elements: [way(1, 'track', 0), way(2, 'residential', .0002), way(3, 'primary', .0006), hut]}, [0, 0]);
  assert.equal(w.context.setting, 'rural');
  assert.deepEqual(w.roads.map(r => r.width), [COUNTRY_WIDTH.track, COUNTRY_WIDTH.residential, COUNTRY_WIDTH.primary]);
});
