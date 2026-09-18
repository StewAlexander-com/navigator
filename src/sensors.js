// Pure positioning and heading math for Prototype B. No browser APIs here so
// every rule (fix rejection, smoothing, area anchoring) is unit-testable.
import {LIMITS, toLocal} from './world.js';

export const SENSORS = Object.freeze({
  maxAccuracy: 60,        // metres; less accurate fixes are ignored
  maxSpeed: 15,           // m/s; faster implied motion is treated as a glitch
  snapDistance: 45,       // metres; larger corrections jump instead of easing
  positionTau: 0.55,      // seconds; position easing time constant
  headingTau: 0.22,       // seconds; heading easing time constant
  courseDistance: 4,      // metres travelled before displacement sets a course
  courseSpeed: 0.6,       // m/s; below this a GPS-provided course is ignored
  staleFixMs: 30000,      // fixes older than this restart the plausibility check
  recoverAfter: 3,        // consecutive implausible fixes before the old fix is deemed the outlier
  compassTimeoutMs: 4000, // wait this long for a first absolute heading event
  reanchorRetryMs: 30000, // delay before another area download after a failure
  idleHeading: 0.05,      // degrees; smaller residual heading error is "settled"
  idlePosition: 0.01      // metres; smaller residual position error is "settled"
});

const RAD = Math.PI / 180;
export const normalizeHeading = h => ((h % 360) + 360) % 360;
export const headingDelta = (from, to) => ((to - from + 540) % 360) - 180;

// Heading (degrees clockwise from north) of the direction the user faces.
// The device rotation matrix follows the W3C DeviceOrientation algorithm
// (intrinsic Z–X'–Y'' with alpha, beta, gamma). Two candidate forward vectors
// are projected onto the ground: the screen-up axis (device held flat) and the
// rear-camera axis (device held upright). The candidate with the larger
// horizontal footprint is stable in both poses and identical when only pitched.
export function compassHeading({alpha, beta, gamma, webkitCompassHeading, absolute}, screenAngle = 0) {
  if (Number.isFinite(webkitCompassHeading)) return normalizeHeading(webkitCompassHeading + screenAngle);
  if (!absolute || ![alpha, beta, gamma].every(Number.isFinite)) return null;
  const z = alpha * RAD, x = beta * RAD, y = gamma * RAD, t = screenAngle * RAD;
  const cX = Math.cos(x), cY = Math.cos(y), cZ = Math.cos(z), sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
  // Columns of R: device x, y, z axes expressed in the east/north/up frame.
  const ax = [cZ * cY - sZ * sX * sY, cY * sZ + cZ * sX * sY, -cX * sY];
  const ay = [-cX * sZ, cZ * cX, sX];
  const az = [cY * sZ * sX + cZ * sY, sZ * sY - cZ * cY * sX, cX * cY];
  const screenUp = [Math.sin(t) * ax[0] + Math.cos(t) * ay[0], Math.sin(t) * ax[1] + Math.cos(t) * ay[1]];
  const rear = [-az[0], -az[1]];
  const forward = Math.hypot(...screenUp) >= Math.hypot(...rear) ? screenUp : rear;
  if (Math.hypot(...forward) < 1e-6) return null;
  return normalizeHeading(Math.atan2(forward[0], forward[1]) / RAD);
}

// Exponential easing on the circle; returns the new heading.
export function smoothHeading(current, target, dt, tau = SENSORS.headingTau) {
  if (current === null || current === undefined) return normalizeHeading(target);
  const k = 1 - Math.exp(-Math.max(dt, 0) / tau);
  return normalizeHeading(current + headingDelta(current, target) * k);
}

export function smoothPosition(current, target, dt, tau = SENSORS.positionTau) {
  const dx = target[0] - current[0], dy = target[1] - current[1];
  if (Math.hypot(dx, dy) > SENSORS.snapDistance) return [target[0], target[1]];
  const k = 1 - Math.exp(-Math.max(dt, 0) / tau);
  return [current[0] + dx * k, current[1] + dy * k];
}

// Geodesic-free planar distance is adequate at the sub-kilometre scale used here.
export function metresBetween(a, b) {
  const [ax, ay] = toLocal(a, b);
  return Math.hypot(ax, ay);
}

// Accepts or rejects a Geolocation fix against the previous accepted one.
// `fix` is {lng, lat, accuracy, timestamp, speed, heading}. `rejectedStreak`
// counts consecutive implausible rejections: after `recoverAfter` of them the
// previous fix, not the new ones, is treated as the outlier. Returns
// {accepted, reason} and never mutates its inputs.
export function evaluateFix(previous, fix, rejectedStreak = 0) {
  if (![fix.lng, fix.lat].every(Number.isFinite)) return {accepted: false, reason: 'invalid'};
  if (!Number.isFinite(fix.accuracy) || fix.accuracy > SENSORS.maxAccuracy) return {accepted: false, reason: 'inaccurate'};
  if (previous) {
    const dt = (fix.timestamp - previous.timestamp) / 1000;
    if (dt < 0) return {accepted: false, reason: 'out-of-order'};
    if (dt < SENSORS.staleFixMs / 1000) {
      const distance = metresBetween([previous.lng, previous.lat], [fix.lng, fix.lat]);
      // Allow the combined accuracy radii before treating motion as implausible.
      if (distance - previous.accuracy - fix.accuracy > SENSORS.maxSpeed * Math.max(dt, 0.5)) {
        return rejectedStreak >= SENSORS.recoverAfter ? {accepted: true, reason: 'recovered'} : {accepted: false, reason: 'implausible'};
      }
    }
  }
  return {accepted: true, reason: 'ok'};
}

// Direction of travel from GPS: the receiver's course when moving, otherwise
// the displacement from the last course anchor once it exceeds noise.
export function travelCourse(anchor, fix) {
  if (Number.isFinite(fix.heading) && Number.isFinite(fix.speed) && fix.speed >= SENSORS.courseSpeed) return {bearing: normalizeHeading(fix.heading), anchor: fix};
  if (!anchor) return {bearing: null, anchor: fix};
  const [dx, dy] = toLocal([fix.lng, fix.lat], [anchor.lng, anchor.lat]);
  if (Math.hypot(dx, dy) < Math.max(SENSORS.courseDistance, Math.min(anchor.accuracy, fix.accuracy) * 0.5)) return {bearing: null, anchor};
  return {bearing: normalizeHeading(Math.atan2(dx, dy) / RAD), anchor: fix};
}

// Square OSM area ([south, west, north, east]) of the given half-size in metres.
export function areaAround([lng, lat], radius = LIMITS.area) {
  const M = 111319.49079327358;
  const dLat = radius / M, dLng = radius / (M * Math.cos(lat * RAD));
  const round = v => Math.round(v * 1e6) / 1e6;
  return [round(lat - dLat), round(lng - dLng), round(lat + dLat), round(lng + dLng)];
}

export function insideBBox([lng, lat], [south, west, north, east]) {
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

// True when the view radius around the local position still lies within the
// loaded area, so no new download is needed.
export function areaCovers(x, y, bbox, origin, margin = LIMITS.radius) {
  const [minX, minY] = toLocal([bbox[1], bbox[0]], origin), [maxX, maxY] = toLocal([bbox[3], bbox[2]], origin);
  return x - margin >= minX && x + margin <= maxX && y - margin >= minY && y + margin <= maxY;
}
