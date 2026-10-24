// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {TapQueue} from '../web/hp48.js';
import {CalculatorController} from '../web/controller.js';
for(const [action,scan] of [['self-test',38],['warm-restart',37]]){
  const events=[],q=new TapQueue((scan,down,tick)=>events.push({scan,down,tick}));
  q.push(26);q.update(0);q.systemChord(action,1000);q.push(5);
  assert.deepEqual(events,[{scan:26,down:true,tick:0},{scan:26,down:false,tick:1000}]);
  for(const tick of [1000,1500999,1501000,3000999,3001000,3600999,3601000])q.update(tick);
  assert.deepEqual(events.slice(2),[{scan:56,down:true,tick:1000},{scan,down:true,tick:1501000},
    {scan,down:false,tick:3001000},{scan:56,down:false,tick:3601000}]);
  assert.equal(q.pending,1,'Ordinary taps wait for the held combination to finish');
  assert.equal(q.boundary(3601000),5601000);q.update(5601000);assert.equal(q.active,5);
  q.clear(5601001);assert.equal(q.pending,0);assert.equal(q.held.size,0);
  q.systemChord(action,6000000);q.update(6000000);q.update(7500000);q.clear(7600000);
  assert.deepEqual(events.slice(-2),[{scan:56,down:false,tick:7600000},{scan,down:false,tick:7600000}]);
  assert.equal(q.boundary(7600000),Infinity);assert.throws(()=>q.systemChord('unknown',0));
}
const sent=[],c=new CalculatorController({worker:{postMessage:m=>sent.push(m),terminate(){}},database:null});
c.systemChord('self-test');assert.equal(sent.length,0);
c.patch({ready:true,loaded:true,running:false});c.systemChord('self-test');
assert.deepEqual(sent.map(m=>m.type),['run','system-chord']);assert.equal(sent[1].action,'self-test');
for(const state of [{busy:true},{busy:false,stopped:true},{stopped:false,transfer:{active:true}},{transfer:null,uploadBatch:{active:true}}]){
  c.patch(state);const n=sent.length;c.systemChord('self-test');assert.equal(sent.length,n);
}
c.dispose();console.log('System keys: overlapping ON/F4 and ON/F3 contacts, exact guest-time boundaries, queued tap isolation, cancel/release and transfer/busy guards pass.');

// Sustained input uses actual down/up ownership, while quick clicks still meet
// the guest debounce dwell. These expectations are physical contact sequences,
// independent of the queue's internal records.
{
  const events=[],q=new TapQueue((scan,down,tick)=>events.push({scan,down,tick}),100,30);
  q.press('keyboard:ArrowLeft',43,0);q.press('keyboard:ArrowLeft',43,10);
  q.update(1000);assert.deepEqual(events,[{scan:43,down:true,tick:0}]);assert.equal(q.boundary(1000),Infinity);
  q.press('pointer:2',45,1000);q.release('keyboard:ArrowLeft',1001);q.release('pointer:2',1002);
  q.update(1099);assert.equal(q.pending,1);q.update(1100);
  assert.deepEqual(events.slice(1),[{scan:45,down:true,tick:1000},{scan:43,down:false,tick:1001},{scan:45,down:false,tick:1100}]);
  assert.equal(q.pending,0);assert.equal(q.held.size,0);
  q.press('keyboard:ArrowLeft',43,1200);q.press('pointer:3',43,1210);q.update(1400);
  q.release('keyboard:ArrowLeft',1400);assert(q.held.has(43),'One owner cannot release another owner of the same contact');
  q.release('pointer:3',1401);assert(!q.held.has(43));assert.deepEqual(events.slice(-2),[{scan:43,down:true,tick:1200},{scan:43,down:false,tick:1401}]);
}
{
  const events=[],q=new TapQueue((scan,down,tick)=>events.push({scan,down,tick}),100,30);
  for(let i=0;i<2;i++){q.press('keyboard:Digit1',26,0);q.release('keyboard:Digit1',0);}
  q.pushMany([5,26,6]);for(let tick=0;tick<=650;tick++)q.update(tick);
  assert.deepEqual(events.filter(e=>e.down).map(e=>[e.scan,e.tick]),[[26,0],[26,130],[5,260],[26,390],[6,520]]);
  assert.deepEqual(events.filter(e=>!e.down).map(e=>e.tick),[100,230,360,490,620]);
  q.press('pointer:1',43,700);q.release('pointer:1',710,true);
  assert.deepEqual(events.slice(-2),[{scan:43,down:true,tick:700},{scan:43,down:false,tick:710}]);
  q.pushMany([58,28]);q.press('pointer:2',45,711);q.release('pointer:2',712,true);
  for(let tick=740;tick<=1100;tick++)q.update(tick);
  assert(!events.some(e=>e.scan===45),'A cancelled queued pointer must never press later');
  q.press('keyboard:ArrowLeft',43,1200);q.pushMany([26,5]);q.clear(1210);
  assert.equal(q.pending,0);assert.equal(q.held.size,0);assert.equal(q.pressed.size,0);
  q.release('keyboard:ArrowLeft',1220);q.update(9999);assert.equal(events.at(-1).tick,1210);
  assert.throws(()=>q.press('',43,0));assert.throws(()=>q.press('x',60,0));
  assert.throws(()=>q.release('x',NaN));
}
console.log('Held input: sustained and overlapping physical contacts, shared-key ownership, rapid repeated clicks, ordered macros and immediate cancellation pass.');
