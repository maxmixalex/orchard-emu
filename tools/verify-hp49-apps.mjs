// SPDX-License-Identifier: MIT
// Original third-party objects installed by stock USB Kermit and physical keys.
// The caller supplies the private ROM and downloaded, unchanged programs.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {HP49_ROM,applySetup} from '../web/hp48.js';
import {VirtualUSB} from '../web/virtual-usb.js';
import {FileTransfer} from '../web/file-transfer.js';
import {sha256} from './rom-inputs.mjs';

const usage='Usage: node tools/verify-hp49-apps.mjs FULL-49GPLUS-NOR DOWNLOADS-DIRECTORY NEW-OUTPUT-DIRECTORY [--installed-checkpoint PRIVATE-CHECKPOINT]';
if(process.argv[2]==='--help'){console.log(usage+'\nDownloads must contain the unchanged HPcalc 2048, BabalPlus and baseconvert packages.\nThe optional checkpoint must be the stock-installed stage of this same witness.');process.exit(0);}
assert([5,7].includes(process.argv.length),usage);
if(process.argv.length===7)assert.equal(process.argv[5],'--installed-checkpoint',usage);
const input=resolve(process.argv[3]),out=resolve(process.argv[4]);
const rom=await readFile(process.argv[2]),wasm=await readFile(process.env.ORCHARD_WASM||new URL('../dist/orchard.wasm',import.meta.url));
assert.equal(sha256(rom),HP49_ROM);
const objects=[
  ['MMGAME','2048/MM48.EXE','fb6eb450ad00a1dd65c6f5877fab352939ce8b449f99244d89b0e45d7739c971'],
  ['ORBABAL','babal49plus/Babal49Plus/BabalPlus.hp','6aade17af0b0c1f0418aa6e19ab3d707d3bc2089c369784263e1eae9c0418577'],
  ['BCONV','baseconvert/BASECONVERT.49','a056b2ff18b3741d32ad093836fece03e94240d629e8d27cfe324d3e497062fd'],
  ['LCONV','baseconvert/LISTCONVERT.49','46cdbadd17e099c8a355a51f134c9a7dccde0fa1b79cc2e2bc11e54ee6017446'],
];
for(const object of objects){object.push(await readFile(resolve(input,object[1])));assert.equal(sha256(object[3]),object[2],`Unexpected original object: ${object[1]}`);}
await mkdir(out);
const c=(await WebAssembly.instantiate(wasm,{})).instance.exports;
assert.equal(c.create(5),0);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);assert.equal(c.load(rom.length),0);applySetup(c,5,'hp49-home');
const report={schema:'orchard-hp49-apps-v1',model:5,preset:'hp49-home',rom_sha256:sha256(rom),wasm_sha256:sha256(wasm),
  tool_sha256:sha256(await readFile(new URL(import.meta.url))),execution_host:'Node production WASM and virtual USB/Kermit modules',production_worker:false,
  original_programs_unchanged:true,guest_memory_patched:false,canonical_hardware_boot:false,canonical_hardware_speed:false,
  cold_boot:process.argv.length===5,objects:objects.map(([name,path,sha256,bytes])=>({name,path,sha256,bytes:bytes.length})),
  keys:[],transfers:[],frames:[],performance:[],visual_review_required:true,passed:false};
