// SPDX-License-Identifier: MIT
// Preserve decoded sender-clock gaps across host batching. This is transport
// scheduling, not a baud, optical waveform or firmware-protocol model.
export const IRDA_PACKET_BYTES=1024,IRDA_QUEUE_BYTES=16384,IRDA_SPAN_TICKS=12000000;
export function irdaTimeline(length,segments=[[length,0]]){
  if(!Number.isInteger(length)||length<1||length>IRDA_PACKET_BYTES||!Array.isArray(segments)||!segments.length||segments.length>IRDA_PACKET_BYTES)throw Error('Invalid infrared timeline');
  let total=0,previous=-1;
  const result=segments.map(segment=>{
    if(!Array.isArray(segment)||segment.length!==2)throw Error('Invalid infrared segment');
    const [count,at]=segment;
    if(!Number.isInteger(count)||count<1||!Number.isSafeInteger(at)||at<0||at<previous)throw Error('Invalid infrared clock');
    total+=count;previous=at;return [count,at];
  });
  if(total!==length||result.at(-1)[1]-result[0][1]>IRDA_SPAN_TICKS)throw Error('Infrared timeline exceeds its bounds');
  return result;
}
export function irdaSuffix(segments,offset){
  const result=[];
  for(const [count,at] of segments){if(offset>=count){offset-=count;continue;}result.push([count-offset,at]);offset=0;}
  return result;
}
export class IrDAInput {
  constructor({ready,send,reply,progress=()=>{}}){
    this.ready=ready;this.send=send;this.reply=reply;this.progress=progress;
    this.pending=null;this.sourceTick=null;this.sourceAnchor=null;this.targetAnchor=0;
  }
  reset(tick=0){if(this.pending)this.finish(true,tick);this.sourceTick=null;this.sourceAnchor=null;this.targetAnchor=0;}
  receive({request,bytes,segments},tick){
    if(this.pending)throw Error('An infrared packet is already pending');
    if(!(bytes instanceof Uint8Array)||!Number.isSafeInteger(request)||request<1)throw Error('Invalid infrared packet');
    const timeline=irdaTimeline(bytes.length,segments);
    if(this.sourceTick!==null&&timeline[0][1]<this.sourceTick)throw Error('Infrared clock moved backwards');
    if(this.sourceAnchor===null){this.sourceAnchor=timeline[0][1];this.targetAnchor=tick;}
    // Map the peer's clock once per connection. Host delivery or RX retries
    // may be late, but their lateness must not accumulate into future packets.
    const nominalDue=this.targetAnchor+(timeline[0][1]-this.sourceAnchor);
    const due=Math.max(tick,nominalDue);
    // Wall-clock progress keeps a slow host alive, but cannot extend this
    // finite guest-time allowance for an RX queue that never drains.
    const deadline=due+(timeline.at(-1)[1]-timeline[0][1])+IRDA_SPAN_TICKS;
    this.pending={request,bytes:bytes.slice(),segments:timeline,index:0,offset:0,end:timeline[0][0],start:due,due,deadline,accepted:0,discarded:false,progressTick:tick};
    if(due-tick>IRDA_SPAN_TICKS||!Number.isSafeInteger(due)||!Number.isSafeInteger(deadline)){this.finish(true,tick,'timing');return;}
    this.poll(tick);
  }
  boundary(tick){const p=this.pending;if(!p)return Infinity;return Math.min(p.due>tick?p.due:Infinity,p.deadline>tick?p.deadline:Infinity);}
  poll(tick){
    while(this.pending){
      const p=this.pending;
      if(tick>=p.deadline){this.finish(true,tick,'overflow');return;}
      if(tick<p.due)return;
      if(!this.ready()){
        // Unavailable receivers lose this arriving segment. Later segments
        // have not arrived yet and may see RX enabled again at their due tick.
        p.offset=p.end;p.discarded=true;
      }else{
        const accepted=this.send(p.bytes.subarray(p.offset,p.end));
        if(!Number.isInteger(accepted)||accepted<0||accepted>p.end-p.offset)throw Error('Invalid infrared accepted length');
        p.offset+=accepted;p.accepted+=accepted;
        if(p.offset<p.end)return;
      }
      this.sourceTick=p.segments[p.index][1];
      if(++p.index===p.segments.length){this.finish(p.discarded,tick);return;}
      // A late coalesced packet still retains its captured internal gaps.
      // Completing a segment late does not move the remaining schedule.
      p.end+=p.segments[p.index][0];p.due=p.start+(p.segments[p.index][1]-p.segments[0][1]);
    }
  }
  notifyProgress(tick){
    const p=this.pending;if(!p||tick<=p.progressTick)return;
    p.progressTick=tick;this.progress({request:p.request,tick,accepted:p.accepted});
  }
  finish(discarded,tick,error){
    const p=this.pending;if(!p)return;this.pending=null;
    if(discarded)this.sourceTick=p.segments.at(-1)[1];
    this.reply({request:p.request,accepted:p.accepted,discarded,...(error?{error}:{})});
  }
}
