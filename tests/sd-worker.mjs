// SPDX-License-Identifier: MIT
// Production Worker handlers with the actual WASM media controller. A synthetic
// branch ROM only establishes a loaded machine; original-ROM acceptance is a
// separate workflow. No emulator pump runs between export and ejection.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createSDImage,readSDState,validateSDSize} from '../web/sd-card.js';
import {listSDDirectory,addSDFiles} from '../web/sd-filesystem.js';
import {MAX_STATE} from '../web/session.js';
import {Pacer} from '../web/pacing.js';
import {LCDFrames} from '../web/lcd-frames.js';
import {IrDAInput} from '../web/irda-input.js';
import {TapQueue} from '../web/hp48.js';

const {instance:{exports:core}}=await WebAssembly.instantiate(readFileSync('dist/orchard.wasm'),{});
assert.equal(core.create(5),0);
const rom=new Uint8Array(2*1024*1024);new DataView(rom.buffer).setUint32(0,0xeafffffe,true);
new Uint8Array(core.memory.buffer,core.rom_buffer(),rom.length).set(rom);assert.equal(core.load(rom.length),0);
const source=readFileSync('web/worker.js','utf8').replace(/^import .*;\n/gm,'').split('\ntry {\n  const response=await fetch')[0];
const output=[],scope={readSDState,validateSDSize,listSDDirectory,MAX_STATE,Pacer,LCDFrames,IrDAInput,TapQueue,
  TaskScheduler:class{schedule(){return 1;}cancel(){}},Uint8Array,Uint32Array,ArrayBuffer,
  performance:{now:()=>0},self:{},initialCore:core,
  postMessage:(data,transfer=[])=>output.push(structuredClone(data,{transfer}))};
const context=vm.createContext(scope);
vm.runInContext(source+"\ncore=initialCore;model=5;generation=1;loaded=true;audience='calculator';",context);
const send=(type,extra={})=>scope.self.onmessage({data:{generation:1,type,...extra}});
const image=addSDFiles(createSDImage(32*1024*1024),'/',[{name:'PAYLOAD',bytes:Uint8Array.of(0,255,42)}]);
send('sd-insert',{bytes:image,writeProtected:true,name:'directory.img'});
assert.equal(readSDState(core).present,true);assert.equal(readSDState(core).writeProtected,true);
const tickBefore=new Uint32Array(core.memory.buffer,core.snapshot(),33)[22];
send('sd-edit');
const edited=output.find(message=>message.type==='sd-edited');assert(edited);
assert.deepEqual(edited.bytes,image);assert.notEqual(edited.bytes.buffer,core.memory.buffer);
assert.equal(readSDState(core).present,false);
assert.equal(new Uint32Array(core.memory.buffer,core.snapshot(),33)[22],tickBefore);
assert.equal(output.at(-1).type,'snapshot');assert.equal(output.at(-1).sd.present,false);

const malformed=createSDImage();malformed[1024]=0;
send('sd-insert',{bytes:malformed,writeProtected:false,name:'damaged.img'});
const count=output.filter(message=>message.type==='sd-edited').length;
send('sd-edit');
assert.equal(output.at(-1).type,'sd-error');assert.equal(output.at(-1).code,'damaged');
assert.equal(readSDState(core).present,true);
assert.deepEqual(new Uint8Array(core.memory.buffer,core.sd_image_buffer(),malformed.length),malformed);
assert.equal(output.filter(message=>message.type==='sd-edited').length,count);
const beforeStale=output.length;send('sd-edit',{generation:0});assert.equal(output.length,beforeStale);
vm.runInContext('transfer={active:true};',context);send('sd-edit');
assert.equal(output.at(-1).type,'sd-error');assert.equal(readSDState(core).present,true);
vm.runInContext('transfer=null;hostBridge={active:true};',context);
const cardBefore=readSDState(core),hostStart=output.length;
for(const type of ['sd-insert','sd-export','sd-edit','sd-eject']){
  send(type,{bytes:image,writeProtected:false,name:'replacement.img'});
  assert.equal(output.at(-1).type,'sd-error');assert.equal(output.at(-1).code,'hostBridgeBusy');
  assert.deepEqual(readSDState(core),cardBefore);
  assert.deepEqual(new Uint8Array(core.memory.buffer,core.sd_image_buffer(),malformed.length),malformed);
}
assert.equal(output.length,hostStart+4);
vm.runInContext('hostBridge=null;',context);send('sd-eject');assert.equal(readSDState(core).present,false);
vm.runInContext('hostBridge={active:true};',context);
send('sd-insert',{bytes:image,writeProtected:false,name:'blocked.img'});
assert.equal(output.at(-1).code,'hostBridgeBusy');assert.equal(readSDState(core).present,false);
vm.runInContext('hostBridge=null;',context);
send('sd-edit');assert.equal(output.at(-1).type,'sd-error');
send('sd-insert',{bytes:image,writeProtected:false,name:'after-disconnect.img'});
assert.equal(readSDState(core).present,true);assert.equal(output.at(-1).type,'snapshot');
assert.deepEqual(new Uint8Array(core.memory.buffer,core.sd_image_buffer(),image.length),image);
console.log('SD Worker: actual WASM 32 MiB export/eject ownership, no intervening guest ticks, malformed-card retention, transfer/local-device exclusion, disconnect retry and stale-generation rejection pass.');
