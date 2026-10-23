// SPDX-License-Identifier: MIT
// Only the emulated LCD is captured. Never request a microphone or desktop stream.
import {frameRGBA,captureName,displayFrame} from './capture.js';
const FORMATS=['video/webm;codecs=vp8','video/webm','video/mp4'];
export function recordingFormat(Recorder=globalThis.MediaRecorder){
  return typeof Recorder?.isTypeSupported==='function'?FORMATS.find(type=>Recorder.isTypeSupported(type)):undefined;
}
export function recordingName(model,type,now=new Date()){
  return captureName(model,now).replace(/\.png$/,type.startsWith('video/mp4')?'.mp4':'.webm');
}
export class LCDRecorder {
  constructor(frame,{scale=4,fps=30,background=[194,208,202],maxBytes=64*1024*1024,onProgress=()=>{}}={}){
    if(![1,4].includes(scale)||!Number.isInteger(fps)||fps<1||fps>60||!Number.isSafeInteger(maxBytes)||maxBytes<1024)throw Error('Invalid recording settings');
    const type=recordingFormat();if(!type)throw Error('LCD recording is not supported by this browser');
    frame=displayFrame(frame);this.width=frame.width;this.height=frame.height;
    this.background=background;this.frame=frame;this.last=null;this.chunks=[];this.bytes=0;this.reason='stop';this.settled=false;this.stopping=false;
    const rgba=frameRGBA(frame,background);
    this.native=document.createElement('canvas');this.native.width=this.width;this.native.height=this.height;
    this.canvas=document.createElement('canvas');this.canvas.width=this.width*scale;this.canvas.height=this.height*scale;
    this.context=this.native.getContext('2d',{alpha:false});this.output=this.canvas.getContext('2d',{alpha:false});
    if(!this.context||!this.output||typeof this.canvas.captureStream!=='function')throw Error('LCD recording is not supported by this browser');
    this.output.imageSmoothingEnabled=false;this.context.putImageData(new ImageData(rgba,this.width,this.height),0,0);
    this.output.drawImage(this.native,0,0,this.canvas.width,this.canvas.height);
    this.finished=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
    // Consumer attaches immediately; this also handles a synchronous encoder failure.
    this.finished.catch(()=>{});
    try{
      this.stream=this.canvas.captureStream(fps);
      this.recorder=new MediaRecorder(this.stream,{mimeType:type,videoBitsPerSecond:1500000});
      this.type=this.recorder.mimeType||type;
      this.recorder.addEventListener('dataavailable',({data})=>{
        if(this.settled||!data?.size)return;
        this.chunks.push(data);this.bytes+=data.size;
        if(this.bytes>=maxBytes)this.stop('limit');
      });
      this.recorder.addEventListener('error',event=>{this.failure=event.error||Error('Video encoding failed');this.stop('error');});
      this.recorder.addEventListener('stop',()=>this.finish());
      this.started=performance.now();this.recorder.start(1000);
      this.timer=setInterval(()=>{
        try{this.paint();onProgress(this.elapsed,this.bytes);}catch(error){this.failure=error;this.stop('error');}
      },1000/fps);
    }catch(error){this.cleanup();this.settled=true;this.reject(error);throw error;}
  }
  get elapsed(){return Math.max(0,(performance.now()-this.started)/1000);}
  update(frame,background=this.background){
    if(this.stopping||this.settled)return;
    if(frame?.width!==this.width||frame?.height!==this.height){this.stop('model');return;}
    this.frame=displayFrame(frame);this.background=background;
  }
  paint(){
    const signature=this.background.join(',');
    if(this.last!==this.frame||this.ink!==signature){
      this.context.putImageData(new ImageData(frameRGBA(this.frame,this.background),this.width,this.height),0,0);
      this.last=this.frame;this.ink=signature;
    }
    // Repaint even while the calculator is paused so the video preserves wall time.
    this.output.drawImage(this.native,0,0,this.canvas.width,this.canvas.height);
    this.stream.getVideoTracks()[0]?.requestFrame?.();
  }
  stop(reason='stop'){
    if(this.stopping||this.settled)return this.finished;
    this.stopping=true;this.reason=reason;clearInterval(this.timer);this.duration=this.elapsed;
    try{this.paint();if(this.recorder.state!=='inactive')this.recorder.stop();else this.finish();}
    catch(error){this.failure=error;this.finish();}
    return this.finished;
  }
  cleanup(){clearInterval(this.timer);for(const track of this.stream?.getTracks()||[])track.stop();}
  finish(){
    if(this.settled)return;
    this.settled=true;this.cleanup();
    const blob=new Blob(this.chunks,{type:this.type});this.chunks=[];
    if(this.failure)this.reject(this.failure);
    else if(!blob.size)this.reject(Error('The recording contains no video data'));
    else this.resolve({blob,type:this.type,reason:this.reason,duration:this.duration??this.elapsed,width:this.canvas.width,height:this.canvas.height});
  }
}
