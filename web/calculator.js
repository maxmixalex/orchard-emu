// SPDX-License-Identifier: MIT
import { CALCULATORS, identifyROM } from './catalog.js';
import { keyRows } from './hp48.js';
import { SkinView } from './skin.js';
import { MAX_SESSION_BYTES } from './session.js';
import { bindLifecycle } from './lifecycle.js';
import { AUTO_PREFIX, readPreferences, writePreferences, validatePreferences, bindings,
  keyCode, validBinding, sessionName, readAuto, writeAuto } from './preferences.js';
const $=id=>document.getElementById(id);
let storage;try{storage=window.localStorage;}catch{storage=null;}
let prefs=readPreferences(storage), draft=null;
const worker=new Worker(new URL('worker.js',import.meta.url),{type:'module'});
const skin=new SkinView($('skin-stage'),scan=>tap([scan]));
const canvas=$('lcd'),context=canvas.getContext('2d',{alpha:false});
let generation=0,selection=0,model=CALCULATORS[0],ready=false,loaded=false,running=false,stopped=false,busy=false;
let pending=null,last=null,image=null,previousPixels=null,previousInk=null,previousActive=null;
let autoTimer=null,autoToken=null,autoRequest=0,autoPending=null,autoBlocked=false,awaitingRestore=false;
let serialConnected=false,usbConnected=false,usbReady=false,linkLog='';
const writer=crypto.randomUUID(),buttons=new Map();
const modalQueue=[];let modalResolve=null;
function ask(title,message,ok='OK',cancel=null){
  return new Promise(resolve=>{modalQueue.push({title,message,ok,cancel,resolve});nextModal();});
}
function nextModal(){
  if(modalResolve||!modalQueue.length)return;
  const item=modalQueue.shift();modalResolve=item.resolve;
  $('message-title').textContent=item.title;$('message-text').textContent=item.message;
  $('message-ok').textContent=item.ok;$('message-cancel').textContent=item.cancel||'Cancel';$('message-cancel').hidden=!item.cancel;
  $('message-dialog').returnValue='';$('message-dialog').showModal();
  (item.cancel?$('message-cancel'):$('message-ok')).focus();
}
$('message-ok').onclick=()=>$('message-dialog').close('ok');
$('message-cancel').onclick=()=>$('message-dialog').close('cancel');
$('message-dialog').addEventListener('close',()=>{const resolve=modalResolve;modalResolve=null;resolve?.($('message-dialog').returnValue==='ok'?true:$('message-dialog').returnValue==='cancel'?false:null);nextModal();});
function report(error){const text=error instanceof Error?error.message:String(error);return ask('Orchard',text);}
function note(text){$('session-note').textContent=text;}
function send(type,extra={}){worker.postMessage({type,generation,...extra});}
function controls(){
  $('open').disabled=!ready||busy;$('model').disabled=!ready||busy;
  $('run').disabled=!loaded||busy||stopped;$('run').textContent=running?'Pause':'Resume';
  $('reset').disabled=!loaded||busy;$('save-session').disabled=!loaded||busy||stopped;
  $('load-session').disabled=!loaded||busy;$('connect-open').disabled=!loaded||busy;
  const enabled=loaded&&running&&!stopped&&!busy;
  skin.setEnabled(enabled&&prefs.view==='immersive');for(const b of buttons.values())b.disabled=!enabled;
  $('serial-toggle').disabled=$('usb-toggle').disabled=!loaded||busy;
  $('link-send').disabled=!loaded||busy||($('link-target').value==='serial'?!serialConnected:!usbReady);
  $('link-receive').disabled=!usbReady||busy;
}
function fit(){
  const box=$('workspace'),r=skin.stage.style.aspectRatio.split('/').map(Number),ratio=r.length===2?r[0]/r[1]:665/1340;
  const w=Math.max(120,box.clientWidth-32),h=Math.max(160,box.clientHeight-24),scale=prefs.zoom/100;
  const dpr=window.devicePixelRatio||1;
  $('calculator').style.setProperty('--case-width',`${Math.round(Math.min(w,h*ratio)*scale*dpr)/dpr}px`);
  const width=Math.min(w,500,Math.max(220,(h-90)*.85))*scale;
  $('calculator').style.setProperty('--plain-width',`${Math.round(width*dpr)/dpr}px`);
  const matrix=last?.width||131;
  const lcd=Math.max(matrix/dpr,Math.floor((width-30)*dpr/matrix)*matrix/dpr);
  $('calculator').style.setProperty('--lcd-width',`${lcd}px`);
}
function applyView(){
  document.body.dataset.view=prefs.view;$('keypad').hidden=prefs.view!=='traditional';
  previousPixels=null;fit();draw(last);controls();
}
function draw(data){
  if(!data)return;
  if(canvas.width!==data.width||canvas.height!==data.height){canvas.width=data.width;canvas.height=data.height;image=null;previousPixels=null;fit();}
  const changed=!previousPixels||previousInk!==skin.rgb.join(',')||
    (data.pixels?previousPixels.length!==data.pixels.length||data.pixels.some((p,i)=>p!==previousPixels[i]):previousPixels.some(Boolean));
  if(changed){
    image??=context.createImageData(data.width,data.height);
    for(let i=0;i<data.width*data.height;i++){
      const ink=data.pixels?data.pixels[i]/255:0;
      for(let c=0;c<3;c++)image.data[i*4+c]=Math.round(skin.rgb[c]*(1-ink)+[31,47,42][c]*ink);
      image.data[i*4+3]=255;
    }
    context.putImageData(image,0,0);previousPixels=data.pixels?.slice()||new Uint8Array(data.width*data.height);previousInk=skin.rgb.join(',');
  }
  skin.update(data.active,data.annunciators,data.annunciatorStatus,model.id);
  if(previousActive!==data.active){for(const [scan,b] of buttons)b.setAttribute('aria-pressed',String(scan===data.active));previousActive=data.active;}
}
function resetLinks(){serialConnected=usbConnected=usbReady=false;$('serial-toggle').textContent=$('usb-toggle').textContent='Connect';$('serial-status').textContent=$('usb-status').textContent='Disconnected';$('usb-info').textContent='';controls();}
function create(rom=null){
  ++generation;clearTimeout(autoTimer);autoPending=null;autoBlocked=false;autoToken=null;awaitingRestore=false;
  pending=rom;loaded=running=stopped=false;last=null;previousPixels=null;previousActive=null;note('');resetLinks();
  $('model').value=String(model.id);$('boot-help').textContent=model.help;
  buttons.clear();$('keypad').replaceChildren();
  for(const row of keyRows(model.id)){
    const line=document.createElement('div');line.className='key-row';line.style.gridTemplateColumns=`repeat(${row.length},minmax(0,1fr))`;
    for(const [label,scan] of row){const b=document.createElement('button');b.textContent=label;b.type='button';b.setAttribute('aria-label',`Calculator ${label}`);b.setAttribute('aria-pressed','false');
      b.onclick=event=>{tap([scan]);if(event.detail>0)$('calculator').focus({preventScroll:true});};line.append(b);buttons.set(scan,b);}
    $('keypad').append(line);
  }
  const token=generation;
  skin.show(model.id).then(()=>{if(token===generation){applyView();draw(last);}}).catch(()=>{
    if(token!==generation)return;prefs={...prefs,view:'traditional'};skin.glass.hidden=false;applyView();report('The skin could not load. Traditional view is available.');
  });
  applyView();$('status').textContent=rom?'Opening…':'No ROM';
  send('create',{model:model.id,preset:model.preset,audience:'calculator'});send('configure',{speed:prefs.speed});
}
async function openFile(file){
  if(!file)return;
  if(loaded){send('pause');if(!await ask('Open ROM','Replace the current calculator memory?','Open','Cancel'))return;}
  const token=++selection;busy=true;send('pause');controls();$('status').textContent='Opening…';
  try{
    if(!CALCULATORS.some(c=>c.bytes===file.size))throw new Error('Choose a complete 1 MB or 2 MB ROM, not a ZIP or firmware update.');
    const rom=await file.arrayBuffer(),identified=await identifyROM(rom);if(token!==selection)return;model=identified;create(rom);
  }catch(e){if(token===selection){busy=false;report(e);controls();}}
}
function mayRun(){return !document.hidden&&(!prefs.pauseOnBlur||document.hasFocus());}
async function loadedROM(){
  const token=generation;awaitingRestore=true;
  try{
    const saved=prefs.autosave&&storage?readAuto(storage,model.hash):null;autoToken=saved?.token??null;
    if(saved){
      const restore=await ask('Restore local save?',`${model.name} · ${new Date(saved.savedAt).toLocaleString()}`,'Restore','Start new');
      if(token!==generation)return;
      if(restore===null){awaitingRestore=false;autoBlocked=true;note('Local save kept');controls();return;}
      if(restore){busy=true;controls();send('checkpoint-load',{file:saved.file.buffer});return;}
    }
    awaitingRestore=false;if(mayRun())send('run');scheduleAuto();
  }catch(e){if(token===generation){autoBlocked=true;awaitingRestore=false;report('Local save could not be read. Delete it in Settings or restore an exported file.');if(mayRun())send('run');}}
}
function scheduleAuto(delay=prefs.interval*1000){
  clearTimeout(autoTimer);autoTimer=null;
  if(prefs.autosave&&loaded&&!autoBlocked&&!awaitingRestore)autoTimer=setTimeout(()=>requestAuto(),delay);
}
function requestAuto(){
  if(!prefs.autosave||!storage||!loaded||busy||stopped||autoBlocked||awaitingRestore){scheduleAuto();return;}
  if(autoPending)return;
  autoPending={request:++autoRequest,generation,model:model.id,hash:model.hash};send('checkpoint-auto',{request:autoRequest});
}
async function acceptAuto(data){
  const request=autoPending;if(!request||request.request!==data.request||request.generation!==generation)return;
  try{
    const put=()=>{
      if(!prefs.autosave||request.generation!==generation||autoPending!==request)return;
      autoToken=writeAuto(storage,request.hash,request.model,data.file,autoToken,`${writer}:${request.request}`);
      note(`Saved ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`);
    };
    if(navigator.locks)await navigator.locks.request('orchard-autosave:'+request.hash,put);else put();
  }catch(e){autoBlocked=true;note('Automatic save stopped');report(e instanceof DOMException&&e.name==='QuotaExceededError'?'Device storage is full. Export a session or delete old local saves.':e);}
  finally{if(autoPending===request){autoPending=null;scheduleAuto();}}
}
worker.onmessage=({data})=>{
  if(data.type==='ready'){ready=true;create();return;}
  if(data.type==='fatal'){ready=loaded=running=false;busy=false;report('The calculator could not start. Reload and try again.');controls();return;}
  if(data.generation!==generation)return;
  if(data.type==='created'){
    if(pending){const rom=pending;pending=null;worker.postMessage({type:'load',generation,rom},[rom]);}
    else{busy=false;controls();}
  }else if(data.type==='loaded'){loaded=true;busy=false;controls();loadedROM();}
  else if(data.type==='checkpoint-auto-saved')acceptAuto(data);
  else if(data.type==='checkpoint-skipped'){autoPending=null;scheduleAuto(5000);}
  else if(data.type==='autosave-error'){autoPending=null;autoBlocked=true;note('Automatic save stopped');report(data.message);}
  else if(data.type==='checkpoint-saved'){
    autoPending=null;busy=false;running=false;controls();
    const url=URL.createObjectURL(new Blob([data.file],{type:'application/octet-stream'})),a=document.createElement('a');
    a.href=url;a.download=sessionName(model.id);document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);note('Session exported');scheduleAuto();
  }else if(data.type==='checkpoint-restored'){autoPending=null;busy=false;running=false;awaitingRestore=false;controls();note('Restored · press Resume');scheduleAuto();}
  else if(data.type==='snapshot'){
    const wasStopped=stopped;last=data;loaded=data.loaded;running=data.running;stopped=data.stopped;draw(data);controls();
    $('status').textContent=stopped?'Stopped':busy?'Opening…':!loaded?'No ROM':running?'Running':'Paused';
    if(stopped&&!wasStopped)report('A compatibility issue stopped the calculator. Save your earlier work or restart.');
  }else if(data.type==='error'){if(awaitingRestore)autoBlocked=true;autoPending=null;busy=false;running=false;awaitingRestore=false;report(data.message||'The operation failed.');controls();scheduleAuto();}
  else if(data.type==='links-reset')resetLinks();
  else if(data.type==='serial-status'){serialConnected=data.connected;$('serial-toggle').textContent=serialConnected?'Disconnect':'Connect';$('serial-status').textContent=serialConnected?'Connected · virtual byte stream':'Disconnected';controls();}
  else if(data.type==='uart-output')logBytes('Serial RX',data.bytes);
  else if(data.type==='uart-sent')log(`${data.accepted}/${data.requested} serial bytes accepted${data.accepted<data.requested?' — resend only the remainder':''}`);
  else if(data.type==='usb-status'){
    usbConnected=data.connected;usbReady=data.phase==='Connected';$('usb-toggle').textContent=usbConnected?'Disconnect':'Connect';$('usb-status').textContent=data.error||data.phase;
    if(data.info){const info=data.info;$('usb-info').textContent=[info.manufacturer,info.name,`${info.vendor.toString(16).padStart(4,'0')}:${info.product.toString(16).padStart(4,'0')}`,`${info.endpoints.length} endpoints`].filter(Boolean).join(' · ');}
    else if(!usbConnected)$('usb-info').textContent='';controls();
  }else if(data.type==='usb-packet'){if(data.bytes?.length)logBytes('USB RX',data.bytes);log(`USB ${data.direction}: ${data.status}${data.accepted!==undefined?' · '+data.accepted+' bytes':''}`);}
};
worker.onerror=()=>{ready=loaded=running=false;busy=false;report('The calculator stopped unexpectedly. Reload to restart it.');controls();};
function tap(scans){if(loaded&&running&&!stopped&&!busy)send('tap-sequence',{scans});}
$('open').onclick=()=>{$('rom').value='';$('rom').click();};$('rom').onchange=()=>openFile($('rom').files[0]);
$('model').onchange=async()=>{
  const selected=Number($('model').value);$('model').value=String(model.id);
  if(loaded){send('pause');if(!await ask('Switch calculator','Replace the current calculator memory?','Switch','Cancel'))return;}
  ++selection;model=CALCULATORS.find(c=>c.id===selected);busy=false;create();
};
$('run').onclick=()=>{send(running?'pause':'run');if(running)setTimeout(requestAuto,0);$('calculator').focus({preventScroll:true});};
$('reset').onclick=async()=>{send('pause');if(await ask('Restart calculator','Clear current memory? Exported session files will not be deleted.','Restart','Cancel')){autoPending=null;send('reset');send('configure',{speed:prefs.speed});send('run');}};
window.addEventListener('keydown',event=>{
  if(event.repeat||event.isComposing||document.querySelector('dialog[open]')||event.target.closest('input,select,textarea,[contenteditable="true"]'))return;
  if(event.target.closest('button,[role="button"]')&&(event.key==='Enter'||event.key===' '))return;
  const code=keyCode(event),sequence=code?bindings(prefs,model.id)[code]:null;
  if(!sequence?.length||!loaded||!running||busy)return;event.preventDefault();tap(sequence);
});
bindLifecycle(window,document,()=>{if(loaded)send('pause');},{preferences:()=>prefs,release:()=>{if(loaded)send('release');},save:()=>{if(prefs.autosave)setTimeout(requestAuto,0);}});
window.addEventListener('storage',event=>{
  if(event.key===AUTO_PREFIX+model.hash&&loaded&&prefs.autosave){autoBlocked=true;autoPending=null;clearTimeout(autoTimer);note('Local save changed in another tab');}
});
new ResizeObserver(fit).observe($('workspace'));window.addEventListener('resize',fit);
$('help').onclick=()=>{const open=$('help').parentElement.classList.toggle('open');$('help').setAttribute('aria-expanded',String(open));};
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
$('save-session').onclick=()=>{if(!loaded||busy)return;autoPending=null;busy=true;controls();send('checkpoint-save');};
$('load-session').onclick=()=>{$('session-file').value='';$('session-file').click();};
$('session-file').onchange=async()=>{
  const file=$('session-file').files[0];if(!file||!loaded||busy)return;
  send('pause');if(!await ask('Restore session','Replace the current calculator memory?','Restore','Cancel'))return;
  busy=true;autoPending=null;controls();const token=generation;
  try{if(file.size>MAX_SESSION_BYTES)throw new Error('This session file is too large.');
    const bytes=await file.arrayBuffer();if(token!==generation)return;worker.postMessage({type:'checkpoint-load',generation,file:bytes},[bytes]);
  }catch(e){if(token===generation){busy=false;report(e);controls();}}
};
// Settings use a draft; Cancel never applies partial edits.
function setTab(name){for(const b of document.querySelectorAll('[data-tab]'))b.setAttribute('aria-pressed',String(b.dataset.tab===name));for(const p of document.querySelectorAll('[data-panel]'))p.hidden=p.dataset.panel!==name;}
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>setTab(b.dataset.tab);
$('settings-open').onclick=()=>{
  draft=validatePreferences(prefs);$('view-mode').value=draft.view;$('zoom').value=draft.zoom;$('zoom-value').value=draft.zoom+'%';
  $('pause-blur').checked=draft.pauseOnBlur;$('pause-hidden').checked=draft.pauseOnHidden;$('speed').value=String(draft.speed);
  $('autosave').checked=draft.autosave;$('auto-interval').value=String(draft.interval);$('binding-error').textContent='';
  $('mapping-model').textContent=model.name;$('storage-status').textContent=storage?'ROMs are never stored.':'Device storage is unavailable.';
  rebuildBindings();setTab('general');$('settings-dialog').showModal();
};
$('zoom').oninput=()=>{$('zoom-value').value=$('zoom').value+'%';};
function step(scan=6){
  const row=document.createElement('div');row.className='binding-step';const select=document.createElement('select');select.setAttribute('aria-label','Calculator key');
  for(const [label,value] of keyRows(model.id).flat()){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}select.value=String(scan);
  const remove=document.createElement('button');remove.type='button';remove.textContent='−';remove.setAttribute('aria-label','Remove step');remove.onclick=()=>row.remove();row.append(select,remove);$('binding-steps').append(row);
}
function editBinding(code){$('binding-code').value=code||'';$('binding-steps').replaceChildren();for(const scan of bindings(draft,model.id)[code]||[6])step(scan);}
function rebuildBindings(selected=null){
  const list=$('binding-list');list.replaceChildren();const names=new Map(keyRows(model.id).flat().map(([n,s])=>[s,n]));
  for(const [code,seq] of Object.entries(bindings(draft,model.id)).sort(([a],[b])=>a.localeCompare(b))){const o=document.createElement('option');o.value=code;o.textContent=code+' — '+(seq.map(s=>names.get(s)).join(' → ')||'Unassigned');list.append(o);}
  if(selected)list.value=selected;editBinding(list.value);
}
$('binding-list').onchange=()=>editBinding($('binding-list').value);
$('binding-new').onclick=()=>{editBinding(null);$('binding-code').focus();};
$('binding-code').onkeydown=event=>{if(event.key==='Tab')return;event.preventDefault();event.stopPropagation();const code=keyCode(event);if(code)$('binding-code').value=code;};
$('step-add').onclick=()=>{if($('binding-steps').children.length<8)step();};
$('binding-apply').onclick=()=>{
  const code=$('binding-code').value,seq=[...$('binding-steps').querySelectorAll('select')].map(s=>Number(s.value));
  if(!validBinding(code,seq)){$('binding-error').textContent='Capture a key and choose up to eight calculator taps.';return;}
  (draft.mappings[model.id]??={})[code]=seq;$('binding-error').textContent='';rebuildBindings(code);
};
$('binding-delete').onclick=()=>{const code=$('binding-list').value;if(code){(draft.mappings[model.id]??={})[code]=[];rebuildBindings(code);}};
$('binding-defaults').onclick=()=>{draft.mappings[model.id]={};rebuildBindings();};
$('settings-form').onsubmit=event=>{
  event.preventDefault();const oldAuto=prefs.autosave;
  try{
    prefs=validatePreferences({...draft,view:$('view-mode').value,zoom:Number($('zoom').value),pauseOnBlur:$('pause-blur').checked,pauseOnHidden:$('pause-hidden').checked,speed:Number($('speed').value),autosave:$('autosave').checked,interval:Number($('auto-interval').value)});
    try{writePreferences(storage,prefs);}catch{report('Settings apply to this tab, but could not be stored on this device.');}
    send('configure',{speed:prefs.speed});applyView();$('settings-dialog').close();
    if(!oldAuto&&prefs.autosave){autoBlocked=false;autoToken=storage?readAuto(storage,model.hash)?.token??null:null;}
    if(!prefs.autosave)autoPending=null;scheduleAuto();
  }catch(e){report(e);}
};
$('clear-local').onclick=async()=>{
  if(!await ask('Delete local saves','Delete automatically saved calculator memory on this device? Exported files are kept.','Delete','Cancel'))return;
  try{autoPending=null;for(const key of Object.keys(storage||{}))if(key.startsWith(AUTO_PREFIX))storage.removeItem(key);autoToken=null;autoBlocked=false;$('storage-status').textContent='Local saves deleted';scheduleAuto();}
  catch(e){report(e);}
};
// Connection state belongs to the Worker. UI only supplies/transcribes bytes.
function log(text){linkLog+=(text+'\n');if(linkLog.length>32768)linkLog='[Earlier data omitted]\n'+linkLog.slice(-30000);$('link-log').textContent=linkLog;$('link-log').scrollTop=$('link-log').scrollHeight;}
function logBytes(label,bytes){log(label+'  '+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(' '));}
$('connect-open').onclick=()=>{$('connection-dialog').showModal();controls();};
$('serial-toggle').onclick=()=>send('serial-connect',{connected:!serialConnected});
$('usb-toggle').onclick=()=>{if(!running&&!usbConnected){report('Resume the calculator and open its USB transfer screen before connecting.');return;}send('usb-connect',{connected:!usbConnected});};
$('link-target').onchange=controls;
$('link-send').onclick=()=>{
  try{
    const value=$('link-input').value;let bytes;
    if($('link-format').value==='hex'){
      const text=value.trim();if(text&&!/^[a-f0-9]{2}(?:\s+[a-f0-9]{2})*$/i.test(text))throw new Error('Use pairs of hexadecimal digits separated by spaces.');
      bytes=text?Uint8Array.from(text.split(/\s+/),n=>parseInt(n,16)):new Uint8Array();
    }else bytes=new TextEncoder().encode(value);
    const usb=$('link-target').value==='usb',limit=usb?64:512;
    if(bytes.length>limit)throw new Error(`Send at most ${limit} bytes at a time.`);
    send(usb?'usb-send':'uart',{bytes});
  }catch(e){report(e);}
};
$('link-receive').onclick=()=>send('usb-read');$('link-clear').onclick=()=>{linkLog='';$('link-log').textContent='';};
applyView();controls();
