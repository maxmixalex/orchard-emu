// SPDX-License-Identifier: MIT
// Actual HTTP-loaded production Worker/WASM. No timer, core or ROM-hash mocks.
import {TaskScheduler} from '../dist/task-scheduler.js';
import {checkScheduler} from './browser-scheduler-check.js';
import {decodeSession} from '../dist/session.js';
class Client {
  constructor(){
    this.worker=new Worker(new URL('../dist/worker.js',import.meta.url),{type:'module'});
    this.waiters=[];this.messages=[];this.failure=null;
    this.worker.onmessage=({data})=>{
      this.messages.push(data);
      if(data.type==='error'||data.type==='fatal')this.fail(Error(data.message));
      else for(const waiter of [...this.waiters])if(waiter.filter(data))waiter.finish(null,data);
    };
    this.worker.onerror=event=>this.fail(Error(event.message||'Worker script failed'));
    this.worker.onmessageerror=()=>this.fail(Error('Worker message deserialization failed'));
  }
  fail(error){this.failure=error;for(const w of [...this.waiters])w.finish(error);}
  wait(filter){
    if(this.failure)return Promise.reject(this.failure);
    return new Promise((resolve,reject)=>{
      const waiter={filter,finish:(error,data)=>{clearTimeout(waiter.timer);this.waiters=this.waiters.filter(w=>w!==waiter);error?reject(error):resolve(data);}};
      waiter.timer=setTimeout(()=>waiter.finish(Error('Worker response timeout')),10000);this.waiters.push(waiter);
    });
  }
  send(type,extra,filter){const result=this.wait(filter);this.worker.postMessage({type,generation:1,...extra});return result;}
  close(){this.fail(Error('Worker closed'));this.worker.terminate();}
}
function check(condition,message){if(!condition)throw Error(message);}
const snapshot=data=>data.type==='snapshot';
// Replies can arrive in different task turns from WebCrypto completion. A
// previous command's trailing snapshot must never acknowledge the next command.
function after(marker,filter){let seen=false;return data=>{if(data.type===marker)seen=true;return seen&&filter(data);};}
async function checkWorker(model,audience){
  const client=new Client();
  try{
    await client.wait(d=>d.type==='ready');
    const created=await client.send('create',{model,preset:'strict',audience},d=>d.type==='created');
    // ARM-only fixture: valid reset branch, disable watchdog, then loop. No HP bytes.
    const rom=new Uint8Array(created.flash),words=new DataView(rom.buffer);
    [0xea000002,0,0,0,0xe59f0008,0xe3a01000,0xe5801000,0xeafffffe,0x53000000].forEach((v,i)=>words.setUint32(i*4,v,true));
    await client.send('load',{rom:rom.buffer},d=>d.type==='loaded');
    await client.send('run',{},d=>snapshot(d)&&d.running);
    // At least two timed snapshots prove execution crossed timer fallbacks;
    // merely receiving the immediate 'running' snapshot is insufficient.
    await client.wait(d=>snapshot(d)&&d.running);
    await client.wait(d=>snapshot(d)&&d.running);
    for(const speed of [.5,2,0,1]){
      client.worker.postMessage({type:'configure',generation:1,speed});
      await client.wait(d=>snapshot(d)&&d.running);
    }
    const paused=await client.send('pause',{},d=>snapshot(d)&&!d.running&&d.loaded);
    check(!paused.stopped,`${model}/${audience}: guest stopped`);
    const count=client.messages.length;
    await new Promise(r=>setTimeout(r,60));
    check(client.messages.length===count,`${model}/${audience}: execution continued after pause`);
    const step=await client.send('step',{},snapshot);
    if(audience==='debug')check(step.state[22]===paused.state[22]+1,`${model}: step must advance exactly one tick`);
    else check(!('state' in step),`${model}: CPU data leaked into calculator audience`);
    const saveSnapshot=client.wait(after('checkpoint-saved',snapshot));
    const [saved]=await Promise.all([
      client.send('checkpoint-save',{},d=>d.type==='checkpoint-saved'),saveSnapshot
    ]);
    const decoded=await decodeSession(saved.file.buffer);
    check(decoded.model===model&&decoded.preset==='strict',`${model}: checkpoint identity changed`);
    const reset=await client.send('reset',{},after('links-reset',snapshot));
    check(reset.pending===0&&!reset.running&&!reset.stopped,`${model}: reset did not release/pause`);
    if(audience==='debug')check(reset.state[22]===0,`${model}: reset clock is not zero`);
    await client.send('checkpoint-load',{file:saved.file.buffer},d=>d.type==='checkpoint-restored');
    await client.send('run',{},d=>snapshot(d)&&d.running);
    await client.wait(d=>snapshot(d)&&d.running);
    const final=await client.send('pause',{},d=>snapshot(d)&&!d.running);
    check(!final.stopped,`${model}: resumed guest stopped`);
    return {model,audience,run:true,rates:[.5,2,0,1],pause:true,step:true,reset:true,checkpoint:true,firmware:'generated ARM fixture'};
  }finally{client.close();}
}
const report={browser:navigator.userAgent,secureContext:isSecureContext,transport:'HTTP production modules',firmwareUsed:false,workers:[]};
try{
  check(isSecureContext,'Test must use a secure localhost context');
  report.windowScheduler=await checkScheduler(TaskScheduler);
  // A separate real module Worker checks native setTimeout and clearTimeout.
  const url=URL.createObjectURL(new Blob([
    `import {TaskScheduler} from '${new URL('../dist/task-scheduler.js',import.meta.url)}';\n`+
    `import {checkScheduler} from '${new URL('./browser-scheduler-check.js',import.meta.url)}';\n`+
    `try{postMessage({result:await checkScheduler(TaskScheduler)})}catch(e){postMessage({error:e.message,stack:e.stack})}`
  ],{type:'text/javascript'}));
  const worker=new Worker(url,{type:'module'});let timer;
  try{
    report.workerScheduler=await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(Error('Native scheduler Worker timeout')),10000);
      worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);
      worker.onerror=e=>reject(Error(e.message||'Native scheduler Worker failed'));
    });
  }finally{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);}
  for(const model of [1,2,3,4,5,6])for(const audience of ['calculator','debug'])report.workers.push(await checkWorker(model,audience));
  report.passed=true;
}catch(error){report.passed=false;report.error=error.message;report.stack=error.stack;}
document.querySelector('#result').textContent=JSON.stringify(report,null,2);
globalThis.__orchardBrowserResult=report;
