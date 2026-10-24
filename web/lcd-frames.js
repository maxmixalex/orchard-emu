// SPDX-License-Identifier: MIT
// Host presentation cache, not guest LCD state. The debugger retains direct
// memory inspection; the calculator publishes one image per scan boundary.
export class LCDFrames {
  constructor(){this.response='instant';this.reset();}
  reset(){this.core=null;this.registers=null;this.frame=null;this.observedTick=-1;this.history=null;this.responseTick=-1;}
  configure({response='instant'}={}){
    if(!['instant','smooth'].includes(response))throw Error('Invalid LCD response');
    if(this.response!==response){this.response=response;this.reset();}
  }
  read(core,model,view,tick,force=false,observing=true){
    const changed=this.core!==core||this.model!==model||this.view!==view||this.observing!==observing||tick<this.observedTick;
    if(changed){this.reset();this.core=core;this.model=model;this.view=view;this.observing=observing;}
    // Calling this is idempotent, and re-enables after a core reset/import.
    // It never advances the guest. New cores publish at the actual scan event
    // rather than sampling live RAM after this Worker's arbitrary run slice.
    const observed=observing&&typeof core.lcd_observe==='function'&&core.lcd_observe(view)===0;
    this.observedTick=tick;
    const pointer=typeof core.peripheral_snapshot==='function'?core.peripheral_snapshot():0;
    if(pointer&&(!this.registers||this.registers.buffer!==core.memory.buffer||this.registers.byteOffset!==pointer))
      this.registers=new Uint32Array(core.memory.buffer,pointer,6);
    // A fixture or an older diagnostic core may lack scan information. Its
    // raw frame remains available; never invent a completed scan for it.
    const registers=pointer?this.registers:null;
    const serial=registers?registers[4]+registers[5]*4294967296:null;
    const enabled=registers?Boolean(registers[0]&1):null;
    if(observing&&!force&&registers&&this.frame&&this.frame.frameSerial===serial&&this.frame.lcdEnabled===enabled)return this.frame;
    const width=core.profile(model,2),height=core.profile(model,3);
    const frameStatus=observed?core.lcd_published_frame():core.frame_view(view),
      annunciatorStatus=observed?core.lcd_published_annunciators():core.annunciators();
    const pixels=frameStatus?null:new Uint8Array(core.memory.buffer,core.frame_buffer(),width*height).slice();
    // An explicit presentation option, not a claim about an HP panel's measured
    // response. The 35 ms exponential follows guest time at completed scans;
    // valid white frames participate exactly like any other intensity. No
    // text/content recognition, frame rejection, wall-clock timer or guest edit.
    if(observing&&this.response==='smooth'&&pixels&&enabled!==false){
      if(!this.history||this.history.length!==pixels.length)this.history=Float32Array.from(pixels);
      else{
        const hz=core.timebase_hz?.()||12000000,amount=1-Math.exp(-Math.max(0,tick-this.responseTick)/(hz*.035));
        for(let i=0;i<pixels.length;i++){
          this.history[i]+=(pixels[i]-this.history[i])*amount;pixels[i]=Math.round(this.history[i]);
        }
      }
      this.responseTick=tick;
    }else{this.history=null;this.responseTick=-1;}
    this.frame={width,height,frameStatus,annunciatorStatus,pixels,
      annunciators:annunciatorStatus?null:new Uint8Array(core.memory.buffer,core.annunciator_buffer(),6).slice(),
      frameTick:tick,frameSerial:serial,lcdEnabled:enabled};
    return this.frame;
  }
}
