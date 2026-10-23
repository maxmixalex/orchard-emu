// SPDX-License-Identifier: MIT
// Private original-ROM integration bridge for the real Go receiver. Restores a
// checkpoint produced solely by normal stock-OS file transfer, then uses keys
// and physical USB packets. Never installs payload bytes by editing guest RAM.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {applySetup} from '../web/hp48.js';
import {VirtualUSB} from '../web/virtual-usb.js';

const [romPath,checkpointPath,outputPath,modelName='hp39gplus']=process.argv.slice(2);
const model={hp39gplus:1,hp39gs:2}[modelName];assert(model,'hp39gplus or hp39gs required');
if(!romPath||!checkpointPath||!outputPath)throw Error('ROM CHECKPOINT PRIVATE-OUTPUT-DIR required');
const out=resolve(outputPath);await mkdir(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const wasm=await readFile(new URL('../dist/orchard.wasm',import.meta.url));
const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
assert.equal(c.create(model),0);
const rom=await readFile(romPath);assert.equal(rom.length,1048576);
new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);if(model===1)applySetup(c,1,'hp39-home');
const checkpoint=await readFile(checkpointPath);
new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),checkpoint.length).set(checkpoint);assert.equal(c.checkpoint_load(checkpoint.length),0);
const state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
let tick=state()[22]+2**32*state()[23],pid=0,usbError='',readReports=0,writeReports=0;
const usb=new VirtualUSB(c,c.timebase_hz(),e=>{console.error('USB',JSON.stringify(e));if(e.error)usbError=e.error;});
const report={schema:'orchard-hp39-romstream-stock-v2',model:modelName,fixture_kind:process.env.ORCHARD_STOCK_FIXTURE||'original-full-nor',hardware_validated:false,rom_sha256:hash(rom),wasm_sha256:hash(wasm),
  starting_checkpoint_sha256:hash(checkpoint),guest_memory_patched:false,physical_key_launch:true,usb_hid_identity:null,
  read_reports:0,write_reports:0,returned_to_stock_os:false,arithmetic_after_return_verified:false,
  external_cable_input:{port:'F',known_mask:'0x8e',connected_levels:'0x02',disconnected_levels:'0x00'}};
function run(n){
  while(n>0){const q=Math.min(8192,n);const r=c.run(q);tick+=q;n-=q;
    if(r)throw Error(`Core stopped: ${JSON.stringify(state())}`);
    if(usb.connected)usb.poll(tick);
    if(usbError)throw Error(usbError);
  }
}
function key(scan,on){assert.equal(c.keyboard_matrix(Math.floor(scan/7),scan%7,+on),0);}
function tap(scan){key(scan,true);run(2000000);key(scan,false);run(2000000);}
async function frame(name){c.frame_view(1);const pix=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*64).slice();
  await writeFile(resolve(out,name+'.pgm'),Buffer.concat([Buffer.from('P5\n131 64\n255\n'),Buffer.from(pix.map(v=>255-v))]));return hash(pix);}
