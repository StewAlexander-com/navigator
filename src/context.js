// Area character from the OSM response itself, with no extra request: how built-up the square is around its centre,
// the nearest mapped settlement, and the climate band from latitude. It fills in what OSM leaves open: the bare
// ground (paving or earth), untagged building heights and styles, and the mix of illustrative trees. The climate (and
// so the ground palette, foliage and tree mix) comes from the bundled Köppen–Geiger map in climate.js.
import {climateAt} from './climate.js';
export const CONTEXT = Object.freeze({radius: 300, tall: 20});
const SETTLEMENT = {city: 'city', town: 'town', suburb: 'town', quarter: 'town', borough: 'town', village: 'village', hamlet: 'village', neighbourhood: 'village', isolated_dwelling: 'rural', farm: 'rural', locality: 'rural'};
const PLACE_REACH = {city: 4000, town: 2500, village: 1500, rural: 800};
// Settings, densest first. A suburb (detached homes on lots, about 2.5+ buildings a hectare) keeps the street-facing home
// inference of building-style.js; only a village or rural square switches to countryside defaults.
// Bare ground per setting: 0 paving (city), 1 earth and grass (countryside).
export const GROUND = Object.freeze({city: 0, town: .3, suburb: .7, village: .85, rural: 1});
// In a dry climate open lots are dirt and gravel, not paving, even in a city.
export const ARID_GROUND = .75;

// footprints: [{area, centre: [x, y], tall}] in local metres; places: [{place, name, x, y}].
export function areaContext({footprints = [], places = [], lat = 0, lng = 0} = {}) {
  const r2 = CONTEXT.radius * CONTEXT.radius;
  let built = 0, count = 0, tall = 0;
  for (const f of footprints) if (f.centre[0] ** 2 + f.centre[1] ** 2 <= r2) {built += f.area; count++; if (f.tall) tall++;}
  const coverage = built / (Math.PI * r2);
  let near = null;
  for (const p of places) {
    const kind = SETTLEMENT[p.place], d = Math.hypot(p.x, p.y);
    if (kind && d <= PLACE_REACH[kind] && (!near || d < near.distance)) near = {name: String(p.name || '').slice(0, 60), kind, place: p.place, distance: Math.round(d)};
  }
  const perHectare = count / (Math.PI * r2 / 1e4);
  let setting = coverage >= .2 || tall >= 6 ? 'city' : coverage >= .08 ? 'town' : coverage >= .035 || perHectare >= 2.5 ? 'suburb' : coverage >= .012 || count >= 6 ? 'village' : 'rural';
  // A mapped settlement nudges the guess one step, never across two: an empty square in a city is a park, not farmland.
  if (near?.kind === 'city' && setting !== 'city' && coverage >= .1) setting = 'city';
  else if (near?.kind === 'town' && ['village', 'rural'].includes(setting) && coverage >= .02) setting = 'suburb';
  else if (near?.kind === 'village' && setting === 'rural' && count >= 3) setting = 'village';
  const biome = climateAt([lng, lat]);
  return {setting, climate: biome.label, biome, ground: biome.group === 'arid' ? Math.max(GROUND[setting], ARID_GROUND) : GROUND[setting], coverage: Math.round(coverage * 1000) / 1000, buildings: count, tall, place: near};
}
export const isCountryside = context => context?.setting === 'village' || context?.setting === 'rural';
