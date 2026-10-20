# SPDX-License-Identifier: MIT
"""Local original-ROM input-to-result comparison in two production browser builds.

Requires Node, Playwright and Chrome/Chromium. Firmware is chosen through the
real page's file input, never served or uploaded. Each trial restores an exact
session produced by the baseline interpreter, enters arithmetic through the
actual keyboard handler or clicks fixture-defined calculator keys, and compares
every LCD pixel with the baseline replay.
Each expression restores its own exact starting checkpoint so the second trial
does not inherit a partially elapsed release gap. The endpoint is reception of
the first matching Worker LCD snapshot, before the page's next canvas paint.
This measures restored-HOME interactions, not cold boot or real hardware speed.
On a stopped-guest failure, the original screenshot and observation report are
preserved before the existing Save control exports a local diagnostic session.
This recovery runs only after the measurement has already failed.
An explicit --diagnostic-trace mode wraps the served Worker to record exact
guest API calls and complete checkpoints for local replay. These instrumented
runs never produce performance samples.
"""
from __future__ import annotations

import argparse
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
from urllib.parse import unquote, urlsplit

from playwright.sync_api import expect, sync_playwright


PREPARE = r'''
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [dist,romDir,out,selected='1,4']=process.argv.slice(2),hash=b=>createHash('sha256').update(b).digest('hex');
const selectedModels=selected.split(',').map(Number);
const {applySetup,setupHash,TapQueue}=await import(pathToFileURL(resolve(dist,'hp48.js')));
const {encodeSession}=await import(pathToFileURL(resolve(dist,'session.js')));
const wasm=await readFile(resolve(dist,'orchard.wasm')),reports=[];
for(const [model,name,preset,homeAt] of [[1,'39g+.bin','hp39-home',100000000],[4,'48gii.bin','hp48-home',160000000]]){
 if(!selectedModels.includes(model))continue;
 const rom=await readFile(resolve(romDir,name));assert.equal(hash(rom),setupHash(preset));
 const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});assert.equal(c.create(model),0);
 new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);applySetup(c,model,preset);
 let tick=0;
 const key=(scan,down)=>assert.equal(c.keyboard_matrix(Math.floor(scan/7),scan%7,Number(down)),0);
 const run=end=>{while(tick<end){const n=Math.min(1024,end-tick);assert.equal(c.run(n),0);tick+=n;c.uart_receive();}};
 for(const at of model===1?[50000000]:[60000000,120000000]){run(at);key(40,true);run(at+600000);key(40,false);}
 run(homeAt);
 const queue=new TapQueue(key,model===1?1500000:600000,model===1?900000:360000),frames=[];
 for(const [expression,scans] of [['1+1',[26,5,26,6]],['7*8',[24,3,17,6]]]){
  assert.equal(queue.pending,0);assert(tick>=queue.readyAt,'A starting state must be past the previous release gap');
  assert.equal(c.frame_view(1),0);
  const before=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice(),startTick=tick;
  assert.equal(c.checkpoint_save(),0);
  const state=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();
  const session=resolve(out,model+'-'+frames.length+'.ord');
  await writeFile(session,await encodeSession({model,romHash:hash(rom),preset,frameView:1,state}),{flag:'wx'});
  queue.pushMany(scans);const end=tick+20000000;
  while(tick<end){queue.update(tick);const n=Math.min(1024,end-tick,queue.boundary(tick)-tick);assert(n>0);assert.equal(c.run(n),0);tick+=n;c.uart_receive();}
  queue.update(tick);assert.equal(c.frame_view(1),0);
  const pixels=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();
  assert.notDeepEqual(pixels,before,'The expected result must differ from the starting screen');
  frames.push({expression,scans,startTick,session,start_sha256:hash(before),start_pixels:[...before],sha256:hash(pixels),pixels:[...pixels]});
 }
 reports.push({model,name,preset,homeAt,rom_sha256:hash(rom),frames});
}
console.log(JSON.stringify({node:process.version,baseline_wasm_sha256:hash(wasm),models:reports}));
'''


