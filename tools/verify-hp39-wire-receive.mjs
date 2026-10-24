// SPDX-License-Identifier: MIT
// Private original-ROM witness. Physical keys, unchanged stock firmware and
// production Wire endpoints only. No guest memory injection or ROM patch.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {applySetup,HP39_ROM,HP39GS_ROM} from '../web/hp48.js';
import {VirtualUSB} from '../web/virtual-usb.js';
import {FileTransfer} from '../web/file-transfer.js';
import {inspectHp39File} from '../web/hp39-files.js';
import {prepareHp39WireFile} from '../web/hp39-wire.js';
import {encodeSession} from '../web/session.js';

const usage='Usage: node tools/verify-hp39-wire-receive.mjs MODEL(1|2) ORIGINAL-ROM.bin NEW-PRIVATE-OUTPUT-DIRECTORY [--multipart LIBRARY APLET] [--wasm WASM] [--transport usb|serial]';
if(process.argv[2]==='--help'){
  console.log(usage+'\nCold boots original 39g+/39gs. Installs two self-authored Notes, then downloads both through a single production Wire listener and compares exact binary bytes. Optionally installs a library and aplet and receives two complete multipart SENDs through another listener. Outputs include private LCDs and returned files; do not publish them. No browser timing or hardware validation.');process.exit(0);
}
const args=process.argv.slice(2);
if(args.length<3||!['1','2'].includes(args[0]))throw Error(usage);
let wasmPath='dist/orchard.wasm',multipartPaths=null,explicitWasm=false,transport='usb';
for(let at=3;at<args.length;at++){
  if(args[at]==='--multipart'&&!multipartPaths&&args[at+1]&&args[at+2]){multipartPaths=args.slice(at+1,at+3);at+=2;}
  else if(args[at]==='--wasm'&&!explicitWasm&&args[at+1]){wasmPath=args[++at];explicitWasm=true;}
  else if(args[at]==='--transport'&&['usb','serial'].includes(args[at+1]))transport=args[++at];
  else throw Error(usage);
}
const model=Number(args[0]),romPath=resolve(args[1]),out=resolve(args[2]),multipart=Boolean(multipartPaths);
if(transport==='serial'&&model!==2)throw Error('Serial Wire requires the original HP39gs.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),text=s=>Uint8Array.from(s,c=>c.charCodeAt(0));
const rom=await readFile(romPath),wasm=await readFile(resolve(wasmPath));assert.equal(sha(rom),model===1?HP39_ROM:HP39GS_ROM);await mkdir(out);
const sourceNotes=[
  {name:'First.arbitrary',bytes:text('HP39AscC 11 Orchard One\r\nFirst Wire object.\r\nHigh bytes: \\233\\255; zero: \\000.\r\n'+('0123456789'.repeat(20)))},
  {name:'Second.arbitrary',bytes:text('HP39AscC 11 Orchard Two\r\nSecond Wire object.\r\nLiteral \\\\123. Trailing zero: \\000')},
];
const expectedNotes=sourceNotes.map(file=>prepareHp39WireFile(file.name,file.bytes).bytes),extra=[];
if(multipart){
  for(const [index,path] of multipartPaths.entries()){
    const bytes=new Uint8Array(await readFile(resolve(path))),info=inspectHp39File(bytes);assert.equal(info.kind,index===0?'H':'B');
    extra.push({name:index===0?'LIBRARY.any':'APLET.any',bytes,info});
  }
}
const report={schema:'orchard-hp39-wire-receive-stock-v1',model,transport,rom_sha256:sha(rom),wasm_sha256:sha(wasm),cold_boot:true,
  guest_memory_patched:false,host_timing_sample:false,hardware_validated:false,multipart,
  sources:{},inputs:[...sourceNotes,...extra].map(f=>({name:f.name,bytes:f.bytes.length,sha256:sha(f.bytes)})),keys:[],frames:[],usb:[],transfers:[],received:[],passed:false};
for(const name of ['web/hp48.js','web/virtual-usb.js','web/file-transfer.js','web/hp39-wire.js','web/hp39-wire-receive.js','web/hp39-files.js'])report.sources[name]=sha(await readFile(name));
const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});assert.equal(c.create(model),0);
new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);applySetup(c,model,model===1?'hp39-home':'hp39gs-home');
const hz=c.timebase_hz(),state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));let tick=0,request=0,error='',last='';
const returned=[],usb=new VirtualUSB(c,hz,e=>{report.usb.push({tick,...e});if(e.error)error=e.error;});
const ft=new FileTransfer({core:c,usb,model,now:()=>tick/hz*1000,notify:e=>{
  if(e.type==='file-transfer-received'){
    returned.push({name:e.name,bytes:e.bytes.slice(),request:e.request});report.received.push({tick,name:e.name,bytes:e.bytes.length,sha256:sha(e.bytes),request:e.request});console.log('RECEIVED',e.name,e.bytes.length);
  }else{
    report.transfers.push({tick,...e});if(e.phase==='error')error=e.error;
    const label=[e.request,e.phase,e.name,e.filesCompleted].join(':');if(label!==last){console.log('TRANSFER',tick,label);last=label;}
  }
}});
function run(n){while(n){const q=Math.min(8192,n);assert.equal(c.run(q),0,'Core stop '+JSON.stringify(state()));tick+=q;n-=q;assert.equal(state()[18],0,'Guest data abort');if(usb.connected)usb.poll(tick);const count=c.uart_receive();if(count)ft.receiveUart(new Uint8Array(c.memory.buffer,c.uart_output(),count).slice(),tick);ft.poll(tick);if(error)throw Error(error);}}
function until(predicate,seconds,label){const end=tick+seconds*hz;while(!predicate()&&tick<end)run(Math.min(8192,end-tick));assert(predicate(),label+' exceeded virtual budget');}
function tap(scan){for(const down of [true,false]){report.keys.push({tick,scan,down});assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated([0,4,5,6][scan-56],+down),0);run(2000000);}}
async function frame(name){assert.equal(c.frame_view(1),0);const pixels=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();
  await writeFile(resolve(out,name+'.pgm'),Buffer.concat([Buffer.from('P5\n131 64\n255\n'),pixels.map(v=>255-v)]),{flag:'wx'});
  const s=state();report.frames.push({name,tick,sha256:sha(pixels),dfsr:s[18],stop:s[28]});console.log('FRAME',name,tick);
}
async function upload(file,label){
  tap(39);run(3000000);tap(44);if(transport==='serial')tap(44);await frame(label+'-receive-menu');
  if(transport==='usb'&&!usb.connected){assert.equal(c.gpio_inputs(5,0x8e,2),0);usb.start(tick);until(()=>usb.phase==='ready',10,'USB enumeration');}
  ft.start({request:++request,mode:'send',transport,protocol:'hp39-wire',name:file.name,bytes:file.bytes},tick);tap(6);
  until(()=>!ft.active,300,'Wire upload');assert.equal(ft.session.phase,'complete');run(24000000);await frame(label+'-installed');
}
async function send(label,target){
  tap(38);run(3000000);tap(44);if(transport==='serial')tap(44);await frame(label+'-send-menu');tap(6);
  // Wire starts on this single OK. A Disk drive filename prompt would be a
  // different protocol; an extra ENTER would remain queued during SEND.
  until(()=>returned.length===target,300,'Stock Wire SEND');run(24000000);await frame(label+'-received');assert(ft.active);
}
try{
  run(50000000);tap(40);run(70000000);await frame('home');
  tap(59);tap(27);run(20000000);await frame('empty-note-catalog');
  for(const [index,file] of sourceNotes.entries())await upload(file,'note-'+(index+1));
  tap(42);await frame('first-note-selected');
  // A portable, original-ROM state makes the same actual Notes reproducible
  // in the production browser. No guest addresses or protocol replies are
  // changed. Keep this private session with the other witness outputs.
  assert.equal(c.checkpoint_save(),0);
  const checkpoint=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();
  const session=await encodeSession({model,romHash:sha(rom),preset:model===1?'hp39-home':'hp39gs-home',frameView:1,state:checkpoint});
  await writeFile(resolve(out,'notepad-ready.ord'),session,{flag:'wx'});
  report.session={name:'notepad-ready.ord',bytes:session.length,sha256:sha(session),checkpoint_version:new DataView(checkpoint.buffer).getUint32(8,true)};
  report.notes=[];
  for(const [index,bytes] of expectedNotes.entries()){
    const name=`expected-note-${index+1}.note`,source=sourceNotes[index];
    await writeFile(resolve(out,name),bytes,{flag:'wx'});
    await writeFile(resolve(out,source.name),source.bytes,{flag:'wx'});
    report.notes.push({title:inspectHp39File(bytes).title,source:source.name,source_bytes:source.bytes.length,source_sha256:sha(source.bytes),expected:name,expected_bytes:bytes.length,expected_sha256:sha(bytes)});
  }
  const notesRequest=++request;ft.start({request:notesRequest,mode:'receive',transport,protocol:'hp39-wire'},tick);
  await send('first-note',1);tap(44);await send('second-note',2);
  const expectedByTitle=new Map(expectedNotes.map(bytes=>[inspectHp39File(bytes).title,bytes]));
  assert.equal(new Set(returned.map(f=>inspectHp39File(f.bytes).title)).size,2,'Both distinct Notes must be sent');
  for(const file of returned)assert.deepEqual(file.bytes,expectedByTitle.get(inspectHp39File(file.bytes).title),'Both Note titles and binary strings must match exactly');
  assert(returned.every(f=>f.request===notesRequest));assert.equal(new Set(returned.map(f=>f.name)).size,2);
  ft.cancel(tick);assert.equal(returned.length,2);assert.equal(ft.pending,false);report.two_notes_exact=true;report.notes_one_listener=true;report.stop_kept_files=true;
  if(multipart){
    tap(49);run(24000000);await frame('aplet-catalog');
    for(const [index,file] of extra.entries())await upload(file,'multipart-'+(index+1));
    const multipartRequest=++request;ft.start({request:multipartRequest,mode:'receive',transport,protocol:'hp39-wire',receiveBudget:{files:14,bytes:8*1024*1024-returned.reduce((n,f)=>n+f.bytes.length,0)}},tick);
    for(let attempt=0;attempt<2;attempt++){
      await send('multipart-'+(attempt+1),4+2*attempt);
      const files=returned.slice(2+2*attempt,4+2*attempt),library=files.find(f=>inspectHp39File(f.bytes).kind==='H'),aplet=files.find(f=>inspectHp39File(f.bytes).kind==='B');
      assert(library&&aplet);const info=inspectHp39File(library.bytes);
      assert.deepEqual(library.bytes.subarray(info.payloadOffset),extra[0].bytes.subarray(extra[0].info.payloadOffset),'Original library body must be preserved');
      assert.deepEqual(aplet.bytes,extra[1].bytes,'Original aplet bytes must be preserved');assert(files.every(f=>f.request===multipartRequest));
    }
    assert.equal(new Set(returned.map(f=>f.name)).size,6);ft.cancel(tick);report.multipart_two_sends_exact=true;report.multipart_one_listener=true;
  }
  usb.disconnect();assert.equal(c.gpio_inputs(5,0x8e,0),0);run(2000000);tap(48);run(10000000);for(const scan of [26,5,26,6])tap(scan);run(30000000);await frame('one-plus-one');
  // The HOME header names the current aplet. Compare the unchanged expression,
  // result 2 and softkeys below it; the reference was visually checked.
  report.arithmetic_work_area_sha256=sha(new Uint8Array(c.memory.buffer,c.frame_buffer()+131*8,131*56));
  assert.equal(report.arithmetic_work_area_sha256,'4f424d9352b6962f8d3d8ec76203f9d7c60136d66caf9b85774d8c6227717bea');
  report.arithmetic_after_transfer=true;report.final_state=state();report.passed=true;
}catch(failure){report.error=String(failure.stack||failure);report.final_state=state();console.error(report.error);await frame('failure').catch(()=>{});process.exitCode=1;}
for(const file of returned)await writeFile(resolve(out,file.name),file.bytes,{flag:'wx'});
report.tool_sha256=sha(await readFile(new URL(import.meta.url)));await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log('HP39 Wire receive stock workflow',report.passed?'PASSED':'FAILED');
