// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {VirtualUSB,endpoints} from '../dist/virtual-usb.js';
import {decodeSession} from '../dist/session.js';
const wasm=await readFile(new URL('../dist/orchard.wasm',import.meta.url));
const dir=await mkdtemp(resolve(tmpdir(),'orchard-user-links-'));
try{
 const p=spawnSync(process.env.CLANG||'clang',['--target=armv4t-none-eabi','-nostdlib','-fuse-ld=lld','-Wl,-Ttext=0,-e,_start,--oformat=binary','tests/usb-guest.S','-o',resolve(dir,'guest.bin')],{encoding:'utf8'});
 assert.ifError(p.error);assert.equal(p.status,0,p.stderr);
 const bytes=await readFile(resolve(dir,'guest.bin')),rom=new Uint8Array(2097152).fill(255);rom.set(bytes);
 const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
 assert.equal(c.timebase_hz(),12000000);c.create(6);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);assert.equal(c.run(5000),0);
 const notifications=[],host=new VirtualUSB(c,c.timebase_hz(),n=>notifications.push(n));host.start(5000);
 let ticks=5000;while(host.phase!=='ready'&&host.connected&&ticks<1000000){assert.equal(c.run(256),0);ticks+=256;host.poll(ticks);}
 assert.equal(host.phase,'ready',JSON.stringify(notifications));assert.equal(host.info.vendor,0x1234);assert.equal(host.info.product,0x5678);
 assert.deepEqual(host.info.endpoints.map(e=>e.address),[0x81,3]);assert.equal(new Uint32Array(c.memory.buffer,c.usb_snapshot(),44)[1],7);
 const packet=host.send(Uint8Array.of(1,2,3));assert.equal(packet.result,5);assert.equal(packet.accepted,0); // Control-only guest does not configure bulk FIFO mode.
 host.disconnect();assert.equal(c.usb_in(7,0,1),3);assert.throws(()=>host.send(Uint8Array.of(1)));
 for(const value of [new Uint8Array(),Uint8Array.of(9,2,9,0,0,0,0,0,0,0)])assert.throws(()=>endpoints(value));
 console.log('Production virtual USB host enumerates the generated ARM guest through real EP0 FIFO/IRQ operations; descriptors, address/configuration and disconnect pass.');
}finally{await rm(dir,{recursive:true,force:true});}
// Exercise the production Worker serial path and non-pausing automatic snapshots.
const w=new Worker(new URL('./web-worker-node.mjs',import.meta.url)),waiters=[];let last;
w.on('message',d=>{last=d;for(const a of [...waiters])if(a.filter(d)){clearTimeout(a.timer);waiters.splice(waiters.indexOf(a),1);a.resolve(d);}});
function wait(filter){return new Promise((resolve,reject)=>{const a={filter,resolve,timer:setTimeout(()=>reject(new Error('Link Worker timeout '+last?.type+': '+last?.message)),8000)};waiters.push(a);});}
async function send(data,filter){const p=wait(filter);w.postMessage({generation:1,...data});return p;}
try{
 await wait(d=>d.type==='ready');await send({type:'create',model:1,preset:'strict',audience:'calculator'},d=>d.type==='created');
 const rom=new Uint8Array(1048576).fill(255),dv=new DataView(rom.buffer);
 // Reset disables watchdog, then polling ARM firmware echoes UART input.
 const words=[0xea000000,0xe1a00000,0xe59f0028,0xe3a01000,0xe5801000,0xe59f0020,0xe5901010,0xe3110001,0x0afffffc,0xe5d01024,0xe5c01020,0xeafffff9,0xe1a00000,0xe1a00000,0x53000000,0x50000000];
 words.forEach((v,i)=>dv.setUint32(i*4,v,true));
 await send({type:'load',rom:rom.buffer},d=>d.type==='loaded');await send({type:'serial-connect',connected:true},d=>d.type==='serial-status'&&d.connected);
 const echoed=wait(d=>d.type==='uart-output'&&d.bytes.length);
 await send({type:'uart',bytes:Uint8Array.of(65,0,255)},d=>d.type==='uart-sent'&&d.accepted===3);
 await send({type:'run'},d=>d.type==='snapshot'&&d.running);
 const got=[];got.push(...(await echoed).bytes);while(got.length<3)got.push(...(await wait(d=>d.type==='uart-output')).bytes);
 assert.deepEqual(got,[65,0,255]);
 const automatic=await send({type:'checkpoint-auto',request:5},d=>d.type==='checkpoint-auto-saved'&&d.request===5);
 const saved=await decodeSession(automatic.file.buffer);assert.equal(saved.model,1);
 const visible=await wait(d=>d.type==='snapshot');assert.equal(visible.running,true,'autosave must not pause');
 const paused=await send({type:'pause'},d=>d.type==='snapshot'&&!d.running);assert(!paused.stopped);
 await send({type:'checkpoint-load',file:automatic.file.buffer},d=>d.type==='checkpoint-restored');
 const after=await send({type:'pause'},d=>d.type==='snapshot'&&!d.running);assert.equal(after.loaded,true);
 console.log('Production Worker: actual ARM UART echo, calculator-audience received bytes, background snapshot without pause and restored session pass.');
}finally{await w.terminate();for(const a of waiters)clearTimeout(a.timer);}
