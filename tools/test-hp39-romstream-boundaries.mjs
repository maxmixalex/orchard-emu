// SPDX-License-Identifier: MIT
// Private original-OS regression. Inputs must come from normal OS installation;
// only physical keys, cable signals and USB packets are used after checkpoint load.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {VirtualUSB} from '../web/virtual-usb.js';

const [romPath,checkpointPath,outputPath,modelName='hp39gs',completedCapturePath]=process.argv.slice(2);
const model={hp39gplus:1,hp39gs:2}[modelName];
assert(model&&romPath&&checkpointPath&&outputPath,'ROM INSTALLED-CHECKPOINT PRIVATE-OUTPUT-DIR [hp39gs|hp39gplus] required');
const out=resolve(outputPath);await mkdir(out,{recursive:true});
const [rom,start,wasm]=await Promise.all([readFile(romPath),readFile(checkpointPath),readFile(new URL('../dist/orchard.wasm',import.meta.url))]);
const hash=b=>createHash('sha256').update(b).digest('hex');
let finishStart,finishHost;
if(completedCapturePath){
  const meta=JSON.parse(await readFile(resolve(completedCapturePath,'stock-execution.json'),'utf8'));
  finishStart=await readFile(resolve(completedCapturePath,'before-finish.checkpoint'));
  assert.equal(hash(finishStart),meta.before_finish_checkpoint_sha256);
  assert.equal(meta.rom_sha256,hash(rom));assert.equal(meta.wasm_sha256,hash(wasm));
  assert.equal(meta.model,modelName);finishHost=meta.before_finish_host;
  assert(finishHost.address>0&&finishHost.address<128&&[0,1].includes(finishHost.next_out_pid));
}
const report={schema:'orchard-hp39-romstream-boundaries-v1',model:modelName,
  fixture:process.env.ORCHARD_STOCK_FIXTURE||'unclassified-private-nor',
  rom_sha256:hash(rom),wasm_sha256:hash(wasm),starting_checkpoint_sha256:hash(start),
  hardware_validated:false,guest_memory_patched:false,cases:[]};
