// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {LCDRecorder,recordingFormat,recordingName} from '../web/recording.js';
const saved=Object.fromEntries(['MediaRecorder','document','ImageData','setInterval','clearInterval'].map(k=>[k,globalThis[k]]));
let live=0,timers=0,failStart=false,codec='video/webm;codecs=vp8';
class Recorder extends EventTarget {
 static isTypeSupported(type){return type===codec;}
 constructor(_stream,options){super();this.mimeType=options.mimeType;this.state='inactive';}
 start(){if(failStart)throw Error('start failed');this.state='recording';}
 emit(size){const e=new Event('dataavailable');e.data=new Blob([new Uint8Array(size)]);this.dispatchEvent(e);}
 stop(){this.state='inactive';queueMicrotask(()=>{this.emit(10);this.dispatchEvent(new Event('stop'));});}
}
try{
 globalThis.MediaRecorder=Recorder;
 globalThis.ImageData=class {constructor(data,width,height){Object.assign(this,{data,width,height});}};
 globalThis.setInterval=()=>++timers;globalThis.clearInterval=id=>{if(id)timers--;};
 globalThis.document={createElement:()=>({getContext:()=>({putImageData(){},drawImage(){}}),captureStream(){live++;let active=true;const track={stop(){if(active){live--;active=false;}},requestFrame(){}};return{getTracks:()=>[track],getVideoTracks:()=>[track]};}})};
 const frame={width:2,height:1,frameStatus:0,pixels:new Uint8Array([0,255])};
 assert(recordingFormat());assert(recordingName(1,codec).endsWith('.webm'));
 const recording=new LCDRecorder(frame);assert.equal(live,1);
 recording.update({...frame,frameStatus:1,pixels:null});
 assert.deepEqual([...recording.frame.pixels],[0,0],'Unavailable frames must match the live empty screen, not retain old ink');
 recording.update(frame);assert.equal(recording.frame,frame,'A recovered valid frame is recorded immediately');
 const p=recording.stop();assert.equal(recording.stop(),p);const r=await p;assert.equal(r.width,8);assert.equal(r.height,4);assert.equal(r.blob.size,10);assert.equal(live,0);
 codec='video/mp4';assert.equal(recordingFormat(),'video/mp4');assert(recordingName(4,codec).endsWith('.mp4'));
 const limited=new LCDRecorder(frame,{maxBytes:1024});limited.recorder.emit(1024);assert.equal((await limited.finished).reason,'limit');assert.equal(live,0);
 const resized=new LCDRecorder(frame);resized.update({...frame,width:3});assert.equal((await resized.finished).reason,'model');assert.equal(live,0);
 failStart=true;assert.throws(()=>new LCDRecorder(frame),/start failed/);assert.equal(live,0);failStart=false;
 codec='unsupported';assert.equal(recordingFormat(),undefined);assert.throws(()=>new LCDRecorder(frame),/not supported/);assert.equal(live,0);
 console.log('Recording: codec/name fallback, invalid frames, idempotent stop, size limit, model switch and failed-start track cleanup passed');
}finally{for(const [name,value] of Object.entries(saved)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}}
