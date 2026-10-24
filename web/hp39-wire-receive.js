// SPDX-License-Identifier: MIT
// HP39 binary objects are nibble-delimited; XMODEM padding is not necessarily
// zero. Determine the complete object boundary before making a host file.
// This parser validates framing/lengths, never executes the stored object.
import {inspectHp39File} from './hp39-files.js';
import {MAX_FILE_BYTES,validateReceiveBudget} from './kermit.js';
import {transferError,transferErrorDetails} from './transfer-errors.js';
import {hp39WireCrc,hp39WireBlock} from './hp39-wire.js';

const malformed=message=>transferError('wireReceiveObject',message);
const sized=new Set([0x029e8,0x02a0a,0x02a2c,0x02a4e,0x02b1e,0x02b40,0x02b62,0x02dcc]);
const fixed=new Map([[0x02911,5],[0x02933,16],[0x02955,21],[0x02977,32],[0x0299d,42],[0x029bf,2],[0x02e92,6],[0x02eb1,6]]);
const composite=new Set([0x02a74,0x02ab8,0x02d9d]);

/** Return one exact typed binary object, excluding the final XMODEM padding.
 * The final unused high nibble is canonical file padding, not object data.
 * Known container types and directory back-links are checked within bounds;
 * an unrecognized top-level object is never guessed from trailing zeroes.
 */
export function inspectHp39WireObject(input,{paddingLimit=1023}={}){
  if(!(input instanceof Uint8Array)||input.length<9||input.length>MAX_FILE_BYTES+1024||
      !Number.isInteger(paddingLimit)||paddingLimit<0||paddingLimit>1023)throw malformed('Invalid Wire object size.');
  const magic=String.fromCharCode(...input.subarray(0,8));
  if(!/^HP39Bin[BCDHI]$/.test(magic))throw malformed('Wire receive supports binary aplets, notes, programs, libraries and transfer indexes.');
  const at=(9+input[8])*2,limit=input.length*2;
  if(at+5>limit)throw malformed('Truncated Wire object name or prolog.');
  let nodes=0;
  function number(offset,count){
    if(!Number.isInteger(offset)||offset<0||offset+count>limit)throw malformed('Truncated Wire object field.');
    let value=0;for(let n=count-1;n>=0;n--)value=value*16+((input[(offset+n)>>1]>>>(((offset+n)&1)*4))&15);
    return value;
  }
  function end(start,bound,depth=0,word=false){
    if(++nodes>100000||depth>32||start+5>bound)throw malformed('Wire object nesting or field limit exceeded.');
    const tag=number(start,5),cursor=start+5;
    let finish;
    if(fixed.has(tag))finish=cursor+fixed.get(tag);
    else if(sized.has(tag)){
      const size=number(cursor,5);if(size<5)throw malformed('Invalid Wire object length.');
      if(tag===0x02a2c&&(size-5)%2)throw malformed('Wire character string has an odd byte length.');
      finish=cursor+size;
    }else if(tag===0x02e48||tag===0x02e6d)finish=cursor+2+2*number(cursor,2);
    else if(tag===0x02afc){finish=end(cursor+2+2*number(cursor,2),bound,depth+1);}
    else if(composite.has(tag)){
      finish=cursor;
      for(;;){
        if(finish+5>bound)throw malformed('Unterminated Wire list or program.');
        if(number(finish,5)===0x0312b){finish+=5;break;}
        finish=end(finish,bound,depth+1,true);
      }
    }else if(tag===0x02a96){
      // RRP: library id, last-entry offset, zero header, then entries linked
      // backwards. The last object's own structure supplies the directory end.
      if(start+18>bound||number(start+13,5)!==0)throw malformed('Unsupported Wire directory header.');
      const offset=number(start+8,5);
      if(offset===0)return start+18;
      let entry=start+8+offset,fieldEnd=bound,result=null;
      if(entry<start+18||entry+2>bound)throw malformed('Invalid Wire directory entry.');
      for(;;){
        const body=entry+2+2*number(entry,2),next=end(body,fieldEnd,depth+1);
        if(result===null)result=next;
        else if(next!==fieldEnd)throw malformed('Wire directory entry does not fit its back-link.');
        if(entry===start+18)break;
        if(entry<start+23)throw malformed('Truncated Wire directory back-link.');
        const previous=entry-5-number(entry-5,5);
        if(previous<start+18||previous>=entry-5)throw malformed('Invalid Wire directory back-link.');
        fieldEnd=entry-5;entry=previous;
      }
      finish=result;
    }else if(word)finish=cursor; // An embedded SysRPL primitive is one word.
    else throw malformed('Unsupported Wire object prolog.');
    if(finish>bound||finish<=start)throw malformed('Wire object extends beyond its frame.');
    return finish;
  }
  const kind=magic[7],tag=number(at,5);
  if(kind==='B'&&tag!==0x02a96||['C','D'].includes(kind)&&tag!==0x02a2c||kind==='H'&&tag!==0x02b40||kind==='I'&&(tag!==0x02a74||input[8]!==0))throw malformed('Wire object type does not match its prolog.');
  const boundary=end(at,limit),length=Math.ceil(boundary/2);
  if(length>MAX_FILE_BYTES||input.length-length>paddingLimit)throw malformed('Invalid Wire object length or padding.');
  const bytes=input.slice(0,length);if(boundary&1)bytes[length-1]&=15;
  return {bytes,info:inspectHp39File(bytes)};
}