// These are complete original-OS LCD frames, separately inspected as images.
const screens={
  unplug:'5d8dcf1fa8194013c60a7f399826d437e3cf9fb8a7d648eaa0b3d86b98ff7f28',
  plug:'59704edb9722237e560d80224c6d1e68f7dc68d527a44329e92be2a952994fef',
  cancelled:'8f73cdc69a087693c929faea63d0d1f1a7d3040f06a59865e0380e5bbc0de5bb',
  reset:'b672c12e0f3b0fbf0265c8c4708a9f6d20799dfe08197b8aac4066da35236b7a',
  lost:'2d15445f5ce03b498c199adeab0abcb8d590dfa70b66f6c68c2a5403f580c67f',
  timeout:'af215a3fab933aed3d094596d80f37c38d93a3622bc2ca3d420c3385817c56a9',
  arithmetic:'abf32ffc5e2fdcfc17172a5351eb6aac13d44a1b432d683f5a1f0c8e2a26844c',
};
const scenarios=['connected-launch','ep0-host-stops','reset-during-read','unplug-during-read','host-read-timeout'];
if(finishStart)scenarios.push('invalid-finish');
for(const scenario of scenarios){
  const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
  assert.equal(c.create(model),0);
  new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);
  const initial=scenario==='invalid-finish'?finishStart:start;
  new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),initial.length).set(initial);assert.equal(c.checkpoint_load(initial.length),0);
  const state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
  let tick=state()[22]+2**32*state()[23],usbError='',poll=true,pid=0;
  const usb=new VirtualUSB(c,c.timebase_hz(),e=>{if(e.error)usbError=e.error;});
  const run=n=>{while(n>0){const q=Math.min(8192,n);assert.equal(c.run(q),0,JSON.stringify(state()));
    n-=q;tick+=q;if(usb.connected&&poll)usb.poll(tick);if(usbError)throw Error(usbError);}};
  const tap=scan=>{
    const key=on=>scan===56?c.keyboard_dedicated(0,on):c.keyboard_matrix(Math.floor(scan/7),scan%7,on);
    assert.equal(key(1),0);run(2000000);assert.equal(key(0),0);run(2000000);
  };
  const frames={};
  async function frame(name,expected){
    c.frame_view(1);const pixels=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();
    frames[name]=hash(pixels);
    await writeFile(resolve(out,scenario+'-'+name+'.pgm'),Buffer.concat([
      Buffer.from('P5\n131 64\n255\n'),Buffer.from(pixels.map(x=>255-x))]));
    if(expected)assert.equal(frames[name],screens[expected],`${scenario}: expected LCD ${expected}`);
  }
  function disconnect(){usb.disconnect();assert.equal(c.gpio_inputs(5,0x8e,0),0);usbError='';}
  function connect(){
    assert.equal(c.gpio_inputs(5,0x8e,2),0);usb.start(tick);
    for(let i=0;i<20000&&usb.phase!=='ready';++i)run(8192);
    assert.equal(usb.phase,'ready');assert.equal(usb.info.name,'HP39 ROM Stream V2');
  }
  function send(command){
    const packet=new Uint8Array(64);packet.set([command.charCodeAt(0),2,72,51,57]);
    for(let i=0;i<20000;++i){const r=usb.out(2,false,pid,packet);
      if(r===0){pid^=1;run(400000);return;}
      assert([1,3].includes(r));run(8192);}
    throw Error('OUT timeout');
  }
  let errorReport;
  if(scenario==='invalid-finish'){
    // Restore an actual post-END state produced by the complete Go capture,
    // preserving its host address/toggle. No guest code or RAM is changed.
    const packet=Uint8Array.of(90,2,72,51,57,...new Uint8Array(59));
    new Uint8Array(c.memory.buffer,c.usb_buffer(),64).set(packet);
    assert.equal(c.usb_out(finishHost.address,2,0,finishHost.next_out_pid,64),0);
    run(2000000);await frame('error');
    assert.equal(c.usb_in(finishHost.address,1,1),0);assert.equal(c.usb_length(),64);
    errorReport=Array.from(new Uint8Array(c.memory.buffer,c.usb_buffer(),5));
    assert.deepEqual(errorReport,[33,2,5,63,2],'E06 must identify completed block 64, read 2');
    disconnect();run(30000000);
  }else{
    disconnect();tap(40);run(16000000);
    if(scenario==='connected-launch')assert.equal(c.gpio_inputs(5,0x8e,2),0);
    tap(6);run(2000000);await frame('launched',scenario==='connected-launch'?'unplug':'plug');
  }
  if(scenario==='connected-launch'){
    assert.equal(c.gpio_inputs(5,0x8e,0),0);run(2000000);await frame('unplugged','plug');
    connect();send('X');run(2000000);await frame('cancelled','cancelled');disconnect();run(30000000);
  }else if(scenario==='ep0-host-stops'){
    assert.equal(c.gpio_inputs(5,0x8e,2),0);assert.equal(c.usb_connect(1),0);
    assert.equal(c.usb_reset_signal(1),0);run(150000);assert.equal(c.usb_reset_signal(0),0);run(200000);
    const setup=Uint8Array.of(128,6,0,1,0,0,18,0);
    new Uint8Array(c.memory.buffer,c.usb_buffer(),8).set(setup);
    assert.equal(c.usb_out(0,0,1,0,8),0);run(100000);
    assert.equal(c.usb_in(0,0,1),0);assert.equal(c.usb_length(),8);
    // Do not read the next descriptor packet; ON must still be serviced.
    run(2000000);tap(56);await frame('cancelled-with-control-pending','cancelled');
    assert.equal(c.usb_connect(0),0);assert.equal(c.gpio_inputs(5,0x8e,0),0);run(30000000);
  }else if(scenario!=='invalid-finish'){
    connect();send('S');run(2000000);await frame('reading');
    if(scenario==='reset-during-read'){
      poll=false;assert.equal(c.usb_reset_signal(1),0);run(2000000);await frame('error','reset');
      assert.equal(c.usb_reset_signal(0),0);disconnect();run(30000000);
    }else if(scenario==='unplug-during-read'){
      disconnect();run(2000000);await frame('error','lost');tap(56);run(30000000);
    }else{
      run(c.timebase_hz()*18);await frame('error','timeout');disconnect();run(30000000);
    }
  }
  tap(48);run(10000000);for(const scan of [26,5,26,6])tap(scan);run(30000000);
  await frame('home-one-plus-one','arithmetic');
  report.cases.push({scenario,frames,returned_to_stock_os:true,arithmetic_after_return_verified:true,
    starting_checkpoint_sha256:hash(initial),error_report_prefix:errorReport,
    final_stop:state()[28],final_tick:tick});
  await writeFile(resolve(out,'boundaries.json'),JSON.stringify(report,null,2)+'\n');
  console.log(scenario,'PASS');
}
