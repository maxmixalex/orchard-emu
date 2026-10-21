// SPDX-License-Identifier: MIT
// Production WASM throughput in a default-Chrome Worker at fixed guest endpoints.
// Adapted from tools/benchmark-scenes.mjs. Not the production UI/Worker runner.
import {applySetup, setupHash, TapQueue} from '/hp48.js';
import {decodeSession, sha256} from '/session.js';

const assert=(ok,message='Assertion failed')=>{if(!ok)throw Error(message);};
const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const median=a=>{const b=a.toSorted((x,y)=>x-y),n=b.length;return (b[n/2-1]+b[n/2])/2;};
const state=c=>{
  const w=Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
  assert(w[28]===0,`Guest stopped: ${w.slice(28)}`);
  const n=i=>w[i]+w[i+1]*2**32;
  return {ticks:n(22),instructions:n(20),exceptions:n(24),pc:w[15]};
};
const checkpoint=c=>{
  assert(c.checkpoint_save()===0,'Checkpoint save failed');
  return new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();
};
const pixels=c=>{
  assert(c.frame_view(1)===0,'LCD failed');
  return new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();
};
function restore(c,saved){
  assert(saved.length===c.checkpoint_size(),'Checkpoint size differs');
  new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),saved.length).set(saved);
  assert(c.checkpoint_load(saved.length)===0,'Checkpoint load failed');
  assert(equal(checkpoint(c),saved),'Restore changed full checkpoint');
}
function create(module,model,rom){
  const c=new WebAssembly.Instance(module,{}).exports;
  assert(c.create(model.model)===0,'Create failed');
  new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);
  assert(c.load(rom.length)===0,'ROM load failed');
  applySetup(c,model.model,model.preset);
  return c;
}
async function replay(c,model,frame,saved,expected){
  restore(c,saved);
  const initial=state(c),start=initial.ticks;
  assert(start===frame.startTick,'Initial tick differs');
  assert(equal(pixels(c),frame.start_pixels),'Initial LCD differs');
  const hold=model.model===1?1500000:600000,gap=model.model===1?600000:360000;
  assert(hold===expected.hold_ticks&&gap===expected.gap_ticks,'Contact settings differ');
  const events=[],uartChunks=[];
  let tick=start,nextSample=start,uartBytes=0,runCalls=0;
  const limit=start+expected.measured_ticks;
  const queue=new TapQueue((scan,down,at)=>{
    assert(at===tick,'Contact is off its guest boundary');
    assert(c.keyboard_matrix(Math.floor(scan/7),scan%7,Number(down))===0,'Contact failed');
    events.push([at-start,scan,Number(down)]);
  },hold,gap);
  queue.pushMany(frame.scans);
  const began=performance.now();
  while(tick<limit){
    queue.update(tick);
    if(tick===nextSample)nextSample+=12000;
    // Keep the exact timed-replay call boundaries of benchmark-scenes.mjs.
    const n=Math.min(1024,limit-tick,queue.boundary(tick)-tick,nextSample-tick);
    assert(n>0,'Empty run budget');
    assert(c.run(n)===0,'Guest run stopped');tick+=n;++runCalls;
    const size=c.uart_receive();
    if(size){uartChunks.push(new Uint8Array(c.memory.buffer,c.uart_output(),size).slice());uartBytes+=size;}
  }
  queue.update(tick);
  const ms=performance.now()-began;
  assert(queue.pending===0&&tick>=queue.readyAt,'Final release/gap incomplete');
  const wantedEvents=frame.scans.flatMap((scan,i)=>[[i*(hold+gap),scan,1],[i*(hold+gap)+hold,scan,0]]);
  assert(same(events,wantedEvents)&&same(events,expected.events),'Physical contacts differ');
  const lcd=pixels(c);
  assert(equal(lcd,frame.pixels),'Full result LCD differs');
  const final=state(c);
  assert(final.ticks===tick&&tick-start===expected.measured_ticks,'Endpoint differs');
  assert(final.instructions-initial.instructions===expected.instructions,'Instruction count differs');
  const cp=checkpoint(c),uart=new Uint8Array(uartBytes);
  let at=0;for(const chunk of uartChunks){uart.set(chunk,at);at+=chunk.length;}
  const [cpHash,pixelHash,uartHash]=await Promise.all([sha256(cp),sha256(lcd),sha256(uart)]);
  assert(cpHash===expected.final_checkpoint_sha256,'Frozen baseline checkpoint differs');
  assert(pixelHash===expected.pixel_sha256,'Frozen baseline LCD differs');
  assert(uartHash===expected.uart_sha256,'Frozen baseline UART differs');
  return {ms,initial,final,events,cp,uart,cpHash,pixelHash,uartHash,runCalls};
}

