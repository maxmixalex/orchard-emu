// SPDX-License-Identifier: MIT
// ROM-free WASM/media and browser envelope boundaries. Stock firmware FILES
// read/write acceptance is recorded separately by verify-sd-workflows.mjs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSDImage,validateSDSize,sdImageName,readSDState} from '../web/sd-card.js';
import {encodeSession,decodeSession,MAX_STATE} from '../web/session.js';
const image=createSDImage(),v=new DataView(image.buffer);
const start=v.getUint32(454,true),sectors=v.getUint32(458,true),b=start*512;
assert.equal(image.length,16*1024*1024);assert.equal(v.getUint16(510,true),0xaa55);
assert.equal(image[450],6);assert.equal(v.getUint16(b+510,true),0xaa55);
const size=v.getUint16(b+11,true),cluster=image[b+13],reserved=v.getUint16(b+14,true),
  fats=image[b+16],rootEntries=v.getUint16(b+17,true),fatSize=v.getUint16(b+22,true);
assert.equal((start+sectors)*size,image.length);assert.equal(v.getUint16(b+19,true),sectors);
const clusters=Math.floor((sectors-reserved-fats*fatSize-Math.ceil(rootEntries*32/size))/cluster);
assert(clusters>=4085&&clusters<65525,'Geometry must be FAT16 by cluster count');
assert(fatSize*size>=(clusters+2)*2);
assert.deepEqual(image.subarray((start+reserved)*size,(start+reserved+fatSize)*size),
  image.subarray((start+reserved+fatSize)*size,(start+reserved+2*fatSize)*size));
assert.equal(v.getUint16((start+reserved)*size,true),0xfff8);
assert(image.subarray((start+reserved+2*fatSize)*size,(start+reserved+2*fatSize)*size+rootEntries*32).every(x=>x===0),'A new card has an empty root directory');
for(const n of [0,512,1048575,1048577,3*1048576,64*1048576,NaN])assert.throws(()=>validateSDSize(n));
assert.equal(sdImageName('../test.img'),'test.img');assert.equal(sdImageName('test'),'test.img');

const {instance:{exports:c}}=await WebAssembly.instantiate(await readFile('dist/orchard.wasm'),{});
assert.equal(c.memory.buffer.byteLength,16*1024*1024,'No-card startup keeps its original memory budget');
assert.equal(c.create(4),0);assert.equal(c.sd_buffer(image.length),0,'48gII has no SD slot');
assert.notEqual(c.sd_insert(image.length,0),0);
assert.equal(c.create(5),0);
const rom=new Uint8Array(2*1024*1024);new DataView(rom.buffer).setUint32(0,0xeafffffe,true);
new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);
const input=c.sd_buffer(image.length);assert(input);assert(c.memory.buffer.byteLength>16*1024*1024);
image[70000]=0x5a;new Uint8Array(c.memory.buffer,input,image.length).set(image);
assert.equal(c.sd_insert(image.length,1),0);assert.equal(c.sd_buffer(image.length),0,'Never overwrite an inserted card through the import buffer');
assert.equal(readSDState(c).writeProtected,true);assert.equal(readSDState(c).bytes,image.length);
assert.notEqual(c.create(99),0,'An invalid model must not replace the current machine');
assert.equal(c.sd_image_buffer(),input,'Rejected creation preserves the mounted storage binding');
assert.equal(readSDState(c).present,true);
assert.equal(c.checkpoint_save(),0);const length=c.checkpoint_size();assert(length>image.length&&length<=MAX_STATE);
const saved=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),length).slice();
new Uint8Array(c.memory.buffer,c.sd_image_buffer(),image.length)[70000]=0xa5;
const bad=saved.slice();bad[bad.length-1]^=1;
let checkpoint=c.checkpoint_buffer(bad.length);new Uint8Array(c.memory.buffer,checkpoint,bad.length).set(bad);
assert.notEqual(c.checkpoint_load(bad.length),0);assert.equal(new Uint8Array(c.memory.buffer,c.sd_image_buffer(),image.length)[70000],0xa5,'Bad CRC must leave current media unchanged');
assert.equal(c.sd_eject(),0);assert.equal(readSDState(c).present,false);
checkpoint=c.checkpoint_buffer(saved.length);new Uint8Array(c.memory.buffer,checkpoint,saved.length).set(saved);
assert.equal(c.checkpoint_load(saved.length),0);assert.equal(readSDState(c).present,true);assert.equal(readSDState(c).writeProtected,true);
assert.deepEqual(new Uint8Array(c.memory.buffer,c.sd_image_buffer(),image.length),image);
c.reset();assert.equal(c.sd_reconnect(),0);assert.equal(readSDState(c).present,true,'Reset keeps inserted media');
assert.equal(new Uint8Array(c.memory.buffer,c.sd_image_buffer(),image.length)[70000],0x5a);
const envelope=await encodeSession({model:5,romHash:'a'.repeat(64),preset:'hp49-home',frameView:1,state:saved});
assert.deepEqual((await decodeSession(envelope.buffer)).state,saved);
await assert.rejects(encodeSession({model:4,romHash:'a'.repeat(64),preset:'hp48-home',frameView:1,state:saved}));
assert.equal(c.memory.buffer.byteLength<=96*1024*1024,true);
console.log('SD media: FAT16 geometry, no-slot rejection, lazy memory growth, mounted-image protection, full-card session/CRC atomicity, write-protect and reset retention pass.');
