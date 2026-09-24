import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCoordinates,geocode,formatPoint} from '../src/places.js';
test('coordinate parsing: decimal pairs, hemisphere letters, swapped order, bounds',()=>{
 assert.deepEqual(parseCoordinates('34.0522, -118.2437'),[-118.2437,34.0522]);
 assert.deepEqual(parseCoordinates(' 36.0957 -79.2670 '),[-79.267,36.0957]);
 assert.deepEqual(parseCoordinates('34.0522°N 118.2437°W'),[-118.2437,34.0522]);
 assert.deepEqual(parseCoordinates('118.2437 W, 34.0522 N'),[-118.2437,34.0522]);
 assert.deepEqual(parseCoordinates('33.8688 S, 151.2093 E'),[151.2093,-33.8688]);
 for(const bad of ['','Mebane NC','91, 10','10, 181','34.05','1,2,3'])assert.equal(parseCoordinates(bad),null,bad);
 assert.equal(formatPoint([-118.2437,34.0522]),'34.0522° N, 118.2437° W');
});
test('geocode uses the first Nominatim hit and reports none',async()=>{
 let asked;const ok=async url=>{asked=url;return {ok:true,json:async()=>[{lat:'36.096',lon:'-79.267',name:'Mebane',display_name:'Mebane, NC'}]};};
 assert.deepEqual(await geocode('Mebane NC',ok),{point:[-79.267,36.096],name:'Mebane'});assert.match(asked,/q=Mebane%20NC/);
 assert.equal(await geocode('nowhere',async()=>({ok:true,json:async()=>[]})),null);
 await assert.rejects(geocode('x',async()=>({ok:false,status:429})),/429/);
});
