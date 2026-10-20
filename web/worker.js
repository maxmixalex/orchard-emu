// SPDX-License-Identifier: MIT
import { Pacer } from './pacing.js';
import { TaskScheduler } from './task-scheduler.js';
import { VirtualUSB } from './virtual-usb.js';
import { encodeSession, decodeSession } from './session.js';
import { setupHash, isPlayable, applySetup, TapQueue } from './hp48.js';
let audience = 'debug';
let romHash='', operation=0, busy=false, autoSaving=false, serial=false, usb;
const pacer=new Pacer(), scheduler=new TaskScheduler();
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
  if (audience !== 'debug') return;
  if (events.length < 512) events.push({tick: at, scan, down: Number(down)});
  else eventOverflow = true;
});
function state() { return new Uint32Array(core.memory.buffer, core.snapshot(), 33).slice(); }
function syncTick(s = state()) {
  const next = s[22] + s[23] * 4294967296;
  // Restoring an earlier checkpoint starts a new input-clock epoch.
  if (next < tick) taps.clear(next);
  tick = next;
}
function resetClock() { tick=0;taps.clear(0);pacer.reset(performance.now()); }
function pause() { running = false; scheduler.cancel(timer); timer = null; taps.clear(tick); }
function sendUart() {
  const n = core.uart_receive();
  if (n && (audience === 'debug' || serial)) postMessage({ type:'uart-output',generation,bytes:new Uint8Array(core.memory.buffer,core.uart_output(),n).slice() });
}
function snapshot() {
  const s = state(); syncTick(s);
  const frameStatus = core.frame_view(frameView), width = core.profile(model,2), height = core.profile(model,3);
  const annunciatorStatus = core.annunciators();
  const annunciators = annunciatorStatus ? null : new Uint8Array(core.memory.buffer,core.annunciator_buffer(),6).slice();
  const pixels = frameStatus ? null : new Uint8Array(core.memory.buffer,core.frame_buffer(),width*height).slice();
  sendUart();
  const visible = {type:'snapshot',generation,width,height,pixels,running,loaded,model,
    stopped:s[28]!==0,frameStatus,annunciatorStatus,annunciators,pending:taps.pending,active:taps.active};
  if (audience === 'calculator') postMessage(visible);
  else postMessage({...visible,state:s,preset,frameView,
    frameStatus,annunciatorStatus,annunciators,reason:errors[s[28]] || 'unknown stop',pending:taps.pending,active:taps.active,
    events:events.slice(),eventOverflow,aliasReads:core.sram_alias_reads().toString(),
    aliasWrites:core.sram_alias_writes().toString(),lcdReads:core.lcd_probe68_reads().toString()});
  lastFrame = performance.now();
}
function schedule() { if (running && timer === null) timer = scheduler.schedule(pump, audience==='calculator'?pacer.delay():0); }
// Keep the calculator's one-slot functional clock while honoring guest IDLE
// requests. The ratio-aware runner remains an explicit research API.
function idleRunner() { return audience==='calculator' && isPlayable(model,preset); }
function runBudget(budget) { return idleRunner()?core.run_idle(budget):core.run(budget); }
function pump() {
  timer=null;
  if (!running) return;
  try {
    const end = performance.now()+6;
    // Keep each core call short enough to drain even a continuously transmitting UART.
    // Batch calls in one bounded Worker task instead of a timer per 256 ticks.
    do {
      taps.update(tick);
      // Both selected runners issue at most one CPU slot per quantum, keeping
      // every UART drain within 1,024 CPU slots.
      const allowance=audience==='calculator'?pacer.available(performance.now(),1024):256;
      const boundary=taps.boundary(tick)-tick;
      // Match Pacer.delay's 256-tick waiting threshold. On a fast host, the
      // bookkeeping above can continually mint a handful of wall-time ticks;
      // executing those tiny allowances would spin for the whole 6 ms task.
      // Keep the credit for the next task, while still reaching exact key
      // transitions even when their remaining distance is below 256 ticks.
      if(audience==='calculator' && allowance<Math.min(256,boundary))break;
      const budget = Math.min(allowance,boundary);
      if(!budget)break;
      const status = runBudget(budget);
      if (status) syncTick(); else tick += budget;
      if(audience==='calculator')pacer.consume(budget);
      usb?.poll(tick);
      sendUart();
      if (status) {pause();break;}
    } while (performance.now()<end);
    if (!running || performance.now()-lastFrame >= (audience==='calculator'?33:50)) snapshot();
    schedule();
  } catch (error) { fail(error); }
}
function fail(error) {
  busy=false;autoSaving=false;running=false;scheduler.cancel(timer);timer=null;
  try { taps.clear(tick); } catch { /* Original error takes precedence. */ }
  postMessage({type:'error',generation,message:error instanceof Error?error.message:String(error)});
  if (core && core.snapshot()) snapshot();
}
self.onmessage=({data})=>{
  if (!core || !data || typeof data.type !== 'string') return;
  try {
    if (data.type==='create') {
      pause();++operation;busy=false;romHash='';
      if (!Number.isSafeInteger(data.generation) || !Number.isInteger(data.model) || !core.profile(data.model,0)) throw new Error('Invalid machine');
      if (data.audience !== undefined && !['debug','calculator'].includes(data.audience)) throw new Error('Invalid audience');
      generation=data.generation;model=data.model;preset=data.preset;audience=data.audience||'debug';
      loaded=false;resetClock();events=[];eventOverflow=false;frameView=0;autoSaving=false;serial=false;
      pacer.setSpeed(audience==='calculator'?1:0,performance.now());
      // The HP39 debounce path needs a longer dwell: a shorter trial lost
      // multiply. Debug keeps its historical 2M/2M deterministic schedule.
      taps.hold=audience==='calculator'?(model===1?1500000:600000):2000000;
      taps.gap=audience==='calculator'?(model===1?900000:360000):2000000;
      if(core.create(model)) throw new Error('Machine initialization failed');
      applySetup(core,model,preset);frameView=isPlayable(model,preset)?1:0;
      usb=new VirtualUSB(core,core.timebase_hz(),data=>postMessage({type:'usb-status',generation,...data}));
      postMessage({type:'created',generation,flash:core.profile(model,0),ram:core.profile(model,1)});snapshot();return;
    }
    if(data.generation!==generation) return;
    if(data.type==='load') {
      pause();loaded=false;busy=true;const job=++operation;
      if(!(data.rom instanceof ArrayBuffer) || data.rom.byteLength!==core.profile(model,0)) throw new Error('A complete physical NOR of the selected capacity is required.');
      // Main UI hashes locally before load. Worker authenticates the research fixture too.
      const token=generation, bytes=data.rom;
      crypto.subtle.digest('SHA-256',bytes).then(hash=>{
        if(token!==generation||job!==operation) return;
        const digest=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
        if(setupHash(preset) && digest!==setupHash(preset)) throw new Error('HOME research setup requires the documented model-specific full-NOR hash.');
        new Uint8Array(core.memory.buffer,core.rom_buffer(),bytes.byteLength).set(new Uint8Array(bytes));
        const status=core.load(bytes.byteLength);if(status) throw new Error(errors[status]);
        resetClock();events=[];eventOverflow=false;applySetup(core,model,preset);loaded=true;romHash=digest;busy=false;
        postMessage({type:'loaded',generation});snapshot();
      }).catch(error=>{if(token===generation&&job===operation)fail(error);});
    } else if(data.type==='checkpoint-auto') {
      if(!loaded || busy || autoSaving || taps.pending || usb?.job){postMessage({type:'checkpoint-skipped',generation,request:data.request});return;}
      autoSaving=true;const token=generation,job=operation,request=data.request;
      const length=core.checkpoint_size();
      if(!length||length>600000||core.checkpoint_save())throw new Error('Unable to save this calculator state.');
      const bytes=new Uint8Array(core.memory.buffer,core.checkpoint_buffer(),length).slice();
      encodeSession({model,romHash,preset,frameView,state:bytes}).then(file=>{
        if(token!==generation||job!==operation)return;autoSaving=false;
        postMessage({type:'checkpoint-auto-saved',generation,request,file},[file.buffer]);
      }).catch(error=>{if(token===generation&&job===operation){autoSaving=false;postMessage({type:'autosave-error',generation,message:error.message});}});
    } else if(data.type==='checkpoint-save' && loaded && !busy) {
      pause();autoSaving=false;busy=true;const token=generation,job=++operation;
      const length=core.checkpoint_size();
      if(!length||length>600000||core.checkpoint_save())throw new Error('Unable to save this calculator state.');
      const bytes=new Uint8Array(core.memory.buffer,core.checkpoint_buffer(),length).slice();
      encodeSession({model,romHash,preset,frameView,state:bytes}).then(file=>{
        if(token!==generation||job!==operation)return;
        busy=false;postMessage({type:'checkpoint-saved',generation,file},[file.buffer]);snapshot();
      }).catch(error=>{if(token===generation&&job===operation)fail(error);});
    } else if(data.type==='checkpoint-load' && loaded && !busy) {
      pause();autoSaving=false;busy=true;const token=generation,job=++operation;
      decodeSession(data.file).then(saved=>{
        if(token!==generation||job!==operation)return;
        if(saved.model!==model||saved.romHash!==romHash||saved.preset!==preset)
          throw new Error('This session belongs to a different ROM or calculator. Open its original ROM first.');
        if(saved.state.length!==core.checkpoint_size())throw new Error('This session version is not supported.');
        new Uint8Array(core.memory.buffer,core.checkpoint_buffer(),saved.state.length).set(saved.state);
        if(core.checkpoint_load(saved.state.length))throw new Error('The session is damaged or incompatible. Your current calculator was not replaced.');
        // Session files created here have no held keys. Also release all inputs
        // on import from a native host; never resurrect a stuck physical key.
        if(isPlayable(model,preset)) {
          for(let c=0;c<8;c++)for(let r=0;r<7;r++)core.keyboard_matrix(c,r,0);
          for(const pin of [0,4,5,6])core.keyboard_dedicated(pin,0);
        }
        usb?.resetLocal();if(new Uint32Array(core.memory.buffer,core.usb_snapshot(),44)[10])core.usb_connect(0);
        serial=false;postMessage({type:'links-reset',generation});
        frameView=saved.frameView;syncTick();pacer.reset(performance.now());events=[];eventOverflow=false;busy=false;
        postMessage({type:'checkpoint-restored',generation});snapshot();
      }).catch(error=>{if(token===generation&&job===operation)fail(error);});
    } else if(data.type==='pause') {pause();snapshot();}
    else if(data.type==='run' && loaded && !busy) {if(!running && state()[28]===0){pacer.reset(performance.now());running=true;schedule();snapshot();}}
    else if(data.type==='step' && loaded && !busy) {pause();runBudget(1);snapshot();}
    else if(data.type==='reset' && loaded) {++operation;busy=false;autoSaving=false;pause();usb?.resetLocal();serial=false;postMessage({type:'links-reset',generation});core.reset();resetClock();events=[];eventOverflow=false;applySetup(core,model,preset);snapshot();}
    else if(data.type==='configure') {
      if(data.speed!==undefined)pacer.setSpeed(data.speed,performance.now());
      if(data.hold!==undefined||data.gap!==undefined){
        if(!Number.isInteger(data.hold)||!Number.isInteger(data.gap)||data.hold<120000||data.hold>2400000||data.gap<120000||data.gap>2400000)throw new Error('Invalid key timing');
        taps.clear(tick);taps.hold=data.hold;taps.gap=data.gap;
      }
    }
    else if(data.type==='tap-sequence' && loaded && running && isPlayable(model,preset)) {taps.pushMany(data.scans);snapshot();}
    else if(data.type==='serial-connect' && loaded) {serial=Boolean(data.connected);postMessage({type:'serial-status',generation,connected:serial});}
    else if(data.type==='usb-connect' && loaded) {
      if(data.connected){if(!running)throw new Error('Resume the calculator before connecting USB.');usb.start(tick);}else usb.disconnect();
    }
    else if(data.type==='usb-send' && loaded) {postMessage({type:'usb-packet',generation,direction:'out',...usb.send(data.bytes)});}
    else if(data.type==='usb-read' && loaded) {postMessage({type:'usb-packet',generation,direction:'in',...usb.read()});}
    else if(data.type==='tap' && loaded && running && isPlayable(model,preset)) {taps.push(data.scan);snapshot();}
    else if(data.type==='release') {taps.clear(tick);snapshot();}
    else if(data.type==='view') {if(data.view!==0 && data.view!==1)throw new Error('Invalid frame view');frameView=data.view;snapshot();}
    else if(data.type==='uart' && loaded) {
      if(!(data.bytes instanceof Uint8Array) || data.bytes.length>1024)throw new Error('UART input limit is 1024 bytes');
      new Uint8Array(core.memory.buffer,core.uart_input(),data.bytes.length).set(data.bytes);
      const n=core.uart_send(data.bytes.length);
      postMessage({type:'uart-sent',generation,accepted:n,requested:data.bytes.length});snapshot();
    }
  } catch(error){fail(error);}
};
try {
  const response=await fetch(new URL('orchard.wasm',import.meta.url));
  if(!response.ok)throw new Error(`WASM download failed: HTTP ${response.status}`);
  ({instance:{exports:core}}=await WebAssembly.instantiate(await response.arrayBuffer(),{}));
  pacer.hz=core.timebase_hz();postMessage({type:'ready'});
} catch(error){postMessage({type:'fatal',message:String(error)});}
