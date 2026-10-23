// SPDX-License-Identifier: MIT
// Explicit WASM wire layout; no JavaScript view survives memory growth.
export class BuzzerStream {
  constructor(core){this.core=core;this.enabled=false;}
  configure(enabled){
    if(typeof enabled!=='boolean')throw Error('Invalid sound setting.');
    if(enabled===this.enabled)return;
    if(this.core.buzzer_enable(Number(enabled)))throw Error('Unable to configure the firmware buzzer.');
    this.enabled=enabled;
  }
  clear(){if(this.enabled)this.core.buzzer_clear();}
  packet(){
    if(!this.enabled)return null;
    const pointer=this.core.buzzer_drain();if(!pointer)return null;
    const header=new Uint32Array(this.core.memory.buffer,pointer,8);
    const count=header[0];if(count>4096)throw Error('Invalid buzzer queue.');
    const words=new Uint32Array(this.core.memory.buffer,pointer+32,count*3);
    const edges=new Float64Array(count*2);
    for(let i=0;i<count;i++){edges[i*2]=words[i*3]+words[i*3+1]*4294967296;edges[i*2+1]=words[i*3+2];}
    return {tick:header[1]+header[2]*4294967296,epoch:header[3],overflow:header[4],level:header[5],timebase:header[7],edges};
  }
}
