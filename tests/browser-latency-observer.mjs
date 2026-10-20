// SPDX-License-Identifier: MIT
// Regression for the browser probe's observation/correlation only. The actual
// production UI and original-ROM acceptance are performed by its Python tool.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const python=readFileSync(new URL('../tools/probe-browser-latency.py',import.meta.url),'utf8');
const observer=python.match(/OBSERVER = r'''([\s\S]*?)'''/)[1];
let now=0;const keys=[];
class NativeWorker extends EventTarget {
  postMessage(){}
  receive(data){const event=new Event('message');event.data=data;this.dispatchEvent(event);}
}
const scope={Worker:NativeWorker,performance:{now:()=>++now},
  addEventListener:(type,fn)=>{if(type==='keydown')keys.push(fn);}};
vm.runInNewContext(observer,scope);
const p=scope.__orchardProbe,worker=new scope.Worker(),other=new scope.Worker();
const send=(type,extra={})=>worker.postMessage({type,generation:1,...extra});
const receive=(type,extra={})=>worker.receive({type,generation:1,...extra});
const snapshot=(extra={})=>receive('snapshot',{model:1,loaded:true,running:false,stopped:false,
  pending:0,active:null,frameStatus:0,width:2,height:1,pixels:new Uint8Array([1,2]),...extra});
const key=code=>keys.forEach(fn=>fn({code,repeat:false}));

send('create');send('configure',{speed:1});receive('loaded');snapshot();
assert.equal(p.configured.speed,1);assert(p.snap.seq>p.loaded.seq);
assert.equal(p.restoreSnapshot,null,'An ordinary paused snapshot is not a restored checkpoint');
send('run');snapshot({running:true});
const oldRun=p.runCommand.seq;
send('checkpoint-load');
snapshot();
assert.equal(p.restoreSnapshot,null,'The restore dialog pause cannot acknowledge WebCrypto completion');
receive('checkpoint-restored',{generation:0});snapshot();
assert.equal(p.restoreSnapshot,null,'A marker from a previous generation cannot acknowledge restore');
receive('checkpoint-restored');
other.receive({type:'snapshot',generation:1,loaded:true,running:false});
assert.equal(p.restoreSnapshot,null,'Another Worker cannot acknowledge the current restore');
snapshot({generation:0});assert.equal(p.restoreSnapshot,null);
snapshot();
assert.equal(p.restoreSnapshot.commandSeq,p.restoreCommand.seq);
assert.equal(p.restoreSnapshot.markerSeq,p.restoreMarker.seq);
assert(p.restoreSnapshot.seq>p.restoreMarker.seq&&p.restoreMarker.seq>p.restoreCommand.seq);
assert(oldRun<p.restoreSnapshot.seq,'The earlier auto-run cannot acknowledge a post-restore Resume');
const restored=p.restoreSnapshot;
send('run');snapshot({running:true});
assert.equal(p.restoreSnapshot,restored,'Retain the first post-marker snapshot, rather than a later frame');
assert.equal(p.runSnapshot.commandSeq,p.runCommand.seq);
assert(p.runCommand.seq>restored.seq&&p.runSnapshot.seq>p.runCommand.seq);

assert.throws(()=>p.arm({pixels:[1,2],scans:[26,5,26,6]}),/already visible/);
p.arm({pixels:[3,4],scans:[26,5,26,6]});
key('Digit1');send('tap-sequence',{scans:[26,5,26]});
snapshot({running:true,pixels:new Uint8Array([3,4])});
assert.equal(p.watch.resultAt,null,'An expected-looking stale image before Enter is not a result');
key('Enter');
snapshot({running:true,pixels:new Uint8Array([3,4])});
assert.equal(p.watch.resultAt,null,'Enter keydown alone does not prove the UI sent its scan');
send('tap-sequence',{scans:[6]});
snapshot({generation:0,running:true,pixels:new Uint8Array([3,4])});
assert.equal(p.watch.resultAt,null);
snapshot({running:true,stopped:true,pixels:new Uint8Array([3,4])});
assert.equal(p.watch.resultAt,null,'A stopped guest cannot supply an accepted result');
snapshot({running:true,pixels:new Uint8Array([3,4])});
assert(p.watch.resultAt!==null&&p.watch.resultAt>=p.watch.enterSendAt);
assert(p.watch.resultSeq>p.watch.enterCommandSeq);
assert.deepEqual([...p.watch.sentScans],[26,5,26,6]);

snapshot({running:true});p.arm({pixels:[3,4],scans:[26,5,26,6]});
key('Digit1');key('ShiftLeft');key('ShiftRight');key('Enter');
send('tap-sequence',{scans:[26,5,19,6]});
snapshot({running:true,pixels:new Uint8Array([3,4])});
assert.equal(p.watch.resultAt,null,'Wrong or missing physical scans reject coincidental result pixels');
assert.deepEqual([...p.watch.keys.map(x=>x.code)],['Digit1','Enter'],'Modifier-only events do not start the input clock');

send('pause');snapshot();
assert.equal(p.pauseSnapshot.commandSeq,p.pauseCommand.seq);
assert(p.pauseSnapshot.seq>p.pauseCommand.seq);
send('run');
assert.equal(p.pauseCommand,null,'A resumed session no longer owns the previous pause request');
assert.equal(p.pauseSnapshot,null);
snapshot({running:true});snapshot({stopped:true});
assert.equal(p.pauseSnapshot,null,'A later compatibility stop is not an acknowledgement of an earlier Pause');
send('pause');snapshot({stopped:true});
assert.equal(p.pauseSnapshot,null,'A stopped snapshot does not acknowledge a healthy paused guest');
snapshot();assert.equal(p.pauseSnapshot.commandSeq,p.pauseCommand.seq);
send('checkpoint-load');
assert.equal(p.pauseCommand,null,'A new restore clears the previous input epoch\'s pause association');
assert.equal(p.pauseSnapshot,null);assert.equal(p.runCommand,null);assert.equal(p.runSnapshot,null);
snapshot({stopped:true});assert.equal(p.pauseSnapshot,null);
send('create',{generation:2});
snapshot();receive('checkpoint-restored');
assert.equal(p.snap,null);assert.equal(p.restoreSnapshot,null);assert.equal(p.watch,null);
assert.equal(p.errors.length,0);
console.log('Browser latency observer: stale pause/restore/run messages, compatibility-stop attribution, old generations/Workers, exact result pixels, Enter delivery and physical-scan transcript gates pass.');
