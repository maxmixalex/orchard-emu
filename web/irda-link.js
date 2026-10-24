// SPDX-License-Identifier: MIT
// Same-origin, two-tab decoded-octet cable. No optical/baud timing is inferred.
// Each direction has one acknowledged packet in flight and a bounded queue.
export function irdaCode(value){
  const code=String(value??'').trim().toUpperCase();
  if(!/^[A-Z0-9]{6,12}$/.test(code))throw Object.assign(Error('Invalid IrDA pairing code'),{code:'code'});
  return code;
}
export function newIrdaCode(){return Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b&31]).join('');}
export class IrDALink {
  constructor({code,label,receive,notify=()=>{},channel=name=>new BroadcastChannel(name),id=crypto.randomUUID(),now=()=>Date.now(),interval=(fn)=>setInterval(fn,1000),clear=timer=>clearInterval(timer)}={}){
    this.code=irdaCode(code);this.id=id;this.label=String(label).slice(0,32);this.receive=receive;this.notify=notify;this.now=now;this.clear=clear;
    this.peers=new Map();this.queue=[];this.queued=0;this.sequence=0;this.lastReceived=0;this.incoming=null;this.sent=0;this.received=0;this.active=true;
    this.channel=channel('orchard-irda-v1-'+this.code);this.channel.onmessage=event=>this.message(event.data);
    this.timer=interval(()=>this.heartbeat());this.status('waiting');this.post('hello');
  }
  post(kind,extra={}){if(this.active)this.channel.postMessage({version:1,kind,from:this.id,label:this.label,...extra});}
  status(phase,error=null){this.phase=phase;this.notify({active:this.active,phase,error,code:this.code,peer:this.peer?.label??null,sent:this.sent,received:this.received});}
  heartbeat(){
    if(!this.active)return;
    if(this.pending&&this.now()-this.pending.at>5000){this.close('timeout');return;}
    for(const [id,peer] of this.peers)if(this.now()-peer.at>6000){this.peers.delete(id);if(this.peer?.id===id){this.close('gone');return;}}
    this.post('hello');
  }
  message(data){
    if(!this.active||!data||data.version!==1||typeof data.from!=='string'||data.from===this.id||data.from.length>64)return;
    if(data.to!==undefined&&data.to!==this.id)return;
    if(data.kind==='hello'||data.kind==='welcome'){
      this.peers.set(data.from,{id:data.from,label:String(data.label??'').slice(0,32),at:this.now()});
      if(this.peers.size>1){this.close('crowded');return;}
      this.peer=this.peers.get(data.from);
      if(data.kind==='hello')this.post('welcome',{to:data.from});
      if(this.phase!=='paired')this.status('paired');this.flush();return;
    }
    if(data.from!==this.peer?.id)return;
    this.peer.at=this.now();
    if(data.kind==='bye'){this.close('gone');return;}
    if(data.kind==='ack'){
      if(this.pending?.sequence!==data.sequence)return;
      this.sent+=this.pending.bytes.length;this.queued-=this.pending.bytes.length;this.pending=null;
      this.status('paired');this.flush();return;
    }
    if(data.kind!=='bytes'||!(data.bytes instanceof Uint8Array)||!data.bytes.length||data.bytes.length>1024||!Number.isSafeInteger(data.sequence)||data.sequence<1)return;
    if(data.sequence===this.lastReceived){this.post('ack',{to:data.from,sequence:data.sequence});return;}
    if(this.incoming||data.sequence!==this.lastReceived+1){this.close('sequence');return;}
    const packet={sequence:data.sequence,from:data.from};this.incoming=packet;
    Promise.resolve().then(()=>this.receive(data.bytes.slice())).then(accepted=>{
      if(!this.active||this.incoming!==packet||this.peer?.id!==packet.from)return;
      this.incoming=null;this.lastReceived=packet.sequence;this.received+=Math.max(0,Math.min(data.bytes.length,Number(accepted)||0));
      this.post('ack',{to:packet.from,sequence:packet.sequence});this.status('paired');
    }).catch(()=>{if(this.active)this.close('overflow');});
  }
  send(bytes){
    if(!this.active||this.phase!=='paired')return false;
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>1024||this.queued+bytes.length>16384){this.close('overflow');return false;}
    this.queue.push(bytes.slice());this.queued+=bytes.length;this.flush();return true;
  }
  flush(){
    if(!this.active||this.phase!=='paired'||this.pending||!this.queue.length)return;
    this.pending={bytes:this.queue.shift(),sequence:++this.sequence,at:this.now()};
    this.post('bytes',{to:this.peer.id,sequence:this.pending.sequence,bytes:this.pending.bytes});
  }
  close(error=null){
    if(!this.active)return;
    this.post('bye');this.active=false;this.clear(this.timer);this.channel.close();
    this.queue=[];this.pending=null;this.incoming=null;this.queued=0;this.status(error?'error':'disconnected',error);
  }
}