OBSERVER = r'''
(() => {
 const probe=globalThis.__orchardProbe={seq:0,nextWorker:0,workerId:null,generation:null,
  snap:null,watch:null,errors:[],events:[],configured:null,restoreCommand:null,
  restoreMarker:null,restoreSnapshot:null,runCommand:null,runSnapshot:null,
  pauseCommand:null,pauseSnapshot:null,loaded:null,traceEpoch:null,traceCapture:null,
  traceRestorePending:false,traceErrors:[]};
 const record=(direction,type,workerId,generation)=>{
  const item={seq:++probe.seq,at:performance.now(),direction,type,workerId,generation};
  probe.events.push(item);if(probe.events.length>64)probe.events.shift();return item;
 };
 const same=(a,b)=>Boolean(a&&b&&a.length===b.length&&a.every((v,i)=>v===b[i]));
 probe.arm=({pixels,scans,inputKind='keyboard'})=>{
  if(!probe.snap?.loaded||!probe.snap.running||probe.snap.stopped||!probe.restoreSnapshot)
   throw Error('Input measurement requires an acknowledged restore and running snapshot');
  if(!['keyboard','pointer'].includes(inputKind)||!Array.isArray(scans)||!scans.length)
   throw Error('Invalid input observation');
  if(same(probe.snap.pixels,pixels))throw Error('Expected result is already visible before input');
  probe.watch={workerId:probe.workerId,generation:probe.generation,expected:pixels,expectedScans:scans,
   inputKind,completionScan:inputKind==='pointer'?scans[scans.length-1]:6,
   sentScans:[],keys:[],firstKeyAt:null,enterKeyAt:null,firstSendAt:null,enterSendAt:null,
   enterCommandSeq:null,resultAt:null,resultSeq:null,resultPixels:null};
 };
 const NativeWorker=globalThis.Worker;
 globalThis.Worker=class extends NativeWorker {
  constructor(...args){super(...args);this.probeId=++probe.nextWorker;
   this.addEventListener('error',event=>probe.errors.push(event.message||'Native Worker error'));
   this.addEventListener('messageerror',()=>probe.errors.push('Native Worker message deserialization failed'));
   this.addEventListener('message',({data})=>{
   const event=record('receive',data.type,this.probeId,data.generation);
   if(data.type==='fatal'){probe.errors.push(data.message);return;}
   if(this.probeId!==probe.workerId||data.generation!==probe.generation)return;
   if(data.type==='error'){probe.errors.push(data.message);return;}
   if(data.type==='diagnostic-trace-error'){probe.traceErrors.push(data.message);return;}
   if(data.type==='diagnostic-trace-epoch'){
    if(!Number.isSafeInteger(data.epoch)||data.epoch<=0)return;
    if(probe.traceEpoch&&data.epoch<=probe.traceEpoch.epoch)return;
    if(probe.traceRestorePending&&data.source!=='checkpoint-load')return;
    probe.traceEpoch={...event,epoch:data.epoch,model:data.model,source:data.source,tick:data.tick};
    probe.traceCapture=null;probe.traceRestorePending=false;return;
   }
   if(data.type==='diagnostic-trace'){
    const t=data.trace,e=probe.traceEpoch;
    if(probe.traceRestorePending)return;
    if(!t||!e||t.epoch!==e.epoch||t.generation!==probe.generation||t.model!==e.model)return;
    if(probe.traceCapture)return;
    probe.traceCapture={...event,trace:{...t,initial:t.initial&&Array.from(t.initial),final:t.final&&Array.from(t.final)}};
    return;
   }
   if(data.type==='loaded')probe.loaded=event;
   if(data.type==='checkpoint-restored'&&probe.restoreCommand&&event.seq>probe.restoreCommand.seq)
    probe.restoreMarker={...event,commandSeq:probe.restoreCommand.seq};
   if(data.type!=='snapshot')return;
   const snap={...event,running:data.running,loaded:data.loaded,stopped:data.stopped,
    pending:data.pending,active:data.active,model:data.model,frameStatus:data.frameStatus,
    width:data.width,height:data.height,pixels:data.pixels};
   probe.snap=snap;
   if(probe.restoreMarker&&!probe.restoreSnapshot&&event.seq>probe.restoreMarker.seq)
    probe.restoreSnapshot={...snap,commandSeq:probe.restoreMarker.commandSeq,markerSeq:probe.restoreMarker.seq};
   if(probe.runCommand&&event.seq>probe.runCommand.seq&&snap.running)
    probe.runSnapshot={...event,commandSeq:probe.runCommand.seq};
   if(probe.pauseCommand&&!probe.pauseSnapshot&&event.seq>probe.pauseCommand.seq&&!snap.running&&!snap.stopped)
    probe.pauseSnapshot={...event,commandSeq:probe.pauseCommand.seq};
   const w=probe.watch;
   if(!w||w.workerId!==this.probeId||w.generation!==data.generation||w.resultAt!==null||
      w.firstKeyAt===null||w.enterKeyAt===null||w.enterSendAt===null||event.seq<=w.enterCommandSeq||
      !same(w.sentScans,w.expectedScans)||!snap.running||snap.stopped||snap.frameStatus||!data.pixels)return;
   if(same(data.pixels,w.expected)){
    w.resultAt=event.at;w.resultSeq=event.seq;w.pendingAtResult=data.pending;w.resultPixels=data.pixels;
   }
  });}
  postMessage(data,...rest){
   const event=record('send',data.type,this.probeId,data.generation);
   if(data.type==='create'){
    globalThis.__orchardTraceWorker=this;
    probe.workerId=this.probeId;probe.generation=data.generation;probe.snap=null;probe.watch=null;
    probe.loaded=null;probe.configured=null;probe.restoreCommand=null;probe.restoreMarker=null;
    probe.restoreSnapshot=null;probe.runCommand=null;probe.runSnapshot=null;probe.pauseCommand=null;probe.pauseSnapshot=null;
    probe.traceEpoch=null;probe.traceCapture=null;probe.traceRestorePending=false;probe.traceErrors=[];
   }
   if(this.probeId!==probe.workerId||data.generation!==probe.generation)return super.postMessage(data,...rest);
   if(data.type==='configure'&&data.speed!==undefined)probe.configured={...event,speed:data.speed};
   if(data.type==='checkpoint-load'){
    probe.restoreCommand=event;probe.restoreMarker=null;probe.restoreSnapshot=null;probe.watch=null;
    probe.runCommand=null;probe.runSnapshot=null;probe.pauseCommand=null;probe.pauseSnapshot=null;
    probe.traceCapture=null;probe.traceRestorePending=true;
   }
   if(data.type==='run'){probe.runCommand=event;probe.runSnapshot=null;probe.pauseCommand=null;probe.pauseSnapshot=null;}
   if(data.type==='pause'){probe.pauseCommand=event;probe.pauseSnapshot=null;}
   const w=probe.watch;
   if(w&&(data.type==='tap-sequence'||data.type==='tap')){
    const scans=data.type==='tap'?[data.scan]:data.scans;
    if(w.firstSendAt===null)w.firstSendAt=event.at;
    w.sentScans.push(...scans);
    if(scans.includes(w.completionScan)){w.enterSendAt=event.at;w.enterCommandSeq=event.seq;}
   }
   return super.postMessage(data,...rest);
  }
 };
 addEventListener('keydown',event=>{
  const w=probe.watch;if(!w||w.inputKind!=='keyboard'||w.resultAt!==null||event.repeat||/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(event.code))return;
  const at=performance.now();w.keys.push({code:event.code,at});
  if(w.firstKeyAt===null)w.firstKeyAt=at;
  if(event.code==='Enter')w.enterKeyAt=at;
 },true);
 addEventListener('click',event=>{
  const w=probe.watch;if(!w||w.inputKind!=='pointer'||w.resultAt!==null)return;
  const target=event.target?.closest?.('.traditional-key[data-scan]');if(!target)return;
  const scan=Number(target.dataset.scan),at=performance.now();
  w.keys.push({code:'scan:'+scan,at});if(w.firstKeyAt===null)w.firstKeyAt=at;
  if(scan===w.completionScan)w.enterKeyAt=at;
 },true);
})();
'''


