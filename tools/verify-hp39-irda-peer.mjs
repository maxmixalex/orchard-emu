// SPDX-License-Identifier: MIT
// Cold original-ROM aplet transfer with an explicitly selected SRAM-decoding
// hypothesis. The post-transfer USB exports compare source and received data.
// Private output contains checkpoints, LCDs and exported calculator objects.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {applySetup} from '../web/hp48.js';
import {VirtualUSB} from '../web/virtual-usb.js';
import {FileTransfer} from '../web/file-transfer.js';
import {inspectHp39File} from '../web/hp39-files.js';

const usage='Usage: node tools/verify-hp39-irda-peer.mjs WASM ROM-DIRECTORY FROM-MODEL TO-MODEL NEW-PRIVATE-OUTPUT-DIRECTORY';
if(process.argv.length===3&&process.argv[2]==='--help'){console.log(usage+'\nModels1=HP39g+,2=HP39gs. Explicitly selects the nGCS1 SRAM mirror hypothesis. No ROM or guest RAM patch. Outputs stay private.');process.exit(0);}
if(process.argv.length!==7)throw Error(usage);
const wasmPath=resolve(process.argv[2]),romDir=resolve(process.argv[3]),
 models=process.argv.slice(4,6).map(Number),out=resolve(process.argv[6]);
assert(models.every(model=>model===1||model===2),'Only the two admitted39 originals');
const fixtures={
 1:['39g+.bin','hp39-home','95920417d4dee311e6113f11720de11018da166a8a777d9255fbff2dd6433f67'],
 2:['hp39gs-full.bin','hp39gs-home','a431b5d61af36aeaffec02a395da648b01507c3b5acc9d325f113384483680ff'],
};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),wasm=await readFile(wasmPath);
await mkdir(out);
const report={schema:'orchard-original-hp39-irda-peer-v1',models,cold_boot:true,
 wasm_sha256:sha(wasm),tool_sha256:sha(await readFile(new URL(import.meta.url))),
 physical_input_only:true,guest_memory_patched:false,bank1_mirror_hypothesis:true,
 ram_bytes_per_instance:262144,physical_hardware_validated:false,
 roms:[],frames:[],keys:[],wire:[[],[]],discarded_while_unready:[0,0],exports:[],passed:false};
