// SPDX-License-Identifier: MIT
// Same-origin, two-tab decoded-octet cable. No optical/baud timing is inferred.
// Each direction has a bounded window with individual, ordered packet ACKs.
import {irdaTimeline,IRDA_PACKET_BYTES,IRDA_QUEUE_BYTES,IRDA_SPAN_TICKS,IRDA_WINDOW_PACKETS} from './irda-input.js';
// Both tabs must refresh: the pipelined receive contract cannot mix with v2.
export const IRDA_PROTOCOL=3;
export function irdaCode(value){
  const code=String(value??'').trim().toUpperCase();
  if(!/^[A-Z0-9]{6,12}$/.test(code))throw Object.assign(Error('Invalid IrDA pairing code'),{code:'code'});
  return code;
}
export function newIrdaCode(){return Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b&31]).join('');}
export class IrDALink {
  constructor({code,label,receive,notify=()=>{},channel=name=>new BroadcastChannel(name),id=crypto.randomUUID(),now=()=>Date.now(),interval=(fn)=>setInterval(fn,1000),clear=timer=>clearInterval(timer)}={}){
    this.code=irdaCode(code);this.id=id;this.label=String(label).slice(0,32);this.receive=receive;this.notify=notify;this.now=now;this.clear=clear;
    this.peers=new Map();this.queue=[];this.pending=[];this.queued=0;this.sequence=0;this.lastReceived=0;this.incoming=[];this.incomingBytes=0;this.sent=0;this.received=0;this.active=true;this.lastSentTick=null;this.lastReceivedTick=null;
    this.channel=channel('orchard-irda-v'+IRDA_PROTOCOL+'-'+this.code);this.channel.onmessage=event=>this.message(event.data);
    this.timer=interval(()=>this.heartbeat());this.status('waiting');this.post('hello');
  }
  post(kind,extra={}){if(this.active)this.channel.postMessage({version:IRDA_PROTOCOL,kind,from:this.id,label:this.label,...extra});}
  status(phase,error=null){this.phase=phase;this.notify({active:this.active,phase,error,code:this.code,peer:this.peer?.label??null,sent:this.sent,received:this.received});}
  heartbeat(){
    if(!this.active)return;
    if(this.pending.some(packet=>this.now()-packet.at>5000)){this.close('timeout');return;}
    for(const [id,peer] of this.peers)if(this.now()-peer.at>6000){this.peers.delete(id);if(this.peer?.id===id){this.close('gone');return;}}
    this.post('hello');
  }
  message(data){
    if(!this.active||!data||data.version!==IRDA_PROTOCOL||typeof data.from!=='string'||data.from===this.id||data.from.length>64)return;
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
    if(data.kind==='progress'){
      const packet=this.pending.find(packet=>packet.sequence===data.sequence);if(packet)packet.at=this.now();
      return;
    }
    if(data.kind==='ack'){
      const packet=this.pending[0];if(!packet||packet.sequence!==data.sequence)return;
      this.pending.shift();this.sent+=packet.bytes.length;this.queued-=packet.bytes.length;
      this.status('paired');this.flush();return;
    }
    if(data.kind!=='bytes'||!(data.bytes instanceof Uint8Array)||!data.bytes.length||data.bytes.length>IRDA_PACKET_BYTES||!Number.isSafeInteger(data.sequence)||data.sequence<1)return;
    if(data.sequence===this.lastReceived){this.post('ack',{to:data.from,sequence:data.sequence});return;}
    if(this.incoming.some(packet=>packet.sequence===data.sequence))return;
    if(data.sequence!==this.lastReceived+this.incoming.length+1){this.close('sequence');return;}
    let segments;try{if(!Array.isArray(data.segments))throw Error('Missing infrared timeline');segments=irdaTimeline(data.bytes.length,data.segments);}catch{this.close('sequence');return;}
    const previous=this.incoming.at(-1)?.segments.at(-1)[1]??this.lastReceivedTick;
    if(previous!==null&&segments[0][1]<previous){this.close('sequence');return;}
    if(this.incoming.length>=IRDA_WINDOW_PACKETS||this.incomingBytes+data.bytes.length>IRDA_QUEUE_BYTES||
      this.incoming.length&&segments.at(-1)[1]-this.incoming[0].segments[0][1]>IRDA_SPAN_TICKS){this.close('overflow');return;}
    const packet={sequence:data.sequence,from:data.from,bytes:data.bytes.slice(),segments,done:false,accepted:0};
    this.incoming.push(packet);this.incomingBytes+=packet.bytes.length;
    const current=()=>this.active&&this.incoming.includes(packet)&&this.peer?.id===packet.from;
    const progress=()=>{if(current())this.post('progress',{to:packet.from,sequence:packet.sequence});};
    Promise.resolve().then(()=>current()?this.receive(packet.bytes,segments,progress):0).then(accepted=>{
      if(!current())return;
      packet.done=true;packet.accepted=Math.max(0,Math.min(packet.bytes.length,Number(accepted)||0));
      // Completion may arrive out of order; ACK only the contiguous prefix.
      // The callback has already queued all following packets in the Worker.
      while(this.incoming[0]?.done){
        const completed=this.incoming.shift();this.incomingBytes-=completed.bytes.length;
        this.lastReceivedTick=completed.segments.at(-1)[1];this.lastReceived=completed.sequence;this.received+=completed.accepted;
        this.post('ack',{to:completed.from,sequence:completed.sequence});
      }
      this.status('paired');
    }).catch(error=>{if(current())this.close(error?.code==='timing'?'timing':'overflow');});
  }
  send(bytes,tick=0){
    if(!this.active||this.phase!=='paired')return false;
    if(!Number.isSafeInteger(tick)||tick<0||this.lastSentTick!==null&&tick<this.lastSentTick){this.close('sequence');return false;}
    const oldest=this.pending[0]?.segments[0][1]??this.queue[0]?.tick??tick;
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>IRDA_PACKET_BYTES||this.queued+bytes.length>IRDA_QUEUE_BYTES||tick-oldest>IRDA_SPAN_TICKS){this.close('overflow');return false;}
    this.lastSentTick=tick;this.queue.push({bytes:bytes.slice(),tick});this.queued+=bytes.length;this.flush();return true;
  }
  flush(){
    if(!this.active||this.phase!=='paired')return;
    while(this.pending.length<IRDA_WINDOW_PACKETS&&this.queue.length){
      // Forward available chunks without waiting for every preceding Worker
      // ACK. At the window limit, adjacent queued chunks still coalesce.
      let length=0,count=0;const segments=[];
      while(count<this.queue.length&&length+this.queue[count].bytes.length<=IRDA_PACKET_BYTES)length+=this.queue[count++].bytes.length;
      const tail=count<this.queue.length?Math.min(IRDA_PACKET_BYTES-length,this.queue[count].bytes.length):0;
      const bytes=new Uint8Array(length+tail);let offset=0;
      const append=(chunk,n)=>{bytes.set(chunk.bytes.subarray(0,n),offset);offset+=n;
        if(segments.at(-1)?.[1]===chunk.tick)segments.at(-1)[0]+=n;else segments.push([n,chunk.tick]);};
      for(let i=0;i<count;i++)append(this.queue[i],this.queue[i].bytes.length);
      if(tail){append(this.queue[count],tail);this.queue[count].bytes=this.queue[count].bytes.subarray(tail);}
      this.queue.splice(0,count);
      const packet={bytes,segments,sequence:++this.sequence,at:this.now()};this.pending.push(packet);
      this.post('bytes',{to:this.peer.id,sequence:packet.sequence,bytes:packet.bytes,segments});
    }
  }
  close(error=null){
    if(!this.active)return;
    this.post('bye');this.active=false;this.clear(this.timer);this.channel.close();
    this.queue=[];this.pending=[];this.incoming=[];this.queued=0;this.incomingBytes=0;this.status(error?'error':'disconnected',error);
  }
}