DECODE_STOPPED_SESSION = r'''
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [dist,romPath,sessionPath]=process.argv.slice(2);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const {decodeSession}=await import(pathToFileURL(resolve(dist,'session.js')));
const file=new Uint8Array(await readFile(sessionPath)),saved=await decodeSession(file.buffer);
const rom=await readFile(romPath),wasm=await readFile(resolve(dist,'orchard.wasm'));
assert.equal(hash(rom),saved.romHash,'Stopped session belongs to a different ROM');
const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
assert.equal(c.create(saved.model),0);
assert.equal(rom.length,c.profile(saved.model,0));
new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);
assert.equal(c.load(rom.length),0);
assert.equal(saved.state.length,c.checkpoint_size());
new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),saved.state.length).set(saved.state);
assert.equal(c.checkpoint_load(saved.state.length),0);
const words=[...new Uint32Array(c.memory.buffer,c.snapshot(),33)];
assert.notEqual(words[28],0,'Exported session did not preserve the guest stop');
const hex=n=>n.toString(16).padStart(8,'0');
const u64=i=>((BigInt(words[i+1])<<32n)|BigInt(words[i])).toString();
console.log(JSON.stringify({schema:'orchard-stopped-session-diagnostic-v1',
 model:saved.model,preset:saved.preset,frame_view:saved.frameView,
 session_sha256:hash(file),checkpoint_sha256:hash(saved.state),
 rom_sha256:hash(rom),wasm_sha256:hash(wasm),words,
 ticks:u64(22),instructions:u64(20),exceptions:u64(24),
 stop:{code:words[28],pc:hex(words[29]),instruction:hex(words[30]),address:hex(words[31]),detail:hex(words[32])},
 fault_status:hex(words[18]),fault_address:hex(words[19]),
 peripheral_words:[...new Uint32Array(c.memory.buffer,c.peripheral_snapshot(),10)],
 usb_words:[...new Uint32Array(c.memory.buffer,c.usb_snapshot(),44)],
 sram_alias_reads:c.sram_alias_reads().toString(),sram_alias_writes:c.sram_alias_writes().toString(),
 lcd_probe_reads:c.lcd_probe68_reads().toString()}));
'''


def instrument_worker_source(source, module_url):
    """Wrap only the probe server's response; leave all production files intact."""
    marker = 'pacer.hz=core.timebase_hz();'
    if source.count(marker) != 1:
        raise ValueError('Cannot identify the Worker instrumentation boundary')
    wrapper = r'''
  core=attachCoreTrace(core,{
    context:()=>({generation,model,preset,romHash,audience}),
    onEpoch:entry=>postMessage({type:'diagnostic-trace-epoch',...entry}),
    onCapture:trace=>postMessage({type:'diagnostic-trace',generation:trace.generation,
      trace:{...trace,input_queue:{pending:taps.pending,active:taps.active,
        readyAt:taps.readyAt,hold:taps.hold,gap:taps.gap}}}),
  });
  const traceOriginalHandler=self.onmessage;
  self.onmessage=event=>{
    const data=event.data;
    if(data?.type==='diagnostic-trace-export'&&data.generation===generation){
      if(running){postMessage({type:'diagnostic-trace-error',generation,message:'Pause before exporting a diagnostic trace'});return;}
      core.trace_capture('requested-paused');return;
    }
    return traceOriginalHandler(event);
  };
'''
    return ('import {attachCoreTrace} from ' + json.dumps(module_url) + ';\n' +
            source.replace(marker, wrapper + marker))


