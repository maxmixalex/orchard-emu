// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {LCDFrames} from '../web/lcd-frames.js';
import {displayFrame,frameRGBA} from '../web/capture.js';

// An independent synthetic scan source: software clears and rewrites its RAM
// while the same physical scan is in progress. The publication policy must
// not turn every status/input message into a new mid-scan display image.
const memory=new WebAssembly.Memory({initial:1,maximum:2});
let decodes=0,error=0,indicatorError=0;
const core={memory,peripheral_snapshot:()=>64,profile:(_model,field)=>field===2?4:2,
  frame_view(view){decodes++;return error;},frame_buffer:()=>512,
  annunciators:()=>indicatorError,annunciator_buffer:()=>600};
const registers=()=>new Uint32Array(memory.buffer,64,6);
const pixels=()=>new Uint8Array(memory.buffer,512,8);
const indicators=()=>new Uint8Array(memory.buffer,600,6);
const source=new LCDFrames();registers()[0]=1;
const imageA=[255,0,0,255,0,255,255,0],imageB=[0,255,255,0,255,0,0,255];
pixels().set(imageA);indicators()[1]=255;
const first=source.read(core,1,1,100);
assert.deepEqual([...first.pixels],imageA);assert.equal(first.frameTick,100);
pixels().fill(0);indicators().fill(0);
for(let tick=101;tick<110;tick++)assert.equal(source.read(core,1,1,tick),first);
pixels().set(imageB);
assert.equal(source.read(core,1,1,110),first);
assert.equal(decodes,1,'Neither partial rewrites nor high-frequency status requests resample the scan');
assert.deepEqual([...first.pixels],imageA);assert.equal(first.annunciators[1],255,'RAM writes cannot mutate a retained frame');
registers()[4]=1;
const second=source.read(core,1,1,111);
assert.deepEqual([...second.pixels],imageB);assert.equal(second.annunciators[1],0);
assert.equal(second.frameTick,111);assert.equal(second.frameSerial,1);
assert.notEqual(second.pixels.buffer,first.pixels.buffer);

// White is valid content. It must appear at the next scan, regardless of how
// long the preceding screen was visible or how much of it contained ink.
pixels().fill(0);registers()[4]=2;
const blank=source.read(core,1,1,112);assert.deepEqual([...blank.pixels],Array(8).fill(0));
pixels().set(imageA);registers()[4]=3;source.read(core,1,1,113);
registers()[0]=0;pixels().fill(0);
const off=source.read(core,1,1,114);assert.equal(off.lcdEnabled,false);assert.equal(off.frameSerial,3);
assert.deepEqual([...off.pixels],Array(8).fill(0),'Disabling the display does not wait for another scan');

// Paused/stopped/debug observation bypasses presentation caching. Error status
// stays present, while display/capture/recording have one explicit empty image.
registers()[0]=1;source.read(core,1,1,115);
error=12;indicatorError=12;
const failed=source.read(core,1,1,116,true);
assert.equal(failed.frameStatus,12);assert.equal(failed.annunciatorStatus,12);
assert.equal(failed.pixels,null);assert.equal(failed.annunciators,null);
const visible=displayFrame(failed);assert.equal(failed.frameStatus,12);
assert.deepEqual([...visible.pixels],Array(8).fill(0));assert.equal(visible.frameStatus,0);
assert.deepEqual([...frameRGBA(visible)],[194,208,202,255,194,208,202,255,194,208,202,255,194,208,202,255,
  194,208,202,255,194,208,202,255,194,208,202,255,194,208,202,255]);
assert.throws(()=>frameRGBA(failed),/No valid LCD frame/,'Raw export validation still distinguishes unsupported frames');
error=indicatorError=0;pixels().set(imageB);
assert.deepEqual([...source.read(core,1,1,117,true).pixels],imageB);
pixels().set(imageA);
assert.deepEqual([...source.read(core,1,0,118).pixels],imageA,'Changing inspection view invalidates the previous view');
pixels().set(imageB);
assert.deepEqual([...source.read(core,1,0,50).pixels],imageB,'A checkpoint rewind starts a fresh presentation epoch');
pixels().set(imageA);
assert.deepEqual([...source.read(core,2,0,51).pixels],imageA,'A model switch cannot retain another model\'s display');
source.reset();pixels().set(imageB);
assert.deepEqual([...source.read(core,2,0,51).pixels],imageB,'Reset/restore invalidates even an equal tick and scan serial');

// 64-bit frame serial carry and WASM memory growth must not leave a stale or
// detached register view. Previously retained images remain independently owned.
registers()[4]=0xffffffff;registers()[5]=7;source.read(core,2,0,52);
memory.grow(1);registers()[4]=0;registers()[5]=8;pixels().set(imageA);
const grown=source.read(core,2,0,53);assert.equal(grown.frameSerial,8*4294967296);
assert.deepEqual([...grown.pixels],imageA);assert.deepEqual([...second.pixels],imageB);
const raw={...core,peripheral_snapshot:undefined};
source.read(raw,2,0,54);pixels().set(imageB);
assert.deepEqual([...source.read(raw,2,0,55).pixels],imageB,'Cores without scan metadata remain readable');
console.log('LCD publication: one immutable image per scan; white/off/error, pause/debug, view/model/reset/rewind, serial carry and memory growth pass.');
