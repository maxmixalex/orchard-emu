// SPDX-License-Identifier: MIT
// Host presentation cache, not guest LCD state. The debugger retains direct
// memory inspection; the calculator publishes one image per scan boundary.
export class LCDFrames {
  constructor(){this.reset();}
  reset(){this.core=null;this.registers=null;this.frame=null;this.observedTick=-1;}
  read(core,model,view,tick,force=false){
    const changed=this.core!==core||this.model!==model||this.view!==view||tick<this.observedTick;
    if(changed){this.reset();this.core=core;this.model=model;this.view=view;}
    this.observedTick=tick;
    const pointer=typeof core.peripheral_snapshot==='function'?core.peripheral_snapshot():0;
    if(pointer&&(!this.registers||this.registers.buffer!==core.memory.buffer||this.registers.byteOffset!==pointer))
      this.registers=new Uint32Array(core.memory.buffer,pointer,6);
    // A fixture or an older diagnostic core may lack scan information. Its
    // raw frame remains available; never invent a completed scan for it.
    const registers=pointer?this.registers:null;
    const serial=registers?registers[4]+registers[5]*4294967296:null;
    const enabled=registers?Boolean(registers[0]&1):null;
    if(!force&&registers&&this.frame&&this.frame.frameSerial===serial&&this.frame.lcdEnabled===enabled)return this.frame;
    const width=core.profile(model,2),height=core.profile(model,3);
    const frameStatus=core.frame_view(view),annunciatorStatus=core.annunciators();
    this.frame={width,height,frameStatus,annunciatorStatus,
      pixels:frameStatus?null:new Uint8Array(core.memory.buffer,core.frame_buffer(),width*height).slice(),
      annunciators:annunciatorStatus?null:new Uint8Array(core.memory.buffer,core.annunciator_buffer(),6).slice(),
      frameTick:tick,frameSerial:serial,lcdEnabled:enabled};
    return this.frame;
  }
}
