// SPDX-License-Identifier: MIT
// Original HP39/40 disk-drive server. Only explicit, bounded in-memory files
// are visible to the calculator. Protocol roles: docs/development/hp39-files.md.
import {KermitSession,PacketReader,PARAMETERS,parameters,packet,decodeData,byteText,MAX_RECEIVE_BYTES,validateReceiveBudget} from './kermit.js';
import {inspectHp39File,inspectHp39Bundle,createHp39Directory,validateHp39Filename} from './hp39-files.js';
const EMPTY=new Uint8Array();
const ascii=text=>Uint8Array.from(text,c=>c.charCodeAt(0));
export const MAX_HP39_HOST_FILES=16;

/** Preserve explicit directory aliases. Generate a disk catalog for loose typed files. */
export function prepareHp39Files(files) {
  if(!Array.isArray(files)||files.length>MAX_HP39_HOST_FILES+2)throw Error('An HP39 catalog supports at most 16 objects and two directory files.');
  const prepared=[],names=new Set();let total=0;
  for(const f of files){
    const name=validateHp39Filename(f?.name),key=name.toUpperCase();
    if(name.length>64)throw Error('Use HP39 host filenames of at most 64 bytes.');
    if(names.has(key))throw Error('Duplicate HP39 file name (case insensitive).');
    const info=inspectHp39File(f.bytes);names.add(key);total+=f.bytes.length;
    if(total>MAX_RECEIVE_BYTES)throw Error('The selected HP39 files exceed 8 MiB.');
    prepared.push({name,bytes:f.bytes.slice(),info});
  }
  const directories=prepared.filter(f=>f.info.kind==='A');
  if(prepared.length-directories.length>MAX_HP39_HOST_FILES)throw Error('Choose at most 16 HP39 objects.');
  if(directories.length){
    // Stock SEND returns HP39DIR.000 and its objects, but not HP39DIR.CUR.
    // Recreate only this fixed entry point; preserve all original aliases and
    // directory bytes. Missing object dependencies still fail bundle validation.
    if(!names.has('HP39DIR.CUR')&&directories.some(f=>f.name.toUpperCase()==='HP39DIR.000'))
      prepared.push({name:'HP39DIR.CUR',bytes:createHp39Directory([{kind:'A',file:'HP39DIR.000',title:'Orchard'}])});
    inspectHp39Bundle(prepared,{allowTitleAliases:true});
  }else{
    const entries=prepared.map(f=>({kind:f.info.kind,file:f.name,title:f.info.title}));
    prepared.push({name:'HP39DIR.CUR',bytes:createHp39Directory([{kind:'A',file:'HP39DIR.000',title:'Orchard'}])},
      {name:'HP39DIR.000',bytes:createHp39Directory(entries)});
  }
  if(prepared.length>MAX_HP39_HOST_FILES+2)throw Error('An HP39 catalog supports at most 16 objects and two directory files.');
  if(prepared.reduce((n,f)=>n+f.bytes.length,0)>MAX_RECEIVE_BYTES)throw Error('The HP39 catalog and files exceed 8 MiB.');
  return prepared.map(({name,bytes})=>({name,bytes}));
}

