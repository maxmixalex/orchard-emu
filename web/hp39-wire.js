// SPDX-License-Identifier: MIT
// HP39/40 direct Wire sender. Guest USB/UART carries every byte; this module
// owns no clock, file access or calculator memory. See hp39-files.md for the
// original-ROM witness and the distinction from Disk drive's Kermit server.
import {inspectHp39File,validateHp39Filename} from './hp39-files.js';

export function validateHp39WireFile(name,bytes){
  validateHp39Filename(name);
  const info=inspectHp39File(bytes);
  if(info.encoding!=='binary'||!['B','C','D','H'].includes(info.kind))
    throw Error('Wire upload accepts binary HP39 aplets, libraries, notes and programs. Use Disk drive for this file.');
  return info;
}
export function hp39WireCrc(bytes,hp=true){
  let value=0;
  for(const byte of bytes){
    if(hp){value^=byte;for(let bit=0;bit<8;bit++)value=value&1?(value>>>1)^0x8408:value>>>1;}
    else{value^=byte<<8;for(let bit=0;bit<8;bit++)value=value&0x8000?(value<<1)^0x1021:value<<1;value&=65535;}
  }
  return value;
}
export function hp39WireBlock(sequence,bytes,check=68){
  if(!Number.isInteger(sequence)||sequence<0||sequence>255||!(bytes instanceof Uint8Array)||
      ![128,1024].includes(bytes.length)||![21,67,68].includes(check)||check===21&&bytes.length!==128)
    throw Error('Invalid HP39 Wire block.');
  const out=new Uint8Array(bytes.length+(check===21?4:5));
  out.set([bytes.length===128?1:2,sequence,255-sequence]);out.set(bytes,3);
  if(check===21)out[out.length-1]=bytes.reduce((a,b)=>(a+b)&255,0);
  else{const crc=hp39WireCrc(bytes,check===68);out[out.length-2]=crc>>>8;out[out.length-1]=crc&255;}
  return out;
}

export class Hp39WireSender {
  constructor({write,notify=()=>{},hz=12000000}={}){
    if(typeof write!=='function'||!Number.isFinite(hz)||hz<=0)throw Error('Invalid HP39 Wire transport.');
    this.write=write;this.notify=notify;this.hz=hz;this.active=false;this.queue=[];
  }
  get pending(){return this.active||this.queue.length>0;}
  status(phase,error){this.phase=phase;this.notify({active:this.active,phase,protocol:'hp39-wire',direction:'send',
    name:this.name,transferred:this.transferred,total:this.total,...(error?{error}:{})});}
  start({name,bytes},now){
    if(this.active)throw Error('An HP39 Wire upload is already running.');
    validateHp39WireFile(name,bytes);
    this.name=name;this.bytes=bytes;this.total=bytes.length;this.transferred=0;this.sequence=1;
    this.now=now;this.end=now+300*this.hz;this.deadline=now+120*this.hz;
    this.active=true;this.stage='handshake';this.queue=[];this.retries=0;this.cancelled=false;this.status('negotiating');
  }
  enqueue(bytes){this.queue=[{bytes,offset:0}];this.deadline=Infinity;}
  next(){
    this.retries=0;
    if(this.transferred===this.total){this.stage='eot';this.last=Uint8Array.of(4);}
    else{
      this.stage='data';
      const left=this.total-this.transferred,size=this.check!==21&&left>=1024?1024:128;
      const data=new Uint8Array(size);data.set(this.bytes.subarray(this.transferred,this.transferred+size));
      this.nextOffset=Math.min(this.total,this.transferred+size);this.last=hp39WireBlock(this.sequence,data,this.check);
    }
    this.enqueue(this.last);
  }
  retry(){
    if(++this.retries>8)throw Error('Wire upload timed out. Reopen the calculator’s matching wired RECV mode and try again.');
    this.enqueue(this.last);
  }
  receive(bytes,now){
    this.now=now;if(!this.active)return;
    try{
      if(!(bytes instanceof Uint8Array)||bytes.length>65536)throw Error('Invalid HP39 Wire input.');
      for(const byte of bytes){
        if(!this.active)break;
        if(this.stage==='handshake'){
          // A cancelled receiver may leave several CAN bytes in USB/UART.
          // They belong to the preceding attempt until this receiver starts a
          // new D/C/NAK handshake. Do not flush the transport: a fresh handshake
          // may share the same packet with that old tail. The initial deadline
          // remains fixed even if the peer keeps sending stale control bytes.
          if([21,67,68].includes(byte)){this.check=byte;this.next();this.status('sending');}
          continue;
        }
        if(byte===24){this.cancelled=true;throw Error('The calculator cancelled the Wire upload.');}
        // An ACK for a partially written block cannot acknowledge that block.
        if(this.queue.length)continue;
        if(byte===21)this.retry();
        else if(byte===6){
          if(this.stage==='eot'){this.active=false;this.status('complete');}
          else{this.transferred=this.nextOffset;this.sequence=(this.sequence+1)&255;this.status('sending');this.next();}
        }
      }
    }catch(error){this.fail(error.message);}
  }
  poll(now){
    this.now=now;
    try{
      if(this.active){
        if(now>=this.end)throw Error('Wire upload reached its five-minute virtual-time limit.');
        if(now>=this.deadline){
          if(this.stage==='handshake')throw Error('Choose the calculator’s matching wired RECV mode for this file.');
          this.retry();
        }
      }
      const item=this.queue[0];if(!item)return;
      const left=item.bytes.subarray(item.offset),accepted=this.write(left);
      if(!Number.isInteger(accepted)||accepted<0||accepted>left.length)throw Error('Invalid HP39 Wire transport acceptance.');
      item.offset+=accepted;
      if(item.offset===item.bytes.length){this.queue.shift();this.deadline=now+10*this.hz;}
    }catch(error){this.fail(error.message);}
  }
  cancel(message='Wire upload cancelled.'){
    this.queue=[];this.active=false;this.cancelled=true;this.status('cancelled',message);
  }
  fail(message){this.queue=[];this.active=false;this.status('error',message);}
}
