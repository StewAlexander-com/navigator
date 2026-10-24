import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCoordinates,geocode,searchPlaces,searchLandmarks,isLandmark,landmarkRadius,roadStart,formatPoint} from '../src/places.js';
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
test('landmark filter keeps places and drops events, governments, companies and settlements',()=>{
 for(const d of ['Tower in Paris, France','Cathedral in Paris, France, built 1163–1345','Shinto shrine in Tokyo, Japan','Roman Catholic church in Bohol, Philippines','Major railway and metro station in Japan','Historic district in North Carolina, United States','Main residence of the Emperor of Japan','Lake in Tromsø, Norway','Baseball park in Los Angeles, California'])assert.ok(isLandmark(d),d);
 for(const d of ['Capital and largest city of France','2015 terrorist attack in Paris','Government of France from 1870','Lower house of the French Parliament','Radio station in Mebane, North Carolina','Public university in Bohol','Municipality in Bohol, Philippines','Former airport in Central Visayas','Neighborhood in Los Angeles','Satellite earth station in Tromsø, Norway','',null])assert.ok(!isLandmark(d),String(d));
});
test('landmark radius follows the place extent, from 1 to 10 km, in whole metres',()=>{
 assert.equal(landmarkRadius({point:[2.35,48.86],bbox:[48.8156,48.9022,2.2241,2.4699]}),5100);
 assert.equal(landmarkRadius({point:[-79.27,36.1],bbox:[36.09,36.1,-79.28,-79.26]}),1000);
 assert.equal(landmarkRadius({point:[139.7,35.7],bbox:[24,46,122,154]}),10000);
 assert.equal(landmarkRadius({point:[0,0]}),1000);
});
test('landmark search ranks by prominence, skips the place itself, and sends only its coordinates',async()=>{
 const page=(title,index,description,at=[48.85,2.35])=>({title,index,description,...(at?{coordinates:[{lat:at[0],lon:at[1]}]}:{})});
 const pages=[page('Louvre',2,'Art museum in Paris, France',[48.861,2.336]),page('Paris',1,'Capital and largest city of France'),page('Eiffel Tower',0,'Tower in Paris, France',[48.858,2.294]),page('Charlie Hebdo shooting',3,'2015 terrorist attack in Paris'),page('Hidden Arch',4,'Arch in Paris',null),page('Panthéon (Paris)',5,'National mausoleum in Paris',[48.846,2.346]),page("Solomon's Temple",6,'Temple in Jerusalem',[31.778,35.235])];
 let asked,options;const place={point:[2.3522,48.8566],name:'Paris',detail:'Île-de-France, France',bbox:[48.8156,48.9022,2.2241,2.4699]};
 const list=await searchLandmarks(place,async(url,o)=>{asked=url;options=o;return {ok:true,json:async()=>({query:{pages}})};});
 assert.deepEqual(list.map(l=>l.name),['Eiffel Tower','Louvre','Panthéon']);
 assert.deepEqual(list[0],{point:[2.294,48.858],name:'Eiffel Tower',detail:'Tower in Paris, France'});
 assert.match(decodeURIComponent(asked),/nearcoord:5100m,48\.85660,2\.35220&/);assert.match(asked,/colimit=max/);assert.match(asked,/origin=\*/);
 assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');
 assert.equal((await searchLandmarks(place,async()=>({ok:true,json:async()=>({query:{pages}})}),1)).length,1);
 assert.deepEqual(await searchLandmarks(place,async()=>({ok:true,json:async()=>({batchcomplete:true})})),[]);
 assert.deepEqual(await searchLandmarks({point:[NaN,1]},async()=>{throw new Error('no request expected');}),[]);
 await assert.rejects(searchLandmarks(place,async()=>({ok:false,status:429})),/429/);
});
test('place choices keep the Nominatim bounding box for the landmark radius',async()=>{
 const [c]=await searchPlaces('Paris',async()=>({ok:true,json:async()=>[{lat:'48.85',lon:'2.35',name:'Paris',boundingbox:['48.8156','48.9022','2.2241','2.4699']}]}));
 assert.deepEqual(c.bbox,[48.8156,48.9022,2.2241,2.4699]);
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