async function open(){
  usb.disconnect();assert.equal(c.gpio_inputs(5,0x8e,0),0);run(2000000);tap(40);run(16000000);await frame('aplet-before-enter');
  tap(6);run(2000000);report.waiting_lcd_sha256=await frame('waiting-for-usb');console.error('ARM launch PC',state()[15].toString(16));
  assert.equal(c.gpio_inputs(5,0x8e,2),0);usb.start(tick);
  for(let n=0;n<100000&&usb.phase!=='ready';n++)run(8192);
  assert.equal(usb.phase,'ready','HID enumeration incomplete');
  assert.equal(usb.info.name,'HP39 ROM Stream V2');
  report.host_ready_lcd_sha256=await frame('host-ready');
  assert.equal(usb.info.vendor,0x03f0);assert.equal(usb.info.product,0x0121);
  assert(usb.info.endpoints.some(e=>e.address===0x81&&e.type===3&&e.maxPacket===64));
  assert(usb.info.endpoints.some(e=>e.address===2&&e.type===3&&e.maxPacket===64));
  report.usb_hid_identity=usb.info;return {product:usb.info.name};
}
async function write(bytes){
  const b=Buffer.from(bytes,'hex');assert.equal(b.length,64);
  if(b[0]===82&&[0,31,63].includes(b[5]))await frame('reading-block-'+(b[5]+1)+'-pass-1');
  if(b[0]===70){
    assert.equal(c.checkpoint_save(),0);
    const checkpoint=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();
    await writeFile(resolve(out,'before-finish.checkpoint'),checkpoint);
    report.before_finish_checkpoint_sha256=hash(checkpoint);
    report.before_finish_host={address:usb.address,next_out_pid:pid};
  }
  for(let n=0;n<10000;n++){const r=usb.out(2,false,pid,b);if(r===0){pid^=1;writeReports++;run(300000);if(b[0]===70)report.saved_lcd_sha256=await frame('saved-before-unplug');return {};}
    assert([1,3].includes(r),`HID OUT ${r}`);run(8192);}
  throw Error('HID OUT timeout');
}
function read(){
  for(let n=0;n<10000;n++){run(8192);const p=usb.receive(1);if(p.result===0){assert.equal(p.bytes.length,64);readReports++;return {hex:Buffer.from(p.bytes).toString('hex')};}
    assert([1,3].includes(p.result),`HID IN ${p.result}`);}
  throw Error('HID IN timeout');
}
async function close(){
  usb.disconnect();assert.equal(c.gpio_inputs(5,0x8e,0),0);usbError='';run(60000000);report.after_return_lcd_sha256=await frame('after-disconnect');
  tap(48);run(10000000);report.home_lcd_sha256=await frame('after-home');
  for(const s of [26,5,26,6])tap(s);run(30000000);
  report.arithmetic_lcd_sha256=await frame('after-one-plus-one');
  // Complete stock HOME frames have been independently viewed for each fixture.
  const arithmeticHash='abf32ffc5e2fdcfc17172a5351eb6aac13d44a1b432d683f5a1f0c8e2a26844c';
  assert.equal(report.arithmetic_lcd_sha256,arithmeticHash,
    'Stock HOME arithmetic after ARM return differs');
  report.returned_to_stock_os=true;
  report.arithmetic_after_return_verified=report.arithmetic_lcd_sha256===arithmeticHash;
  report.read_reports=readReports;report.write_reports=writeReports;
  // Re-enter the original OS receiver and enumerate its normal USB interface.
  // This checks that USB ownership/IRQ cleanup permits the next stock session.
  tap(49);tap(39);
  for(let i=0;i<(model===1?2:3);++i)tap(44);
  assert.equal(c.gpio_inputs(5,0x8e,2),0);usb.start(tick);
  for(let n=0;n<100000&&usb.phase!=='ready';++n)run(8192);
  assert.equal(usb.phase,'ready','Stock USB after ARM return did not enumerate');
  assert.equal(usb.info.name,'HPx9G+ Device');
  report.stock_usb_after_return=usb.info;
  usb.disconnect();assert.equal(c.gpio_inputs(5,0x8e,0),0);usbError='';
  c.keyboard_dedicated(0,1);run(2000000);c.keyboard_dedicated(0,0);run(2000000);
  report.final_cpu_stop=state()[28];report.final_tick=tick;
  // The generated LCD must be independently viewed before asserting semantics.
  await writeFile(resolve(out,'stock-execution.json'),JSON.stringify(report,null,2)+'\n');return report;
}
for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
  try{const request=JSON.parse(line);let result;
    if(request.op==='open')result=await open();
    else if(request.op==='write')result=await write(request.hex);
    else if(request.op==='read')result=read();
    else if(request.op==='close')result=await close();
    else throw Error('Unknown bridge operation');
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){process.stdout.write(JSON.stringify({error:String(error.stack||error)})+'\n');}
}
