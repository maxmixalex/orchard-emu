// SPDX-License-Identifier: MIT
// Actual loopback TCP framing and generated ARM guests, no kernel driver claims.
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const root=resolve(process.env.ORCHARD_HOST_ROOT||'.');
const {createUSBIPServer,DEVID}=await import(pathToFileURL(resolve(root,'host/usbip.mjs')));
const {GuestUSBDevice}=await import(pathToFileURL(resolve(root,'host/device.mjs')));
const {createSerialServer}=await import(pathToFileURL(resolve(root,'host/serial.mjs')));
const wasm=await readFile(resolve(root,'dist/orchard.wasm'));
async function core(model,rom){const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});assert.equal(c.create(model),0);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);return c;}
async function client(port){const s=net.createConnection({port,host:'127.0.0.1'});let buffer=Buffer.alloc(0),waiter=null;
 s.on('error',()=>{});s.on('data',d=>{buffer=Buffer.concat([buffer,d]);flush();});
 function flush(){if(waiter&&buffer.length>=waiter.n){const w=waiter;waiter=null;clearTimeout(w.timer);const result=buffer.subarray(0,w.n);buffer=buffer.subarray(w.n);w.resolve(result);}}
 await once(s,'connect');return {s,read(n){return new Promise((resolve,reject)=>{assert(!waiter);waiter={n,resolve,timer:setTimeout(()=>{waiter=null;reject(Error('TCP read timeout'));},5000)};flush();});}};
}
function operation(code){const b=Buffer.alloc(code===0x8003?40:8);b.writeUInt16BE(0x111);b.writeUInt16BE(code,2);if(code===0x8003)b.write('1-1',8);return b;}
function urb(seq,ep=0,dir=1,length=18){const b=Buffer.alloc(48);b.writeUInt32BE(1);b.writeUInt32BE(seq,4);b.writeUInt32BE(DEVID,8);b.writeUInt32BE(dir,12);b.writeUInt32BE(ep,16);b.writeUInt32BE(length,24);b.writeInt32BE(-1,32);if(!ep)b.set([128,6,0,1,0,0,length,0],40);return b;}
const temp=await mkdtemp(resolve(tmpdir(),'orchard-host-'));
let pump;
try{
 const cc=spawnSync('clang',['--target=armv4t-none-eabi','-nostdlib','-fuse-ld=lld','-Wl,-Ttext=0,-e,_start,--oformat=binary','tests/usb-guest.S','-o',resolve(temp,'guest.bin')],{encoding:'utf8'});assert.equal(cc.status,0,cc.stderr);
 const rom=new Uint8Array(2097152).fill(255);rom.set(await readFile(resolve(temp,'guest.bin')));const c=await core(6,rom),device=new GuestUSBDevice(c);let tick=5000;assert.equal(c.run(tick),0);device.start(tick);
 for(;!device.available&&tick<1000000;){assert.equal(c.run(256),0);tick+=256;device.poll(tick);}assert(device.available,device.error);
 const server=createUSBIPServer(device),port=await server.listen(0);assert.equal(server.server.address().address,'127.0.0.1');
 const sockets=[];
 try{
  const list=await client(port);sockets.push(list.s);const request=operation(0x8005);list.s.write(request.subarray(0,3));list.s.write(request.subarray(3));const data=await list.read(328);assert.equal(data.readUInt32BE(8),1);assert.equal(data.readUInt16BE(312),0x1234);assert.equal(data.readUInt16BE(314),0x5678);
  const owner=await client(port);sockets.push(owner.s);owner.s.write(operation(0x8003));const imp=await owner.read(320);assert.equal(imp.readUInt32BE(4),0);assert(server.attached);
  const second=await client(port);sockets.push(second.s);second.s.write(operation(0x8003));assert.equal((await second.read(8)).readUInt32BE(4),1);
  pump=setInterval(()=>{for(let i=0;i<8;i++){assert.equal(c.run(256),0);tick+=256;device.poll(tick);}},1);
  const get=urb(1);owner.s.write(get.subarray(0,17));owner.s.write(get.subarray(17));const response=await owner.read(66);
  assert.equal(response.readUInt32BE(0),3);assert.equal(response.readUInt32BE(4),1);assert.equal(response.readInt32BE(20),0);assert.equal(response.readUInt32BE(24),18);assert.equal(response.subarray(48).toString('hex'),'12011001ff00000834127856000100000001');
  // Stop guest progress, queue an IN, then unlink it before a transaction.
  clearInterval(pump);pump=null;owner.s.write(urb(2,1,1,64));const unlink=Buffer.alloc(48);unlink.writeUInt32BE(2);unlink.writeUInt32BE(3,4);unlink.writeUInt32BE(DEVID,8);unlink.writeUInt32BE(2,20);owner.s.write(unlink);
  const unlinked=await owner.read(48);assert.equal(unlinked.readUInt32BE(0),4);assert.equal(unlinked.readInt32BE(20),-104);assert.equal(device.jobs.size,0);
  // Oversized URBs close instead of allocating an unbounded transfer.
  const closed=once(owner.s,'close');owner.s.write(urb(4,1,1,65537));await closed;
  console.log('USB/IP: split TCP headers, guest-generated descriptors, exclusive import, real EP0 URB, cancel and oversized rejection pass. No OS attach tested.');
 }finally{clearInterval(pump);for(const s of sockets)s.destroy();await server.close();}
 const uartRom=new Uint8Array(1048576).fill(255),words=[0xea000000,0xe1a00000,0xe59f0028,0xe3a01000,0xe5801000,0xe59f0020,0xe5901010,0xe3110001,0x0afffffc,0xe5d01024,0xe5c01020,0xeafffff9,0xe1a00000,0xe1a00000,0x53000000,0x50000000];words.forEach((v,i)=>new DataView(uartRom.buffer).setUint32(i*4,v,true));
 const u=await core(1,uartRom),serial=createSerialServer(u),port2=await serial.listen(0),peer=await client(port2);
 try{assert.equal(serial.server.address().address,'127.0.0.1');pump=setInterval(()=>{serial.poll();assert.equal(u.run(1024),0);serial.poll();},1);
  const bytes=Buffer.from([65,0,255,13,10]);peer.s.write(bytes);assert.deepEqual(await peer.read(bytes.length),bytes);
  console.log('Serial: actual loopback TCP → ARM UART echo → TCP preserves NUL, high-bit and newline bytes. Not a COM/PTY device.');
 }finally{clearInterval(pump);peer.s.destroy();await serial.close();}
}finally{await rm(temp,{recursive:true,force:true});}
