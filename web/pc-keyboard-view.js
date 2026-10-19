// SPDX-License-Identifier: MIT
// ANSI 104-key geometry in key units. Codes describe physical keys, not text.
import {PC_DISPLAY} from './pc-keyboard.js';
const keys=[];
const add=(id,token,x,y,w=1,h=1)=>keys.push(Object.freeze({id,token,x,y,w,h}));
const row=(y,items)=>{let x=0;for(const item of items){const [id,token,w]=typeof item==='string'?[item,item,1]:item;add(id,token,x,y,w);x+=w;}};
add('Escape','Escape',0,0);
for(let i=1;i<=12;i++)add(`F${i}`,`F${i}`,2+(i-1)+Math.floor((i-1)/4)*.5,0);
row(1.5,['Backquote',...Array.from({length:9},(_,i)=>`Digit${i+1}`),'Digit0','Minus','Equal',['Backspace','Backspace',2]]);
row(2.5,[['Tab','Tab',1.5],...'QWERTYUIOP'.split('').map(c=>'Key'+c),'BracketLeft','BracketRight',['Backslash','Backslash',1.5]]);
row(3.5,[['CapsLock','CapsLock',1.75],...'ASDFGHJKL'.split('').map(c=>'Key'+c),'Semicolon','Quote',['Enter','Enter',2.25]]);
row(4.5,[['ShiftLeft','{Shift}',2.25],...'ZXCVBNM'.split('').map(c=>'Key'+c),'Comma','Period','Slash',['ShiftRight','{Shift}',2.75]]);
row(5.5,[['ControlLeft','{Ctrl}',1.25],['MetaLeft','{Meta}',1.25],['AltLeft','{Alt}',1.25],['Space','Space',6.25],['AltRight','{Alt}',1.25],['MetaRight','{Meta}',1.25],['ContextMenu','ContextMenu',1.25],['ControlRight','{Ctrl}',1.25]]);
for(const [y,tokens] of [[0,['PrintScreen','ScrollLock','Pause']],[1.5,['Insert','Home','PageUp']],[2.5,['Delete','End','PageDown']],[5.5,['ArrowLeft','ArrowDown','ArrowRight']]])tokens.forEach((t,i)=>add(t,t,15.5+i,y));
add('ArrowUp','ArrowUp',16.5,4.5);
for(const [y,tokens] of [[1.5,['NumLock','NumpadDivide','NumpadMultiply','NumpadSubtract']],[2.5,['Numpad7','Numpad8','Numpad9']],[3.5,['Numpad4','Numpad5','Numpad6']],[4.5,['Numpad1','Numpad2','Numpad3']]])tokens.forEach((t,i)=>add(t,t,19+i,y));
add('NumpadAdd','NumpadAdd',22,2.5,1,2);add('NumpadEnter','NumpadEnter',22,4.5,1,2);
add('Numpad0','Numpad0',19,5.5,2);add('NumpadDecimal','NumpadDecimal',21,5.5);
export const PC_KEYS=Object.freeze(keys);
export const PC_SIZE=Object.freeze({width:23,height:6.5});
const DISPLAY={...PC_DISPLAY,PrintScreen:'PrtSc',ScrollLock:'Scroll',Pause:'Pause',NumLock:'Num',ContextMenu:'Menu','{Meta}':'Win / ⌘'};
export class PCKeyboardView {
  constructor(host,choose){
    this.host=host;this.buttons=[];host.classList.add('pc-physical');
    for(const key of PC_KEYS){
      const b=document.createElement('button');b.type='button';b.className='pc-physical-key';b.dataset.code=key.id;b.dataset.token=key.token;
      b.textContent=DISPLAY[key.token]||key.token;
      b.setAttribute('aria-label',key.id);b.setAttribute('aria-pressed','false');
      const unit=(n,d)=>`${n/d*100}%`;
      Object.assign(b.style,{left:unit(key.x,23),top:unit(key.y,6.5),width:`calc(${unit(key.w,23)} - 4px)`,height:`calc(${unit(key.h,6.5)} - 4px)`});
      b.addEventListener('click',()=>choose(key.token));this.buttons.push(b);host.append(b);
    }
  }
  update(selected,modifiers=[]){
    for(const b of this.buttons){const token=b.dataset.token,modifier=token.startsWith('{'),pressed=modifier?modifiers.includes(token.slice(1,-1)):token===selected;
      b.classList.toggle('pc-selected',pressed&&!modifier);b.classList.toggle('pc-modifier',pressed&&modifier);b.setAttribute('aria-pressed',String(pressed));}
  }
  destroy(){this.host.replaceChildren();this.host.classList.remove('pc-physical');this.buttons=[];}
}
