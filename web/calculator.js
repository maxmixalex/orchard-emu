// SPDX-License-Identifier: MIT
import { CALCULATORS, identifyROM } from './catalog.js';
import { keyRows, shortcut } from './hp48.js';
import { SkinView } from './skin.js';
import { bindLifecycle } from './lifecycle.js';
const $=id=>document.getElementById(id);
const worker=new Worker(new URL('worker.js',import.meta.url),{type:'module'});
const skin=new SkinView($('skin-stage'),tap);
const canvas=$('lcd'), context=canvas.getContext('2d',{alpha:false});
let generation=0, selection=0, model=CALCULATORS[0], ready=false, loaded=false, running=false, stopped=false, busy=false, pending=null, last=null;
const buttons=new Map();
function send(type,extra={}){worker.postMessage({type,generation,...extra});}
function status(text){if($('status').textContent!==text)$('status').textContent=text;}
function error(text){$('error').textContent=text;$('error').hidden=!text;}
function controls(){
  $('open').disabled=!ready||busy;$('model').disabled=!ready||busy;
  $('run').disabled=!loaded||busy||stopped;$('run').textContent=running?'Pause':'Resume';
  $('reset').disabled=!loaded||busy;
  const enabled=loaded&&running&&!stopped&&!busy;
  skin.setEnabled(enabled);for(const b of buttons.values())b.disabled=!enabled;
}
function draw(data){
  if(!data)return;
  if(canvas.width!==data.width||canvas.height!==data.height){canvas.width=data.width;canvas.height=data.height;}
  const image=context.createImageData(data.width,data.height);
  for(let i=0;i<data.width*data.height;i++){
    const ink=data.pixels?data.pixels[i]/255:0;
    for(let c=0;c<3;c++)image.data[i*4+c]=Math.round(skin.rgb[c]*(1-ink)+[31,47,42][c]*ink);
    image.data[i*4+3]=255;
  }
  context.putImageData(image,0,0);
  skin.update(data.active,data.annunciators,data.annunciatorStatus,model.id);
  for(const [scan,b] of buttons)b.setAttribute('aria-pressed',String(scan===data.active));
}
function create(rom=null){
  ++generation;pending=rom;loaded=running=stopped=false;last=null;error('');
  $('model').value=String(model.id);$('machine-title').textContent=model.name;$('boot-help').textContent=model.help;
  buttons.clear();$('keypad').replaceChildren();
  for(const row of keyRows(model.id)){
    const line=document.createElement('div');line.className='key-row';line.style.gridTemplateColumns=`repeat(${row.length},minmax(0,1fr))`;
    for(const [label,scan] of row){const b=document.createElement('button');b.textContent=label;b.type='button';b.setAttribute('aria-label',`Calculator ${label}`);b.setAttribute('aria-pressed','false');b.onclick=event=>{tap(scan);if(event.detail>0)$('calculator').focus({preventScroll:true});};line.append(b);buttons.set(scan,b);}
    $('keypad').append(line);
  }
  const token=generation;
  skin.show(model.id).then(()=>{if(token===generation)draw(last);}).catch(()=>{if(token===generation)error('The calculator artwork could not load. Reload the page or use the text keypad.');});
  controls();status(rom?'Opening ROM…':'Open a ROM to begin.');
  send('create',{model:model.id,preset:model.preset,audience:'calculator'});
}
async function openFile(file){
  if(!file)return;
  const token=++selection;busy=true;send('pause');error('');controls();status('Checking ROM…');
  try{
    if(!CALCULATORS.some(c=>c.bytes===file.size))throw new Error('Open a complete 1 MB or 2 MB ROM file, not a ZIP or firmware update.');
    const rom=await file.arrayBuffer(), identified=await identifyROM(rom);
    if(token!==selection)return;
    model=identified;create(rom);
  }catch(e){if(token===selection){busy=false;error(e.message||'The ROM could not be opened.');status(loaded?'Paused':'No ROM loaded.');controls();}}
}
worker.onmessage=({data})=>{
  if(data.type==='ready'){ready=true;create();return;}
  if(data.type==='fatal'){ready=loaded=running=false;busy=false;error('The calculator could not start. Reload the page and try again.');controls();return;}
  if(data.generation!==generation)return;
  if(data.type==='created'){
    if(pending){const rom=pending;pending=null;worker.postMessage({type:'load',generation,rom},[rom]);}
    else{busy=false;controls();}
  }else if(data.type==='loaded'){loaded=true;busy=false;controls();if(!document.hidden&&document.hasFocus())send('run');}
  else if(data.type==='snapshot'){
    last=data;loaded=data.loaded;running=data.running;stopped=data.stopped;
    draw(data);controls();
    if(stopped){status('Stopped');error('A compatibility issue interrupted the calculator. Restart it to try again.');}
    else if(busy)status('Opening ROM…');else status(!loaded?'Open a ROM to begin.':running?'Running':'Paused');
  }else if(data.type==='error'){busy=false;running=false;error('The calculator could not complete this operation. Restart or open a supported ROM.');controls();}
};
worker.onerror=()=>{ready=loaded=running=false;busy=false;error('The calculator stopped unexpectedly. Reload the page to restart it.');controls();};
function tap(scan){if(loaded&&running&&!stopped&&!busy)send('tap',{scan});}
$('open').onclick=()=>{$('rom').value='';$('rom').click();};
$('rom').onchange=()=>openFile($('rom').files[0]);
$('model').onchange=()=>{
  if(loaded&&!confirm('Switch calculators? The current calculator’s memory will be cleared.')){$('model').value=String(model.id);return;}
  ++selection;model=CALCULATORS.find(c=>c.id===Number($('model').value));busy=false;create();
};
$('run').onclick=()=>{send(running?'pause':'run');$('calculator').focus({preventScroll:true});};
$('reset').onclick=()=>{if(confirm('Restart the calculator? Its current memory and calculations will be cleared.')){error('');send('reset');send('run');}};
window.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.altKey||event.metaKey||event.repeat||event.target.closest('input,select,textarea,[contenteditable="true"]'))return;
  if(event.target.tagName==='BUTTON'&&(event.key==='Enter'||event.key===' '))return;
  const scan=shortcut(event.key);if(scan===undefined||!loaded||!running)return;
  event.preventDefault();tap(scan);
});
bindLifecycle(window,document,()=>{if(loaded)send('pause');});
controls();