function nibbles(bytes){return (offset,count)=>{
  if(offset<0||offset+count>bytes.length*2)throw malformed('Truncated Wire negotiation.');
  let value=0;for(let n=count-1;n>=0;n--)value=value*16+((bytes[(offset+n)>>1]>>>(((offset+n)&1)*4))&15);return value;
};}
function transferIndex(bytes){
  const number=nibbles(bytes);let at=23;
  // Original 39g+/39gs multipart SEND: list, the original transfer marker,
  // main aplet identifier, then requested library numbers. Other index forms
  // require their own protocol evidence and are rejected before acknowledging.
  if(number(at,5)!==0x10cd1)throw malformed('Unsupported Wire multipart index.');at+=5;
  if(number(at,5)!==0x02e48)throw malformed('Missing Wire aplet identifier.');at+=5;
  const count=number(at,2);at+=2;
  const title=String.fromCharCode(...Array.from({length:count},(_,i)=>number(at+2*i,2)));at+=2*count;
  if(!title||/[\x00-\x1f\x7f]/.test(title))throw malformed('Invalid Wire aplet identifier.');
  const libraries=[];
  while(number(at,5)!==0x0312b){
    if(libraries.length>=16||number(at,5)!==0x02911)throw malformed('Unsupported Wire dependency list.');
    const id=number(at+5,5);if(id>4095||libraries.includes(id))throw malformed('Invalid Wire library identifier.');
    libraries.push(id);at+=10;
  }
  if(Math.ceil((at+5)/2)!==bytes.length)throw malformed('Trailing Wire index fields.');
  return {title,libraries};
}
function indexReply(libraries){
  const digits=[];const number=(value,count)=>{for(let n=0;n<count;n++){digits.push(value&15);value=Math.floor(value/16);}};
  for(const byte of [72,80,51,57,66,105,110,73,0])number(byte,2);
  number(0x02a74,5);for(const id of libraries){number(0x02911,5);number(id,5);}number(0x0312b,5);
  const bytes=new Uint8Array(Math.ceil(digits.length/2));digits.forEach((value,index)=>bytes[index>>1]|=value<<((index&1)*4));return bytes;
}
function libraryId(bytes,info){
  const number=nibbles(bytes),start=info.payloadOffset*2,characters=number(start+10,2),at=start+12+2*characters;
  if(number(at,2)!==characters)throw malformed('Invalid Wire library name length.');
  return number(at+2,3);
}

/** One user-started listener accepts successive stock SEND operations.
 * Completed files are published individually. An error terminates only the
 * current listener; it never removes files already delivered to its owner.
 */