self.onmessage=async({data})=>{
  const report={schema:'orchard-default-chrome-fixed-scenes-v1',passed:false,
    performance_sample:true,measurement_kind:'default-Chrome fixed-workload core throughput; NOT UI latency',
    measurement:'Two complete warmups per variant, then four alternating AB/BA timed replays per scene. Production WASM executes in a dedicated WebWorker under default Chrome with no V8 flags. Loading, explicit compilation, restore, LCD inspection and hashes are outside timing. Key scheduling and UART draining/byte capture are inside; WebCrypto UART hashing is outside. No Worker pacing, UI input, snapshot delivery or canvas rendering is timed.',
    runner:'run',quantum:1024,result_sample_ticks:12000,repeats:4,warmups_per_variant:2,
    user_agent:navigator.userAgent,worker_time_origin_ms:performance.timeOrigin,
    identities:data.identities,cases:[]};
  try{
    const {fixtures,endpoints,roms,sessions}=data;
    const binary=await Promise.all(['/baseline.wasm','/candidate.wasm'].map(async p=>new Uint8Array(await (await fetch(p)).arrayBuffer())));
    const hashes=await Promise.all(binary.map(sha256));
    assert(hashes[0]===data.identities.baseline_wasm_sha256&&hashes[1]===data.identities.candidate_wasm_sha256,'Served WASM identity differs');
    assert(hashes[0]===fixtures.baseline_wasm_sha256&&hashes[0]===endpoints.baseline_wasm_sha256,'Reference baseline differs');
    assert(data.identities.fixture_sha256===endpoints.fixture_sha256,'Frozen endpoint fixtures differ');
    assert(endpoints.passed&&endpoints.runner==='run'&&endpoints.quantum===1024&&endpoints.result_sample_ticks===12000,'Invalid frozen endpoint report');
    const modules=await Promise.all(binary.map(b=>WebAssembly.compile(b)));
    assert(modules.every(m=>WebAssembly.Module.imports(m).length===0),'Unexpected WASM imports');
    const keys=new Set();
    for(const model of fixtures.models){
      const rom=new Uint8Array(roms[model.model]);
      assert(await sha256(rom)===model.rom_sha256&&model.rom_sha256===setupHash(model.preset),'ROM identity differs');
      const machines=modules.map(m=>create(m,model,rom));
      for(const frame of model.frames){
        const key=model.model+':'+frame.expression;
        assert(!keys.has(key),'Duplicate scene');keys.add(key);
        const matches=endpoints.cases.filter(c=>c.model===model.model&&c.expression===frame.expression);
        assert(matches.length===1,'Missing or duplicate frozen endpoint');
        const expected=matches[0],saved=await decodeSession(sessions[frame.session]);
        assert(saved.model===model.model&&saved.romHash===model.rom_sha256&&saved.preset===model.preset&&saved.frameView===1,'Session identity differs');
        assert(await sha256(saved.state)===expected.initial_checkpoint_sha256,'Frozen initial checkpoint differs');
        assert(await sha256(new Uint8Array(frame.start_pixels))===frame.start_sha256&&await sha256(new Uint8Array(frame.pixels))===frame.sha256,'Fixture LCD identity differs');
        let reference=null;const warmups=[];
        const check=r=>{
          if(reference){assert(equal(r.cp,reference.cp),'Full checkpoint byte comparison differs');assert(equal(r.uart,reference.uart),'UART bytes differ');assert(same(r.final,reference.final)&&same(r.events,reference.events)&&r.runCalls===reference.runCalls,'Execution witness differs');}
          else reference=r;
        };
        for(let pass=0;pass<2;++pass)for(let variant=0;variant<2;++variant){
          const r=await replay(machines[variant],model,frame,saved.state,expected);check(r);
          warmups.push({pass,variant:variant?'candidate':'baseline',ms:r.ms});
        }
        const times=[[],[]],order=[];
        for(let repeat=0;repeat<4;++repeat)for(const variant of repeat%2?[1,0]:[0,1]){
          const r=await replay(machines[variant],model,frame,saved.state,expected);check(r);
          times[variant].push(r.ms);order.push({repeat,variant:variant?'candidate':'baseline',ms:r.ms});
        }
        const row={model:model.model,expression:frame.expression,rom_sha256:model.rom_sha256,
          initial_checkpoint_sha256:expected.initial_checkpoint_sha256,final_checkpoint_sha256:reference.cpHash,
          pixel_sha256:reference.pixelHash,uart_sha256:reference.uartHash,uart_bytes:reference.uart.length,
          first_result_ticks:expected.first_result_ticks,measured_ticks:expected.measured_ticks,
          instructions:expected.instructions,hold_ticks:expected.hold_ticks,gap_ticks:expected.gap_ticks,
          events:reference.events,run_calls:reference.runCalls,baseline_ms:times[0],candidate_ms:times[1],
          baseline_median_ms:median(times[0]),candidate_median_ms:median(times[1]),
          speedup:median(times[0])/median(times[1]),warmups,order,
          complete_checkpoint_equal:true,full_lcd_equal:true,uart_bytes_equal:true};
        report.cases.push(row);postMessage({type:'progress',model:row.model,expression:row.expression,baseline_ms:times[0],candidate_ms:times[1],speedup:row.speedup});
      }
    }
    assert(report.cases.length===6&&keys.size===endpoints.cases.length,'Incomplete six-scene coverage');
    report.passed=true;
  }catch(e){report.error=e instanceof Error?e.stack:String(e);}
  postMessage({type:'done',report});
};
