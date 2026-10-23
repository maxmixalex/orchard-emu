#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Opt-in local host process; never binds externally or installs a system driver.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {parseArgs} from 'node:util';
import {identifyROM} from '../web/catalog.js';
import {decodeSession,encodeSession,MAX_SESSION_BYTES} from '../web/session.js';
import {applySetup,TapQueue} from '../web/hp48.js';
import {Pacer} from '../web/pacing.js';
import {GuestUSBDevice} from './device.mjs';
import {createUSBIPServer} from './usbip.mjs';
import {createSerialServer} from './serial.mjs';
const usage=`Orchard experimental local host (Node 22+)
  node host/run.mjs --rom FULL-NOR.bin [--session SAVED.ord] [--usbip 3240] [--serial 8124] [--speed 1]

At least one connection must be selected. Both listen on 127.0.0.1 only.
Open the guest's transfer mode before enabling USB. A saved .ord can carry
that state from the browser; this is an independent emulator, not the live tab.
Commands: tap <scan,...>, pause, resume, usb, save <new-file.ord>, quit.
USB/IP requires a separately installed client/virtual-controller driver.
No OS-level attach, HP driver or Conn3x compatibility is certified yet.`;
async function main(){
 const {values}=parseArgs({options:{rom:{type:'string'},session:{type:'string'},usbip:{type:'string'},serial:{type:'string'},speed:{type:'string',default:'1'},help:{type:'boolean'}}});
 if(values.help){console.log(usage);return;}
 if(!values.rom||(!values.usbip&&!values.serial))throw Error(usage);
 const port=value=>{if(!/^\d+$/.test(value)||Number(value)>65535)throw Error('Port must be 0–65535');return Number(value);};
 const usbPort=values.usbip?port(values.usbip):null,serialPort=values.serial?port(values.serial):null;
 const speed=Number(values.speed);if(![0,0.5,1,2].includes(speed))throw Error('Speed must be 0, 0.5, 1 or 2 (0 is unlimited)');
 if(![1048576,2097152].includes((await stat(values.rom)).size))throw Error('Expected an exact complete NOR size');
 const rom=await readFile(values.rom);const model=await identifyROM(rom.buffer.slice(rom.byteOffset,rom.byteOffset+rom.length));
 const {instance:{exports:c}}=await WebAssembly.instantiate(await readFile(new URL('../dist/orchard.wasm',import.meta.url)),{});
 if(c.create(model.id))throw Error('Cannot create machine');new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);
 if(c.load(rom.length))throw Error('Cannot load full NOR');applySetup(c,model.id,model.preset);
 if(values.session){
  if((await stat(values.session)).size>MAX_SESSION_BYTES)throw Error('Session too large');
  const bytes=await readFile(values.session);if(bytes.length>MAX_SESSION_BYTES)throw Error('Session too large');
  const saved=await decodeSession(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
  if(saved.model!==model.id||saved.romHash!==model.hash||saved.preset!==model.preset)throw Error('Session identity/configuration does not match this ROM');
  if(saved.state.length<32||saved.state.length>c.checkpoint_size())throw Error('Session checkpoint exceeds this model capacity');
  new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),saved.state.length).set(saved.state);
  if(c.checkpoint_load(saved.state.length))throw Error('Core rejected saved state');
 }
 const words=new Uint32Array(c.memory.buffer,c.snapshot(),33);
 let tick=words[22]+words[23]*4294967296;
 if(!Number.isSafeInteger(tick))throw Error('Session virtual time exceeds the host adapter range');
 // Inputs and USB peer state belong to the host, not to an imported checkpoint.
 for(let col=0;col<8;col++)for(let row=0;row<7;row++)c.keyboard_matrix(col,row,0);
 for(const pin of [0,4,5,6])c.keyboard_dedicated(pin,0);c.usb_connect(0);
 const queue=new TapQueue((scan,down)=>{const r=scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,Number(down)):c.keyboard_dedicated([0,4,5,6][scan-56],Number(down));if(r)throw Error('Key input failed');},model.id===1?1500000:600000,model.id===1?900000:360000);
 let closing=false;
 const device=new GuestUSBDevice(c),serial=serialPort===null?null:createSerialServer(c);
 const usb=usbPort===null?null:createUSBIPServer(device,{onRelease:()=>{if(!closing)device.start(tick);}});
 try {
 if(serial)console.log(`UART stream: 127.0.0.1:${await serial.listen(serialPort)}`);
 if(usb)console.log(`USB/IP: 127.0.0.1:${await usb.listen(usbPort)} (bus 1-1; use command usb in transfer mode)`);
 } catch(error) {await Promise.all([serial?.close(),usb?.close()]);throw error;}
 let running=true,closed=false,pendingSave=false,timer;
 const pacer=new Pacer(c.timebase_hz());pacer.setSpeed(speed,performance.now());
 const input=createInterface({input:process.stdin,terminal:false});
 const close=async()=>{if(closed)return;closed=true;closing=true;clearTimeout(timer);input.close();queue.clear(tick);device.detach();await Promise.all([usb?.close(),serial?.close()]);};
 process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
 input.on('line',line=>{void (async()=>{
  const [command,...args]=line.trim().split(/\s+/);
  if(command==='quit')return close();
  if(command==='pause'){running=false;queue.clear(tick);pacer.reset(performance.now());return;}
  if(command==='resume'){running=true;pacer.reset(performance.now());return;}
  if(command==='tap'){queue.pushMany(args.join(',').split(',').filter(Boolean).map(Number));return;}
  if(command==='usb'){if(!usb)throw Error('USB/IP is not enabled');if(usb.attached)throw Error('Detach the system client before resetting USB');device.start(tick);return;}
  if(command==='save'){
   if(!args.length||pendingSave)throw Error('Choose a new output file; wait for an active save');
   pendingSave=true;running=false;queue.clear(tick);
   try{if(c.checkpoint_save())throw Error('Snapshot unavailable');const state=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();
    await writeFile(args.join(' '),await encodeSession({model:model.id,romHash:model.hash,preset:model.preset,frameView:1,state}),{flag:'wx'});console.log('Saved; execution remains paused.');
   }finally{pendingSave=false;}return;
  }
  console.log('Commands: tap <scan,...>, pause, resume, usb, save <new-file.ord>, quit');
 })().catch(e=>console.error(e.message));});
 function pump(){
  if(closed)return;
  try{
   const until=performance.now()+6;
   while(running&&performance.now()<until){
    queue.update(tick);const amount=pacer.available(performance.now(),Math.min(1024,queue.boundary(tick)-tick));if(!amount)break;
    const result=c.run(amount);pacer.consume(amount);tick+=amount;serial?.poll();device.poll(tick);
    if(result){running=false;console.error('Guest stopped; inspect this ROM/session in the developer workbench.');void close();return;}
   }
   timer=setTimeout(pump,running?pacer.delay():20);
  }catch(e){console.error(e.message);void close();}
 }
 console.log(`${model.name}; conditional board configuration, functional timing. ${values.session?'Session restored.':'Cold boot; tap 40 for F6 as prompted.'}`);
 pump();
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
