// SPDX-License-Identifier: MIT
// The only signal source is timestamped GPB2 output from the emulated SoC.
// Area averaging limits aliasing; a 40 Hz DC blocker models an AC speaker path
// without inventing a command, key click, or a guessed oscillator frequency.
export class BuzzerPCM {
  constructor(){this.reset();}
  reset(){this.tick=null;this.epoch=null;this.rate=0;this.timebase=0;this.level=0;this.remaining=0;this.area=0;this.previous=0;this.filtered=0;}
  render(packet,rate=48000,maxSeconds=0.12){
    const {tick,epoch,edges,timebase=12000000}=packet;
    if(!Number.isSafeInteger(tick)||tick<0||!Number.isInteger(epoch)||epoch<0||
       !(edges instanceof Float64Array)||edges.length%2||edges.length>8192||![0,1].includes(packet.level)||
       !Number.isFinite(timebase)||timebase<=0||!Number.isFinite(rate)||rate<8000||rate>192000||
       !Number.isFinite(maxSeconds)||maxSeconds<=0||maxSeconds>1)throw Error('Invalid buzzer packet.');
    let previousTick=-1;
    for(let i=0;i<edges.length;i+=2){
      if(!Number.isSafeInteger(edges[i])||edges[i]<0||edges[i]<previousTick||edges[i]>tick||![0,1].includes(edges[i+1]))throw Error('Invalid buzzer edge.');
      previousTick=edges[i];
    }
    let discontinuity=this.tick===null||this.epoch!==epoch||this.rate!==rate||this.timebase!==timebase||tick<this.tick;
    let start=discontinuity?(edges.length?edges[0]:tick):this.tick;
    const earliest=Math.max(0,tick-Math.floor(timebase*maxSeconds));
    const discarded=Math.max(0,earliest-start);
    if(discarded){start=earliest;discontinuity=true;}
    let index=0,current=discontinuity?(edges.length?edges[1]:packet.level):this.level;
    while(index<edges.length&&edges[index]<=start){current=edges[index+1];index+=2;}
    const period=timebase/rate;
    if(discontinuity){this.remaining=period;this.area=0;this.previous=current;this.filtered=0;}
    const output=new Float32Array(Math.ceil((tick-start)/period)+1);
    const coefficient=Math.exp(-2*Math.PI*40/rate);
    let cursor=start,n=0;
    const segment=end=>{
      let distance=end-cursor;
      while(distance>0){
        const part=Math.min(distance,this.remaining);
        this.area+=current*part;this.remaining-=part;distance-=part;
        if(this.remaining<1e-7){
          const sample=this.area/period;
          this.filtered=sample-this.previous+coefficient*this.filtered;
          this.previous=sample;output[n++]=this.filtered;
          this.remaining=period;this.area=0;
        }
      }
      cursor=end;
    };
    for(;index<edges.length;index+=2){
      if(edges[index]<cursor)continue;
      segment(edges[index]);current=edges[index+1];
    }
    segment(tick);
    this.tick=tick;this.epoch=epoch;this.rate=rate;this.timebase=timebase;this.level=current;
    return {samples:output.subarray(0,n),discontinuity,discarded};
  }
}

export class BuzzerAudio {
  constructor({createContext=null}={}){
    this.createContext=createContext||(()=>{const Context=globalThis.AudioContext||globalThis.webkitAudioContext;return Context?new Context({latencyHint:'interactive'}):null;});
    this.pcm=new BuzzerPCM();this.context=null;this.gain=null;this.sources=new Set();
    this.sound=true;this.volume=0.35;this.ready=false;this.dead=false;this.next=0;
    this.pending=null;this.tag=null;this.blocked=null;
  }
  configure({sound=true,volume=0.35}={}){
    if(typeof sound!=='boolean'||!Number.isFinite(volume)||volume<0||volume>1)throw Error('Invalid sound settings.');
    if(sound&&volume&&(!this.sound||!this.volume)){this.blocked=null;this.pcm.reset();}
    this.sound=sound;this.volume=volume;
    if(this.gain)this.gain.gain.setValueAtTime(sound?volume:0,this.context.currentTime);
    if(!sound||!volume)this.reset();
  }
  unlock(){
    if(this.dead||!this.sound)return Promise.resolve(false);
    if(this.ready&&this.context?.state==='running')return Promise.resolve(true);
    if(this.pending)return this.pending;
    try{
      if(!this.context){
        this.context=this.createContext();if(!this.context)return Promise.resolve(false);
        this.gain=this.context.createGain();this.gain.connect(this.context.destination);
        this.gain.gain.setValueAtTime(this.volume,this.context.currentTime);
        this.context.addEventListener?.('statechange',()=>{if(this.context?.state!=='running'){this.ready=false;this.reset();}});
      }
      // resume() is invoked synchronously inside the trusted user gesture.
      const resumed=this.context.resume();
      this.pending=Promise.resolve(resumed).then(()=>{
        if(this.dead||!this.sound||this.context.state!=='running')return false;
        this.ready=true;this.cancelSources();this.pcm.reset();this.blocked=null;return true;
      }).catch(()=>false).finally(()=>{this.pending=null;});
      return this.pending;
    }catch{return Promise.resolve(false);}
  }
  cancelSources(){
    for(const source of this.sources){try{source.stop();}catch{}try{source.disconnect();}catch{}}
    this.sources.clear();this.next=0;
  }
  reset(){
    // A queued Worker message from the old epoch cannot restart a paused tone.
    // Worker pause/resume starts a new core epoch before producing more audio.
    this.blocked=this.tag;this.cancelSources();this.pcm.reset();
  }
  receive(packet){
    if(this.dead||!this.sound||!this.volume||!this.ready||this.context?.state!=='running')return;
    const tag=`${packet.generation??0}:${packet.epoch}`;
    if(tag===this.blocked)return;
    if(this.tag!==tag){this.cancelSources();this.pcm.reset();this.tag=tag;this.blocked=null;}
    const result=this.pcm.render(packet,this.context.sampleRate);
    const samples=result.samples;
    if(result.discontinuity)this.cancelSources();
    if(!samples.length)return;
    let peak=0;for(const sample of samples)peak=Math.max(peak,Math.abs(sample));
    const now=this.context.currentTime;
    // Unlimited may produce seconds of guest sound in one host frame. Keep
    // only the latest 120 ms and never leave a long delayed playback tail.
    if(this.next>now+0.15)this.cancelSources();
    this.next=Math.max(this.next,now+0.01);
    if(peak>0.00001){
      const buffer=this.context.createBuffer(1,samples.length,this.context.sampleRate);
      buffer.copyToChannel(samples,0);
      const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.gain);
      source.onended=()=>{this.sources.delete(source);try{source.disconnect();}catch{}};
      this.sources.add(source);source.start(this.next);
    }
    this.next+=samples.length/this.context.sampleRate;
  }
  dispose(){
    if(this.dead)return;this.dead=true;this.ready=false;this.reset();
    try{this.gain?.disconnect();}catch{}
    try{Promise.resolve(this.context?.close()).catch(()=>{});}catch{}
  }
}
