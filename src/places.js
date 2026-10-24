// "Explore a place": pick any point on Earth for the manual (GPS-off) scene. Coordinates are parsed locally; a place
// name is looked up with OSM Nominatim, which reveals the typed text (never your GPS position) to that service.
export const PLACES = Object.freeze({nominatim: 'https://nominatim.openstreetmap.org/search', timeoutMs: 10000, maxQuery: 200, choices: 5});
// Accepts "34.0522, -118.2437", "34.0522 -118.2437", "34.0522°N 118.2437°W", and the same with lng/lat order only when
// hemisphere letters make it unambiguous. Returns [lng, lat] or null.
export function parseCoordinates(text) {
  const s = String(text || '').trim().toUpperCase().replace(/[°º]/g, ' ');
  const m = s.match(/^(-?\d{1,3}(?:\.\d+)?)\s*([NSEW])?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*([NSEW])?$/);
  if (!m) return null;
  let a = parseFloat(m[1]), b = parseFloat(m[3]); const ha = m[2], hb = m[4];
  if (ha === 'S' || ha === 'W') a = -Math.abs(a); if (hb === 'S' || hb === 'W') b = -Math.abs(b);
  let lat = a, lng = b;
  if ((ha === 'E' || ha === 'W') && (hb === 'N' || hb === 'S')) {lat = b; lng = a;}
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
  return [lng, lat];
}
// One Nominatim hit as {point, name, detail}; detail is "town, region, country" so similar names can be told apart.
export function placeChoice(hit, q = '') {
  const lng = parseFloat(hit?.lon), lat = parseFloat(hit?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const name = String(hit.name || hit.display_name || q).split(',')[0].trim().slice(0, 80), a = hit.address || {};
  const parts = [a.city || a.town || a.village || a.hamlet || a.suburb || a.county, a.state || a.region || a.province, a.country];
  let detail = [...new Set(parts.filter(p => p && p !== name))].join(', ');
  if (!detail) detail = String(hit.display_name || '').split(',').slice(1).map(s => s.trim()).filter(Boolean).slice(-3).join(', ');
  const box = (hit.boundingbox || []).map(Number), bbox = box.length === 4 && box.every(Number.isFinite) ? box : null;
  return {point: [lng, lat], name, detail, ...(bbox ? {bbox} : {})};
}
// Up to `limit` distinct places for a typed name. Nominatim's usage policy rules out search-as-you-type, so this runs on submit only.
export async function searchPlaces(query, fetcher = fetch, limit = PLACES.choices) {
  const q = String(query || '').trim().slice(0, PLACES.maxQuery);
  if (!q) return [];
  const url = `${PLACES.nominatim}?format=jsonv2&addressdetails=1&limit=${limit}&q=${encodeURIComponent(q)}`;
  const response = await fetcher(url, {signal: AbortSignal.timeout(PLACES.timeoutMs), credentials: 'omit', referrerPolicy: 'no-referrer', headers: {'Accept-Language': globalThis.navigator?.language || 'en'}});
  if (!response.ok) throw new Error(`Place search returned ${response.status}.`);
  const seen = new Set(), out = [];
  for (const hit of await response.json()) {const c = placeChoice(hit, q), key = c && `${c.name}|${c.detail}`; if (c && !seen.has(key)) {seen.add(key); out.push(c);}}
  return out;
}
// Landmarks around a found place, from Wikipedia's nearby-article search (ranked by article prominence, so the Eiffel
// Tower comes before a Paris side street). Only the place's coordinates are sent, never GPS. The short English
// description tells places apart from events, governments and companies that also have coordinates.
export const LANDMARKS = Object.freeze({wikipedia: 'https://en.wikipedia.org/w/api.php', timeoutMs: 8000, minKm: 1, maxKm: 10, fetch: 50, show: 6});
const KIND = /\b(tower|museum|cathedral|church|basilica|temple|mosque|synagogue|shrine|cemetery|monument|memorial|arch|bridge|palace|castle|fort|fortress|citadel|park|garden|gardens|square|plaza|opera house|theatre|theater|library|stadium|arena|mausoleum|building|skyscraper|market|lighthouse|beach|waterfall|falls|lake|mountain|hill|hills|island|zoo|aquarium|gallery|house|mansion|residence|complex|ossuary|statue|fountain|landmark|hall|abbey|monastery|chapel|ruins|archaeological site|historic site|formation|avenue|boulevard|street|promenade|pier|harbou?r|observatory|amphitheat(re|er)|pyramid|gate|wall|canal|viewpoint|reserve|sanctuary|hotel|station|terminal|courthouse|capitol|mall|town hall|city hall|centre|center)\b/;
const NOT = /\b(former|demolished|destroyed|defunct|proposed|planned|cancelled|canceled)\b|attack|bombing|shooting|battle|siege|ceremony|election|riot|massacre|crash|treaty|government|republic|empire|parliament|assembly|legislat|lower house|upper house|organi[sz]ation|company|fashion|university|college|school|institution|arrondissement|municipality|census|unincorporated|neighbo(u)?rhood|district|commune|county|town in|village in|city in|capital|metropolitan|river|railway line|bus|season|band|team|club|radio|television|tv station|satellite|power station|airport|heliport/;
export function isLandmark(description) {
  const d = String(description || '').toLowerCase();
  return !!d && (d.includes('historic district') || (KIND.test(d) && !NOT.test(d)));
}
// Search radius in whole metres (Wikipedia ignores a decimal "5.1km" and falls back to a text search): a quarter of the
// found place's bounding-box diagonal, so a town searches its own extent and a city its centre.
export function landmarkRadius(choice) {
  const [s, n, w, e] = choice?.bbox || [], lat = choice?.point?.[1] || 0;
  const km = [s, n, w, e].every(Number.isFinite) ? Math.hypot((n - s) * 111.32, (e - w) * 111.32 * Math.cos(lat * Math.PI / 180)) / 4 : LANDMARKS.minKm;
  return Math.round(Math.min(LANDMARKS.maxKm, Math.max(LANDMARKS.minKm, km)) * 10) * 100;
}
export async function searchLandmarks(choice, fetcher = fetch, limit = LANDMARKS.show) {
  const [lng, lat] = choice?.point || [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
  const radius = landmarkRadius(choice), near = `nearcoord:${radius}m,${lat.toFixed(5)},${lng.toFixed(5)}`;
  const url = `${LANDMARKS.wikipedia}?action=query&format=json&formatversion=2&origin=*&generator=search&gsrsearch=${encodeURIComponent(near)}&gsrlimit=${LANDMARKS.fetch}&prop=description%7Ccoordinates&colimit=max`;
  const response = await fetcher(url, {signal: AbortSignal.timeout(LANDMARKS.timeoutMs), credentials: 'omit', referrerPolicy: 'no-referrer'});
  if (!response.ok) throw new Error(`Landmark search returned ${response.status}.`);
  const pages = [...((await response.json())?.query?.pages || [])].sort((a, b) => (a.index || 0) - (b.index || 0));
  const self = String(choice.name || '').toLowerCase(), out = [];
  for (const p of pages) {
    const at = p.coordinates?.[0], title = String(p.title || '').trim();
    if (!at || !Number.isFinite(at.lat) || !Number.isFinite(at.lon) || !title || !isLandmark(p.description)) continue;
    if (Math.hypot((at.lat - lat) * 111320, (at.lon - lng) * 111320 * Math.cos(lat * Math.PI / 180)) > radius * 1.2) continue;
    if (title.toLowerCase() === self || title.toLowerCase().startsWith(`${self},`)) continue;
    out.push({point: [at.lon, at.lat], name: title.replace(/\s*\([^)]*\)$/, '').slice(0, 80), detail: String(p.description).slice(0, 90)});
    if (out.length >= limit) break;
  }
  return out;
}
export async function geocode(query, fetcher = fetch) {
  const [hit] = await searchPlaces(query, fetcher, 1);
  return hit ? {point: hit.point, name: hit.name} : null;
}
// Where to stand on arrival: the nearest point on a road's centre line (never inside a building), preferring named
// streets over unnamed ones, paths, service lanes and motorways. Keeps the current spot when it is already on a street.
// Faces along the road, whichever way is closer to the current heading. Returns {x, y, heading, moved, name} or null.
const PATHS = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor']);
const FAST = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);
export function roadStart(roads, {x = 0, y = 0, heading = 0} = {}) {
  let best = null;
  for (const road of roads || []) {
    const p = road.points || [], hw = road.highway || '';
    const penalty = (PATHS.has(hw) ? 80 : 0) + (FAST.has(hw) ? 40 : 0) + (hw === 'service' ? 12 : 0) + (road.name ? 0 : 15);
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
      if (!l) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)), px = a[0] + t * dx, py = a[1] + t * dy, d = Math.hypot(x - px, y - py);
      const score = d + penalty;
      if (!best || score < best.score) best = {score, d, px, py, dx, dy, road, path: PATHS.has(hw)};
    }
  }
  if (!best) return null;
  if (!best.path && best.d <= (best.road.width || 6) / 2) return {x, y, heading, moved: false, name: best.road.name || ''};
  const along = (Math.atan2(best.dx, best.dy) * 180 / Math.PI + 360) % 360, diff = Math.abs(((heading - along + 540) % 360) - 180);
  return {x: best.px, y: best.py, heading: diff <= 90 ? along : (along + 180) % 360, moved: true, name: best.road.name || ''};
}
export const formatPoint = ([lng, lat]) => `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lng).toFixed(4)}° ${lng < 0 ? 'W' : 'E'}`;
