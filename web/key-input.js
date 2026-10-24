// SPDX-License-Identifier: MIT
// One physical pointer owns one contact until release, cancellation or teardown.
// Keyboard/assistive activation remains a finite tap. Mapping editors omit the
// live-contact callbacks and therefore retain ordinary click selection.
export function bindCalculatorKey(element,{enabled,tap,press,release}){
  const pointers=new Set();
  const click=event=>{if(enabled()&&(!press||event.detail===0))tap();};
  const key=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();if(enabled()&&!event.repeat)tap();}};
  const down=event=>{
    if(!press||!enabled()||event.button!==0)return;
    event.preventDefault();pointers.add(event.pointerId);
    try{element.setPointerCapture(event.pointerId);}catch{}
    press(`pointer:${event.pointerId}`);
  };
  const end=(event,cancel)=>{
    if(!pointers.delete(event.pointerId))return;
    release(`pointer:${event.pointerId}`,cancel);
    try{if(element.hasPointerCapture(event.pointerId))element.releasePointerCapture(event.pointerId);}catch{}
  };
  const up=event=>end(event,false),cancel=event=>end(event,true);
  element.addEventListener('click',click);element.addEventListener('keydown',key);
  element.addEventListener('pointerdown',down);element.addEventListener('pointerup',up);
  element.addEventListener('pointercancel',cancel);element.addEventListener('lostpointercapture',cancel);
  return()=>{for(const pointer of [...pointers])end({pointerId:pointer},true);};
}