let tick=0,previous=-1,request=0;
const state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
const usb=new VirtualUSB(c,c.timebase_hz(),()=>{}),transfer=new FileTransfer({core:c,usb,model:5,notify:()=>{}});
function run(n){while(n){const step=Math.min(n,1024);assert.equal(c.run(step),0,JSON.stringify(state()));tick+=step;n-=step;usb.poll(tick);transfer.poll(tick);c.uart_receive();}}
function key(scan,down){assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated([0,4,5,6][scan-56],+down),0);report.keys.push({tick,scan,down});}
function tap(scan){if(previous===scan)run(2000000);previous=scan;key(scan,true);run(1200000);key(scan,false);run(1200000);}
const alphabet=[35,36,37,38,39,40,41,46,47,48,49,50,28,21,14,7,29,22,15,8,1,30,23,16,9,2];
function command(text){assert.match(text,/^[A-Z]+$/);for(const ch of text){tap(57);tap(alphabet[ch.charCodeAt(0)-65]);}tap(6);run(5000000);}
function keys(scans){for(const scan of scans)tap(scan);}
function connect(){usb.start(tick);const end=tick+120000000;while(usb.phase!=='ready'&&tick<end){run(1024);assert(usb.connected);}assert.equal(usb.phase,'ready');}
function operation(mode,name,bytes){const start=tick,began=performance.now();transfer.start({request:++request,transport:'usb',mode,name,bytes},tick);const end=tick+3600000000;while(transfer.active&&tick<end)run(1024);assert.equal(transfer.session.phase,'complete',JSON.stringify(transfer.lastProgress));run(3000000);report.transfers.push({mode,name,bytes:bytes?.length,sha256:bytes?sha256(bytes):undefined,ticks:tick-start,wall_ms:performance.now()-began});}
async function picture(name){assert.equal(c.frame_view(1),0);const pixels=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*80).slice();
  await writeFile(resolve(out,name+'.pgm'),Buffer.concat([Buffer.from('P5\n131 80\n255\n'),Buffer.from(pixels.map(x=>255-x))]),{flag:'wx'});
  assert.equal(c.checkpoint_save(),0);const saved=new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();await writeFile(resolve(out,name+'.checkpoint'),saved,{flag:'wx'});
  const data={name,tick,frame_sha256:sha256(pixels),checkpoint_sha256:sha256(saved),state:state()};report.frames.push(data);console.log(name,data.frame_sha256);return data;
}
function sample(name,ticks=24000000){const start=state(),began=performance.now(),pcs=new Set();for(let done=0;done<ticks;done+=100000){run(Math.min(100000,ticks-done));pcs.add(state()[15]);}
  const wall=performance.now()-began,after=state();report.performance.push({name,ticks,wall_ms:wall,reference_seconds:ticks/c.timebase_hz(),instructions:(after[20]+after[21]*2**32)-(start[20]+start[21]*2**32),sampled_pc:[...pcs]});
}
async function arithmetic(name){keys([26,6,26,5]);run(5000000);await picture(name);}
try{
  if(process.argv.length===7){const bytes=await readFile(process.argv[6]);new Uint8Array(c.memory.buffer,c.checkpoint_buffer(bytes.length),bytes.length).set(bytes);assert.equal(c.checkpoint_load(bytes.length),0);const s=state();tick=s[22]+s[23]*2**32;report.installed_checkpoint_sha256=sha256(bytes);}
  else{
    run(60000000);key(40,true);run(600000);key(40,false);run(59400000);key(40,true);run(600000);key(40,false);run(39400000);
    // CF(-33), CF(-78), SF(-35): wired USB binary mode through physical input.
    for(const sequence of [[57,37,57,40,58,4,12,12,23,45,6],[57,37,57,40,58,4,24,17,23,45,6],[57,15,57,40,58,4,12,18,23,45,6]]){keys(sequence);run(2000000);}
    command('SERVER');connect();for(const [name,,,bytes] of objects)operation('send',name,bytes);
    // An ordinary user-authored RPL installer; Babal itself stays byte-identical.
    operation('send','BINSTALL',Buffer.from('%%HP: T(3)A(D)F(.);\n\\<< ORBABAL 0 STO \\>>\n','ascii'));
    operation('finish');usb.disconnect();transfer.resetUsb(tick);run(10000000);
    for(const scan of [46,23,40]){tap(scan);run(3000000);}
    await picture('stock-installed');
  }
  command('MMGAME');run(12000000);const game=await picture('2048-running');assert(game.state[16]&32,'Native Thumb program was not entered');
  keys([43,44,45,42]);sample('2048');const moved=await picture('2048-moved');assert.notEqual(moved.frame_sha256,game.frame_sha256,'Directions did not change the board');
  tap(56);run(12000000);await picture('2048-returned');await arithmetic('2048-one-plus-one');
  command('CLEAR');keys([25,19,6,19,6]);command('BCONV');run(5000000);await picture('baseconvert-42-binary');
  keys([19,6]);command('LCONV');run(5000000);await picture('listconvert-binary-42');await arithmetic('conversion-one-plus-one');
  command('CLEAR');run(5000000);command('BINSTALL');run(15000000);
  key(56,true);run(100000);key(37,true);run(1000000);key(37,false);key(56,false);run(30000000);
  keys([59,19]);run(5000000);tap(35);run(5000000);tap(37);run(72000000);const babal=await picture('babal-running');
  keys([36,37,35,38]);sample('BabalPlus');const played=await picture('babal-played');assert.notEqual(played.frame_sha256,babal.frame_sha256,'Game did not advance');
  tap(56);run(12000000);await picture('babal-returned');await arithmetic('babal-one-plus-one');
  assert.equal(c.sram_alias_reads().toString(),'0');assert.equal(c.sram_alias_writes().toString(),'0');
  report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error.stack);}
report.final_tick=tick;report.final_state=state();
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:report.passed,frames:report.frames.length,performance:report.performance.map(({sampled_pc,...data})=>data)}));
