// "Explore a place": pick any point on Earth for the manual (GPS-off) scene. Coordinates are parsed locally; a place
// name is looked up with OSM Nominatim, which reveals the typed text (never your GPS position) to that service.
export const PLACES = Object.freeze({nominatim: 'https://nominatim.openstreetmap.org/search', timeoutMs: 10000, maxQuery: 200});
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
export async function geocode(query, fetcher = fetch) {
  const q = String(query || '').trim().slice(0, PLACES.maxQuery);
  if (!q) return null;
  const url = `${PLACES.nominatim}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const response = await fetcher(url, {signal: AbortSignal.timeout(PLACES.timeoutMs), credentials: 'omit', referrerPolicy: 'no-referrer', headers: {'Accept-Language': globalThis.navigator?.language || 'en'}});
  if (!response.ok) throw new Error(`Place search returned ${response.status}.`);
  const [hit] = await response.json();
  if (!hit) return null;
  const lng = parseFloat(hit.lon), lat = parseFloat(hit.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? {point: [lng, lat], name: String(hit.name || hit.display_name || q).split(',')[0].slice(0, 80)} : null;
}
export const formatPoint = ([lng, lat]) => `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lng).toFixed(4)}° ${lng < 0 ? 'W' : 'E'}`;
