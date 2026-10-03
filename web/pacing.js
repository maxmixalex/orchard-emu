// SPDX-License-Identifier: MIT
// Wall time controls how much deterministic guest work may run, never device
// register values. No catch-up burst after suspension, dialogs or rate changes.
export class Pacer {
  constructor(hz=12000000){if(!Number.isFinite(hz)||hz<=0)throw new Error('Invalid timebase');this.hz=hz;this.speed=1;this.reset(0);}
  reset(now){this.last=now;this.credit=0;}
  setSpeed(speed,now){if(![0,0.5,1,2].includes(speed))throw new Error('Invalid speed');this.speed=speed;this.reset(now);}
  available(now,cap=4096){
    if(!Number.isFinite(now)||!Number.isSafeInteger(cap)||cap<0)throw new Error('Invalid pacing input');
    const elapsed=Math.max(0,Math.min(50,now-this.last));this.last=now;
    if(this.speed===0)return cap;
    const rate=this.hz*this.speed/1000;
    this.credit=Math.min(this.credit+elapsed*rate,rate*50);
    return Math.min(cap,Math.floor(this.credit));
  }
  consume(ticks){if(!Number.isSafeInteger(ticks)||ticks<0)throw new Error('Invalid pacing input');if(this.speed)this.credit=Math.max(0,this.credit-ticks);}
  delay(){return this.speed?Math.max(1,Math.min(8,Math.ceil((256-this.credit)*1000/(this.hz*this.speed)))):0;}
}
