// SPDX-License-Identifier: MIT
// Original-ROM display publication witness. No guest patch, pixel heuristic,
// downloaded firmware or private framebuffer/checkpoint payload in the report.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LCDFrames} from '../web/lcd-frames.js';
import {applySetup,setupHash} from '../web/hp48.js';

const usage='Usage: node tools/probe-lcd-publication.mjs ORIGINAL-NOR NEW-REPORT.json [--checkpoint PRIVATE-CHECKPOINT] [--repeats N]';
const args=process.argv.slice(2);assert(args.length>=2,usage);
let checkpointPath=null,repeats=3;
for(let i=2;i<args.length;i++){
  if(args[i]==='--checkpoint'&&!checkpointPath)checkpointPath=args[++i];
  else if(args[i]==='--repeats')repeats=Number(args[++i]);
  else throw Error(usage);
}
assert(Number.isSafeInteger(repeats)&&repeats>=1&&repeats<=7,usage);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rom=await readFile(args[0]),romHash=sha(rom);
const choices=[[1,'hp39-home'],[2,'hp39gs-home'],[4,'hp48-home'],[5,'hp49-home']];
const admitted=choices.find(([,preset])=>setupHash(preset)===romHash);assert(admitted,'Requires an admitted complete original NOR');
const [model,preset]=admitted,wasm=await readFile(process.env.ORCHARD_WASM||new URL('../dist/orchard.wasm',import.meta.url));
const module=await WebAssembly.compile(wasm);
async function fresh(){const {exports:core}=await WebAssembly.instantiate(module,{});
  assert.equal(core.create(model),0);new Uint8Array(core.memory.buffer,core.rom_buffer(),rom.length).set(rom);
  assert.equal(core.load(rom.length),0);applySetup(core,model,preset);return core;
}
let c=await fresh();
const state=()=>new Uint32Array(c.memory.buffer,c.snapshot(),33).slice();
const time=()=>{const s=state();return s[22]+s[23]*4294967296;};
let tick=0;
function run(n){assert.equal(c.run(n),0,'Original firmware stopped');tick+=n;c.uart_receive();}
function until(end){while(tick<end)run(Math.min(1024,end-tick));}
function key(scan,down){assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,down):c.keyboard_dedicated([0,4,5,6][scan-56],down),0);}
function save(){assert.equal(c.checkpoint_save(),0);return Buffer.from(new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()));}
function restore(bytes){new Uint8Array(c.memory.buffer,c.checkpoint_buffer(bytes.length),bytes.length).set(bytes);assert.equal(c.checkpoint_load(bytes.length),0);tick=time();}
if(checkpointPath)restore(await readFile(checkpointPath));
else{
  until(60000000);key(40,1);until(61500000);key(40,0);until(120000000);
  if(model>=4){key(40,1);until(121500000);key(40,0);until(180000000);}
}
const initial=save(),start=tick,width=c.profile(model,2),height=c.profile(model,3),hz=c.timebase_hz();
const events=[];let length=0;
function tap(scan,label,settle=4500000){events.push({at:length,scan,down:1,label},{at:length+1500000,scan,down:0,label});length+=1500000+settle;}
tap(model<4?49:41,model<4?'APLET':'APPS',18500000);
for(let i=0;i<6;i++)tap(i%2?42:44,i%2?'menu up':'menu down');
tap(model<4?48:56,'HOME / cancel',18500000);
for(const scan of model<4?[26,5,19,6]:[26,6,19,5])tap(scan,'arithmetic',1500000);
length+=12000000;
const end=start+length;
function raw(){const status=c.frame_view(1);assert.equal(status,0);return new Uint8Array(c.memory.buffer,c.frame_buffer(),width*height).slice();}
async function replay(sync,inspect=false){
  // Host observer policy intentionally survives checkpoint restores. A fresh
  // core prevents a previous synchronized trial from enabling the raw baseline.
  c=await fresh();restore(initial);const source=new LCDFrames();if(sync)source.read(c,model,1,tick,true);
  let next=0,nextFrame=start,previous=null,observations=0,changed=0,sameScanChanges=0,off=0;
  let sourceChanges=0,sourceFrame=source.frame,maxAge=0;
  const serials=new Set(),transitions=[],hashes=new Map();
  const observe=()=>{
    const regs=new Uint32Array(c.memory.buffer,c.peripheral_snapshot(),6);
    const serial=regs[4]+regs[5]*4294967296,enabled=Boolean(regs[0]&1);
    const frame=sync?source.read(c,model,1,tick):{pixels:raw(),frameTick:tick,frameSerial:serial};
    assert.equal(frame.pixels.length,width*height);
    if(!inspect)return;
    const signature=sha(frame.pixels);observations++;serials.add(serial);if(!enabled)off++;
    if(previous&&previous.signature!==signature){changed++;if(previous.serial===serial)sameScanChanges++;}
    if(!previous||previous.signature!==signature)transitions.push({tick:tick-start,scan:serial,source_tick:frame.frameTick-start,sha256:signature});
    previous={signature,serial};maxAge=Math.max(maxAge,tick-frame.frameTick);
    const seen=hashes.get(serial)||new Set();seen.add(signature);hashes.set(serial,seen);
  };
  const cpuStart=process.cpuUsage(),began=performance.now();
  while(tick<end){
    while(events[next]&&start+events[next].at===tick){const e=events[next++];key(e.scan,e.down);observe();}
    if(tick===nextFrame){observe();nextFrame+=Math.round(hz*.033);}
    const n=Math.min(1024,end-tick,(events[next]?start+events[next].at:end)-tick,nextFrame-tick);
    assert(n>0);run(n);
    if(sync){const frame=source.read(c,model,1,tick);if(frame!==sourceFrame){sourceChanges++;sourceFrame=frame;}}
  }
  observe();const elapsed=performance.now()-began,cpu=process.cpuUsage(cpuStart);
  const final=save();
  return {elapsed,cpuMs:(cpu.user+cpu.system)/1000,final,observations,changed,sameScanChanges,
    scans:serials.size,multiImageScans:[...hashes.values()].filter(set=>set.size>1).length,off,
    sourceChanges,maxAge,transitions};
}
const baseline=await replay(false,true),candidate=await replay(true,true);
assert(baseline.final.equals(candidate.final),'Display publication mutated CPU/RAM/peripheral state');
assert.equal(candidate.sameScanChanges,0,'Healthy continuous scans must publish one image per scan');
// The scan cache is an observer: duplicate reads also cannot change a single
// checkpoint byte, and stable screens do not allocate another decoded image.
const probe=new LCDFrames(),before=save(),at=time();probe.read(c,model,1,at,true);
const image=probe.frame;for(let i=0;i<1000;i++)assert.equal(probe.read(c,model,1,at),image);
assert(save().equals(before));
// Warm both paths, then alternate order to limit one-sided JIT/cache bias.
await replay(false);await replay(true);const timing=[[],[]],cpuTiming=[[],[]];
for(let round=0;round<repeats;round++)for(const index of round%2?[1,0]:[0,1]){
  const result=await replay(Boolean(index));assert(result.final.equals(baseline.final));
  timing[index].push(result.elapsed);cpuTiming[index].push(result.cpuMs);
}
const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
const summary=({final,transitions,elapsed,cpuMs,...rest})=>rest;
const report={schema:'orchard-lcd-publication-v1',passed:true,model,preset,rom_sha256:romHash,wasm_sha256:sha(wasm),
  probe_sha256:sha(await readFile(new URL(import.meta.url))),source_sha256:sha(await readFile(new URL('../web/lcd-frames.js',import.meta.url))),
  scope:'Original firmware and physical keys in 1024-tick chunks; independent fresh cores per trial. Requests at 33 virtual ms and each key transition. Uses native completed-boundary publication when available, otherwise the older after-slice cache. Host canvas/compositor and physical panel response are separate.',
  native_completed_boundary:typeof c.lcd_observe==='function',
  clock_scope:'Functional 12 MHz reference pacing; this is not physical ARM/LCD calibration.',
  start_tick:start,end_tick:end,events,baseline:summary(baseline),candidate:summary(candidate),
  identical_final_checkpoint:true,final_checkpoint_sha256:sha(baseline.final),
  read_only_checkpoint_equal:true,baseline_ms:timing[0],candidate_ms:timing[1],baseline_cpu_ms:cpuTiming[0],candidate_cpu_ms:cpuTiming[1],
  median_elapsed_ratio:median(timing[1])/median(timing[0]),median_cpu_ratio:median(cpuTiming[1])/median(cpuTiming[0]),
  transitions:{baseline:baseline.transitions,candidate:candidate.transitions}};
await writeFile(args[1],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({model,baseline:report.baseline,candidate:report.candidate,median_elapsed_ratio:report.median_elapsed_ratio,median_cpu_ratio:report.median_cpu_ratio,identical_final_checkpoint:true}));
