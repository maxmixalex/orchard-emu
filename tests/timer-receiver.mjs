// SPDX-License-Identifier: MIT
// Node's native timers allow arbitrary receivers. Browser Web IDL timers do
// not: make that contract explicit instead of hiding it in arrow-function fakes.
import assert from 'node:assert/strict';
import {TaskScheduler} from '../web/task-scheduler.js';
const queued=[],pending=new Map();let next=0,sets=0,clears=0,closed=0;
function setTimer(callback,delay){
  assert.equal(this,globalThis,'setTimeout must retain its global receiver');
  ++sets;const id=++next;pending.set(id,{callback,delay});return id;
}
function clearTimer(id){
  assert.equal(this,globalThis,'clearTimeout must retain its global receiver');
  ++clears;pending.delete(id);
}
const channel={port1:{start(){},close(){++closed;}},port2:{postMessage:id=>queued.push(id),close(){++closed;}}};
const scheduler=new TaskScheduler({channel,setTimer,clearTimer});
let fired=0;
const delayed=scheduler.schedule(()=>++fired,1);
assert.equal(sets,1);assert.equal(pending.size,1);
scheduler.cancel(delayed);assert.equal(clears,1);assert.equal(pending.size,0);
// Hit the fallback timer after the four immediate MessagePort tasks.
for(let i=0;i<5;i++)scheduler.schedule(()=>++fired);
assert.equal(queued.length,4);assert.equal(pending.size,1);assert.equal(sets,2);
for(const id of queued.splice(0))channel.port1.onmessage({data:id});
assert.equal(fired,4);
const [id,job]=pending.entries().next().value;pending.delete(id);job.callback();
assert.equal(fired,5);
const a=scheduler.schedule(()=>++fired,50),b=scheduler.schedule(()=>++fired,50);
scheduler.close();scheduler.cancel(a);scheduler.cancel(b);
assert.equal(clears,3);assert.equal(closed,2);assert.equal(pending.size,0);assert.equal(scheduler.jobs.size,0);
assert.throws(()=>scheduler.schedule(()=>{}));
console.log('Browser timer receiver: delayed scheduling, cancellation, burst fallback and shutdown passed');