/** Persistent Kermit server for the calculator's Disk drive... client mode. */
export class Hp39FileServer {
  constructor({write,notify=()=>{},file=()=>{},listing=()=>{},hz=12000000,end=null,onPacket=()=>{},receiveBudget}={}) {
    if(typeof write!=='function'||!Number.isFinite(hz)||hz<=0)throw Error('Invalid HP39 transport.');
    this.write=write;this.notify=notify;this.file=file;this.listing=listing;this.hz=hz;this.onPacket=onPacket;
    this.receiveBudget=validateReceiveBudget(receiveBudget);
    this.reader=new PacketReader({end});this.active=false;this.queue=[];this.lingerUntil=0;
  }
  get pending(){return this.active||this.queue.length>0||Boolean(this.child?.pending)||this.lingerUntil>this.now;}
  status(phase,error){this.phase=phase;this.notify({active:this.active,phase,direction:'serve',name:this.name||'',transferred:this.transferred,total:this.total,...(error?{error}:{})});}
  start({files=[]},now){
    if(this.active)throw Error('An HP39 file server is already running.');
    const prepared=prepareHp39Files(files);
    this.files=new Map(prepared.map(f=>[f.name.toUpperCase(),f]));
    this.total=prepared.filter(f=>inspectHp39File(f.bytes).kind!=='A').reduce((n,f)=>n+f.bytes.length,0);
    this.transferred=0;this.served=new Set();this.received=0;this.receivedBytes=0;this.child=null;this.lastAck=null;this.queue=[];this.reader.reset();
    this.peer=parameters(PARAMETERS);this.now=now;this.end=now+900*this.hz;this.active=true;this.mode='serve';this.lingerUntil=0;
    this.publishListing();this.status('serving');
  }
  frame(sequence,type,data=EMPTY){return packet(sequence,type,data,this.peer.end,this.peer.pad,this.peer.padding);}
  enqueue(bytes,sent=null){if(this.queue.length>=8)throw Error('HP39 output queue exceeded its limit.');this.queue.push({bytes,offset:0,sent});}
  publishListing(){this.listing([...this.files.values()].filter(f=>inspectHp39File(f.bytes).kind!=='A').map(f=>`${f.name} · ${inspectHp39File(f.bytes).title} · ${f.bytes.length} bytes`).join('\n'));}
  makeChild(mode,name='',bytes){
    const child=new KermitSession({write:bytes=>this.queue.length?0:this.write(bytes),hz:this.hz,
      validateFile:file=>this.validateStore([...child.files.filter(f=>!f.screen),file]),notify:state=>{
      if(state.phase==='complete'){
        if(mode==='send'){
          const item=this.files.get(name.toUpperCase());
          if(item&&inspectHp39File(item.bytes).kind!=='A'&&!this.served.has(name.toUpperCase())){this.served.add(name.toUpperCase());this.transferred+=item.bytes.length;}
        }
        this.lastAck=child.ack?{...child.ack,type:'B'}:null;this.lingerUntil=child.lingerUntil;this.child=null;this.name=name;this.status('serving');
      }else if(state.phase==='error'||state.phase==='cancelled')this.fail(state.error||'The HP39 transfer ended unexpectedly.');
      else{this.name=state.name||name;this.notify({...state,active:true,direction:mode==='send'?'send':'receive'});}
    },file:received=>this.store(received)});
    this.child=child;
    child.start({mode,name,bytes,passive:true},this.now);
    return child;
  }
  validateStore(files){
    // Include earlier files in the same still-uncommitted transaction. Reject
    // before EOF ACK so a full host disk cannot acknowledge a lost file.
    if(this.received+files.length>this.receiveBudget.files||this.receivedBytes+files.reduce((n,f)=>n+f.bytes.length,0)>this.receiveBudget.bytes)throw Error('Download and clear received files before receiving more.');
    const sizes=new Map([...this.files].map(([key,f])=>[key,f.bytes.length]));
    for(const {name,bytes} of files){validateHp39Filename(name);inspectHp39File(bytes);sizes.set(name.toUpperCase(),bytes.length);}
    if(sizes.size>MAX_HP39_HOST_FILES+2||[...sizes.values()].reduce((n,size)=>n+size,0)>MAX_RECEIVE_BYTES)throw Error('HP39 disk catalog is full.');
  }
  store({name,bytes}){
    this.validateStore([{name,bytes}]);
    ++this.received;this.receivedBytes+=bytes.length;this.files.set(name.toUpperCase(),{name,bytes:bytes.slice()});this.publishListing();this.file({name,bytes});
  }
  repeatFinal(p,now){
    const ack=this.lastAck;
    if(!ack||now>=this.lingerUntil||p.type!==ack.type||p.sequence!==ack.sequence)return false;
    if(p.type==='G'&&(p.data.length!==ack.data.length||p.data.some((b,i)=>b!==ack.data[i])))return false;
    this.enqueue(ack.bytes);return true;
  }
  receive(bytes,now){
    this.now=now;
    try{for(const p of this.reader.feed(bytes)){
      if(p.error){if(this.child?.active)this.child.enqueue(this.child.frame(this.child.expected,'N'));continue;}
      this.onPacket(p);
      if(!this.active){this.repeatFinal(p,now);continue;}
      if(p.type==='E')throw Error('Calculator: '+byteText(decodeData(p.data,{ctl:this.peer.ctl,binary:this.peer.binary,repeat:this.peer.repeat},4096)));
      if(this.child?.active){this.child.now=now;this.child.accept(p);continue;}
      if(this.repeatFinal(p,now))continue;
      if(p.type==='I'){
        this.peer=parameters(p.data);this.enqueue(this.frame(p.sequence,'Y',PARAMETERS));
      }else if(p.type==='R'){
        const name=validateHp39Filename(byteText(decodeData(p.data,{ctl:this.peer.ctl,binary:this.peer.binary,repeat:this.peer.repeat},256)));
        const f=this.files.get(name.toUpperCase());
        if(!f){this.enqueue(this.frame(p.sequence,'E',ascii('File not found')));continue;}
        this.makeChild('send',name,f.bytes);
      }else if(p.type==='S'){
        if(p.sequence!==0){this.enqueue(this.frame(0,'N'));continue;}
        const child=this.makeChild('receive');child.accept(p);
      }else if(p.type==='G'){
        const command=byteText(decodeData(p.data,{ctl:this.peer.ctl,binary:this.peer.binary,repeat:this.peer.repeat},256));
        if(command==='F'||command==='L'){
          const reply=this.frame(p.sequence,'Y');
          this.enqueue(reply,()=>{
            this.lastAck={sequence:p.sequence,type:'G',data:p.data.slice(),bytes:reply};
            this.lingerUntil=this.now+2*this.peer.timeout*this.hz;this.active=false;this.status('complete');
          });
        }
        else this.enqueue(this.frame(p.sequence,'E',ascii('Unsupported command')));
      }
    }}catch(error){this.fail(error.message);}
  }
  poll(now){
    this.now=now;
    try{
      if(this.active&&now>=this.end)throw Error('The HP39 file server reached its 15-minute virtual-time limit.');
      const q=this.queue[0];
      if(q){const left=q.bytes.subarray(q.offset),n=this.write(left);if(!Number.isInteger(n)||n<0||n>left.length)throw Error('Invalid HP39 transport acceptance.');q.offset+=n;if(q.offset===q.bytes.length){this.queue.shift();q.sent?.();}}
      else if(this.child?.pending)this.child.poll(now);
    }catch(error){this.fail(error.message);}
  }
  cancel(message='HP39 file server stopped.'){
    const child=this.child;this.child=null;this.queue=[];this.lingerUntil=0;
    if(child?.active){child.notify=()=>{};child.cancel(message);for(const q of child.queue)this.queue.push(q);}
    this.active=false;this.status('cancelled',message);
  }
  fail(message){this.active=false;this.child=null;this.queue=[];this.lingerUntil=0;this.status('error',message);}
}
