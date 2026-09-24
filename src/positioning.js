// Browser sensor glue for Prototype B: Geolocation watch + DeviceOrientation.
// Raw readings are filtered by ./sensors.js and handed to the caller; nothing
// here stores, buffers or transmits position or heading.
import {compassHeading, evaluateFix, travelCourse, SENSORS} from './sensors.js';

export function createPositioning(handlers) {
  const state = {mode: 'manual', headingSource: 'manual', position: 'off', compass: 'off', fixes: {accepted: 0, rejected: 0, streak: 0, lastReason: null}, lastFix: null, courseAnchor: null, course: null, accuracy: null, compassAccuracy: null, rawHeading: null, headingEvents: 0, headingAt: null, compassFlat: false, screenAngle: 0, fixIntervalMs: null, error: null};
  let watchId = null, orientationEvent = null, compassTimer = 0, active = false;
  const screenAngle = () => screen.orientation?.angle ?? (Number(window.orientation) || 0);
  const changed = () => handlers.onState?.(state);

  function onOrientation(event) {
    const heading = compassHeading(event, screenAngle());
    if (heading === null) {
      // A delivered event without usable absolute values means no compass on this device/browser.
      if (state.compass === 'waiting' && event.alpha === null && !Number.isFinite(event.webkitCompassHeading)) {clearTimeout(compassTimer); state.compass = 'unavailable'; state.headingSource = 'manual'; changed();}
      return;
    }
    if (state.compass !== 'on') {clearTimeout(compassTimer); state.compass = 'on'; state.headingSource = 'compass'; changed();}
    state.rawHeading = heading; state.headingEvents++; state.headingAt = Date.now(); state.screenAngle = screenAngle(); state.compassFlat = Number.isFinite(event.beta) && Number.isFinite(event.gamma) && Math.abs(event.beta) < 20 && Math.abs(event.gamma) < 20;
    state.compassAccuracy = Number.isFinite(event.webkitCompassAccuracy) && event.webkitCompassAccuracy >= 0 ? event.webkitCompassAccuracy : null;
    handlers.onHeading(heading);
  }
  function onPosition(position) {
    const c = position.coords;
    const fix = {lng: c.longitude, lat: c.latitude, accuracy: c.accuracy, timestamp: position.timestamp, speed: c.speed, heading: c.heading};
    const verdict = evaluateFix(state.lastFix, fix, state.fixes.streak);
    handlers.onRaw?.(fix, verdict.reason);
    state.accuracy = fix.accuracy;
    if (!verdict.accepted) {state.fixes.rejected++; state.fixes.lastReason = verdict.reason; if (verdict.reason === 'implausible') state.fixes.streak++; if (state.position !== 'on') state.position = 'waiting'; changed(); return;}
    if (state.lastFix) state.fixIntervalMs = fix.timestamp - state.lastFix.timestamp;
    state.fixes.accepted++; state.fixes.streak = 0; state.fixes.lastReason = verdict.reason; state.lastFix = fix; state.position = 'on'; state.error = null;
    const course = travelCourse(state.courseAnchor, fix);
    state.courseAnchor = course.anchor; if (course.bearing !== null) state.course = course.bearing;
    handlers.onFix(fix, course.bearing);
    changed();
  }
  function onPositionError(error) {
    state.error = error.code === 1 ? 'denied' : error.code === 2 ? 'unavailable' : 'timeout';
    if (error.code === 1) {disable(); handlers.onError?.(state.error); return;}
    changed();
    // Receivers emit transient unavailable/timeout errors between fixes; only surface them when no recent fix exists.
    if (!state.lastFix || Date.now() - state.lastFix.timestamp > 10000) handlers.onError?.(state.error);
  }
  function startWatch() {
    if (watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {enableHighAccuracy: true, maximumAge: 1000, timeout: 20000});
    if (state.position !== 'on') state.position = 'waiting';
  }
  function startCompass() {
    if (orientationEvent) return;
    orientationEvent = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    addEventListener(orientationEvent, onOrientation);
    state.compass = 'waiting';
    compassTimer = setTimeout(() => {if (state.compass === 'waiting') {state.compass = 'unavailable'; state.headingSource = 'manual'; changed();}}, SENSORS.compassTimeoutMs);
  }
  function stopSensors() {
    if (watchId !== null) {navigator.geolocation.clearWatch(watchId); watchId = null;}
    if (orientationEvent) {removeEventListener(orientationEvent, onOrientation); orientationEvent = null;}
    clearTimeout(compassTimer);
  }
  // Must run inside a user gesture: iOS only resolves the orientation permission prompt from one.
  async function enable() {
    if (!('geolocation' in navigator)) {state.error = 'unsupported'; changed(); return false;}
    active = true; state.mode = 'gps'; state.error = null; state.fixes = {accepted: 0, rejected: 0, streak: 0, lastReason: null}; state.lastFix = null; state.courseAnchor = null; state.course = null;
    const orientationPermission = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function' ? DeviceOrientationEvent.requestPermission().catch(() => 'denied') : null;
    startWatch(); changed();
    const permission = orientationPermission ? await orientationPermission : 'granted';
    if (!active) return false;
    if (permission === 'granted') startCompass(); else {state.compass = 'denied'; state.headingSource = 'manual';}
    changed();
    return true;
  }
  function disable() {
    active = false; stopSensors();
    Object.assign(state, {mode: 'manual', headingSource: 'manual', position: 'off', compass: 'off', rawHeading: null, courseAnchor: null});
    changed();
  }
  // Hidden tabs stop both sensors; resuming restarts them without a new prompt.
  function pause() {if (active) {stopSensors(); if (state.compass === 'on' || state.compass === 'waiting') state.compass = 'paused'; state.position = 'paused'; changed();}}
  function resume() {if (active && watchId === null) {startWatch(); if (state.compass !== 'denied' && state.compass !== 'unavailable') startCompass(); changed();}}
  return {state, enable, disable, pause, resume};
}
