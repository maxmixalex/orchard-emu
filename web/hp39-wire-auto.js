// SPDX-License-Identifier: MIT
// Optional physical-key continuation between separately acknowledged Wire
// objects. This does not extend the one-object stock Wire protocol or bypass
// a guest dialog. Fingerprints cover stock UI chrome, never object contents.
function fingerprint(pixels,x,y,width,height){
  let value=2166136261;
  for(let row=y;row<y+height;row++)for(let col=x;col<x+width;col++)value=Math.imul(value^(pixels[row*131+col]>=128?1:0),16777619)>>>0;
  return value;
}
const catalogHeaders=new Set([0xfc7caa87,0x43df1287]);
const menus={1:{box:[17,8,95,39],initial:0x8e014693,target:0xe2e94695},2:{box:[17,4,95,48],initial:0x77b39b9d,target:0xe46fdce3}};
function hasDialogBorder(pixels){
  const edge=(x,y)=>y>=8&&y<55&&[x-1,x,x+1].some(col=>pixels[y*131+col]>=128);
  for(let y=8;y<55;y++){
    let start=-1;
    for(let x=0;x<=131;x++){
      if(x<131&&pixels[y*131+x]>=128){if(start<0)start=x;}
      else if(start>=0){
        if(start>8&&x<124&&x-start>=65&&[-1,1].some(direction=>
          Array.from({length:12},(_,i)=>y+direction*(i+1)).every(row=>edge(start,row)&&edge(x-1,row))))return true;
        start=-1;
      }
    }
  }
  return false;
}
export function recognizeHp39WireScreen({width,height,pixels,lcdEnabled},model){
  if(![1,2].includes(model)||width!==131||height!==64||!(pixels instanceof Uint8Array)||pixels.length!==131*64||lcdEnabled===false)return null;
  const menu=menus[model],hash=fingerprint(pixels,...menu.box);
  if(hash===menu.initial)return 'receive-initial';
  if(hash===menu.target)return 'receive-wire';
  if(catalogHeaders.has(fingerprint(pixels,40,0,72,8))&&fingerprint(pixels,88,56,21,8)===0xce2735dc&&!hasDialogBorder(pixels))return 'aplet-catalog';
  return null;
}
export class Hp39WireAutoReceive{
  constructor({model,transport='usb',previousKind,kind,recognize=recognizeHp39WireScreen,hz=12000000}){
    this.model=model;this.recognize=recognize;this.hz=hz;this.stage='catalog';this.started=null;this.seen=null;this.seenAt=0;
    this.active=[1,2].includes(model)&&transport==='usb'&&['B','H'].includes(previousKind)&&['B','H'].includes(kind);
  }
  cancel(){this.active=false;}
  observe(frame){
    if(!this.active)return null;
    if(!frame.running||frame.stopped||!Number.isFinite(frame.tick)){this.cancel();return null;}
    if(this.started===null)this.started=frame.tick;
    if(frame.tick<this.started||frame.tick-this.started>30*this.hz){this.cancel();return null;}
    if(frame.pending||frame.active!==null&&frame.active!==undefined){this.seen=null;return null;}
    const screen=this.recognize(frame,this.model);
    if(screen!==this.seen){this.seen=screen;this.seenAt=frame.tick;return null;}
    // Require repeated stable observations after the last key release. Host
    // refresh rate and Unlimited do not change this guest-time guard.
    if(!screen||frame.tick-this.seenAt<this.hz/10)return null;
    let scan=null;
    if(this.stage==='catalog'&&screen==='aplet-catalog'){scan=39;this.stage='menu';}
    else if(this.stage==='menu'&&screen==='receive-initial'){scan=44;this.stage='wire';}
    else if(['menu','wire'].includes(this.stage)&&screen==='receive-wire'){scan=6;this.stage='done';this.cancel();}
    if(scan===null)return null;
    this.seen=null;return [scan];
  }
}
