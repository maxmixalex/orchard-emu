// SPDX-License-Identifier: MIT
// Private unchanged-ROM Wire continuation + stock SEND round-trip witness.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {HP39_ROM,HP39GS_ROM,applySetup} from '../web/hp48.js';
import {resolve,basename} from 'node:path';
import {VirtualUSB} from '../web/virtual-usb.js';
import {Hp39WireAutoReceive} from '../web/hp39-wire-auto.js';
import {inspectHp39File} from '../web/hp39-files.js';
import {TapQueue} from '../web/hp48.js';
import {FileTransfer} from '../web/file-transfer.js';
const usage='Usage: node tools/verify-hp39-wire-batch.mjs FULL-NOR.bin LIBRARY APLET NEW-PRIVATE-OUTPUT [--wasm PATH] [--observe-idle]';
if(process.argv.length===3&&process.argv[2]==='--help'){console.log(usage+'\nUses original ROM menus, the production Wire sender, physical TapQueue and screen-gated continuation. Exports the installed aplet/library through stock SEND and compares bytes. Outputs private LCDs/checkpoint; do not publish them.');process.exit(0);}
const args=process.argv.slice(2);if(args.length<4)throw Error(usage);
const [romPath,libraryPath,apletPath,out]=args.splice(0,4).map(path=>resolve(path));let wasmPath=resolve('dist/orchard.wasm'),observeIdle=false;
while(args.length){const option=args.shift();if(option==='--wasm'&&args.length)wasmPath=resolve(args.shift());else if(option==='--observe-idle')observeIdle=true;else throw Error(usage);}
const sha=value=>createHash('sha256').update(value).digest('hex'),rom=await readFile(romPath),wasm=await readFile(wasmPath);
const model=sha(rom)===HP39_ROM?1:sha(rom)===HP39GS_ROM?2:0;if(!model)throw Error('Use the admitted complete unchanged HP39g+ or HP39gs NOR.');
const library=new Uint8Array(await readFile(libraryPath)),aplet=new Uint8Array(await readFile(apletPath));
assert.equal(inspectHp39File(library).kind,'H');assert.equal(inspectHp39File(aplet).kind,'B');await mkdir(out);
const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});assert.equal(c.create(model),0);
new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);applySetup(c,model,model===2?'hp39gs-home':'hp39-home');
const hz=c.timebase_hz(),state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));let tick=0,error='',request=0;
const report={schema:'orchard-hp39-wire-batch-stock-v1',model,wasm:sha(wasm),rom:sha(rom),coldBoot:true,guestMemoryPatched:false,hardwareValidated:false,browserEndToEnd:false,inputs:[{name:basename(libraryPath),bytes:library.length,sha:sha(library)},{name:basename(apletPath),bytes:aplet.length,sha:sha(aplet)}],frames:[],keys:[],events:[]};
const usb=new VirtualUSB(c,hz,event=>{if(event.error)error=event.error;});
const returned=[];
const ft=new FileTransfer({core:c,usb,model,now:()=>tick/hz*1000,notify:event=>{if(event.type==='file-transfer-received'){returned.push(event);report.events.push({tick,type:event.type,name:event.name,length:event.bytes.length,sha:sha(event.bytes)});}else report.events.push({tick,...event});if(event.phase==='error')error=event.error;}});
let auto=null,observeAt=0;const taps=new TapQueue((scan,down)=>key(scan,down),model===1?1500000:600000,model===1?600000:360000);
function run(n){while(n){taps.update(tick);const q=Math.min(8192,n,taps.boundary(tick)-tick),s=c.run(q);if(s)throw Error(JSON.stringify(state()));tick+=q;n-=q;if(usb.connected)usb.poll(tick);ft.poll(tick);if(error)throw Error(error);if(auto&&tick>=observeAt){observeAt=tick+hz/30;c.frame_view(1);const pixels=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();const scans=auto.observe({width:131,height:64,pixels,running:true,tick,pending:taps.pending,active:taps.active});if(scans){report.automaticKeys??=[];report.automaticKeys.push({tick,scans});taps.pushMany(scans);}}}}
function key(scan,on){report.keys.push({tick,scan,on});assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+on):c.keyboard_dedicated(scan===56?0:scan===58?5:6,+on),0);}
function tap(scan){key(scan,true);run(2000000);key(scan,false);run(2000000);}
function until(test,budget){let end=tick+budget;while(!test()&&tick<end)run(Math.min(8192,end-tick));assert(test());}
async function frame(name){assert.equal(c.frame_view(1),0);let bytes=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();
await writeFile(`${out}/${name}.pgm`,Buffer.concat([Buffer.from('P5\n131 64\n255\n'),Buffer.from(bytes.map(x=>255-x))]));report.frames.push({name,tick,sha:sha(bytes)});console.log(model,name,tick);}
try{
run(60000000);tap(40);run(70000000);tap(49);run(20000000);await frame('catalog-before');
tap(39);run(3000000);await frame('receive-default');tap(44);await frame('receive-menu');
assert.equal(c.gpio_inputs(5,0x8e,2),0);usb.start(tick);until(()=>usb.phase==='ready',10*hz);
ft.start({request:++request,mode:'send',protocol:'hp39-wire',transport:'usb',name:basename(libraryPath),bytes:library},tick);tap(6);until(()=>!ft.active,300*hz);assert.equal(ft.session.phase,'complete');
await frame('library-ack');await frame('library-catalog');
ft.start({request:++request,mode:'send',protocol:'hp39-wire',transport:'usb',name:basename(apletPath),bytes:aplet},tick);
if(observeIdle){run(36*hz);report.secondWithoutRecv={stage:ft.session.stage,phase:ft.session.phase,bytes:ft.session.transferred};assert.equal(ft.session.transferred,0);await frame('without-second-recv');}
auto=new Hp39WireAutoReceive({model,previousKind:'H',kind:'B'});
until(()=>!ft.active,300*hz);assert.equal(ft.session.phase,'complete');run(120000000);await frame('aplet-catalog');
assert.equal(c.checkpoint_save(),0);await writeFile(`${out}/installed.checkpoint`,new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice());
auto=null;tap(38);run(3000000);for(let index=0;index<(model===1?2:3);index++)tap(44);await frame('send-disk-menu');tap(6);run(3000000);await frame('send-name');
ft.start({request:++request,mode:'receive',transport:'usb'},tick);tap(6);until(()=>returned.length===3,300*hz);run(12000000);
const receivedAplet=returned.find(f=>inspectHp39File(f.bytes).kind==='B'),receivedLibrary=returned.find(f=>inspectHp39File(f.bytes).kind==='H');
assert(receivedAplet&&receivedLibrary);assert.deepEqual(receivedAplet.bytes,aplet);const got=inspectHp39File(receivedLibrary.bytes),original=inspectHp39File(library);assert.deepEqual(receivedLibrary.bytes.subarray(got.payloadOffset),library.subarray(original.payloadOffset));
report.apletRoundTripEqual=true;report.libraryBodyEqual=true;report.passed=true;
}catch(e){report.error=String(e.stack||e);report.state=state();process.exitCode=1;await frame('failure').catch(()=>{});}
report.tool=sha(await readFile(new URL(import.meta.url)));report.sources={};for(const name of ['hp39-wire-auto.js','file-transfer.js','hp39-wire.js','hp39-transfer.js','hp48.js'])report.sources[name]=sha(await readFile(new URL('../web/'+name,import.meta.url)));
assert.equal(sha(await readFile(romPath)),sha(rom));assert.equal(sha(await readFile(libraryPath)),sha(library));assert.equal(sha(await readFile(apletPath)),sha(aplet));assert.equal(sha(await readFile(wasmPath)),sha(wasm));
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({model,passed:report.passed,error:report.error,automaticKeys:report.automaticKeys}));