def chrome_path():
    requested = os.environ.get('CHROMIUM')
    if requested:
        return requested
    for name in ('google-chrome', 'chromium', 'chromium-browser', 'google-chrome-stable'):
        found = shutil.which(name)
        if found:
            return found
    raise RuntimeError('Set CHROMIUM to a Chrome/Chromium executable')


def wait_probe(page, expression, argument=None, timeout=15000):
    return page.wait_for_function('''arg=>{
      const p=globalThis.__orchardProbe;
      if(!p)return false;
      if(p.errors.length)throw Error(p.errors.join('; '));
      if(p.snap?.stopped)throw Error('Guest stopped during browser verification');
      return (''' + expression + ''');
    }''', arg=argument, timeout=timeout)


def choose_file(page, button, path):
    expect(button).to_be_enabled(timeout=15000)
    with page.expect_file_chooser() as chosen:
        button.click()
    chosen.value.set_files(str(path))


def write_pgm(path, pixels, width=131, height=64):
    assert len(pixels) == width * height
    with path.open('xb') as out:
        out.write(f'P5\n{width} {height}\n255\n'.encode('ascii'))
        out.write(bytes(255 - x for x in pixels))


def probe_summary(page):
    return page.evaluate('''()=>{
      const p=globalThis.__orchardProbe;if(!p)return null;
      const brief=s=>s&&Object.fromEntries(Object.entries(s).filter(([k])=>k!=='pixels'));
      return {generation:p.generation,workerId:p.workerId,configured:p.configured,
       loaded:p.loaded,snapshot:brief(p.snap),restoreCommand:p.restoreCommand,
       restoreMarker:p.restoreMarker,restoreSnapshot:brief(p.restoreSnapshot),
       runCommand:p.runCommand,runSnapshot:p.runSnapshot,pauseCommand:p.pauseCommand,
       pauseSnapshot:p.pauseSnapshot,errors:p.errors,events:p.events,
       traceEpoch:p.traceEpoch,traceRestorePending:p.traceRestorePending,traceErrors:p.traceErrors,
       traceCapture:p.traceCapture&&{seq:p.traceCapture.seq,epoch:p.traceCapture.trace.epoch,
        reason:p.traceCapture.trace.reason,complete:p.traceCapture.trace.complete,
        call_count:p.traceCapture.trace.call_count,problems:p.traceCapture.trace.problems},
       watch:p.watch&&Object.fromEntries(Object.entries(p.watch)
        .filter(([k])=>!['expected','resultPixels'].includes(k)))};
    }''')


def capture_failure_evidence(page, evidence, name, errors):
    """Attempt every original artifact before any recovery UI action."""
    capture_errors = []
    observation = None
    try:
        observation = probe_summary(page)
    except Exception as error:
        capture_errors.append({'artifact': 'observation', 'error': str(error)})
    try:
        page.screenshot(path=str(evidence / f'{name}-failure.png'))
    except Exception as error:
        capture_errors.append({'artifact': 'screenshot', 'error': str(error)})
    try:
        pixels = page.evaluate('globalThis.__orchardProbe.snap?.pixels&&Array.from(globalThis.__orchardProbe.snap.pixels)')
        if pixels:
            write_pgm(evidence / f'{name}-failure.pgm', pixels)
    except Exception as error:
        capture_errors.append({'artifact': 'lcd_pgm', 'error': str(error)})
    try:
        with (evidence / f'{name}-failure.json').open('x') as out:
            json.dump({'page_errors': errors, 'probe': observation,
                       'capture_errors': capture_errors}, out, indent=2)
            out.write('\n')
    except Exception as error:
        capture_errors.append({'artifact': 'observation_json', 'error': str(error)})
    return capture_errors


def export_core_trace(page, path, build_dir, rom_path, request=False):
    """Persist an opt-in diagnostic trace and verify it against the same WASM."""
    if request:
        page.evaluate('''()=>{
          const p=globalThis.__orchardProbe;
          if(p.snap?.running)throw Error('Cannot export a running diagnostic trace');
          if(!p.traceCapture)globalThis.__orchardTraceWorker.postMessage({type:'diagnostic-trace-export',generation:p.generation});
        }''')
    page.wait_for_function('''()=>{
      const p=globalThis.__orchardProbe;
      if(p.traceErrors.length)throw Error(p.traceErrors.join('; '));
      const t=p.traceCapture;
      return t&&t.workerId===p.workerId&&t.generation===p.generation&&t.trace.epoch===p.traceEpoch?.epoch;
    }''', timeout=15000)
    trace = page.evaluate('globalThis.__orchardProbe.traceCapture.trace')
    for key in ('initial', 'final'):
        data = trace.pop(key)
        if data is None:
            raise ValueError('Diagnostic trace has no ' + key + ' checkpoint')
        content = bytes(data)
        file = path.with_name(path.stem + '-' + key + '.checkpoint')
        with file.open('xb') as out:
            out.write(content)
        trace[key + '_file'] = file.name
        trace[key + '_sha256'] = hashlib.sha256(content).hexdigest()
    trace['rom_sha256'] = hashlib.sha256(rom_path.read_bytes()).hexdigest()
    trace['wasm_sha256'] = hashlib.sha256((build_dir / 'orchard.wasm').read_bytes()).hexdigest()
    trace['worker_sha256'] = hashlib.sha256((build_dir / 'worker.js').read_bytes()).hexdigest()
    trace['instrumentation_sha256'] = hashlib.sha256(Path(__file__).with_name('browser-core-trace.mjs').read_bytes()).hexdigest()
    with path.open('x') as out:
        json.dump(trace, out, separators=(',', ':'))
        out.write('\n')
    replay_path = path.with_name(path.stem + '-replay.json')
    replay = subprocess.run(['node', str(Path(__file__).with_name('replay-browser-trace.mjs')),
                             str(path), str(rom_path), str(build_dir / 'orchard.wasm'), str(replay_path)],
                            text=True, capture_output=True, timeout=60)
    result = {'trace_file': str(path.resolve()), 'instrumented': True, 'performance_sample': False,
              'complete': trace['complete'], 'call_count': trace['call_count'],
              'reason': trace['reason'], 'epoch': trace['epoch'],
              'key_transitions': [{k: row[k] for k in ('seq', 'name', 'args', 'before', 'after', 'result')}
                                  for row in trace['calls'] if row['name'] in ('keyboard_matrix', 'keyboard_dedicated')],
              'replay_passed': replay.returncode == 0}
    if replay.returncode:
        error_path = path.with_name(path.stem + '-replay-error.txt')
        error_path.write_text(replay.stderr + replay.stdout)
        result['replay_error_file'] = str(error_path.resolve())
    else:
        result['replay_file'] = str(replay_path.resolve())
        result['replay'] = json.loads(replay.stdout)
    return result


