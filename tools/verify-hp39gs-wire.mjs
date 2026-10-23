// SPDX-License-Identifier: MIT
// Local original-ROM witness: physical switches and USB protocol only.
// Output contains private LCDs, returned objects and checkpoints; do not publish.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { HP39GS_ROM, applySetup } from '../web/hp48.js';
import { VirtualUSB } from '../web/virtual-usb.js';
import { FileTransfer } from '../web/file-transfer.js';
import { inspectHp39File } from '../web/hp39-files.js';

const usage='Usage: node tools/verify-hp39gs-wire.mjs FULL-39GS-NOR.bin V2-CALCULATOR-DIRECTORY NEW-PRIVATE-OUTPUT-DIRECTORY [--roundtrip]';
if(process.argv.length===3&&process.argv[2]==='--help'){
  console.log(usage+'\nCold boots the unchanged full NOR. Uploads the library then aplet using the production Wire sender and the stock HP39/40 (USB) menu. Optionally, stock SEND exports them for byte verification. Finally launches the installed native reader, disconnects, and checks HOME arithmetic. No ROM/RAM patch, browser timing sample or hardware authentication.');
  process.exit(0);
}
if(![5,6].includes(process.argv.length)||process.argv.length===6&&process.argv[5]!=='--roundtrip')throw Error(usage);
const [romPath,folder,out]=process.argv.slice(2,5).map(p=>resolve(p)),roundtrip=process.argv.includes('--roundtrip');
const sha=b=>createHash('sha256').update(b).digest('hex');
const rom=await readFile(romPath),wasm=await readFile('dist/orchard.wasm');
assert.equal(sha(rom),HP39GS_ROM);await mkdir(out);
const report={schema:'orchard-hp39gs-wire-stock-v1',model:2,preset:'hp39gs-home',rom_sha256:sha(rom),wasm_sha256:sha(wasm),
  cold_boot:true,guest_memory_patched:false,host_timing_sample:false,hardware_validated:false,roundtrip,
  calculator_upload_menu:'HP39/40 (USB)',calculator_download_menu:'USB Disk drive…',sources:{},inputs:[],keys:[],usb:[],transfers:[],frames:[],received:[],passed:false};
for(const name of ['web/hp48.js','web/virtual-usb.js','web/file-transfer.js','web/hp39-wire.js','web/hp39-transfer.js','web/hp39-files.js'])report.sources[name]=sha(await readFile(name));
const files=[];
for(const [name,expected] of [['LIB275L.000',null],['HPGCC000.000','298732caeba57a240acf135f1260c6f1cf1899e024fb734f3b4d2c4f92cadcc1']]){
  const bytes=new Uint8Array(await readFile(resolve(folder,name)));if(expected)assert.equal(sha(bytes),expected,'Use the published V2 aplet');
  files.push({name,bytes});report.inputs.push({name,bytes:bytes.length,sha256:sha(bytes),kind:inspectHp39File(bytes).kind});
}
const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});assert.equal(c.create(2),0);
new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);applySetup(c,2,'hp39gs-home');
const hz=c.timebase_hz(),state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
let tick=0,error='',request=0,wireBytesOut=0,wireBytesIn=0,lastLog='';
const returned=[];
const usb=new VirtualUSB(c,hz,event=>{report.usb.push({tick,...event});if(event.error)error=event.error;});
const originalSend=usb.send.bind(usb),originalRead=usb.read.bind(usb);
usb.send=bytes=>{const result=originalSend(bytes);if(ft.wire)wireBytesOut+=result.accepted;return result;};
usb.read=()=>{const result=originalRead();if(ft.wire&&result.result===0)wireBytesIn+=result.bytes.length;return result;};
const ft=new FileTransfer({core:c,usb,model:2,now:()=>tick/hz*1000,notify:event=>{
  if(event.type==='file-transfer-received'){returned.push({name:event.name,bytes:event.bytes.slice()});report.received.push({tick,name:event.name,bytes:event.bytes.length,sha256:sha(event.bytes)});}
  else {report.transfers.push({tick,...event});if(event.phase==='error')error=event.error;
    const log=[event.request,event.phase,event.name,Math.floor((event.transferred||0)/1024)].join(':');
    if(log!==lastLog){lastLog=log;console.log('TRANSFER',tick,event.phase,event.name||'',event.transferred||0);}}
}});
function run(n){while(n){const q=Math.min(8192,n);assert.equal(c.run(q),0,'Diagnostic stop: '+JSON.stringify(state()));tick+=q;n-=q;
  if(usb.connected)usb.poll(tick);ft.poll(tick);if(error)throw Error(error);}}
function until(predicate,budget,label){const end=tick+budget;while(!predicate()&&tick<end)run(Math.min(8192,end-tick));assert(predicate(),label+' exceeded virtual budget');}
function key(scan,down){report.keys.push({tick,scan,down});assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated(scan===56?0:scan===58?5:6,+down),0);}
function tap(scan){key(scan,true);run(2000000);key(scan,false);run(2000000);}
async function frame(name){assert.equal(c.frame_view(1),0);const bytes=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();
  await writeFile(resolve(out,name+'.pgm'),Buffer.concat([Buffer.from('P5\n131 64\n255\n'),Buffer.from(bytes.map(v=>255-v))]),{flag:'wx'});
  const s=state(),record={name,tick,sha256:sha(bytes),stop:s[28],dfsr:s[18],far:s[19]};report.frames.push(record);console.log(name,tick,record.sha256);return record.sha256;}
