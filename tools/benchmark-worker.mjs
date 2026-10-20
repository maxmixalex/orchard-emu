// SPDX-License-Identifier: MIT
// Opt-in host scheduling measurement; generated guests only, no firmware.
// Uses real Node Worker timers/MessageChannel and one identical production WASM.
// This does not measure browser painting or physical-calculator timing.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';

const sha=b=>createHash('sha256').update(b).digest('hex');
if(!isMainThread) {
  assert.equal(typeof process.threadCpuUsage,'function','This benchmark requires a Node release with process.threadCpuUsage()');
  globalThis.self=globalThis;
  globalThis.postMessage=data=>parentPort.postMessage(data);
  const wasm=await readFile(workerData.wasm);
  globalThis.fetch=async()=>new Response(wasm,{status:200});
  parentPort.on('message',data=>self.onmessage?.({data}));
  const url=pathToFileURL(workerData.source);
  let source=(await readFile(url,'utf8'))
    .replace(/^import (.+) from '([^']+)';$/gm,(_,names,path)=>`import ${names} from ${JSON.stringify(new URL(path,url).href)};`)
    .replace("new URL('orchard.wasm',import.meta.url)",JSON.stringify(pathToFileURL(workerData.wasm).href));
  source+=`
  const originalRun=core.run,originalPump=pump,originalHandler=self.onmessage;
  let measured,startWall,startCpu;
  core={...core,run:n=>{
    if(measured){++measured.calls;measured.ticks+=n;measured.minimum=Math.min(measured.minimum,n);measured.smallCalls+=Number(n<256);}
    return originalRun(n);
  }};
  pump=()=>{
    const start=performance.now();originalPump();
    if(measured){const elapsed=performance.now()-start;++measured.tasks;measured.taskMs+=elapsed;measured.maxTaskMs=Math.max(measured.maxTaskMs,elapsed);}
  };
  self.onmessage=({data})=>{
    if(data.type==='measure-run'){
      measured={calls:0,ticks:0,minimum:Infinity,smallCalls:0,tasks:0,taskMs:0,maxTaskMs:0};
      startWall=performance.now();startCpu=process.threadCpuUsage();
      originalHandler({data:{type:'run',generation}});
      postMessage({type:'measure-started'});
    }else if(data.type==='measure-stop'){
      const elapsedMs=performance.now()-startWall,cpu=process.threadCpuUsage(startCpu);
      originalHandler({data:{type:'pause',generation}});
      const s=state();const status=core.checkpoint_save();if(status)throw Error('Checkpoint failed');
      const saved=new Uint8Array(core.memory.buffer,core.checkpoint_buffer(),core.checkpoint_size()).slice();
      postMessage({type:'measure-result',...measured,elapsedMs,cpuUs:cpu.user+cpu.system,guestTicks:s[22]+s[23]*4294967296,saved});
      measured=null;
    }else originalHandler({data});
  };`;
  await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
} else {
  const args=process.argv.slice(2);
  assert.equal(args.length,4,'Usage: node tools/benchmark-worker.mjs BASELINE-WORKER.js CANDIDATE-WORKER.js SAME-PRODUCTION.wasm NEW-REPORT.json');
  const [baseline,candidate,wasmPath,output]=args.map(p=>resolve(p));
  const binary=await readFile(wasmPath),compiled=await WebAssembly.compile(binary);
  function romFor(idle){
    const rom=new Uint8Array(1048576).fill(255),view=new DataView(rom.buffer);
    const words=idle?[0xea000000,0xeafffffe,0xe59f000c,0xe3a01000,0xe5801000,0xee071f90,0xeafffffd,0x53000000]
      :[0xea000002,0,0,0,0xe59f0008,0xe3a01000,0xe5801000,0xeafffffe,0x53000000];
    words.forEach((n,i)=>view.setUint32(4*i,n,true));return rom;
  }
  class Client {
    constructor(source){
      this.worker=new Worker(new URL(import.meta.url),{workerData:{source,wasm:wasmPath}});this.waiters=[];this.failure=null;
      this.worker.on('message',data=>{
        if(data.type==='error'||data.type==='fatal'){this.fail(Error(data.message));return;}
        for(const w of [...this.waiters])if(w.filter(data))w.finish(null,data);
      });
      this.worker.on('error',e=>this.fail(e));
    }
    fail(e){this.failure=e;for(const w of [...this.waiters])w.finish(e);}
    wait(filter){
      if(this.failure)return Promise.reject(this.failure);
      return new Promise((resolve,reject)=>{
        const w={filter,finish:(e,d)=>{clearTimeout(w.timer);this.waiters=this.waiters.filter(x=>x!==w);e?reject(e):resolve(d);}};
        w.timer=setTimeout(()=>w.finish(Error('Timed out')),10000);this.waiters.push(w);
      });
    }
    send(type,extra,filter){const promise=this.wait(filter||((d)=>d.type===type));this.worker.postMessage({type,generation:1,...extra});return promise;}
    async close(){this.fail(Error('Closed'));await this.worker.terminate();}
  }
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function once(source,speed,idle){
    const client=new Client(source),rom=romFor(idle);
    try {
      await client.wait(d=>d.type==='ready');
      await client.send('create',{model:1,preset:'strict',audience:'calculator'},d=>d.type==='created');
      await client.send('load',{rom:rom.buffer},d=>d.type==='loaded');
      client.worker.postMessage({type:'configure',generation:1,speed});
      await client.send('run',{},d=>d.type==='snapshot'&&d.running);
      await sleep(80);
      await client.send('reset',{},d=>d.type==='links-reset');
      await client.send('measure-run',{},d=>d.type==='measure-started');
      await sleep(650);
      const sent=performance.now();const result=await client.send('measure-stop',{},d=>d.type==='measure-result');
      result.pauseResponseMs=performance.now()-sent;
      assert(Number.isSafeInteger(result.calls)&&result.calls>0,'A sample must execute core calls');
      assert(Number.isSafeInteger(result.ticks)&&result.ticks>0,'A sample must advance guest time');
      assert(Number.isFinite(result.elapsedMs)&&result.elapsedMs>0,'A sample needs positive finite wall time');
      assert(Number.isFinite(result.cpuUs)&&result.cpuUs>=0,'A sample needs a valid thread CPU reading');
      assert.equal(result.guestTicks,result.ticks,'Measured core runs must account for every guest tick');
      const reference=(await WebAssembly.instantiate(compiled,{})).exports;
      assert.equal(reference.create(1),0);
      new Uint8Array(reference.memory.buffer,reference.rom_buffer(),rom.length).set(rom);
      assert.equal(reference.load(rom.length),0);
      for(let tick=0;tick<result.guestTicks;){const count=Math.min(1024,result.guestTicks-tick);assert.equal(reference.run(count),0);reference.uart_receive();tick+=count;}
      assert.equal(reference.checkpoint_save(),0);
      const saved=new Uint8Array(reference.memory.buffer,reference.checkpoint_buffer(),reference.checkpoint_size());
      assert.deepEqual(result.saved,saved,'Pacing changed complete serialized guest state');
      delete result.saved;delete result.type;
      result.fullCheckpointReplay=true;result.cpuPercent=result.cpuUs/(result.elapsedMs*10);
      result.meanBudget=result.ticks/result.calls;result.guestTicksPerSecond=result.ticks/(result.elapsedMs/1000);
      assert([result.cpuPercent,result.meanBudget,result.guestTicksPerSecond,result.pauseResponseMs].every(Number.isFinite),
        'Derived timing statistics must be finite');
      return result;
    }finally{await client.close();}
  }
  const reports=[];
  const smoke=Boolean(process.env.ORCHARD_WORKER_SMOKE);
  for(let round=0;round<(smoke?1:3);round++)for(const idle of (smoke?[false]:[false,true]))for(const speed of (smoke?[1]:[.5,1,2]))for(const variant of round%2?['candidate','baseline']:['baseline','candidate']){
    const measured=await once(variant==='baseline'?baseline:candidate,speed,idle);
    const result={round,guest:idle?'WFI':'branch',speed,variant,...measured};reports.push(result);
    console.log(JSON.stringify({round,guest:result.guest,speed,variant,cpuPercent:measured.cpuPercent,calls:measured.calls,meanBudget:measured.meanBudget,guestMHz:measured.guestTicksPerSecond/1e6,pauseMs:measured.pauseResponseMs}));
  }
  const report={schema:1,node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,
    wasmSha256:sha(binary),baselineWorkerSha256:sha(await readFile(baseline)),candidateWorkerSha256:sha(await readFile(candidate)),
    boundary:'Node Worker using real native timers and MessageChannel, instrumented production Worker module and same WASM. Generated ARM branch/WFI guests. No browser paint, stock ROM or physical-device comparison. 80ms warm-up, reset, 650ms requested sample; actual sample and thread CPU measured on Worker. Full checkpoint independently replayed for actual tick count.',reports};
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