def export_stopped_failure(page, session_path, build_dir, rom_path):
    """Use the existing stopped UI's Save action; never alter a running trial."""
    if not page.evaluate('Boolean(globalThis.__orchardProbe?.snap?.stopped)'):
        return None
    if session_path.exists():
        raise FileExistsError('Stopped session evidence already exists: ' + str(session_path))
    close = page.get_by_role('dialog').get_by_role('button', name='Close', exact=True)
    expect(close).to_be_enabled(timeout=5000)
    close.click()
    save = page.get_by_role('button', name='Save', exact=True)
    expect(save).to_be_enabled(timeout=5000)
    with page.expect_download(timeout=15000) as downloaded:
        save.click()
    downloaded.value.save_as(str(session_path))
    result = {'session_file': str(session_path.resolve()),
              'session_bytes': session_path.stat().st_size, 'exported_after_failure': True}
    if build_dir is not None:
        decoded = subprocess.run(['node', '--input-type=module', '-', str(build_dir),
                                  str(rom_path), str(session_path)], input=DECODE_STOPPED_SESSION,
                                 text=True, capture_output=True, check=True, timeout=30)
        diagnostic = json.loads(decoded.stdout)
        path = session_path.with_suffix('.stop.json')
        with path.open('x') as out:
            json.dump(diagnostic, out, indent=2)
            out.write('\n')
        result.update({'diagnostic_file': str(path.resolve()), 'stop': diagnostic['stop'],
                       'ticks': diagnostic['ticks'], 'wasm_sha256': diagnostic['wasm_sha256']})
    return result


