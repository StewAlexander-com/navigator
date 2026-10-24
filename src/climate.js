// Climate from position: the Köppen–Geiger class of a 0.5° cell (climate-grid.js, bundled, so no request reveals where
// you explore), mapped to a small rendering profile. Latitude alone cannot tell Mesa's desert from Mebane's deciduous
// forest or Los Angeles's dry summer at the same 33–36° N; the climate map can. Mapped OSM features always win over the
// profile: an irrigated park in a desert stays green and a mapped forest stays a forest.
import {KOPPEN_CLASSES, KOPPEN_GRID} from './climate-grid.js';

let cells = null;
function decode() {
  if (cells) return cells;
  const {width, height, symbols, digits, runs} = KOPPEN_GRID;
  cells = new Uint8Array(width * height); let at = 0;
  for (let i = 0; i < runs.length;) {
    const cls = symbols.indexOf(runs[i++]); let n = 0;
    while (i < runs.length && digits.includes(runs[i])) n = n * 30 + digits.indexOf(runs[i++]);
    cells.fill(cls, at, at + (n || 1)); at += n || 1;
  }
  return cells;
}
// Köppen code at [lng, lat]. Small islands and coasts can fall in an ocean cell; the nearest land cell within `reach`
// cells (1.5°) is used instead, else null.
export function koppenAt([lng, lat], reach = 3) {
  const {width, height, step} = KOPPEN_GRID, grid = decode();
  const row = Math.min(height - 1, Math.max(0, Math.floor((90 - lat) / step))), col = ((Math.floor((lng + 180) / step) % width) + width) % width;
  for (let r = 0; r <= reach; r++) {
    let best = null, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const y = row + dy; if (y < 0 || y >= height) continue;
      const cls = grid[y * width + ((col + dx + width) % width)], d = dx * dx + dy * dy;
      if (cls && d < bestD) {bestD = d; best = cls;}
    }
    if (best) return KOPPEN_CLASSES[best];
  }
  return null;
}
// Rendering profile per climate. earth: two bare-ground tones (mixed by noise); leaf: foliage tint; palms/conifers:
// share of illustrative trees; density: illustrative trees on open ground (1 = the base scatter); height: tree scale.
const P = (label, group, earth, leaf, palms, conifers, density, height) => ({label, group, earth, leaf, palms, conifers, density, height});
const PROFILES = {
  rainforest: P('tropical rainforest', 'tropical', [[.30, .44, .20], [.40, .44, .25]], [.95, 1.1, .92], .45, 0, 1.35, 1.1),
  monsoon: P('tropical monsoon', 'tropical', [[.33, .45, .22], [.44, .45, .27]], [.97, 1.08, .92], .4, 0, 1.2, 1.05),
  savanna: P('tropical savanna', 'tropical', [[.52, .50, .28], [.62, .53, .34]], [1.05, 1.02, .86], .3, 0, .55, .9),
  hotDesert: P('hot desert', 'arid', [[.71, .50, .34], [.80, .63, .45]], [.92, .9, .8], .12, 0, .18, .5),
  coldDesert: P('cold desert', 'arid', [[.66, .60, .47], [.75, .69, .55]], [.9, .92, .84], 0, .25, .18, .5),
  hotSteppe: P('hot steppe', 'arid', [[.62, .55, .36], [.70, .60, .42]], [.98, .95, .82], .1, 0, .35, .7),
  coldSteppe: P('cold steppe', 'arid', [[.58, .56, .40], [.66, .62, .46]], [.95, .95, .85], 0, .3, .35, .7),
  mediterranean: P('mediterranean', 'temperate', [[.55, .52, .32], [.65, .57, .38]], [.88, .94, .84], .12, .2, .6, .85),
  subtropical: P('humid subtropical', 'temperate', [[.35, .47, .24], [.45, .46, .28]], [1, 1.06, .95], 0, .2, 1.1, 1.15),
  oceanic: P('oceanic', 'temperate', [[.37, .50, .28], [.46, .50, .31]], [.95, 1.05, .98], 0, .15, .9, 1),
  continental: P('continental', 'continental', [[.39, .48, .28], [.48, .48, .32]], [.95, 1.02, .95], 0, .4, .9, 1),
  subarctic: P('subarctic', 'continental', [[.38, .43, .29], [.47, .46, .34]], [.88, .98, .95], 0, .85, .8, .85),
  tundra: P('tundra', 'polar', [[.49, .51, .40], [.58, .56, .45]], [.85, .92, .9], 0, .5, .05, .3),
  ice: P('ice cap', 'polar', [[.86, .89, .92], [.93, .95, .97]], [.85, .9, .9], 0, 1, 0, .3),
};
export function climateProfile(koppen) {
  const k = koppen || '';
  const key = k === 'Af' ? 'rainforest' : k === 'Am' ? 'monsoon' : k[0] === 'A' ? 'savanna'
    : k === 'BWh' ? 'hotDesert' : k === 'BWk' ? 'coldDesert' : k === 'BSh' ? 'hotSteppe' : k === 'BSk' ? 'coldSteppe'
    : k.startsWith('Cs') ? 'mediterranean' : k === 'Cfa' || k === 'Cwa' ? 'subtropical' : k[0] === 'C' ? 'oceanic'
    : k[0] === 'D' ? (/[cd]$/.test(k) ? 'subarctic' : 'continental') : k === 'ET' ? 'tundra' : k === 'EF' ? 'ice' : null;
  return key ? {koppen: k, key, ...PROFILES[key]} : null;
}
// Without a climate cell (open ocean), fall back to latitude bands.
export function climateAt(point) {
  const profile = climateProfile(koppenAt(point));
  if (profile) return profile;
  const a = Math.abs(point[1]);
  return {koppen: null, ...climateProfile(a < 23.44 ? 'Af' : a < 35 ? 'Cfa' : a < 55 ? 'Cfb' : a < 66 ? 'Dfc' : 'ET')};
}
