// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {BuzzerPCM,BuzzerAudio} from '../web/buzzer-audio.js';
import {BuzzerStream} from '../web/buzzer-worker.js';
import {CalculatorController} from '../web/controller.js';
const packet=(tick,edges=[],extra={})=>({tick,epoch:1,overflow:0,level:edges.length?edges.at(-1):0,timebase:12000000,edges:Float64Array.from(edges),...extra});
const square=[];for(let tick=0;tick<=120000;tick+=6000)square.push(tick,(tick/6000)%2);
const complete=new BuzzerPCM().render(packet(120000,square));
assert.equal(complete.samples.length,480,'A 10 ms electrical waveform produces 10 ms of PCM');
let crossings=0;for(let i=1;i<complete.samples.length;i++)if(complete.samples[i]>0&&complete.samples[i-1]<=0)crossings++;
assert.equal(crossings,10,'One kHz must remain one kHz at the 12 MHz functional timebase');
// An irregular Worker/USB packet boundary cannot shift pulse timing or drop
// the fractional sample carried between messages.
const split=new BuzzerPCM(),chunks=[];let start=-1;
for(let end=997;end<120000+997;end+=997){end=Math.min(120000,end);const edges=[];
  for(let i=0;i<square.length;i+=2)if(square[i]>start&&square[i]<=end)edges.push(square[i],square[i+1]);
  const out=split.render(packet(end,edges));chunks.push(...out.samples);start=end;if(end===120000)break;
}
assert.equal(chunks.length,complete.samples.length);
for(let i=0;i<chunks.length;i++)assert(Math.abs(chunks[i]-complete.samples[i])<1e-6,'PCM depends on signal time, not message boundaries');
const dc=new BuzzerPCM();const quiet=dc.render(packet(120000,[0,0]));assert(quiet.samples.every(x=>x===0));
const rising=dc.render(packet(240000,[120000,1]));assert(rising.samples[0]>0.9);
const held=dc.render(packet(1440000,[],{level:1}));assert(Math.abs(held.samples.at(-1))<1e-10,'A stopped high pin cannot make a continuous tone');
const bounded=new BuzzerPCM().render(packet(120000000,[0,0,6000,1,12000,0]));
assert.equal(bounded.samples.length,5760);assert(bounded.discarded>0);assert(bounded.samples.every(x=>x===0),'Accelerated stale beeps are discarded, never replayed seconds later');
assert.throws(()=>new BuzzerPCM().render(packet(100,[-1,0])));
assert.throws(()=>new BuzzerPCM().render(packet(100,[101,0])));
assert.throws(()=>new BuzzerPCM().render(packet(100,[20,1,10,0])));
assert.throws(()=>new BuzzerPCM().render(packet(100,[0,2])));

const memory={buffer:new ArrayBuffer(200)},words=new Uint32Array(memory.buffer,32);
words.set([2,50,1,7,3,0,1,12000000,12,1,1,30,1,0]);let enabled=0,cleared=0;
const stream=new BuzzerStream({memory,buzzer_enable:n=>{enabled=n;return 0;},buzzer_clear:()=>cleared++,buzzer_drain:()=>32});
assert.equal(new BuzzerStream({}).packet(),null);new BuzzerStream({}).configure(false);
stream.configure(true);assert.equal(enabled,1);
const wire=stream.packet();assert.equal(wire.tick,4294967346);assert.equal(wire.epoch,7);assert.equal(wire.overflow,3);
assert.deepEqual([...wire.edges],[4294967308,1,4294967326,0]);
stream.clear();assert.equal(cleared,1);stream.configure(false);assert.equal(stream.packet(),null);

