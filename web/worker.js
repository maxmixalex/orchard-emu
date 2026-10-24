// SPDX-License-Identifier: MIT
import { Pacer } from './pacing.js';
import { TaskScheduler } from './task-scheduler.js';
import { VirtualUSB } from './virtual-usb.js';
import { BrowserHostBridge } from './host-bridge-client.js';
import { bridgeAddress,bridgeToken } from './host-bridge-protocol.js';
import { FileTransfer } from './file-transfer.js';
import {transferError,transferErrorDetails} from './transfer-errors.js';
import { BuzzerStream } from './buzzer-worker.js';
import { LCDFrames } from './lcd-frames.js';
import { IrDAInput } from './irda-input.js';
import { encodeSession, decodeSession, MAX_STATE } from './session.js';
import { readSDState, validateSDSize } from './sd-card.js';
import { listSDDirectory } from './sd-filesystem.js';
import { setupHash, isPlayable, applySetup, TapQueue } from './hp48.js';
let audience = 'debug';
let romHash='', operation=0, busy=false, autoSaving=false, serial=false, irda=false, irdaEpoch=0, usb, transfer, buzzer, hostBridge=null;
let hostBridgeCleanup=Promise.resolve();
const pacer=new Pacer(), scheduler=new TaskScheduler();
const lcdFrames=new LCDFrames();
let requestedSpeed=1, transferUnlimited=false, transferMoving=false;
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
function resetClock() { tick=0;taps.clear(0);lcdFrames.reset();pacer.reset(performance.now()); }
function transferBoosted() { return audience==='calculator'&&transferUnlimited&&transferMoving; }
function configurePacing(force=false) {
  const speed=transferBoosted()?0:requestedSpeed;
  if(force||pacer.speed!==speed)pacer.setSpeed(speed,performance.now());
}
function transferMessage(data) {
  if(data.type==='file-transfer-status'){
    // Waiting for a human to choose RECV or a catalog entry must not consume
    // the handshake deadline at Unlimited. Restore before posting a terminal
    // status so a busy main thread cannot leave the calculator accelerated.
    if(data.request===transfer?.request||!transfer?.active){
      transferMoving=Boolean(data.active&&['sending','receiving','listing','finishing'].includes(data.phase));
      configurePacing();
    }
    data={...data,effectiveSpeed:pacer.speed,transferBoosted:transferBoosted()};
  }
  postMessage({generation,...data});
}
function stopHostBridge(){const previous=hostBridge;hostBridge=null;
  if(previous)hostBridgeCleanup=Promise.allSettled([hostBridgeCleanup,previous.stop()]).then(()=>{});
  return hostBridgeCleanup;
}
function pause() { stopHostBridge();transfer?.cancel(tick,transferError('transferPaused','File transfer cancelled because the calculator paused.'));buzzer?.clear();irdaInput.reset(tick);running = false; scheduler.cancel(timer); timer = null; taps.clear(tick); }
function sendUart() {
  const n = core.uart_receive();
  if(n){const bytes=new Uint8Array(core.memory.buffer,core.uart_output(),n).slice();
    if(!transfer?.receiveUart(bytes,tick)&&(audience === 'debug' || serial))postMessage({type:'uart-output',generation,bytes});}
  // Drain all host capture queues even without a peer. Sending into open air
  // must not eventually halt the CPU because the browser kept old octets.
  if(typeof core.uart_receive_channel==='function')for(const channel of [1,2]){
    const count=core.uart_receive_channel(channel);if(!count)continue;
    const bytes=new Uint8Array(core.memory.buffer,core.uart_output(),count).slice();
    // These bytes were already transmitted by the core. A guest can disable
    // TX or change its line mode before this host slice drains them. An
    // explicitly paired decoded-byte UART2 link must retain that final data;
    // internal loopback never enters the core's external output queue.
    if(channel===2&&irda)postMessage({type:'irda-output',generation,epoch:irdaEpoch,tick,bytes},[bytes.buffer]);
    else if(audience==='debug')postMessage({type:'uart-output',generation,channel,bytes});
  }
}
function irdaReady(receiving){
  if(typeof core.uart_snapshot!=='function')return false;
  const pointer=core.uart_snapshot(2);if(!pointer)return false;
  const s=new Uint32Array(core.memory.buffer,pointer,9);
  return Boolean(s[7]&&(s[0]&64)&&!(s[1]&32)&&(receiving?(s[1]&3):(s[1]&12)));
}
const irdaInput=new IrDAInput({
  ready:()=>irda&&loaded&&running&&!busy&&irdaReady(true),
  send:bytes=>{new Uint8Array(core.memory.buffer,core.uart_input(),bytes.length).set(bytes);return core.uart_send_channel(2,bytes.length);},
  reply:result=>postMessage({type:'irda-input-result',generation,epoch:irdaEpoch,tick,...result}),
  progress:result=>postMessage({type:'irda-input-progress',generation,epoch:irdaEpoch,...result}),
});
function snapshot() {
  const s = state(); syncTick(s);
  irdaInput.notifyProgress(tick);
  // Key/link/status messages must not expose another partially rewritten RAM
  // image in the same LCD scan. Pause/stop/debug inspection remains immediate.
  const frame=lcdFrames.read(core,model,frameView,tick,audience!=='calculator'||!running||s[28]!==0,audience==='calculator');
  sendUart();
  const visible = {type:'snapshot',generation,...frame,running,loaded,model,tick,
    sd:readSDState(core),stopped:s[28]!==0,pending:taps.pending,active:taps.active,activeKeys:[...taps.held],
    effectiveSpeed:pacer.speed,transferBoosted:transferBoosted()};
  if (audience === 'calculator') postMessage(visible);
  else postMessage({...visible,state:s,preset,frameView,
    reason:errors[s[28]] || 'unknown stop',pending:taps.pending,active:taps.active,
    events:events.slice(),eventOverflow,aliasReads:core.sram_alias_reads().toString(),
    aliasWrites:core.sram_alias_writes().toString(),lcdReads:core.lcd_probe68_reads().toString()});
  if(running){const packet=buzzer?.packet();if(packet)postMessage({type:'buzzer',generation,...packet},[packet.edges.buffer]);}
  lastFrame = performance.now();
}
function schedule() { if (running && timer === null) timer = scheduler.schedule(pump, audience==='calculator'?pacer.delay():0); }
function pump() {
  timer=null;
  if (!running) return;
  try {
    const end = performance.now()+6;
    // Keep each core call short enough to drain even a continuously transmitting UART.
    // Batch calls in one bounded Worker task instead of a timer per 256 ticks.
    do {
      irdaInput.poll(tick);
      taps.update(tick);
      const allowance=audience==='calculator'?pacer.available(performance.now(),1024):256;
      const boundary=Math.min(taps.boundary(tick),irdaInput.boundary(tick))-tick;
      // Match Pacer.delay's 256-tick waiting threshold. On a fast host, the
      // bookkeeping above can continually mint a handful of wall-time ticks;
      // executing those tiny allowances would spin for the whole 6 ms task.
      // Keep the credit for the next task, while still reaching exact key
      // transitions even when their remaining distance is below 256 ticks.
      if(audience==='calculator' && allowance<Math.min(256,boundary))break;
      const budget = Math.min(allowance,boundary);
      if(!budget)break;
      const status = core.run(budget);
      if (status) syncTick(); else tick += budget;
      if(audience==='calculator')pacer.consume(budget);
      irdaInput.poll(tick);
      usb?.poll(tick);
      hostBridge?.poll(tick);
      sendUart();
      if(transfer?.pending)transfer.poll(tick);
      if (status) {pause();break;}
      // Observe after servicing the links. This never waits for a display
      // deadline or changes the next key/UART/USB scheduling boundary.
      if(audience==='calculator')lcdFrames.read(core,model,frameView,tick);
    } while (performance.now()<end);
    if (!running || performance.now()-lastFrame >= (audience==='calculator'?33:50)) snapshot();
    schedule();
  } catch (error) { fail(error); }
}
function fail(error) {
  stopHostBridge();
  irdaInput.reset(tick);
  transfer?.cancel(tick,'File transfer cancelled because the calculator stopped.');
  buzzer?.clear();
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
      loaded=false;resetClock();events=[];eventOverflow=false;frameView=0;autoSaving=false;serial=false;irda=false;irdaEpoch=0;
      requestedSpeed=audience==='calculator'?1:0;transferUnlimited=false;transferMoving=false;configurePacing(true);
      // The HP39 debounce path needs a longer dwell: a shorter trial lost
      // multiply. Debug keeps its historical 2M/2M deterministic schedule.
      taps.hold=audience==='calculator'?(model===1?1500000:600000):2000000;
      taps.gap=audience==='calculator'?(model===1?600000:360000):2000000;
      if(core.create(model)) throw new Error('Machine initialization failed');
      buzzer=new BuzzerStream(core);
      applySetup(core,model,preset);frameView=isPlayable(model,preset)?1:0;
      usb=new VirtualUSB(core,core.timebase_hz(),data=>postMessage({type:'usb-status',generation,...data}));
      transfer=new FileTransfer({core,usb,model,notify:transferMessage});
      postMessage({type:'created',generation,flash:core.profile(model,0),ram:core.profile(model,1)});snapshot();return;
    }
    if(data.generation!==generation) return;
    if(hostBridge?.active&&['serial-connect','usb-connect','usb-send','usb-read','uart'].includes(data.type)){
      postMessage({type:'host-bridge-conflict',generation});return;
    }
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
    } else if(['sd-insert','sd-export','sd-edit','sd-eject'].includes(data.type)) {
      try {
        if(hostBridge?.active)throw Object.assign(new Error(),{code:'hostBridgeBusy'});
        if(!loaded||busy||!core.profile(model,4))throw new Error('This calculator has no available SD card slot.');
        if(transfer?.active)throw new Error('Finish the current file transfer first.');
        const card=readSDState(core);
        if(data.type==='sd-insert'){
          if(card?.present)throw new Error('Eject the current card before inserting another.');
          if(!(data.bytes instanceof Uint8Array)||typeof data.writeProtected!=='boolean')throw new Error('Invalid SD card image.');
          validateSDSize(data.bytes.length);
          const buffer=core.sd_buffer(data.bytes.length);if(!buffer)throw new Error('Unable to allocate SD card storage.');
          new Uint8Array(core.memory.buffer,buffer,data.bytes.length).set(data.bytes);
          if(core.sd_insert(data.bytes.length,Number(data.writeProtected)))throw new Error('Unable to insert this SD card.');
          postMessage({type:'sd-complete',generation,action:'insert',name:data.name});
        } else if(data.type==='sd-export'||data.type==='sd-edit'){
          if(!card?.present)throw new Error('Insert a card first.');
          const buffer=core.sd_image_buffer();if(!buffer)throw new Error('The SD card image is unavailable.');
          const bytes=new Uint8Array(core.memory.buffer,buffer,card.bytes).slice();
          if(data.type==='sd-edit'){
            // Validate before ejecting. Export + eject is synchronous within
            // one Worker turn, so the guest cannot change the copied card.
            listSDDirectory(bytes);
            if(core.sd_eject())throw new Error('Unable to eject this SD card.');
          }
          postMessage({type:data.type==='sd-edit'?'sd-edited':'sd-exported',generation,bytes},[bytes.buffer]);
        } else {
          if(core.sd_eject())throw new Error('Unable to eject this SD card.');
          postMessage({type:'sd-complete',generation,action:'eject'});
        }
        snapshot();
      } catch(error){postMessage({type:'sd-error',generation,message:error.message,code:error.code});}
    } else if(data.type==='checkpoint-auto') {
      if(!loaded || busy || autoSaving || taps.pending || usb?.job || transfer?.active || hostBridge?.active){postMessage({type:'checkpoint-skipped',generation,request:data.request});return;}
      autoSaving=true;const token=generation,job=operation,request=data.request;
      const length=core.checkpoint_size();
      if(!length||length>MAX_STATE||core.checkpoint_save())throw new Error('Unable to save this calculator state.');
      const bytes=new Uint8Array(core.memory.buffer,core.checkpoint_buffer(),length).slice();
      encodeSession({model,romHash,preset,frameView,state:bytes}).then(file=>{
        if(token!==generation||job!==operation)return;autoSaving=false;
        postMessage({type:'checkpoint-auto-saved',generation,request,file},[file.buffer]);
      }).catch(error=>{if(token===generation&&job===operation){autoSaving=false;postMessage({type:'autosave-error',generation,message:error.message});}});
    } else if(data.type==='checkpoint-save' && loaded && !busy) {
      pause();autoSaving=false;busy=true;const token=generation,job=++operation;
      const length=core.checkpoint_size();
      if(!length||length>MAX_STATE||core.checkpoint_save())throw new Error('Unable to save this calculator state.');
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
        if(saved.state.length<32||saved.state.length>MAX_STATE)throw new Error('This session version is not supported.');
        const buffer=core.checkpoint_buffer(saved.state.length);
        if(!buffer)throw new Error('Not enough memory to restore this session.');
        new Uint8Array(core.memory.buffer,buffer,saved.state.length).set(saved.state);
        if(core.checkpoint_load(saved.state.length))throw new Error('The session is damaged or incompatible. Your current calculator was not replaced.');
        // Session files created here have no held keys. Also release all inputs
        // on import from a native host; never resurrect a stuck physical key.
        if(isPlayable(model,preset)) {
          for(let c=0;c<8;c++)for(let r=0;r<7;r++)core.keyboard_matrix(c,r,0);
          for(const pin of [0,4,5,6])core.keyboard_dedicated(pin,0);
        }
        usb?.resetLocal();if(new Uint32Array(core.memory.buffer,core.usb_snapshot(),44)[10])core.usb_connect(0);
        serial=false;irda=false;postMessage({type:'links-reset',generation});
        frameView=saved.frameView;syncTick();lcdFrames.reset();pacer.reset(performance.now());events=[];eventOverflow=false;busy=false;
        postMessage({type:'checkpoint-restored',generation,stopped:state()[28]!==0});snapshot();
      }).catch(error=>{if(token===generation&&job===operation)fail(error);});
    } else if(data.type==='pause') {pause();snapshot();}
    else if(data.type==='run' && loaded && !busy) {if(!running && state()[28]===0){buzzer?.clear();pacer.reset(performance.now());running=true;schedule();snapshot();}}
    else if(data.type==='step' && loaded && !busy) {pause();core.run(1);snapshot();}
    else if(data.type==='reset' && loaded) {++operation;busy=false;autoSaving=false;pause();usb?.resetLocal();serial=false;postMessage({type:'links-reset',generation});core.reset();resetClock();events=[];eventOverflow=false;applySetup(core,model,preset);if(core.profile(model,4))core.sd_reconnect();snapshot();}
    else if(data.type==='configure') {
      if(data.speed!==undefined){if(![0,0.5,1,2].includes(data.speed))throw new Error('Invalid speed');requestedSpeed=data.speed;}
      if(data.transferUnlimited!==undefined){if(typeof data.transferUnlimited!=='boolean')throw new Error('Invalid transfer speed setting');transferUnlimited=data.transferUnlimited;}
      if(data.speed!==undefined||data.transferUnlimited!==undefined)configurePacing(true);
      if(data.sound!==undefined)buzzer?.configure(data.sound);
      if(data.lcdResponse!==undefined)lcdFrames.configure({response:data.lcdResponse});
      if(data.hold!==undefined||data.gap!==undefined){
        if(!Number.isInteger(data.hold)||!Number.isInteger(data.gap)||data.hold<120000||data.hold>2400000||data.gap<120000||data.gap>2400000)throw new Error('Invalid key timing');
        taps.clear(tick);taps.hold=data.hold;taps.gap=data.gap;
      }
    }
    else if(data.type==='tap-sequence' && loaded && running && isPlayable(model,preset)) {taps.pushMany(data.scans);snapshot();}
    else if(data.type==='key-down' && loaded && running && !busy && isPlayable(model,preset)) {taps.press(data.source,data.scan,tick);snapshot();}
    else if(data.type==='key-up' && loaded && isPlayable(model,preset)) {taps.release(data.source,tick,data.cancel===true);snapshot();}
    else if(data.type==='system-chord' && loaded && running && !busy && !transfer?.active && !hostBridge?.active && isPlayable(model,preset)) {taps.systemChord(data.action,tick);snapshot();}
    else if(data.type==='host-bridge-start') {
      if(hostBridge?.active)return;
      try{
        bridgeAddress(data.address);bridgeToken(data.token);
        if(!loaded||busy||!running)throw Object.assign(Error('Calculator is not running'),{code:'hostBridgeNotReady'});
        transfer?.cancel(tick,transferError('hostBridgeBusy','The local device connection owns USB.'));transfer?.resetUsb(tick);usb.disconnect();serial=false;postMessage({type:'links-reset',generation});
        const waitFor=stopHostBridge(),owner=generation,request=data.request,bridge=new BrowserHostBridge(core,{tick:()=>tick,waitFor,notify:status=>postMessage({type:'host-bridge-status',generation:owner,request,...status})});hostBridge=bridge;
        void bridge.start(data.address,data.token).catch(error=>{if(hostBridge===bridge)bridge.stop(error.code??'hostBridgeNetwork');});
      }catch(error){postMessage({type:'host-bridge-status',generation,request:data.request,active:false,ready:false,attached:false,phase:'error',usbipPort:null,errorCode:error.code??'hostBridgeNetwork'});}
    }
    else if(data.type==='host-bridge-stop') {stopHostBridge();}
    else if(data.type==='file-transfer-start') {
      if(Number.isSafeInteger(data.request)&&data.request<=transfer?.lastRequest)return;
      try {
        if(hostBridge?.active)throw transferError('hostBridgeBusy','Disconnect the local device before using the internal transfer connection.');
        if(!loaded||busy||!running)throw transferError('calculatorNotReady','Resume the calculator before starting a file transfer.');
        if(data.transport==='serial'&&!serial)throw transferError('connectFirst','Connect serial before starting a file transfer.');
        transfer.start(data,tick);
      } catch(error) {transferMessage({type:'file-transfer-status',request:data.request,transport:data.transport,active:false,phase:'error',...transferErrorDetails(error)});}
    }
    else if(data.type==='file-transfer-cancel') {
      if(!Number.isSafeInteger(data.request)||data.request<1)return;
      try{transfer?.cancel(tick,transferError('transferCancelled','File transfer cancelled.'),data.request);}
      finally{
        // Messages from this Worker are FIFO. The main thread may retain this
        // request's completed files until this explicit closing barrier, even
        // if start failed or the session ended before cancellation arrived.
        postMessage({type:'file-transfer-cancelled',generation,request:data.request});
      }
    }
    else if(data.type==='serial-connect' && loaded) {if(!data.connected&&transfer?.transport==='serial')transfer.cancel(tick,transferError('linkDisconnected','Serial disconnected.'));serial=Boolean(data.connected);postMessage({type:'serial-status',generation,connected:serial});}
    else if(data.type==='irda-connect') {
      if(!Number.isSafeInteger(data.epoch)||data.epoch<0)throw Error('Invalid infrared connection');
      if(data.epoch<irdaEpoch)return;
      const connected=Boolean(data.connected&&loaded);
      if(!connected||!irda||data.epoch!==irdaEpoch)irdaInput.reset(tick);
      irda=connected;irdaEpoch=data.epoch;
    }
    else if(data.type==='irda-input') {
      if(data.epoch!==irdaEpoch){postMessage({type:'irda-input-result',generation,epoch:data.epoch,request:data.request,tick,accepted:0,discarded:true});return;}
      irdaInput.receive(data,tick);
    }
    else if(data.type==='usb-connect' && loaded) {
      transfer?.resetUsb(tick);
      if(data.connected){if(!running)throw new Error('Resume the calculator before connecting USB.');usb.start(tick);}else usb.disconnect();
    }
    else if(data.type==='usb-send' && loaded) {postMessage({type:'usb-packet',generation,direction:'out',...(transfer?.pending&&transfer.transport==='usb'?{result:4,status:'File transfer owns USB.',accepted:0}:usb.send(data.bytes))});}
    else if(data.type==='usb-read' && loaded) {postMessage({type:'usb-packet',generation,direction:'in',...(transfer?.pending&&transfer.transport==='usb'?{result:4,status:'File transfer owns USB.'}:usb.read())});}
    else if(data.type==='tap' && loaded && running && isPlayable(model,preset)) {taps.push(data.scan);snapshot();}
    else if(data.type==='release') {taps.clear(tick);snapshot();}
    else if(data.type==='view') {if(data.view!==0 && data.view!==1)throw new Error('Invalid frame view');frameView=data.view;snapshot();}
    else if(data.type==='uart' && loaded) {
      if(transfer?.pending&&transfer.transport==='serial'){postMessage({type:'uart-sent',generation,accepted:0,requested:data.bytes?.length||0});return;}
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