def trial(browser, base, variant, fixture, rom_dir, speed, repeat, evidence, build_dir=None,
          diagnostic_trace=False, before_input_ms=0, after_result_ms=0):
    context = browser.new_context(viewport={'width': 1360, 'height': 940}, locale='en-US')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    preferences = {'version': 1, 'view': 'traditional', 'zoom': 100,
                   'pauseOnBlur': False, 'pauseOnHidden': True, 'speed': speed,
                   'autosave': False, 'interval': 30, 'mappings': {}}
    page.add_init_script('localStorage.setItem("orchard:preferences:v1",' +
                         json.dumps(json.dumps(preferences)) + ');')
    page.add_init_script(OBSERVER)
    name = f'{variant}-model{fixture["model"]}-speed{speed:g}-repeat{repeat}'
    try:
        page.goto(base + '/' + variant + '/')
        choose_file(page, page.get_by_role('button', name='Open ROM', exact=True),
                    rom_dir / fixture['name'])
        wait_probe(page, '''p.loaded&&p.snap&&p.snap.seq>p.loaded.seq&&p.snap.loaded&&
          p.snap.model===arg.model&&p.configured?.speed===arg.speed''',
                   {'model': fixture['model'], 'speed': speed})
        measurements = []
        for index, frame in enumerate(fixture['frames']):
            input_kind = frame.get('input_kind', 'keyboard')
            arithmetic_keys = {'1+1': ('1', 'Shift+Equal', '1', 'Enter'),
                               '7*8': ('7', 'Shift+Digit8', '8', 'Enter')}
            if input_kind not in ('keyboard', 'pointer'):
                raise ValueError('Unsupported fixture input kind')
            if input_kind == 'keyboard' and frame['expression'] not in arithmetic_keys:
                raise ValueError('Unsupported keyboard fixture expression')
            choose_file(page, page.get_by_role('button', name='Restore', exact=True),
                        frame['session'])
            confirm = page.get_by_role('dialog').get_by_role('button', name='Restore', exact=True)
            expect(confirm).to_be_enabled()
            # Restore is setup, outside the measured input interval. A loaded
            # host can delay Playwright's click completion even after the
            # Worker has acknowledged the restore. Keep a bounded setup wait;
            # the exact acknowledgement and starting pixels are still required.
            confirm.click(timeout=60000)
            # A pause snapshot sent before WebCrypto completes is insufficient.
            # Only the first snapshot following the matching restored marker
            # acknowledges this exact checkpoint-load command and generation.
            wait_probe(page, '''p.restoreCommand&&p.restoreMarker&&p.restoreSnapshot&&
              p.restoreMarker.commandSeq===p.restoreCommand.seq&&
              p.restoreSnapshot.commandSeq===p.restoreCommand.seq&&
              p.restoreSnapshot.markerSeq===p.restoreMarker.seq&&
              p.restoreSnapshot.seq>p.restoreMarker.seq&&
              p.restoreSnapshot.loaded&&!p.restoreSnapshot.running&&
              p.restoreSnapshot.pending===0&&p.restoreSnapshot.active===null&&
              p.restoreSnapshot.model===arg.model&&p.restoreSnapshot.frameStatus===0&&
              p.restoreSnapshot.pixels?.length===arg.pixels.length&&
              p.restoreSnapshot.pixels.every((v,i)=>v===arg.pixels[i])''',
                       {'model': fixture['model'], 'pixels': frame['start_pixels']})
            restored = page.evaluate('''()=>{const p=globalThis.__orchardProbe;return {
              generation:p.generation,worker:p.workerId,command_seq:p.restoreCommand.seq,
              restored_marker_seq:p.restoreMarker.seq,snapshot_seq:p.restoreSnapshot.seq};}''')
            resume = page.get_by_role('button', name='Resume', exact=True)
            expect(resume).to_be_enabled()
            resume.click()
            wait_probe(page, '''p.runCommand&&p.runSnapshot&&p.snap.running&&
              p.runCommand.seq>p.restoreSnapshot.seq&&
              p.runSnapshot.commandSeq===p.runCommand.seq&&p.runSnapshot.seq>p.runCommand.seq''')
            expect(page.get_by_role('button', name='Pause', exact=True)).to_be_enabled()
            page.locator('#calculator').focus()
            if before_input_ms:
                floor = page.evaluate('performance.now()')
                wait_probe(page, 'p.snap.running&&performance.now()>=arg', floor + before_input_ms)
            page.evaluate('args=>globalThis.__orchardProbe.arm(args)',
                          {'pixels': frame['pixels'], 'scans': frame['scans'], 'inputKind': input_kind})
            if input_kind == 'pointer':
                for scan in frame['scans']:
                    page.locator(f'.traditional-key[data-scan="{scan}"]').click()
            else:
                for key in arithmetic_keys[frame['expression']]:
                    page.keyboard.press(key)
            wait_probe(page, 'p.watch.resultAt !== null')
            result = page.evaluate('''()=>{const w=globalThis.__orchardProbe.watch;return {
              first_key_to_result_ms:w.resultAt-w.firstKeyAt,
              enter_key_to_result_ms:w.resultAt-w.enterKeyAt,
              first_worker_send_to_result_ms:w.resultAt-w.firstSendAt,
              enter_worker_send_to_result_ms:w.resultAt-w.enterSendAt,
              input_injection_ms:w.enterKeyAt-w.firstKeyAt,
              result_snapshot_seq:w.resultSeq,enter_command_seq:w.enterCommandSeq,
              key_codes:w.keys.map(k=>k.code),sent_scans:w.sentScans,
              pending_at_result:w.pendingAtResult};}''')
            assert result['sent_scans'] == frame['scans'], result
            expected_codes = ([f'scan:{scan}' for scan in frame['scans']] if input_kind == 'pointer' else
                              ['Digit1', 'Equal', 'Digit1', 'Enter'] if frame['expression'] == '1+1' else
                              ['Digit7', 'Digit8', 'Digit8', 'Enter'])
            assert result['key_codes'] == expected_codes, result
            assert result['enter_key_to_result_ms'] >= 0 and result['enter_worker_send_to_result_ms'] >= 0, result
            if input_kind == 'pointer':
                result['last_click_to_result_ms'] = result.pop('enter_key_to_result_ms')
                result['last_worker_send_to_result_ms'] = result.pop('enter_worker_send_to_result_ms')
                result['first_click_to_result_ms'] = result.pop('first_key_to_result_ms')
                result['last_command_seq'] = result.pop('enter_command_seq')
            if diagnostic_trace:
                result = {key: value for key, value in result.items() if not key.endswith('_ms')}
            measurements.append({'expression': frame['expression'], 'frame_sha256': frame['sha256'],
                                 'start_tick': frame['startTick'], 'start_frame_sha256': frame['start_sha256'],
                                 'restore_ack': restored, 'input_kind': input_kind,
                                 'instrumented': diagnostic_trace, **result})
            # Complete the physical release before pausing. The next expression
            # restores its own checkpoint, avoiding a residual readyAt gap.
            wait_probe(page, 'p.snap.pending===0&&p.snap.seq>=p.watch.resultSeq')
            if after_result_ms:
                wait_probe(page, 'p.snap.running&&performance.now()>=p.watch.resultAt+arg', after_result_ms)
            pause = page.get_by_role('button', name='Pause', exact=True)
            expect(pause).to_be_enabled()
            pause.click()
            wait_probe(page, '''p.pauseCommand&&p.pauseSnapshot&&!p.snap.running&&
              p.pauseSnapshot.commandSeq===p.pauseCommand.seq&&p.pauseSnapshot.seq>p.pauseCommand.seq''')
            if diagnostic_trace:
                diagnostic = export_core_trace(page, evidence / f'{name}-expression{index}-trace.json',
                                               build_dir, rom_dir / fixture['name'], request=True)
                measurements[-1]['diagnostic'] = diagnostic
                assert diagnostic['complete'] and diagnostic['replay_passed'], diagnostic
            if repeat == 0 and variant == 'candidate':
                pixels = page.evaluate('Array.from(globalThis.__orchardProbe.watch.resultPixels)')
                write_pgm(evidence / f'{name}-result{index}.pgm', pixels)
                if index == 1:
                    page.screenshot(path=str(evidence / f'{name}-ui.png'))
            page.evaluate('globalThis.__orchardProbe.watch=null')
        errors += page.evaluate('globalThis.__orchardProbe.errors')
        assert not errors, errors
        assert not page.evaluate('globalThis.__orchardProbe.snap.stopped')
        return {'variant': variant, 'model': fixture['model'], 'speed': speed,
                'instrumented': diagnostic_trace, 'performance_sample': not diagnostic_trace,
                'restored_home': True, 'exact_start_states': True, 'pixel_equality': True, 'pause': True,
                'errors': errors, 'measurements': measurements}
    except Exception:
        capture_errors = capture_failure_evidence(page, evidence, name, errors)
        diagnostic = None
        if diagnostic_trace:
            try:
                if page.evaluate('Boolean(globalThis.__orchardProbe?.traceCapture)'):
                    diagnostic = export_core_trace(page, evidence / f'{name}-failure-trace.json',
                                                   build_dir, rom_dir / fixture['name'])
            except Exception as error:
                capture_errors.append({'artifact': 'core_trace', 'error': str(error)})
        # Keep the failed observation intact. This UI action happens only after
        # failure, and preserves the full stopped guest without modifying Worker
        # source, input timing, or the normal measurement path.
        try:
            recovery = export_stopped_failure(page, evidence / f'{name}-failure.ord',
                                              build_dir, rom_dir / fixture['name'])
        except Exception as error:
            session_path = evidence / f'{name}-failure.ord'
            recovery = {'exported_after_failure': session_path.is_file(), 'error': str(error)}
            if session_path.is_file():
                recovery.update({'session_file': str(session_path.resolve()),
                                 'session_bytes': session_path.stat().st_size})
        if capture_errors:
            if recovery is None:
                recovery = {'exported_after_failure': False}
            recovery['capture_errors'] = capture_errors
        if diagnostic is not None:
            if recovery is None:
                recovery = {'exported_after_failure': False}
            recovery['diagnostic'] = diagnostic
        if recovery is not None:
            try:
                with (evidence / f'{name}-failure-recovery.json').open('x') as out:
                    json.dump(recovery, out, indent=2)
                    out.write('\n')
            except Exception:
                pass
        raise
    finally:
        context.close()


