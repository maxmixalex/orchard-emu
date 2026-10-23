// SPDX-License-Identifier: MIT
// HP39/40 direct Wire sender. Guest USB/UART carries every byte; this module
// owns no clock, file access or calculator memory. See hp39-files.md for the
// original-ROM witness and the distinction from Disk drive's Kermit server.
import {inspectHp39File,validateHp39Filename} from './hp39-files.js';
import {transferError,transferErrorDetails} from './transfer-errors.js';

// HP character translation codes, documented by HP (AUR appendix J) and
// emitted by stock HP39 Note SEND. Values are character bytes, not Unicode.
const noteEscapes=new Map([
  ...['<)','x-','.V','v/','.S','GS','|>','pi','.d','<=','>=','=/','Ga','->','<-','|v',
    '|^','Gg','Gd','Ge','Gn','Gh','Gl','Gr','Gs','Gt','Gw','GD','PI','GW','[]','oo'].map((key,i)=>[key,128+i]),
  ['<<',171],['^o',176],['Gm',181],['>>',187],['.x',215],['O/',216],['Gb',223],[':-',247]
]);
function noteText(input,start){
  // The stock ASCII Note reader skips the whitespace after the counted name.
  // An intentional leading blank/newline can be represented by \032 / \010.
  while([32,9,13,10].includes(input[start]))start++;
  const output=new Uint8Array(input.length-start);let count=0;
  for(let i=start;i<input.length;i++){
    let byte=input[i];
    if(byte===13&&input[i+1]===10){byte=10;i++;}
    else if(byte===92){
      if(input[i+1]===92)i++;
      else{
        const token=String.fromCharCode(input[i+1]??0,input[i+2]??0),translated=noteEscapes.get(token);
        if(translated!==undefined){byte=translated;i+=2;}
        else if(input[i+1]>=48&&input[i+1]<=57&&input[i+2]>=48&&input[i+2]<=57&&input[i+3]>=48&&input[i+3]<=57){
          const value=(input[i+1]-48)*100+(input[i+2]-48)*10+input[i+3]-48;
          if(value<=255){byte=value;i+=3;}
        }
      }
    }
    output[count++]=byte;
  }
  return output.subarray(0,count);
}

export function validateHp39WireFile(name,bytes){
  validateHp39Filename(name);
  const info=inspectHp39File(bytes);
  if(!(info.kind==='C'||info.encoding==='binary'&&['B','D','H'].includes(info.kind)))
    throw transferError('hp39WireType','Wire upload accepts HP39 notes and binary aplets, libraries and programs. Use Disk drive for this file.');
  return info;
}
/** Wire carries binary objects even when Disk drive accepts an ASCII Note.
 * C is a Saturn character string (prolog 02A2C); its five-nibble size includes
 * the size field itself. This is deliberately not an ASCII program compiler.
 * Keep calculator-charset bytes intact: a UTF-8 roundtrip corrupts legacy notes.
 */
export function prepareHp39WireFile(name,input){
  const info=validateHp39WireFile(name,input);
  if(info.encoding==='binary')return {bytes:input,info,noteConverted:false,sourceBytes:input.length};
  const body=noteText(input,info.payloadOffset),nibbles=5+2*body.length;
  if(nibbles>0xfffff)throw transferError('hp39NoteSize','This note exceeds the 524285-byte Saturn string limit.');
  const bytes=new Uint8Array(14+info.titleBytes+body.length);
  bytes.set([72,80,51,57,66,105,110,67,info.titleBytes]);
  bytes.set(input.subarray(info.payloadOffset-info.titleBytes,info.payloadOffset),9);
  const offset=9+info.titleBytes;
  bytes.set([0x2c,0x2a,(nibbles&15)<<4,(nibbles>>>4)&255,nibbles>>>12],offset);
  bytes.set(body,offset+5);
  return {bytes,info:inspectHp39File(bytes),noteConverted:true,sourceBytes:input.length};
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
    name:this.name,objectKind:this.objectKind,...(this.noteConverted?{noteConverted:true,sourceBytes:this.sourceBytes}:{}),
    transferred:this.transferred,total:this.total,...(error?transferErrorDetails(error):{})});}
  start({name,bytes},now){
    if(this.active)throw transferError('wireRunning','An HP39 Wire upload is already running.');
    const prepared=prepareHp39WireFile(name,bytes);
    this.objectKind=prepared.info.kind;this.noteConverted=prepared.noteConverted;this.sourceBytes=prepared.sourceBytes;
    this.name=name;this.bytes=prepared.bytes;this.total=this.bytes.length;this.transferred=0;this.sequence=1;
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
    if(++this.retries>8)throw transferError('wireRetryTimeout','Wire upload timed out. Reopen the calculator’s matching wired RECV mode and try again.');
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
        if(byte===24){this.cancelled=true;throw transferError('wireCancelledByCalculator','The calculator cancelled the Wire upload.');}
        // An ACK for a partially written block cannot acknowledge that block.
        if(this.queue.length)continue;
        if(byte===21)this.retry();
        else if(byte===6){
          if(this.stage==='eot'){this.active=false;this.status('complete');}
          else{this.transferred=this.nextOffset;this.sequence=(this.sequence+1)&255;this.status('sending');this.next();}
        }
      }
    }catch(error){this.fail(error);}
  }
  poll(now){
    this.now=now;
    try{
      if(this.active){
        if(now>=this.end)throw transferError('wireDuration','Wire upload reached its five-minute virtual-time limit.');
        if(now>=this.deadline){
          if(this.stage==='handshake')throw transferError('wireChooseReceiver','Choose the calculator’s matching wired RECV mode for this file.');
          this.retry();
        }
      }
      const item=this.queue[0];if(!item)return;
      const left=item.bytes.subarray(item.offset),accepted=this.write(left);
      if(!Number.isInteger(accepted)||accepted<0||accepted>left.length)throw Error('Invalid HP39 Wire transport acceptance.');
      item.offset+=accepted;
      if(item.offset===item.bytes.length){this.queue.shift();this.deadline=now+10*this.hz;}
    }catch(error){this.fail(error);}
  }
  cancel(message=transferError('wireCancelled','Wire upload cancelled.')){
    this.queue=[];this.active=false;this.cancelled=true;this.status('cancelled',message);
  }
  fail(message){this.queue=[];this.active=false;this.status('error',message);}
}
