// SPDX-License-Identifier: MIT
// Deterministic host diagnostics: no browser, firmware, WASM or timing benchmark.
import assert from 'node:assert/strict';
import {attachRuntimeTrace,validateRuntimeTrace} from '../tools/browser-runtime-trace.mjs';

function fixture(maxEvents=50000) {
  let now=0,tick=100,next=0;const jobs=new Map(),contacts=[];
  const scheduler={
    schedule(callback,delay){const id=++next;jobs.set(id,{callback,delay});return id;},
    cancel(id){jobs.delete(id);},
  };
  const trace=attachRuntimeTrace({scheduler,maxEvents,timeOrigin:1000,now:()=>now,
    context:()=>({generation:7,model:1,tick,speed:1,credit:256,pending:0,active:null})});
  const core=trace.wrapCore({
    keyboard_matrix:(...args)=>{contacts.push(args);return 0;},
    keyboard_dedicated:(...args)=>{contacts.push(args);return 0;},
  });
  return {trace,scheduler,core,jobs,contacts,
    begin:epoch=>trace.begin({epoch,generation:7,model:1,source:'checkpoint-load'}),
    advance(ms,ticks=0){now+=ms;tick+=ticks;},
    run(id){const job=jobs.get(id);assert(job);jobs.delete(id);return job.callback();}};
}
const f=fixture();
const untouched={type:'snapshot',generation:7};
assert.equal(f.trace.outgoing(untouched),untouched,'No runtime epoch exists before ROM load');
f.begin(1);
f.trace.command({type:'tap',generation:7,diagnostic_runtime:{seq:41,time_origin_ms:500,at_ms:501}});
const task=f.scheduler.schedule(()=>{
  f.core.keyboard_matrix(3,5,1);f.advance(2,1024);f.core.keyboard_matrix(3,5,0);
  f.core.keyboard_dedicated(4,1);return 123;
},1);
assert.equal(f.jobs.get(task).delay,1,'Instrumentation must preserve the requested delay');
f.advance(4);
assert.equal(f.run(task),123,'Instrumentation must preserve task results');
const outgoing=f.trace.outgoing({type:'snapshot',generation:7,running:true,loaded:true,
  stopped:false,frameStatus:0,pixels:new Uint8Array([1,2])});
assert(outgoing.diagnostic_runtime?.epoch===1);
assert.deepEqual(f.contacts,[[3,5,1],[3,5,0],[4,1]]);
const capture=f.trace.capture('requested-paused'),rows=capture.events;
assert.equal(capture.instrumented,true);assert.equal(capture.performance_sample,false);
assert.equal(capture.complete,true);assert.equal(capture.time_origin_ms,1000);
assert.equal(capture.event_count,rows.length);assert.deepEqual(capture.open_tasks,[]);
assert.equal(validateRuntimeTrace(capture),capture);
assert.deepEqual(rows.map(row=>row.seq),rows.map((_,i)=>i+1));
assert(rows.every(row=>row.epoch===1&&row.generation===7&&row.model===1));
const command=rows.find(row=>row.type==='command');
assert.deepEqual([command.main_seq,command.main_time_origin_ms,command.main_at_ms],[41,500,501]);
const queued=rows.find(row=>row.type==='task-queued'),start=rows.find(row=>row.type==='task-start'),end=rows.find(row=>row.type==='task-end');
assert.equal(start.queued_seq,queued.seq);assert.equal(end.start_seq,start.seq);
assert.equal(start.at_ms-queued.at_ms,4);assert.equal(end.at_ms-start.at_ms,2);
assert.equal(end.tick-start.tick,1024);
assert.deepEqual(rows.filter(row=>row.type==='key-contact').map(row=>[row.scan,row.down,row.tick,row.result]),
  [[26,true,100,0],[26,false,1124,0],[57,true,1124,0]]);
assert.equal(rows.find(row=>row.seq===outgoing.diagnostic_runtime.seq).type,'snapshot-post');
assert.equal(rows.find(row=>row.seq===outgoing.diagnostic_runtime.seq).tick,1124);
const observed={epoch:1,generation:7,model:1,host_observation:{instrumented:true,performance_sample:false,
  result_worker_event:outgoing.diagnostic_runtime,last_command_seq:41,completion_scan:26}};
validateRuntimeTrace(capture,observed);
for(const [edit,match] of [
  [o=>{o.result_worker_event={epoch:2,seq:1};},/result snapshot association/],
  [o=>{o.last_command_seq=999;},/input command association/],
  [o=>{o.completion_scan=49;},/completion key did not reach the guest/],
]) {const invalid=structuredClone(observed);edit(invalid.host_observation);assert.throws(()=>validateRuntimeTrace(capture,invalid),match);}
f.trace.command({type:'pause'});f.core.keyboard_dedicated(4,0);
assert.equal(f.trace.capture('late'),capture,'The original capture remains immutable after release');
assert.equal(capture.events.length,rows.length);

// A stop can freeze the evidence inside a task, before its finally/release.
f.begin(2);
const stopped=f.scheduler.schedule(()=>{f.advance(3,10);return f.trace.capture('core-stop');},0);
const during=f.run(stopped);
assert.equal(during.open_tasks.length,1);
assert.equal(during.events.at(-1).type,'capture');
assert(!during.events.some(row=>row.type==='task-end'));
assert.equal(f.trace.capture('after-finally'),during);
validateRuntimeTrace(during);

// New epochs cannot borrow the previous task/capture, and limits fail closed.
f.begin(3);
const cancelled=f.scheduler.schedule(()=>assert.fail('Cancelled callback ran'),0);
f.scheduler.cancel(cancelled);assert.equal(f.jobs.size,0);
const fresh=f.trace.capture('fresh');
assert.equal(fresh.epoch,3);assert.equal(fresh.events[0].type,'epoch');
assert(fresh.events.every(row=>row.epoch===3));assert.deepEqual(fresh.open_tasks,[]);
const limited=fixture(2);limited.begin(1);limited.trace.command({type:'tap'});
const incomplete=limited.trace.capture('limited');
assert.equal(incomplete.complete,false);assert.equal(incomplete.events.length,2);
assert.equal(incomplete.event_count,3);assert.equal(incomplete.event_limit,2);
assert.throws(()=>validateRuntimeTrace(incomplete),/incomplete event history/);
for(const [edit,match] of [
  [t=>{t.events[1].seq++;},/reordered event/],
  [t=>{t.events[1].generation++;},/event identity/],
  [t=>{t.events[1].at_ms=-1;},/non-monotonic host time/],
  [t=>{t.events.find(r=>r.type==='task-end').start_seq=999;},/task start association/],
  [t=>{t.performance_sample=true;},/not a performance sample/],
]) {const invalid=structuredClone(capture);edit(invalid);assert.throws(()=>validateRuntimeTrace(invalid),match);}

const broken=fixture();broken.begin(1);
const failing=broken.scheduler.schedule(()=>{throw Error('original task failure');},0);
assert.throws(()=>broken.run(failing),/original task failure/);
const failure=broken.trace.capture('failure');
assert.equal(failure.events.at(-2).type,'task-end');assert.deepEqual(failure.open_tasks,[]);
assert.throws(()=>attachRuntimeTrace({scheduler:{},context:()=>({}),timeOrigin:NaN}),/Invalid runtime trace/);
console.log('Runtime trace: exact contact ticks, cross-clock command/snapshot IDs, preserved scheduling, bounded events, isolated epochs and immutable in-task stop capture pass.');
