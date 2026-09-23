import test from 'node:test';
import assert from 'node:assert/strict';
import {mib,clock,progressFraction,progressText,updateRate} from '../src/progress.js';
test('progress fraction trusts a Content-Length only while the bytes read stay within it',()=>{
 assert.equal(progressFraction({bytes:512,total:1024}),.5);assert.equal(progressFraction({bytes:1024,total:1024}),1);
 // Compressed transfer: decoded bytes overtake the header value, so the total is unknown and the bar goes indeterminate.
 assert.equal(progressFraction({bytes:2000,total:1024}),null);assert.equal(progressFraction({bytes:10,total:null}),null);assert.equal(progressFraction({bytes:10,total:0}),null);
 assert.equal(progressFraction({fraction:.3,bytes:2000,total:1024}),.3);assert.equal(progressFraction({fraction:1.7}),1);assert.equal(progressFraction({fraction:-1}),0);assert.equal(progressFraction({}),null);
});
test('tqdm-style status line: percent and total only when known, bytes, rate, elapsed clock, phase detail',()=>{
 assert.equal(mib(1048576),'1.00 MiB');assert.equal(mib(12*1048576),'12.0 MiB');assert.equal(clock(0),'00:00');assert.equal(clock(65900),'01:05');assert.equal(clock(-5),'00:00');
 assert.equal(progressText({bytes:1258291,total:2988441,rate:429916,elapsedMs:3200}),'42 % · 1.20 / 2.85 MiB · 0.41 MiB/s · 00:03');
 assert.equal(progressText({bytes:1258291,total:1000000,rate:0,elapsedMs:3200,detail:'parsing OSM data'}),'1.20 MiB · 00:03 · parsing OSM data');
 assert.equal(progressText({elapsedMs:12000,detail:'last fix ±120 m (too inaccurate, need ±60 m)'}),'00:12 · last fix ±120 m (too inaccurate, need ±60 m)');
 assert.equal(progressText({bytes:0,rate:1e6,elapsedMs:500}),'00:00');
});
test('transfer rate is sampled no faster than every 400 ms and smoothed',()=>{
 const s={};assert.equal(updateRate(s,0,1000),0);assert.equal(updateRate(s,100000,1200),0);
 assert.equal(updateRate(s,200000,1500),400000);assert.equal(updateRate(s,200000,1600),400000);
 assert.equal(updateRate(s,200000,2000),200000);assert.equal(updateRate(s,100000,2500),100000);
});