export class Hp39WireReceiver {
  constructor({write,notify=()=>{},file=()=>{},hz=12000000,receiveBudget,receiveId=1}={}){
    if(typeof write!=='function'||typeof file!=='function'||!Number.isFinite(hz)||hz<=0||
        !Number.isSafeInteger(receiveId)||receiveId<1)throw Error('Invalid HP39 Wire receive transport.');
    this.write=write;this.notify=notify;this.file=file;this.hz=hz;this.receiveId=receiveId;
    this.receiveBudget=validateReceiveBudget(receiveBudget);this.active=false;this.queue=[];this.lingerUntil=0;
  }
  get pending(){return this.active||this.queue.length>0||this.lingerUntil>this.now;}
  status(phase,error){this.phase=phase;this.notify({active:this.active,phase,protocol:'hp39-wire',direction:'receive',
    name:this.name,transferred:this.transferred,total:0,filesCompleted:this.received,receivedBytes:this.receivedBytes,
    ...(error?transferErrorDetails(error):{})});}
  start(_data,now){
    if(this.active)throw Error('A Wire receiver is already running.');
    if(!this.receiveBudget.files||!this.receiveBudget.bytes)throw transferError('receiveCapacity','Download and clear received files before receiving more.');
    this.active=true;this.now=now;this.end=now+900*this.hz;this.received=0;this.receivedBytes=0;
    this.queue=[];this.lingerUntil=0;this.multipart=null;this.resetObject();this.listen();
  }
  resetObject(){this.frame=[];this.want=0;this.parts=[];this.transferred=0;this.expected=1;this.lastBlock=null;this.lastBlockSize=128;this.retries=0;this.name='';}
  enqueue(bytes,kind='control'){
    // Retransmission replaces an unsent identical control, not a partial
    // transport write. A malicious peer cannot create an unbounded ACK queue.
    if(this.queue.some(item=>item.kind===kind&&item.offset===0&&item.bytes.length===bytes.length&&item.bytes.every((v,i)=>v===bytes[i])))return;
    if(this.queue.length>=4)throw transferError('wireReceiveProtocol','Too many pending Wire replies.');
    this.queue.push({bytes,offset:0,kind});this.deadline=Infinity;
  }
  listen(){this.stage='listen';this.deadline=this.now+3*this.hz;this.enqueue(Uint8Array.of(68),'handshake');this.status('listening');}
  retry(){
    if(++this.retries>8)throw transferError('wireReceiveTimeout','The calculator did not finish the current Wire object.');
    this.frame=[];this.want=0;
    if(this.stage==='reply-block'||this.stage==='reply-eot')this.enqueue(this.replyLast,'reply');
    else this.enqueue(Uint8Array.of(this.stage==='listen'?68:21),'handshake');
  }
  receive(bytes,now){
    this.now=now;this.expireLinger();if(!this.active&&!this.lingerUntil)return;
    try{
      if(!(bytes instanceof Uint8Array)||bytes.length>65536)throw Error('Invalid HP39 Wire input.');
      for(const byte of bytes){
        if(!this.active){
          // At capacity the object is complete, but its final ACK can be
          // lost. Only repeat EOTs belong to this bounded closing window.
          // A new frame ends it, so payload 0x04 cannot acknowledge a new
          // object that this receiver no longer has capacity to retain.
          if(!this.lingerUntil)break;
          if(byte===4)this.enqueue(Uint8Array.of(6),'ack');
          else {this.lingerUntil=0;this.queue=[];}
          continue;
        }
        if(this.stage.startsWith('reply-')){this.replyInput(byte);continue;}
        if(this.frame.length){
          this.frame.push(byte);
          if(this.frame.length===this.want){const frame=Uint8Array.from(this.frame);this.frame=[];this.want=0;this.block(frame);}
          continue;
        }
        if(byte===1||byte===2){
          this.queue=this.queue.filter(item=>item.kind!=='handshake'||item.offset>0);
          this.stage='blocks';this.frame=[byte];this.want=(byte===1?128:1024)+5;this.deadline=now+10*this.hz;continue;
        }
        if(byte===4){
          if(this.parts.length)this.finishObject();
          else if(this.received||this.multipart)this.enqueue(Uint8Array.of(6),'ack');
          continue;
        }
        if(byte===24&&(this.stage!=='listen'||this.multipart))throw transferError('wireReceiveCancelledByCalculator','The calculator cancelled the current Wire receive.');
      }
    }catch(error){this.fail(error);}
  }
  block(frame){
    const size=frame[0]===1?128:1024,body=frame.subarray(3,3+size),check=(frame.at(-2)<<8)|frame.at(-1);
    if(frame[1]+frame[2]!==255||hp39WireCrc(body)!==check){this.retry();return;}
    if(frame[1]!==this.expected){
      if(this.lastBlock&&frame.length===this.lastBlock.length&&frame.every((v,i)=>v===this.lastBlock[i]))this.enqueue(Uint8Array.of(6),'ack');
      else this.retry();return;
    }
    if(this.transferred+size>MAX_FILE_BYTES+1023)throw transferError('receiveCapacity','The Wire object exceeds the file-size limit.');
    this.parts.push(body.slice());this.transferred+=size;this.lastBlock=frame;this.lastBlockSize=size;
    this.expected=(this.expected+1)&255;this.retries=0;this.stage='blocks';this.enqueue(Uint8Array.of(6),'ack');
    if(this.parts.length===1&&body.length>9+body[8]&&String.fromCharCode(...body.subarray(0,7))==='HP39Bin')this.name=String.fromCharCode(...body.subarray(9,9+body[8]));
    this.status('receiving');
  }
  finishObject(){
    const payload=new Uint8Array(this.transferred);let offset=0;
    for(const part of this.parts){payload.set(part,offset);offset+=part.length;}
    const {bytes,info}=inspectHp39WireObject(payload,{paddingLimit:this.lastBlockSize-1});
    if(info.kind==='I'){
      if(this.multipart)throw malformed('Unexpected nested Wire transfer index.');
      this.multipart=transferIndex(bytes);
      if(this.received+this.multipart.libraries.length+1>this.receiveBudget.files)throw transferError('receiveCapacity','The multipart Wire object exceeds the remaining file count.');
    }else{
      if(this.multipart){
        if(this.multipart.libraries.length){
          if(info.kind!=='H')throw malformed('Expected the requested Wire library.');
          const id=libraryId(bytes,info),index=this.multipart.libraries.indexOf(id);
          if(index<0)throw malformed('The calculator sent an unrequested Wire library.');
          this.multipart.libraries.splice(index,1);
        }else{
          if(info.kind!=='B'||info.title!==this.multipart.title)throw malformed('Wire aplet does not match its transfer index.');
          this.multipart=null;
        }
      }
      if(this.received>=this.receiveBudget.files||this.receivedBytes+bytes.length>this.receiveBudget.bytes)throw transferError('receiveCapacity','Download and clear received files before receiving more.');
      const stem=info.title.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,24)||'OBJECT';
      const extension={B:'apt',C:'note',D:'program',H:'L39'}[info.kind];
      const name=`${stem}-${this.receiveId}-${this.received+1}.${extension}`;
      this.file({name,bytes});this.received++;this.receivedBytes+=bytes.length;
    }
    this.queue=this.queue.filter(item=>item.kind!=='handshake'||item.offset>0);
    this.enqueue(Uint8Array.of(6),'ack');this.resetObject();
    if(this.multipart){
      this.reply=indexReply(this.multipart.libraries);this.stage='reply-wait';this.deadline=this.now+30*this.hz;this.status('negotiating');
    }else if(this.received===this.receiveBudget.files||this.receivedBytes===this.receiveBudget.bytes){
      // Match the host Wire sender's ten-second retry policy with two
      // intervals from the first EOT; this is not a hardware timing claim.
      // Duplicates and transport backpressure never extend the deadline.
      this.lingerUntil=this.now+20*this.hz;
      this.active=false;this.stage='done';this.status('complete');
    }else this.listen();
  }
  replyInput(byte){
    if(byte===24)throw transferError('wireReceiveCancelledByCalculator','The calculator cancelled the Wire negotiation.');
    if(this.stage==='reply-wait'){
      if(byte===4){this.enqueue(Uint8Array.of(6),'ack');return;}
      if(![21,67,68].includes(byte))return;
      const body=new Uint8Array(128);body.set(this.reply);this.replyLast=hp39WireBlock(1,body,byte);
      this.stage='reply-block';this.retries=0;this.enqueue(this.replyLast,'reply');return;
    }
    if(this.queue.length)return;
    if(byte===21){this.retry();return;}
    if(byte!==6)return;
    this.retries=0;
    if(this.stage==='reply-block'){this.replyLast=Uint8Array.of(4);this.stage='reply-eot';this.enqueue(this.replyLast,'reply');}
    else {this.resetObject();this.listen();}
  }
  expireLinger(){
    if(!this.active&&this.lingerUntil&&this.now>=this.lingerUntil){this.lingerUntil=0;this.queue=[];}
  }
  poll(now){
    this.now=now;this.expireLinger();
    try{
      if(this.active){
        if(now>=this.end)throw transferError('wireReceiveDuration','Wire receive reached its fifteen-minute calculator-time limit.');
        if(now>=this.deadline){
          if(this.stage==='reply-wait')throw transferError('wireReceiveTimeout','The calculator did not request the Wire dependency reply.');
          if(this.stage==='listen'&&!this.frame.length)this.enqueue(Uint8Array.of(68),'handshake');
          else this.retry();
        }
      }
      const item=this.queue[0];if(!item)return;
      const left=item.bytes.subarray(item.offset),accepted=this.write(left);
      if(!Number.isInteger(accepted)||accepted<0||accepted>left.length)throw Error('Invalid HP39 Wire transport acceptance.');
      item.offset+=accepted;
      if(item.offset===item.bytes.length){this.queue.shift();this.deadline=now+(this.stage==='listen'?3:this.stage==='reply-wait'?30:10)*this.hz;}
    }catch(error){this.fail(error);}
  }
  cancel(error=transferError('wireReceiveCancelled','Wire receive stopped.')){
    this.queue=[];this.lingerUntil=0;this.active=false;this.parts=[];this.frame=[];this.multipart=null;this.status('cancelled',error);
  }
  fail(error){this.queue=[];this.lingerUntil=0;this.active=false;this.parts=[];this.frame=[];this.multipart=null;this.status('error',error);}
}
