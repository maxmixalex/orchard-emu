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
