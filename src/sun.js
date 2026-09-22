// NOAA General Solar Position Calculations, evaluated in UTC (east-positive longitude).
// https://gml.noaa.gov/grad/solcalc/solareqns.PDF
// Approximate geometric Sun position, not atmospheric refraction or a compass measurement.
import {normalizeHeading, headingDelta, metresBetween} from './sensors.js';
const RAD=Math.PI/180;
export const SUN=Object.freeze({minElevation:10,maxElevation:75,mismatch:15,fixAgeMs:30000,headingAgeMs:2000,lifetimeMs:600000,maxDistance:100});
export function solarPosition(timestamp,lat,lng){
 if(![timestamp,lat,lng].every(Number.isFinite)||Math.abs(lat)>90||Math.abs(lng)>180)return null;
 const date=new Date(timestamp),year=date.getUTCFullYear();if(!Number.isFinite(year))return null;
 const days=(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000;
 const day=Math.floor((timestamp-Date.UTC(year,0,1))/86400000)+1;
 const hour=date.getUTCHours()+date.getUTCMinutes()/60+date.getUTCSeconds()/3600;
 const g=2*Math.PI/days*(day-1+(hour-12)/24);
 const eq=229.18*(.000075+.001868*Math.cos(g)-.032077*Math.sin(g)-.014615*Math.cos(2*g)-.040849*Math.sin(2*g));
 const decl=.006918-.399912*Math.cos(g)+.070257*Math.sin(g)-.006758*Math.cos(2*g)+.000907*Math.sin(2*g)-.002697*Math.cos(3*g)+.00148*Math.sin(3*g);
 const ha=(normalizeHeading((hour*60+eq+4*lng)/4)-180)*RAD,phi=lat*RAD;
 const elevation=Math.asin(Math.max(-1,Math.min(1,Math.sin(phi)*Math.sin(decl)+Math.cos(phi)*Math.cos(decl)*Math.cos(ha))))/RAD;
 const azimuth=normalizeHeading(Math.atan2(Math.sin(ha),Math.cos(ha)*Math.sin(phi)-Math.tan(decl)*Math.cos(phi))/RAD+180);
 return {azimuth,elevation};
}
function sensorAvailability(s,now){
 if(s.mode!=='gps')return 'Enable location and compass first.';
 if(!s.lastFix||s.position!=='on'||now-s.lastFix.timestamp<0||now-s.lastFix.timestamp>SUN.fixAgeMs)return 'Waiting for a recent GPS fix.';
 if(s.compass!=='on'||!Number.isFinite(s.rawHeading)||!Number.isFinite(s.headingAt)||now-s.headingAt<0||now-s.headingAt>SUN.headingAgeMs)return 'Waiting for a fresh compass reading.';
 return null;
}
export function sunAvailability(s,now){
 const reason=sensorAvailability(s,now);if(reason)return reason;
 const sun=solarPosition(now,s.lastFix.lat,s.lastFix.lng);
 if(!sun)return 'Location or clock is invalid.';
 if(sun.elevation<SUN.minElevation)return 'Sun too low or below the horizon. Keep using the compass.';
 if(sun.elevation>SUN.maxElevation)return 'Sun too high for a reliable shadow alignment.';
 return null;
}
export function observeShadow(s,now){
 const reason=sunAvailability(s,now);if(reason)return {reason};
 if(!s.compassFlat)return {reason:'Hold the phone flat, screen facing up.'};
 if(s.compassAccuracy!==null&&s.compassAccuracy>20)return {reason:'Compass reports poor accuracy. Move away from metal and retry.'};
 const sun=solarPosition(now,s.lastFix.lat,s.lastFix.lng),expected=normalizeHeading(sun.azimuth+180);
 return {observation:{at:now,lng:s.lastFix.lng,lat:s.lastFix.lat,screenAngle:s.screenAngle,raw:s.rawHeading,expected,offset:headingDelta(s.rawHeading,expected),sun}};
}
export function observationValid(o,s,now){
 return !!o&&!sensorAvailability(s,now)&&now>=o.at&&now-o.at<SUN.lifetimeMs&&s.screenAngle===o.screenAngle&&metresBetween([o.lng,o.lat],[s.lastFix.lng,s.lastFix.lat])<SUN.maxDistance;
}
export function correctedHeading(raw,observation,applied,s,now){
 return applied&&observationValid(observation,s,now)?normalizeHeading(raw+observation.offset):raw;
}
