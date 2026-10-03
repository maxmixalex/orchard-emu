// SPDX-License-Identifier: MIT
import { HP48_ROM, applySetup, TapQueue } from './hp48.js';
let core, model = 4, generation = 0, preset = 'strict', running = false, loaded = false;
let timer = null, lastFrame = 0, tick = 0, events = [], eventOverflow = false, frameView = 0;
const errors = ['ready','bad argument','full-NOR size mismatch','not a full ARM NOR image',
  'no ROM loaded','unsupported instruction','unsupported CP15 operation','unimplemented MMIO',
  'unimplemented NOR command','unpredictable ARM operation','UART host queue full',
  'big-endian mode not implemented','unsupported LCD mode','physical bus error',
  'watchdog reset propagation not implemented','contradictory external GPIO drives',
  'unresolved ADC input or conversion data','unsupported USB operation or FIFO state'];
const taps = new TapQueue((scan, down, at) => {
  const status = scan < 56 ? core.keyboard_matrix(Math.floor(scan / 7), scan % 7, Number(down))
    : core.keyboard_dedicated([0,4,5,6][scan-56], Number(down));
  if (status) throw new Error(errors[status]);
  if (events.length < 512) events.push({tick: at, scan, down: Number(down)});
  else eventOverflow = true;
});
function state() { return new Uint32Array(core.memory.buffer, core.snapshot(), 33).slice(); }
function syncTick(s = state()) { tick = s[22] + s[23] * 4294967296; }
function pause() { running = false; clearTimeout(timer); timer = null; taps.clear(tick); }
function sendUart() {
  const n = core.uart_receive();
  if (n) postMessage({ type:'uart-output',generation,bytes:new Uint8Array(core.memory.buffer,core.uart_output(),n).slice() });
}
function snapshot() {
  const s = state(); syncTick(s);
  const frameStatus = core.frame_view(frameView), width = core.profile(model,2), height = core.profile(model,3);
  const pixels = frameStatus ? null : new Uint8Array(core.memory.buffer,core.frame_buffer(),width*height).slice();
  sendUart();
  postMessage({type:'snapshot',generation,state:s,width,height,pixels,running,loaded,model,preset,frameView,
    frameStatus,reason:errors[s[28]] || 'unknown stop',pending:taps.pending,active:taps.active,
    events:events.slice(),eventOverflow,aliasReads:core.sram_alias_reads().toString(),
    aliasWrites:core.sram_alias_writes().toString(),lcdReads:core.lcd_probe68_reads().toString()});
  lastFrame = performance.now();
}
function schedule() { if (running && timer === null) timer = setTimeout(pump, 0); }
function pump() {
  timer=null;
  if (!running) return;
  try {
    const end = performance.now()+8;
    // Keep each core call short enough to drain even a continuously transmitting UART.
    // Batch calls in one bounded Worker task instead of a timer per 256 ticks.
    do {
      taps.update(tick);
      const budget = Math.min(256,taps.boundary(tick)-tick);
      const status = core.run(budget); syncTick(); sendUart();
      if (status) {pause();break;}
    } while (performance.now()<end);
    if (!running || performance.now()-lastFrame >= 50) snapshot();
    schedule();
  } catch (error) { fail(error); }
}
function fail(error) {
  running=false;
  try { taps.clear(tick); } catch { /* Original error takes precedence. */ }
  postMessage({type:'error',generation,message:error instanceof Error?error.message:String(error)});
  if (core && core.snapshot()) snapshot();
}
self.onmessage=({data})=>{
  if (!core || !data || typeof data.type !== 'string') return;
  try {
    if (data.type==='create') {
      pause();
      if (!Number.isSafeInteger(data.generation) || !Number.isInteger(data.model) || !core.profile(data.model,0)) throw new Error('Invalid machine');
      generation=data.generation;model=data.model;preset=data.preset;
      loaded=false;tick=0;events=[];eventOverflow=false;frameView=0;
      if(core.create(model)) throw new Error('Machine initialization failed');
      applySetup(core,model,preset);frameView=preset==='hp48-home'?1:0;
      postMessage({type:'created',generation,flash:core.profile(model,0),ram:core.profile(model,1)});snapshot();return;
    }
    if(data.generation!==generation) return;
    if(data.type==='load') {
      pause();loaded=false;
      if(!(data.rom instanceof ArrayBuffer) || data.rom.byteLength!==core.profile(model,0)) throw new Error('A complete physical NOR of the selected capacity is required.');
      // Main UI hashes locally before load. Worker authenticates the research fixture too.
      const token=generation, bytes=data.rom;
      crypto.subtle.digest('SHA-256',bytes).then(hash=>{
        if(token!==generation) return;
        const digest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
        if(preset==='hp48-home' && digest!==HP48_ROM) throw new Error('HOME research setup requires the documented HP48gII USB-revision full-NOR hash.');
        new Uint8Array(core.memory.buffer,core.rom_buffer(),bytes.byteLength).set(new Uint8Array(bytes));
        const status=core.load(bytes.byteLength);if(status) throw new Error(errors[status]);
        tick=0;events=[];eventOverflow=false;applySetup(core,model,preset);loaded=true;
        postMessage({type:'loaded',generation});snapshot();
      }).catch(error=>{if(token===generation)fail(error);});
    } else if(data.type==='pause') {pause();snapshot();}
    else if(data.type==='run' && loaded) {if(!running && state()[28]===0){running=true;schedule();snapshot();}}
    else if(data.type==='step' && loaded) {pause();core.run(1);snapshot();}
    else if(data.type==='reset' && loaded) {pause();core.reset();tick=0;events=[];eventOverflow=false;applySetup(core,model,preset);snapshot();}
    else if(data.type==='tap' && loaded && running && preset==='hp48-home') {taps.push(data.scan);snapshot();}
    else if(data.type==='release') {taps.clear(tick);snapshot();}
    else if(data.type==='view') {if(data.view!==0 && data.view!==1)throw new Error('Invalid frame view');frameView=data.view;snapshot();}
    else if(data.type==='uart' && loaded) {
      if(!(data.bytes instanceof Uint8Array) || data.bytes.length>1024)throw new Error('UART input limit is 1024 bytes');
      new Uint8Array(core.memory.buffer,core.uart_input(),data.bytes.length).set(data.bytes);
      const n=core.uart_send(data.bytes.length);if(n!==data.bytes.length)throw new Error(`UART queue full: accepted ${n} of ${data.bytes.length} bytes`);snapshot();
    }
  } catch(error){fail(error);}
};
try {
  const response=await fetch(new URL('orchard.wasm',import.meta.url));
  if(!response.ok)throw new Error(`WASM download failed: HTTP ${response.status}`);
  ({instance:{exports:core}}=await WebAssembly.instantiate(await response.arrayBuffer(),{}));
  postMessage({type:'ready'});
} catch(error){postMessage({type:'fatal',message:String(error)});}
