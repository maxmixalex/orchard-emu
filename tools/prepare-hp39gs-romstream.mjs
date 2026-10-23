// SPDX-License-Identifier: MIT
// Cold-boot the private original HP39gs NOR and install the published ROMstream
// through its stock USB Disk drive client. No guest-memory installation shortcut.
import assert from 'node:assert/strict';
import{readFile,writeFile,mkdir}from'node:fs/promises';
import{createHash}from'node:crypto';
import{VirtualUSB}from '../web/virtual-usb.js';
import{FileTransfer}from '../web/file-transfer.js';
import{HP39GS_ROM,applySetup}from '../web/hp48.js';
const usage='Usage: node tools/prepare-hp39gs-romstream.mjs FULL-39GS-NOR.bin V2-CALCULATOR-DIRECTORY NEW-OUTPUT-DIRECTORY';
if(process.argv[2]==='--help'){console.log(usage+'\nCold boots the unchanged full NOR, then installs the V2 aplet and library through stock USB.\nRun the Go TestStockOSFullCapture witness with the resulting ready-to-start.checkpoint.\nOutput includes private LCD/checkpoint artifacts; never publish them.');process.exit(0);}
if(process.argv.length!==5)throw Error(usage);
const[romPath,folder,out]=process.argv.slice(2),model=2,hash=b=>createHash('sha256').update(b).digest('hex');
await mkdir(out);const wasm=await readFile('dist/orchard.wasm');
const{instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});assert.equal(c.create(model),0);const rom=await readFile(romPath);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);
assert.equal(hash(rom),HP39GS_ROM,'Requires the pinned complete HP39gs capture');applySetup(c,2,'hp39gs-home');
const state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));let tick=state()[22]+2**32*state()[23],error='',last='';
const report={schema:'orchard-hp39gs-stock-install-v1',model,preset:'hp39gs-home',rom_sha256:hash(rom),wasm_sha256:hash(wasm),cold_boot:true,normal_os_usb_install:true,guest_memory_patched:false,events:[]};
const usb=new VirtualUSB(c,c.timebase_hz(),e=>{console.log('USB',e);if(e.error)error=e.error;});
const ft=new FileTransfer({core:c,usb,model,notify:e=>{if(e.phase==='error')error=e.error;if(e.phase!==last||e.transferred===e.total){console.log('FT',JSON.stringify(e));last=e.phase;report.events.push(e);}},now:()=>tick/c.timebase_hz()*1000});
function run(n){while(n>0){const q=Math.min(8192,n);assert.equal(c.run(q),0,JSON.stringify(state()));tick+=q;n-=q;if(usb.connected)usb.poll(tick);ft.poll(tick);if(error)throw Error(error);}}
function tap(s){assert.equal(c.keyboard_matrix(Math.floor(s/7),s%7,1),0);run(2000000);assert.equal(c.keyboard_matrix(Math.floor(s/7),s%7,0),0);run(2000000);}
async function snap(name){c.frame_view(1);const p=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();await writeFile(out+'/'+name+'.pgm',Buffer.concat([Buffer.from('P5\n131 64\n255\n'),Buffer.from(p.map(x=>255-x))]));c.checkpoint_save();const b=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();await writeFile(out+'/'+name+'.checkpoint',b);const sr=new DataView(b.buffer,b.length-4096,4096);console.log(name,'PC',state()[15].toString(16),'old L1',Array.from({length:5},(_,i)=>sr.getUint32(0x280+i*4,true).toString(16)));}
run(50000000);await snap('memory-clear');tap(40);run(70000000);await snap('home');tap(49);run(20000000);await snap('before');tap(39);run(3000000);for(let i=0;i<(model===1?2:3);++i)tap(44);await snap('receive-menu');
c.gpio_inputs(5,0x8e,2);usb.start(tick);for(let i=0;i<100000&&usb.phase!=='ready';i++)run(8192);assert.equal(usb.phase,'ready');
const files=[];for(const name of['HP39DIR.CUR','HP39DIR.000','HPGCC000.000','LIB275L.000'])files.push({name,bytes:new Uint8Array(await readFile(folder+'/'+name))});assert.equal(hash(files.find(f=>f.name==='HPGCC000.000').bytes),'298732caeba57a240acf135f1260c6f1cf1899e024fb734f3b4d2c4f92cadcc1','Use the published V2 package');report.inputs=files.map(f=>({name:f.name,bytes:f.bytes.length,sha256:hash(f.bytes)}));
ft.start({request:1,mode:'serve',files,transport:'usb'},tick);tap(6);
for(let i=0;i<400000&&!ft.session.served?.has('HP39DIR.000')&&ft.session.name!=='HP39DIR.000';i++)run(8192);
run(30000000);await snap('remote-aplet');tap(6);
for(let i=0;i<800000&&ft.session.transferred!==ft.session.total;i++)run(8192);
assert.equal(ft.session.transferred,ft.session.total);run(120000000);await snap('installed');
ft.cancel(tick);usb.disconnect();c.gpio_inputs(5,0x8e,0);run(2000000);await snap('ready-to-start');
report.complete=true;report.final_tick=tick;await writeFile(out+'/install.json',JSON.stringify(report,null,2)+'\n');