async function checkpoint(name){assert.equal(c.checkpoint_save(),0);const bytes=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();await writeFile(resolve(out,name+'.checkpoint'),bytes,{flag:'wx'});return sha(bytes);}
function connect(){assert.equal(c.gpio_inputs(5,0x8e,2),0);usb.start(tick);until(()=>usb.phase==='ready',10*hz,'USB enumeration');}
function disconnect(){ft.resetUsb(tick);usb.disconnect();assert.equal(c.gpio_inputs(5,0x8e,0),0);error='';}
try {
  run(50000000);await frame('memory-clear');tap(40);run(70000000);await frame('home');
  tap(49);run(20000000);tap(39);run(3000000);tap(44);await frame('receive-usb-menu');connect();
  assert.equal(usb.info.name,'HPx9G+ Device');
  for(let index=0;index<files.length;index++){
    if(index){run(12000000);tap(39);run(3000000);tap(44);await frame('receive-usb-menu-'+(index+1));}
    const file=files[index],start=tick,beforeOut=wireBytesOut,beforeIn=wireBytesIn;
    ft.start({request:++request,mode:'send',protocol:'hp39-wire',transport:'usb',...file},tick);tap(6);
    until(()=>!ft.active,300*hz,'Wire upload');assert.equal(ft.session.phase,'complete');assert.equal(ft.session.transferred,file.bytes.length);
    report.inputs[index].wire={start_tick:start,end_tick:tick,acknowledged_bytes:ft.session.transferred,
      transport_bytes_out:wireBytesOut-beforeOut,transport_bytes_in:wireBytesIn-beforeIn,check:ft.session.check};
    await frame('wire-complete-'+(index+1));
  }
  run(120000000);await frame('installed-aplet');report.installed_checkpoint_sha256=await checkpoint('installed');
  if(roundtrip){
    // Stock SEND: APLET SEND -> USB Disk drive -> confirm default object name.
    tap(38);run(3000000);for(let i=0;i<3;i++)tap(44);await frame('send-disk-menu');tap(6);run(3000000);await frame('send-name');
    ft.start({request:++request,mode:'receive',transport:'usb'},tick);tap(6);
    until(()=>returned.length===3,900*hz,'Stock SEND round trip');run(12000000);await frame('after-send');
    const aplet=returned.find(f=>inspectHp39File(f.bytes).kind==='B'),library=returned.find(f=>inspectHp39File(f.bytes).kind==='H');
    assert(aplet&&library,'Stock SEND did not return the installed aplet and library');
    assert.deepEqual(aplet.bytes,files[1].bytes,'Aplet changed during Wire install or stock SEND');
    const got=inspectHp39File(library.bytes),original=inspectHp39File(files[0].bytes);
    assert.deepEqual(library.bytes.subarray(got.payloadOffset),files[0].bytes.subarray(original.payloadOffset),'Library body changed');
    assert.equal(got.title,'LIB275L','Library alias changed');
    for(const file of returned)await writeFile(resolve(out,file.name),file.bytes,{flag:'wx'});
    report.aplet_file_equal=true;report.library_body_equal=true;report.library_alias_preserved=true;
  }
  disconnect();run(2000000);report.ready_checkpoint_sha256=await checkpoint('ready-to-start');
  // Normal START and ENTER invoke the native reader from the installed aplet.
  tap(40);run(16000000);await frame('aplet-before-enter');tap(6);run(2000000);await frame('waiting-for-usb');
  connect();assert.equal(usb.info.name,'HP39 ROM Stream V2');report.native_reader_usb=usb.info;await frame('native-reader-connected');
  // No ROM read is required here; the complete-reader witness is separate.
  disconnect();run(60000000);await frame('native-reader-cable-lost');
  // An interrupted reader deliberately waits for ON on its E03 error screen.
  tap(56);run(16000000);tap(48);run(10000000);await frame('home-after-native-return');
  for(const scan of [26,5,26,6])tap(scan);run(30000000);
  report.arithmetic_frame_sha256=await frame('one-plus-one-after-return');
  assert.equal(report.arithmetic_frame_sha256,'abf32ffc5e2fdcfc17172a5351eb6aac13d44a1b432d683f5a1f0c8e2a26844c');
  report.native_reader_launched=true;report.native_exit='E03 cable lost, physical ON acknowledgement';
  report.returned_home=true;report.arithmetic_after_return=true;
  report.final_state=state();assert.equal(report.final_state[18],0);assert.equal(report.final_state[28],0);report.passed=true;
}catch(failure){report.error=String(failure.stack||failure);report.final_state=state();await frame('failure').catch(()=>{});console.error(report.error);process.exitCode=1;}
report.tool_sha256=sha(await readFile(new URL(import.meta.url)));
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log('HP39gs Wire stock workflow',report.passed?'PASSED':'FAILED');
