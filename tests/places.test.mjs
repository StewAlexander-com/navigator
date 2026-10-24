import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCoordinates,geocode,searchPlaces,roadStart,formatPoint} from '../src/places.js';
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
test('place search lists distinct matches with town, region and country',async()=>{
 let asked;const hits=[{lat:'51.5',lon:'-0.12',name:'London',address:{city:'London',state:'England',country:'United Kingdom'}},{lat:'42.98',lon:'-81.24',name:'London',address:{city:'London',state:'Ontario',country:'Canada'}},{lat:'42.98',lon:'-81.24',name:'London',address:{city:'London',state:'Ontario',country:'Canada'}},{lat:'x',lon:'1'}];
 const list=await searchPlaces('London',async url=>{asked=url;return {ok:true,json:async()=>hits};});
 assert.match(asked,/addressdetails=1&limit=5&q=London/);
 assert.deepEqual(list.map(c=>c.detail),['England, United Kingdom','Ontario, Canada']);
 const [m]=await searchPlaces('Mebane',async()=>({ok:true,json:async()=>[{lat:'36.1',lon:'-79.3',name:'Mebane',display_name:'Mebane, Alamance County, North Carolina, United States'}]}));
 assert.equal(m.detail,'Alamance County, North Carolina, United States');
});
test('arrival snaps to the nearest street centre line, never staying off-road',()=>{
 const roads=[{name:'Main Street',highway:'residential',width:8,points:[[-100,30],[100,30]]},{name:'',highway:'footway',width:2,points:[[-50,5],[50,5]]},{name:'',highway:'service',width:4,points:[[-50,15],[50,15]]}];
 const s=roadStart(roads,{x:10,y:0,heading:80});
 assert.equal(s.moved,true);assert.equal(s.name,'Main Street');assert.deepEqual([s.x,s.y].map(Math.round),[10,30]);assert.equal(s.heading,90);
 assert.equal(roadStart(roads,{x:10,y:0,heading:260}).heading,270);
 assert.equal(roadStart(roads,{x:0,y:32,heading:15}).moved,false);
 assert.equal(roadStart([{name:'Far Road',highway:'primary',width:10,points:[[0,400],[10,400]]}],{x:0,y:0}).y,400);
 assert.equal(roadStart([],{x:0,y:0}),null);
});
