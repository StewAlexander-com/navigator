import test from 'node:test';
import assert from 'node:assert/strict';
import {solarPosition,sunAvailability,observeShadow,observationValid,correctedHeading,SUN} from '../src/sun.js';
const at=Date.parse('2026-09-21T19:00:00Z');
const state=(now=at)=>({mode:'gps',position:'on',compass:'on',lastFix:{lat:34.0510824,lng:-118.2462058,timestamp:now},rawHeading:350,headingAt:now,compassFlat:true,compassAccuracy:null,screenAngle:0});
test('NOAA approximation agrees within 0.5 degrees with the independent NREL SPA published example',()=>{
 // NREL/TP-560-34302 Table A5.1, https://docs.nlr.gov/docs/fy08osti/34302.pdf
 const p=solarPosition(Date.parse('2003-10-17T19:30:30Z'),39.742476,-105.1786);
 assert.ok(Math.abs(p.azimuth-194.34024)<.5);assert.ok(Math.abs(p.elevation-(90-50.11162))<.5);
});
test('solar position handles UTC, east/west, leap day, southern hemisphere and polar night',()=>{
 assert.deepEqual(solarPosition(Date.parse('2003-10-17T12:30:30-07:00'),39.742476,-105.1786),solarPosition(Date.parse('2003-10-17T19:30:30Z'),39.742476,-105.1786));
 assert.ok(solarPosition(Date.parse('2024-02-29T00:00:00Z'),-33.9,151.2).elevation>20);
 assert.ok(solarPosition(Date.parse('2024-12-21T12:00:00Z'),80,0).elevation<0);
 assert.ok(solarPosition(Date.parse('2024-06-21T12:00:00Z'),80,0).elevation>20);
 assert.equal(solarPosition(at,91,0),null);assert.equal(solarPosition(NaN,0,0),null);
});
test('no correction from solar prediction without an explicit observation and apply',()=>{
 const s=state(),o=observeShadow(s,at).observation;assert.ok(o);assert.equal(correctedHeading(350,null,true,s,at),350);assert.equal(correctedHeading(350,o,false,s,at),350);
 assert.ok(Math.abs(correctedHeading(350,o,true,s,at)-o.expected)<1e-9);assert.ok(Math.abs(o.offset)<=180);
});
test('alignment requires live recent sensors, flat phone and suitable daylight',()=>{
 for(const s of [{...state(),mode:'manual'},{...state(),compass:'denied'},{...state(),headingAt:at-2001},{...state(),headingAt:at+1},{...state(),lastFix:{...state().lastFix,timestamp:at-30001}},{...state(),compassFlat:false},{...state(),compassAccuracy:50}])assert.ok(observeShadow(s,at).reason);
 const night=Date.parse('2026-09-21T07:00:00Z');assert.match(sunAvailability(state(night),night),/Sun too low/);
 const noon=Date.parse('2026-03-20T12:00:00Z');const zenith={...state(noon),lastFix:{lat:0,lng:0,timestamp:noon}};assert.match(sunAvailability(zenith,noon),/Sun too high/);
});
test('correction expires with age, relocation, screen rotation, loss of sensors or time reversal',()=>{
 const s=state(),o=observeShadow(s,at).observation;assert.equal(observationValid(o,s,at),true);
 assert.equal(observationValid(o,state(at+SUN.lifetimeMs),at+SUN.lifetimeMs),false);
 for(const changed of [{...s,screenAngle:90},{...s,mode:'manual'},{...s,compass:'paused'},{...s,lastFix:{...s.lastFix,lat:s.lastFix.lat+.002}}]){assert.equal(observationValid(o,changed,at),false);assert.equal(correctedHeading(10,o,true,changed,at),10);}
 assert.equal(observationValid(o,state(at-1),at-1),false);
});
