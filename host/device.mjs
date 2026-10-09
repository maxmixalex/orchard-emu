// SPDX-License-Identifier: MIT
// USB URBs translated into transactions on the guest-owned device controller.
// Does not synthesize descriptors, acknowledge a NAK or execute guest code.
import {VirtualUSB} from '../web/virtual-usb.js';
export const ERR={INVALID:-22,UNSUPPORTED:-95,PIPE:-32,IO:-5,TIMEOUT:-110,OVERFLOW:-75,SHORT:-121};
const EMPTY=new Uint8Array();
export class GuestUSBDevice {
  constructor(core, hz=core.timebase_hz()) {
    this.core=core;this.hz=hz;this.tick=0;this.jobs=new Map();this.available=false;
    this.host=new VirtualUSB(core,hz,status=>{
      if(status.error)this.error=status.error;
      if(status.phase==='Connected'){
        this.device=this.host.device.slice();this.config=this.host.config.slice();
        this.available=true;this.error=null;
      }else this.available=false;
    });
  }
  start(tick) {this.cancelAll();this.error=null;this.available=false;this.tick=tick;this.host.start(tick);}
  detach() {this.cancelAll();this.available=false;this.host.disconnect();}
  cancelAll(){this.jobs.clear();}
  unlink(seq){return this.jobs.delete(seq);}
  submit(request, done) {
    const {seq,ep,direction,length,flags,setup,data}=request;
    if(!this.available||this.jobs.size>=64||this.jobs.has(seq))return false;
    const fail=status=>{done({seq,direction,status,length:0,data:EMPTY});return true;};
    if(!Number.isInteger(ep)||ep<0||ep>4||![0,1].includes(direction)||!Number.isInteger(length)||length<0||length>65536)return fail(ERR.INVALID);
    // Non-ISO host memory-management flags do not alter USB wire semantics.
    if(flags&~(1|4|0x40|0x80|0x100|0x200|0xff0000))return fail(ERR.UNSUPPORTED);
    const job={...request,done,position:0,received:[],toggle:1,stage:ep===0?'setup':'data',deadline:this.tick+5*this.hz,zlp:false};
    if(ep===0){
      if(!(setup instanceof Uint8Array)||setup.length!==8)return fail(ERR.INVALID);
      const n=setup[6]|setup[7]<<8;
      if(n!==length||(n>0&&Boolean(setup[0]&128)!==Boolean(direction)))return fail(ERR.INVALID);
      job.maxPacket=this.host.mps;
    }else{
      const endpoint=this.host.info.endpoints.find(e=>e.address===(ep|(direction?128:0)));
      if(!endpoint||endpoint.type!==2||endpoint.maxPacket>64)return fail(ERR.UNSUPPORTED);
      job.maxPacket=endpoint.maxPacket;
    }
    if(direction===0&&(!(data instanceof Uint8Array)||data.length!==length))return fail(ERR.INVALID);
    this.jobs.set(seq,job);return true;
  }
  complete(job,status=0){
    if(!this.jobs.delete(job.seq))return;
    const data=Uint8Array.from(job.received);
    job.done({seq:job.seq,direction:job.direction,status,length:job.position,data});
  }
  poll(tick){
    this.tick=tick;this.host.poll(tick);
    if(!this.available)return;
    const visited=new Set();
    for(const job of [...this.jobs.values()]){
      const lane=job.ep===0?'control':`${job.ep}:${job.direction}`;
      if(visited.has(lane))continue;visited.add(lane);
      if(tick>=job.deadline){this.complete(job,ERR.TIMEOUT);continue;}
      try{this.transaction(job);}catch{this.complete(job,ERR.IO);}
    }
  }
  transaction(j){
    let result, packet;
    if(j.stage==='setup'){
      result=this.host.out(0,true,0,j.setup);
      if(result===0)j.stage=j.length?'data':(j.setup[0]&128?'status-out':'status-in');
    }else if(j.stage==='status-in'){
      packet=this.host.receive(0);result=packet.result;
      if(!result){
        if(packet.bytes.length||packet.pid!==1){this.complete(j,ERR.IO);return;}
        this.controlComplete(j);
      }
    }else if(j.stage==='status-out'){
      result=this.host.out(0,false,1,EMPTY);if(!result)this.controlComplete(j);
    }else if(j.direction===1){
      packet=this.host.receive(j.ep);result=packet.result;
      if(!result){
        if(j.ep===0&&packet.pid!==j.toggle){this.complete(j,ERR.IO);return;}
        if(packet.bytes.length>j.maxPacket||packet.bytes.length>j.length-j.position){this.complete(j,ERR.OVERFLOW);return;}
        j.toggle^=1;j.received.push(...packet.bytes);j.position+=packet.bytes.length;
        const short=packet.bytes.length<j.maxPacket;
        if(j.position===j.length||short){
          if(j.ep===0){j.stage='status-out';j.short=short&&j.position<j.length;}
          else this.complete(j,short&&j.position<j.length&&(j.flags&1)?ERR.SHORT:0);
        }
      }
    }else{
      const pid=j.ep===0?j.toggle:(this.host.toggles.get(j.ep)||0);
      const bytes=j.data.subarray(j.position,Math.min(j.position+j.maxPacket,j.length));
      result=this.host.out(j.ep,false,pid,bytes);
      if(!result){
        if(j.ep===0)j.toggle^=1;else this.host.toggles.set(j.ep,pid^1);
        j.position+=bytes.length;
        if(j.position===j.length){
          if(j.ep===0)j.stage='status-in';
          else if(!j.zlp&&j.length>0&&j.length%j.maxPacket===0&&(j.flags&0x40))j.zlp=true;
          else this.complete(j);
        }
      }
    }
    // ACK, NAK and lack of response are not interchangeable. Keep a NAK pending.
    if(result!==undefined&&![0,1,3].includes(result))this.complete(j,result===2?ERR.PIPE:result===5?ERR.UNSUPPORTED:ERR.IO);
  }
  controlComplete(j){
    const s=j.setup,value=s[2]|s[3]<<8,index=s[4]|s[5]<<8;
    if(s[0]===0&&s[1]===5&&value<128)this.host.address=value;
    if(s[0]===0&&s[1]===9)this.host.toggles.clear();
    if(s[0]===2&&s[1]===1&&value===0)this.host.toggles.set(index & 15,0);
    this.complete(j,j.short&&(j.flags&1)?ERR.SHORT:0);
  }
}