class Context {
  constructor(){this.sampleRate=48000;this.currentTime=10;this.state='suspended';this.nodes=[];this.buffers=[];this.resumes=0;this.closed=false;}
  createGain(){return {connect(){},disconnect(){},gain:{setValueAtTime:value=>{this.volume=value;}}};}
  resume(){this.resumes++;this.state='running';return Promise.resolve();}
  close(){this.closed=true;this.state='closed';return Promise.resolve();}
  createBuffer(_channels,n,rate){const b={n,rate,copyToChannel:samples=>{b.samples=samples.slice();}};this.buffers.push(b);return b;}
  createBufferSource(){const n={connect(){},disconnect(){n.disconnected=true;},stop(){n.stopped=true;},start:t=>{n.startTime=t;}};this.nodes.push(n);return n;}
}
let created=0;const ctx=new Context(),audio=new BuzzerAudio({createContext:()=>{created++;return ctx;}});
audio.receive(packet(120000,square));assert.equal(created,0,'ROM execution alone cannot open or unlock Web Audio');
assert.equal(await audio.unlock(),true);assert.equal(created,1);assert.equal(ctx.resumes,1);
audio.receive(packet(120000,square));assert.equal(ctx.nodes.length,1);assert(ctx.buffers[0].samples.some(x=>Math.abs(x)>0.1));
const old=ctx.nodes[0];audio.reset();assert(old.stopped&&old.disconnected);
audio.receive(packet(240000,[120000,0,126000,1]));assert.equal(ctx.nodes.length,1,'An old Worker epoch cannot revive a paused tone');
audio.receive(packet(240000,[120000,0,126000,1],{epoch:2}));assert.equal(ctx.nodes.length,2);
audio.configure({sound:true,volume:0});assert(ctx.nodes[1].stopped);
audio.configure({sound:true,volume:0.6});assert.equal(ctx.volume,0.6);
audio.receive(packet(360000,[240000,0,246000,1],{epoch:2}));assert.equal(ctx.nodes.length,3,'Restoring volume after zero must recover in the same machine epoch');
audio.configure({sound:false,volume:0.6});assert(ctx.nodes[2].stopped);
audio.receive(packet(480000,[360000,0,366000,1],{epoch:3}));assert.equal(ctx.nodes.length,3);
audio.configure({sound:true,volume:0.35});audio.receive(packet(480000,[360000,0,366000,1],{epoch:3,generation:2}));assert.equal(ctx.nodes.length,4);
await audio.unlock();assert.equal(ctx.resumes,1,'Every key gesture does not restart an unlocked stream');
audio.dispose();assert(ctx.nodes[3].stopped&&ctx.closed);assert.equal(await audio.unlock(),false);
audio.dispose();
const denied=new BuzzerAudio({createContext:()=>({...new Context(),createGain:()=>ctx.createGain(),resume:()=>Promise.reject(Error('Gesture required'))})});
assert.equal(await denied.unlock(),false);denied.dispose();
assert.equal(await new BuzzerAudio({createContext:()=>null}).unlock(),false);
// Exercise the production controller's lifecycle with an inert audio sink.
// Especially important: Pause before the first audio packet has no old epoch
// to reject yet, so the host's explicit run intent must reject that late packet.
const calls=[],sink={configure:p=>calls.push(['configure',p.sound,p.volume]),unlock:()=>{calls.push(['unlock']);return Promise.resolve(true);},
  receive:p=>calls.push(['receive',p.epoch]),reset:()=>calls.push(['reset']),dispose:()=>calls.push(['dispose'])};
const controller=new CalculatorController({worker:{postMessage(){},terminate(){}},audio:sink,database:null});
assert.deepEqual(calls,[['configure',true,0.35]]);
controller.patch({ready:true,loaded:true,running:true});controller.unlockAudio();assert.deepEqual(calls.at(-1),['unlock']);
controller.send('run');controller.pause();let received=calls.filter(x=>x[0]==='receive').length;
controller.receive({type:'buzzer',generation:0,epoch:1});assert.equal(calls.filter(x=>x[0]==='receive').length,received);
controller.send('run');controller.receive({type:'buzzer',generation:0,epoch:2});assert.deepEqual(calls.at(-1),['receive',2]);
let resets=calls.filter(x=>x[0]==='reset').length;controller.send('checkpoint-auto');assert.equal(calls.filter(x=>x[0]==='reset').length,resets);
for(const action of ['pause','reset','checkpoint-save','checkpoint-load','load']){
  controller.send('run');resets=calls.filter(x=>x[0]==='reset').length;controller.send(action);
  assert.equal(calls.filter(x=>x[0]==='reset').length,resets+1,action+' stops playback immediately');
}
controller.setPreferences({...controller.state.prefs,sound:false,volume:0.8});assert(calls.some(x=>x[0]==='configure'&&x[1]===false&&x[2]===0.8));
controller.create();controller.patch({loaded:true,running:true});controller.send('run');received=calls.filter(x=>x[0]==='receive').length;
controller.receive({type:'buzzer',generation:0,epoch:9});assert.equal(calls.filter(x=>x[0]==='receive').length,received);
controller.dispose();assert.deepEqual(calls.at(-1),['dispose']);
console.log('Buzzer: electrical frequency, packet-independent PCM, DC blocking, bounded catch-up, 64-bit wire timestamps, user gesture, pause/stale epoch, mute/volume and disposal passed');
