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
const romPath=resolve(process.argv[2]),wasmPath=process.env.ORCHARD_WASM||new URL('../dist/orchard.wasm',import.meta.url);
const rom=await readFile(romPath),wasm=await readFile(wasmPath);
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
  keys:[],transfers:[],frames:[],performance:[],expected_frames_visually_reviewed:true,passed:false};
// Original-program LCD bytes were independently viewed: the 2048 board and
// moves, Babal's ball/track, conversion results, and a visible 2 after return.
// A changing image and a zero emulator stop alone do not prove application
// success: an original-OS abort loop can retain a plausible stale image.
const expectedFrames={
  'stock-installed':'b86ee8936184cc73ad2ec09cfdb90a184d3497dd99dd053e2492f60a449e7023',
  '2048-running':'b3ebcdb5dfafd23315ef02f36252d7f08a65581d070e020648b169493dd8d547',
  '2048-moved':'92672cf8ae6e078cf265539fe69b83725b04dada1910f78468a8cd7fdf401b21',
  '2048-returned':'83d40b63c86233a2dd14a9e6d52802f2b2a90a7065829260a4ee72d86c80de59',
  '2048-one-plus-one':'428982a9aaa21b5306417186842d0d8945021d268f9f46d272cbdf232c7423b9',
  'baseconvert-42-binary':'9606088f5d32a8c36b99a086fe0fa5671097b6e793aaf3f3b71710f5c86ad03b',
  'listconvert-binary-42':'ce5bb3c926afe0b8ea5f4b8a6c5966b12a2518982658b80c0b13ca3ef80f33f1',
  'conversion-one-plus-one':'94132b535aa50f61b39b48e71cebe83ff57209c85fed43686fc3de3e8a8422b7',
  'babal-running':'018cfb9d9ae131df857b0f9be140ec276c1b1c48d83c4f6fafb2df1df187cf4c',
  'babal-played':'2ed38985986fc1ca010b9209be2b55bba4f9fee07eba3f59e86e1b9f05e2a718',
  'babal-returned':'4368d1c1f5a20b8f15faac9f822fd95c6d53c2bb456c21c60291e5de1fe245d4',
  'babal-one-plus-one':'f8145de7772fbc58dfe4ce3b4654696909e52ef2312c9f19cb33b3c367e3b281',
};
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
  const data={name,tick,frame_sha256:sha256(pixels),checkpoint_sha256:sha256(saved),state:state()};report.frames.push(data);console.log(name,data.frame_sha256);
  assert.equal(data.frame_sha256,expectedFrames[name],'Original program LCD differs at '+name);return data;
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
  assert.equal(sha256(await readFile(romPath)),report.rom_sha256,'ROM changed during acceptance');
  assert.equal(sha256(await readFile(wasmPath)),report.wasm_sha256,'WASM changed during acceptance');
  for(const [,path,hash]of objects)assert.equal(sha256(await readFile(resolve(input,path))),hash,'Program changed during acceptance');
  report.application_results_verified=true;
  report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;console.error(error.stack);}
report.final_tick=tick;report.final_state=state();
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:report.passed,frames:report.frames.length,performance:report.performance.map(({sampled_pc,...data})=>data)}));