def main():
    probe_sha256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline_dist', type=Path)
    parser.add_argument('candidate_dist', type=Path)
    parser.add_argument('rom_directory', type=Path)
    parser.add_argument('new_report', type=Path)
    parser.add_argument('--repeats', type=int, default=3, choices=range(1, 8))
    parser.add_argument('--speeds', default='1,0', help='Comma-separated existing speed settings: 0,.5,1,2')
    parser.add_argument('--models', default='1,4', help='Comma-separated original-ROM models: 1,4')
    parser.add_argument('--fixtures', type=Path, help='Private exact-checkpoint fixture JSON from probe-aplet-latency.mjs; skips repeated cold boot')
    parser.add_argument('--diagnostic-trace', action='store_true', help='Record and replay exact core calls; disables timing evidence')
    parser.add_argument('--before-input-ms', type=int, default=0, help='Diagnostic-only wait after Resume, before typing (0..2000)')
    parser.add_argument('--after-result-ms', type=int, default=0, help='Diagnostic-only dwell after the matching result (0..2000)')
    args = parser.parse_args()
    speeds = [float(x) for x in args.speeds.split(',')]
    if not speeds or any(x not in (0, .5, 1, 2) for x in speeds):
        parser.error('Invalid speed selection')
    models = [int(x) for x in args.models.split(',')]
    if not models or len(models) != len(set(models)) or any(x not in (1, 4) for x in models):
        parser.error('Invalid model selection')
    if not 0 <= args.before_input_ms <= 2000 or not 0 <= args.after_result_ms <= 2000:
        parser.error('Diagnostic waits must be between 0 and 2000 ms')
    if (args.before_input_ms or args.after_result_ms) and not args.diagnostic_trace:
        parser.error('Diagnostic waits require --diagnostic-trace')
    roots = {'baseline': args.baseline_dist.resolve(), 'candidate': args.candidate_dist.resolve()}
    if args.new_report.exists():
        parser.error('Report must be a new path')
    args.new_report.parent.mkdir(parents=True, exist_ok=True)
    evidence = args.new_report.parent / (args.new_report.stem + '-evidence')
    if evidence.exists():
        parser.error('Evidence directory must be a new path: ' + str(evidence))
    evidence.mkdir()

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            parts = unquote(urlsplit(self.path).path).strip('/').split('/')
            if args.diagnostic_trace and len(parts) == 2 and parts[0] in roots:
                body = None
                if parts[1] == '__orchard-trace.mjs':
                    body = Path(__file__).with_name('browser-core-trace.mjs').read_bytes()
                elif parts[1] == 'worker.js':
                    source = (roots[parts[0]] / 'worker.js').read_text()
                    body = instrument_worker_source(source, './__orchard-trace.mjs').encode()
                if body is not None:
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/javascript; charset=utf-8')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
            super().do_GET()

        def translate_path(self, path):
            parts = unquote(urlsplit(path).path).strip('/').split('/')
            root = roots.get(parts[0])
            if root is None or '..' in parts:
                return '/nonexistent-orchard-probe-path'
            target = root.joinpath(*parts[1:]).resolve()
            if target != root and root not in target.parents:
                return '/nonexistent-orchard-probe-path'
            return str(target)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'schema': 'orchard-original-rom-browser-latency-v2', 'passed': False,
              'probe_sha256': probe_sha256,
              'instrumented': args.diagnostic_trace, 'performance_sample': not args.diagnostic_trace,
              'measurement': ('Instrumented diagnostic with exact core API replay; no timing evidence.' if args.diagnostic_trace else
                              'Actual production UI and Worker; each scene restores an exact starting checkpoint. Keydown or calculator-key click to first matching Worker LCD snapshot received on the main thread, before canvas paint. No real-calculator calibration.'),
              'diagnostic_waits_ms': {'before_input': args.before_input_ms, 'after_result': args.after_result_ms},
              'evidence_directory': str(evidence.resolve()), 'trials': [],
              'builds': {name: {asset.replace('.', '_') + '_sha256': hashlib.sha256((path / asset).read_bytes()).hexdigest()
                               for asset in ('orchard.wasm', 'worker.js')}
                         for name, path in roots.items()}}
    try:
        with tempfile.TemporaryDirectory(prefix='orchard-browser-latency-') as tmp:
            if args.fixtures:
                fixture_bytes = args.fixtures.read_bytes()
                fixtures = json.loads(fixture_bytes)
                assert fixtures['baseline_wasm_sha256'] == report['builds']['baseline']['orchard_wasm_sha256'], 'Fixture baseline WASM differs'
                assert sorted(f['model'] for f in fixtures['models']) == sorted(models), 'Fixture model selection differs'
                for fixture in fixtures['models']:
                    assert hashlib.sha256((args.rom_directory / fixture['name']).read_bytes()).hexdigest() == fixture['rom_sha256'], 'Fixture ROM differs'
                    for frame in fixture['frames']:
                        assert len(frame['pixels']) == len(frame['start_pixels']) == 131 * 64
                        assert hashlib.sha256(bytes(frame['pixels'])).hexdigest() == frame['sha256']
                        assert hashlib.sha256(bytes(frame['start_pixels'])).hexdigest() == frame['start_sha256']
                        assert frame['sha256'] != frame['start_sha256'], 'Expected result is already visible'
                        assert Path(frame['session']).is_file(), 'Fixture session is missing'
                report['fixture_sha256'] = hashlib.sha256(fixture_bytes).hexdigest()
            else:
                prepared = subprocess.run(['node', '--input-type=module', '-', str(roots['baseline']),
                                           str(args.rom_directory.resolve()), tmp, ','.join(map(str, models))], input=PREPARE,
                                          text=True, capture_output=True, check=True, timeout=300)
                fixtures = json.loads(prepared.stdout)
            report['reference'] = {k: v for k, v in fixtures.items() if k != 'models'}
            report['roms'] = [{k: f[k] for k in ('model', 'rom_sha256', 'homeAt')} for f in fixtures['models']]
            report['reference_frames'] = []
            for fixture in fixtures['models']:
                for index, frame in enumerate(fixture['frames']):
                    write_pgm(evidence / f'reference-model{fixture["model"]}-result{index}.pgm', frame['pixels'])
                    report['reference_frames'].append({'model': fixture['model'], **{k: frame[k]
                        for k in ('expression', 'scans', 'startTick', 'start_sha256', 'sha256')}})
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=chrome_path(), headless=True,
                                           args=['--no-sandbox'])
                try:
                    report['browser'] = browser.version
                    for repeat in range(args.repeats):
                        for fixture in fixtures['models']:
                            for speed in speeds:
                                for variant in (('baseline', 'candidate') if repeat % 2 == 0 else ('candidate', 'baseline')):
                                    item = trial(browser, f'http://127.0.0.1:{server.server_port}', variant,
                                                 fixture, args.rom_directory.resolve(), speed, repeat, evidence,
                                                 roots[variant], diagnostic_trace=args.diagnostic_trace,
                                                 before_input_ms=args.before_input_ms, after_result_ms=args.after_result_ms)
                                    item['repeat'] = repeat
                                    report['trials'].append(item)
                                    print(json.dumps(item), flush=True)
                finally:
                    browser.close()
            report['passed'] = True
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        server.shutdown()
        server.server_close()
        with args.new_report.open('x') as out:
            json.dump(report, out, indent=2)
            out.write('\n')


if __name__ == '__main__':
    main()