const machines=[];let linked=true;
for(let i=0;i<2;i++){
 const model=models[i],[file,preset,hash]=fixtures[model],rom=await readFile(join(romDir,file));
 assert.equal(sha(rom),hash,'Original ROM identity');
 const{instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
 assert.equal(c.create(model),0);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);
 assert.equal(c.load(rom.length),0);applySetup(c,model,preset);assert.equal(c.sram_select(1),0);
 machines.push({c,model,i,tick:0,last:-1,error:'',usb:null,ft:null,received:[]});
 report.roms.push({side:i,model,preset,sha256:hash});
}
const state=m=>Array.from(new Uint32Array(m.c.memory.buffer,m.c.snapshot(),33));
const uart=m=>Array.from(new Uint32Array(m.c.memory.buffer,m.c.uart_snapshot(2),9));
function route(from,to){
 const c=from.c,n=c.uart_receive_channel(2);if(!n)return;
 const bytes=new Uint8Array(c.memory.buffer,c.uart_output(),n).slice(),src=uart(from),dst=uart(to);
 assert(report.wire[from.i].length+n<1024*1024,'Bound private wire capture');
 report.wire[from.i].push(...bytes);
 if(!linked||!(src[0]&64)||src[1]&32||!dst[7]||!(dst[0]&64)||!(dst[1]&3)||dst[1]&32){
  report.discarded_while_unready[from.i]+=n;return;
 }
 new Uint8Array(to.c.memory.buffer,to.c.uart_input(),n).set(bytes);
 assert.equal(to.c.uart_send_channel(2,n),n,'Peer staging must have room');
}
function run(n){while(n){
 const q=Math.min(n,linked&&(uart(machines[0])[7]||uart(machines[1])[7])?512:8192);
 for(const m of machines){
  assert.equal(m.c.run(q),0,JSON.stringify(state(m)));m.tick+=q;
  assert.equal(state(m)[18],0,'Guest ARM data abort');route(m,machines[1-m.i]);
  if(m.usb?.connected)m.usb.poll(m.tick);m.ft?.poll(m.tick);
  if(m.error)throw Error(m.error);
 }n-=q;
}}
function key(m,scan,down){
 assert.equal(scan<56?m.c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):m.c.keyboard_dedicated([0,4,5,6][scan-56],+down),0);
 report.keys.push({side:m.i,tick:m.tick,scan,down});
}
function tap(m,scan){
 if(m.last===scan)run(2000000);m.last=scan;
 key(m,scan,true);run(2000000);key(m,scan,false);run(2000000);
}
const alphabet=[28,21,14,7,29,22,15,8,1,30,23,16,9,2,57,24,17,10,3,25,18,11,4,26,19,12];
function type(m,text){for(const ch of text){tap(m,58);tap(m,alphabet[ch.charCodeAt(0)-65]);}}
async function frame(label){
 const hashes=[];
 for(const m of machines){
  const c=m.c;assert.equal(c.frame_view(1),0);
  const pixels=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();
  await writeFile(join(out,`${label}-${m.i}.pgm`),Buffer.concat([Buffer.from('P5\n131 64\n255\n'),pixels.map(v=>255-v)]),{flag:'wx'});
  assert.equal(c.checkpoint_save(),0);const cp=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();
  await writeFile(join(out,`${label}-${m.i}.checkpoint`),cp,{flag:'wx'});
  hashes.push(sha(pixels));report.frames.push({label,side:m.i,model:m.model,tick:m.tick,
   frame_sha256:sha(pixels),checkpoint_sha256:sha(cp),state:state(m),uart2:uart(m)});
 }console.log(label,machines[0].tick);return hashes;
}
function until(test,budget){
 const end=machines[0].tick+budget;
 while(!test()&&machines[0].tick<end)run(Math.min(8192,end-machines[0].tick));
 assert(test(),'Bounded firmware operation must complete');
}
async function exportAplet(m){
 tap(m,49);run(24000000);await frame('export-catalog-'+m.i);
 tap(m,38);run(3000000);for(let i=0;i<(m.model===1?2:3);i++)tap(m,44);
 await frame('export-menu-'+m.i);
 assert.equal(m.c.gpio_inputs(5,0x8e,2),0);
 m.usb=new VirtualUSB(m.c,m.c.timebase_hz(),event=>{if(event.error)m.error=event.error;});
 m.usb.start(m.tick);until(()=>m.usb.phase==='ready',120000000);
 tap(m,6);run(3000000);await frame('export-name-'+m.i);
 m.ft=new FileTransfer({core:m.c,usb:m.usb,model:m.model,now:()=>m.tick/m.c.timebase_hz()*1000,
  notify:event=>{
   if(event.type==='file-transfer-received'){m.received.push(event);console.log('exported',m.i,event.name,event.bytes.length);}
   if(event.phase==='error')m.error=event.error;
  }});
 m.ft.start({request:1,mode:'receive',transport:'usb'},m.tick);tap(m,6);
 until(()=>m.received.some(file=>inspectHp39File(file.bytes).kind==='B'),1200000000);
 run(24000000);
 const file=m.received.find(file=>inspectHp39File(file.bytes).kind==='B'),info=inspectHp39File(file.bytes);
 assert.equal(info.title,'IRTEST');await writeFile(join(out,'export-'+m.i+'.bin'),file.bytes,{flag:'wx'});
 report.exports.push({side:m.i,model:m.model,name:file.name,info,sha256:sha(file.bytes),
  body_sha256:sha(file.bytes.subarray(info.payloadOffset))});
 return file.bytes;
}
try{
 const[sender,receiver]=machines;
 run(60000000);tap(sender,40);tap(receiver,40);run(52000000);await frame('home');
 for(const scan of[19,5,12,6])tap(sender,scan);run(24000000);
 assert.equal((await frame('arithmetic'))[0],'ed1ee4231ddc7255a34ae7469d3a7790bf8e49bc6917d28d60d70f14e80b7ba0','Stock2+3 result5');
 tap(sender,49);tap(sender,35);type(sender,'IRTEST');tap(sender,6);run(60000000);await frame('saved');
 tap(sender,40);tap(sender,41);for(const scan of[26,19,12,25,18,6])tap(sender,scan);
 run(24000000);const expression=(await frame('expression'))[0];
 assert.equal(expression,'d1a58bcb22f90818144078eb566c90c48a6ba862ee2ef7c0ce1a3d06163052ad','StockIRTEST F1=12345');
 tap(sender,49);run(24000000);tap(receiver,49);run(24000000);await frame('library');
 tap(sender,38);tap(receiver,39);await frame('ir-menus');
 tap(receiver,6);tap(sender,6);run(3000000);await frame('ir-name');tap(sender,6);
 let waited=0;while((uart(sender)[7]||uart(receiver)[7])&&waited<360000000){run(120000);waited+=120000;}
 assert.equal(uart(sender)[7]+uart(receiver)[7],0,'Original commands close both IR ports');
 run(60000000);await frame('received');report.transfer_wait_ticks=waited;linked=false;
 const original=await exportAplet(sender),received=await exportAplet(receiver);
 assert.deepEqual(received,original,'Recipient and source stock USB exports must match exactly');
 assert.equal(original.length,620);assert.equal(sha(original),'37e3f8c07e00debcb5fa86cdf350292fe0fef330ddf4a51a4f2169548e50e222');
 report.export_equal=true;tap(receiver,40);tap(receiver,41);run(24000000);
 assert.equal((await frame('received-expression'))[1],expression,'Recipient symbolic view must match sender');
 report.recipient_expression_equal=true;report.passed=true;
}catch(error){
 report.error=String(error.stack||error);process.exitCode=1;await frame('failure').catch(()=>{});console.error(report.error);
}
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
