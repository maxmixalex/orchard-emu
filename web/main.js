// SPDX-License-Identifier: MIT
import { KEY_ROWS, shortcut } from './hp48.js';
const $=id=>document.getElementById(id), hex=n=>n.toString(16).padStart(8,'0');
const count=(lo,hi)=>(BigInt(hi)<<32n)|BigInt(lo);
const worker=new Worker(new URL('worker.js',import.meta.url),{type:'module'});
let generation=0,ready=false,machineReady=false,loaded=false,running=false,stopped=false,busy=false;
let current=null,currentFile=null,fingerprint='',uartText='';
const canvas=$('lcd'),context=canvas.getContext('2d',{alpha:false});
const regs=Array.from({length:16},(_,i)=>{
  const item=document.createElement('div'),name=document.createElement('dt'),value=document.createElement('dd');
  name.textContent=i===13?'SP · r13':i===14?'LR · r14':i===15?'PC · r15':`r${i}`;
  value.textContent='00000000';item.append(name,value);$('registers').append(item);return value;
});
const keyButtons=new Map();
for(const row of KEY_ROWS){
  const node=document.createElement('div');node.className='key-row';node.style.gridTemplateColumns=`repeat(${row.length},minmax(0,1fr))`;
  for(const [label,scan] of row){
    const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.scan=String(scan);b.disabled=true;
    b.setAttribute('aria-label',`Calculator ${label}`);b.setAttribute('aria-pressed','false');
    b.addEventListener('click',event=>{tap(scan);if(event.detail>0)$('calculator').focus({preventScroll:true});});
    node.append(b);keyButtons.set(scan,b);
  }$('keypad').append(node);
}
function message(type,extra={}){worker.postMessage({type,generation,...extra});}
function error(text){$('error').textContent=text;$('error').hidden=!text;}
function controls(){
  $('model').disabled=$('preset').disabled=!ready;
  $('preset').querySelector('[value="hp48-home"]').disabled=$('model').value!=='4';
  $('rom').disabled=!ready||!machineReady||busy;
  $('run').disabled=!loaded||stopped||busy;$('run').textContent=running?'Pause':'Run';
  $('step').disabled=!loaded||stopped||running||busy;$('reset').disabled=!loaded||busy;
  $('export').disabled=!loaded||!current||running||busy;$('view').disabled=!machineReady;
  $('uart-input').disabled=$('uart-send').disabled=!loaded||busy;
  const playable=loaded&&running&&!stopped&&$('preset').value==='hp48-home';
  for(const button of keyButtons.values())button.disabled=!playable;
  $('release').disabled=!playable;
}
function recreate(){
  ++generation;machineReady=false;loaded=false;running=false;stopped=false;busy=false;current=null;fingerprint='';uartText='';
  $('uart-log').textContent='No guest output.';$('digest').textContent='No ROM loaded';$('filename').textContent=currentFile?.name||'No file selected';
  $('status').textContent='Initializing…';error('');
  const experiment=$('preset').value==='hp48-home';
  $('setup-note').textContent=experiment?'Explicit experiment: SST39VF1601, 256 KiB SRAM with bank1 mirroring, weak GPIO bias, ADC codes 1023/512, counted LCD +0x68 idle-zero, packed-LSB view. Changing setup clears RAM.':'Strict mode does not assume missing hardware behavior. Changing setup cold-resets the machine; RAM is not saved.';
  $('view').value=experiment?'1':'0';$('machine-title').textContent=$('model').selectedOptions[0].textContent;
  for(const button of keyButtons.values())button.setAttribute('aria-pressed','false');
  controls();message('create',{model:Number($('model').value),preset:$('preset').value});
}
async function loadFile(token,size){
  const file=currentFile;if(!file)return;
  busy=true;controls();
  try{
    if(file.size!==size)throw new Error(`Expected exactly ${size.toLocaleString()} bytes of complete physical NOR, not an updater or Saturn image.`);
    const rom=await file.arrayBuffer(), digest=await crypto.subtle.digest('SHA-256',rom);
    if(token!==generation)return;
    fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    $('digest').textContent=fingerprint;
    worker.postMessage({type:'load',generation,rom},[rom]);
  }catch(e){if(token===generation){busy=false;error(String(e.message||e));controls();}}
}
function draw(pixels,width,height){
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const img=context.createImageData(width,height);
  for(let i=0;i<width*height;++i){const ink=pixels?pixels[i]/255:0;img.data[i*4]=227-190*ink;img.data[i*4+1]=232-188*ink;img.data[i*4+2]=222-189*ink;img.data[i*4+3]=255;}
  context.putImageData(img,0,0);
}
function appendUart(bytes){
  if(!bytes.length)return;
  uartText+=`${Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(' ')}\n`;
  if(uartText.length>16384)uartText=`[Earlier log truncated]\n${uartText.slice(-15000)}`;
  $('uart-log').textContent=uartText;
}
function stateView(data){
  current=data;const s=data.state;running=data.running;loaded=data.loaded;stopped=s[28]!==0;
  $('ticks').dataset.value=count(s[22],s[23]).toString();$('key-status').dataset.pending=String(data.pending);
  regs.forEach((node,i)=>{node.textContent=hex(s[i]);});
  $('instructions').textContent=count(s[20],s[21]).toLocaleString();$('ticks').textContent=count(s[22],s[23]).toLocaleString();$('exceptions').textContent=count(s[24],s[25]).toLocaleString();
  $('cpsr').textContent=hex(s[16]);$('control').textContent=hex(s[17]);
  const modes={16:'user',17:'FIQ',18:'IRQ',19:'supervisor',23:'abort',27:'undefined',31:'system'};
  $('isa').textContent=`${s[16]&32?'Thumb':'ARM'} · ${modes[s[16]&31]||'invalid mode'}`;
  $('status').textContent=stopped?'Stopped':!loaded?(busy?'Loading ROM…':'No ROM loaded'):running?'Running':'Paused';
  $('stop').textContent=stopped?`${data.reason}\nPC ${hex(s[29])} · instruction ${hex(s[30])}\nAddress ${hex(s[31])} · detail ${hex(s[32])}`:`No diagnostic stop.\nData fault status ${hex(s[18])} · address ${hex(s[19])}`;
  $('frame-status').textContent=data.frameStatus?`LCD unavailable · code ${data.frameStatus}`:`${data.width} × ${data.height} · ${data.frameView?'packed LSB inspection':'controller stream'}`;
  $('aliases').textContent=`${data.aliasReads} / ${data.aliasWrites}`;$('lcd-reads').textContent=data.lcdReads;
  $('assumption-status').textContent=data.preset==='hp48-home'?'HP48gII HOME experiment · unverified SRAM/LCD/pad/ADC assumptions':'Strict defaults · no HOME preset';
  $('key-status').textContent=data.preset!=='hp48-home'?'Keypad requires the HOME setup.':!loaded?'Load the documented HP48gII NOR.':!running?'Press Run to enable key taps.':data.pending?`${data.pending} tap(s) pending`:'Ready for a key tap';
  for(const [scan,b] of keyButtons)b.setAttribute('aria-pressed',String(scan===data.active));
  draw(data.pixels,data.width,data.height);controls();
}
worker.onmessage=({data})=>{
  if(data.type==='ready'){ready=true;recreate();return;}
  if(data.type==='fatal'){ready=false;loaded=false;running=false;controls();error(data.message);return;}
  if(data.generation!==generation)return;
  if(data.type==='created'){machineReady=true;$('memory').textContent=`${data.flash/1024} KiB NOR · ${data.ram/1024} KiB RAM`;controls();loadFile(generation,data.flash);}
  else if(data.type==='loaded'){loaded=true;busy=false;error('');controls();}
  else if(data.type==='snapshot')stateView(data);
  else if(data.type==='uart-output')appendUart(data.bytes);
  else if(data.type==='error'){busy=false;running=false;error(data.message);controls();}
};
worker.onerror=event=>{ready=false;loaded=false;running=false;controls();error(event.message||'Emulator Worker failed');};
$('model').addEventListener('change',()=>{currentFile=null;$('rom').value='';$('preset').value='strict';recreate();});
$('preset').addEventListener('change',recreate);
$('rom').addEventListener('change',()=>{currentFile=$('rom').files[0]||null;recreate();});
$('run').addEventListener('click',()=>message(running?'pause':'run'));
$('step').addEventListener('click',()=>message('step'));
$('reset').addEventListener('click',()=>{uartText='';$('uart-log').textContent='No guest output.';error('');message('reset');});
$('release').addEventListener('click',()=>message('release'));
$('view').addEventListener('change',()=>message('view',{view:Number($('view').value)}));
function tap(scan){if(loaded&&running&&!stopped&&$('preset').value==='hp48-home')message('tap',{scan});}
window.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.altKey||event.metaKey||event.repeat||event.target.closest('input,select,textarea,[contenteditable="true"]'))return;
  if(event.target.tagName==='BUTTON'&&(event.key==='Enter'||event.key===' '))return;
  const scan=shortcut(event.key);if(scan===undefined||!loaded||!running||$('preset').value!=='hp48-home')return;
  event.preventDefault();tap(scan);
});
function suspend(){if(loaded)message('pause');}
window.addEventListener('blur',suspend);
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();});
window.addEventListener('pagehide',()=>worker.terminate());
$('uart-form').addEventListener('submit',event=>{
  event.preventDefault();const text=$('uart-input').value.trim();
  if(!/^(?:[0-9a-f]{2})(?:\s+[0-9a-f]{2})*$/i.test(text)){error('Use space-separated hexadecimal bytes.');return;}
  const parts=text.split(/\s+/);if(parts.length>1024){error('UART input limit is 1024 bytes.');return;}
  error('');message('uart',{bytes:Uint8Array.from(parts,p=>parseInt(p,16))});
});
$('uart-clear').addEventListener('click',()=>{uartText='';$('uart-log').textContent='No guest output.';});
$('export').addEventListener('click',async()=>{
  if(!current||running)return;
  const data=current,hash=fingerprint,log=uartText;
  try{
    const frameHash=data.pixels?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data.pixels)),b=>b.toString(16).padStart(2,'0')).join(''):null;
    const payload={schema:'orchard-web-diagnostics-v2',model:data.model,preset:data.preset,rom_sha256:hash,
      canonical_hardware_boot:false,state_words:Array.from(data.state),stop_reason:data.reason,frame_view:data.frameView,
      frame_sha256:frameHash,key_events:data.events,events_truncated:data.eventOverflow,
      sram_alias_reads:data.aliasReads,sram_alias_writes:data.aliasWrites,lcd_unverified_reads:data.lcdReads,uart_log_hex:log};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='orchard-diagnostics.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){error(String(e.message||e));}
});
controls();draw(null,131,64);
