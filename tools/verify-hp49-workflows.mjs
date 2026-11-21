// SPDX-License-Identifier: MIT
// Original-ROM cold boot, physical keys, CAS/plot/menus and portable resume.
// Output is private local evidence; never publish its checkpoints or LCD files.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {HP49_ROM,applySetup} from '../web/hp48.js';
import {hardwareModSetup} from '../web/hardware-mod.js';
import {readFirmware,sha256} from './rom-inputs.mjs';

const usage='Usage: node tools/verify-hp49-workflows.mjs FULL-NOR.bin NEW-OUTPUT-DIRECTORY [--hp50gm]';
if(process.argv.length===3&&process.argv[2]==='--help'){
  console.log(usage+'\nCold boots the pinned private ROM and checks stock CAS, menus, plot and native/WASM resume.\nBuild the native orchard-checkpoint-replay and production WASM first. No firmware is fetched.');
  process.exit(0);
}
if(![4,5].includes(process.argv.length)||process.argv.length===5&&process.argv[4]!=='--hp50gm')throw new Error(usage);
const modified=process.argv.includes('--hp50gm');
const config=modified?hardwareModSetup('hp50gm-home'):{model:5,preset:'hp49-home',hash:HP49_ROM};
const height=modified?64:80;
// Independently viewed 64-line modified-OS results; no pixels are cropped from
// the 80-line stock expectations and no guest state is changed by this table.
const modFrames={
  home:'47a7e742901f75d8ca2a32a08058d5a66e5d4ae07eceb91c1fa5913f144752cd',
  version:'def6b8999f4d725b4ecf52b5a8a9b8b6f5c45deeae60865473bb347a59ff0733',
  factor:'ef522c6ec859f6c0f031e93b5b84e6ab6e28b04662bbb59cb2317a9b39f707d4',
  apps:'4fc17d51baf7e29f10faff317491243ba70e9954c379b1d667f1ad05931a41c4',
  'apps-return':'ef522c6ec859f6c0f031e93b5b84e6ab6e28b04662bbb59cb2317a9b39f707d4',
  mode:'589397a8b94ba1a1459300354836e2bdeeb0327c2e9a7326af1da16e19029e11',
  'mode-return':'ef522c6ec859f6c0f031e93b5b84e6ab6e28b04662bbb59cb2317a9b39f707d4',
  plot:'095a75d3c481b6c36d423701f370a71e61af3144fd64d33ed00d2f505abfea12',
  'plot-return':'d39bfd059d87cc78436d626e0607e4d8c048ebcac1d83fc54291bdd6e06b586d',
};
const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(process.argv[3]),rom=await readFirmware(resolve(process.argv[2]));
assert.equal(sha256(rom),config.hash,'Requires the exact complete NOR for the selected configuration');
const wasm=await readFile(process.env.ORCHARD_WASM||resolve(root,'dist/orchard.wasm'));
const native=resolve(root,process.env.ORCHARD_BUILD_DIR||'build',process.platform==='win32'?'orchard-checkpoint-replay.exe':'orchard-checkpoint-replay');
await mkdir(output); // Retain previous successes and failures; never overwrite them.
const {instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
assert.equal(c.create(config.model),0);
new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);
assert.equal(c.load(rom.length),0);applySetup(c,config.model,config.preset);
const report={schema:'orchard-hp49-stock-workflows-v1',model:config.model,preset:config.preset,rom_sha256:config.hash,
  hardware_modified:modified,stock_model_verified:!modified,
  wasm_sha256:sha256(wasm),tool_sha256:sha256(await readFile(fileURLToPath(import.meta.url))),
  physical_input_only:true,ram_bytes:524288,frame_view:'packed-lsb',canonical_hardware_boot:false,
  keys:[],stages:[],passed:false};
let tick=0,previous=-1;
const state=()=>Array.from(new Uint32Array(c.memory.buffer,c.snapshot(),33));
function run(n){while(n){const step=Math.min(1024,n);assert.equal(c.run(step),0,JSON.stringify(state()));tick+=step;n-=step;assert.equal(c.uart_receive(),0,'Unexpected unsolicited UART data');}}
function key(scan,down){assert.equal(scan<56?c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):c.keyboard_dedicated([0,4,5,6][scan-56],+down),0);report.keys.push({tick,scan,down});}
function tap(scan){if(scan===previous)run(2000000);previous=scan;key(scan,true);run(1200000);key(scan,false);run(1200000);}
const alphabet=[35,36,37,38,39,40,41,46,47,48,49,50,28,21,14,7,29,22,15,8,1,30,23,16,9,2];
function type(text){assert.match(text,/^[A-Z]+$/);for(const char of text){tap(57);tap(alphabet[char.charCodeAt(0)-65]);}}
async function picture(name,expected){
  assert.equal(c.frame_view(1),0);
  const pixels=new Uint8Array(c.memory.buffer,c.frame_buffer(),131*height).slice(),hash=sha256(pixels);
  await writeFile(resolve(output,name+'.pgm'),Buffer.concat([Buffer.from(`P5\n131 ${height}\n255\n`),Buffer.from(pixels.map(v=>255-v))]),{flag:'wx'});
  report.stages.push({name,tick,frame_sha256:hash,stop:state()[28]});
  console.log(name,tick,hash);
  if(modified)expected=modFrames[name];
  if(expected)assert.equal(hash,expected,'Firmware LCD differs at '+name);
}
function checkpoint(){assert.equal(c.checkpoint_save(),0);return new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),c.checkpoint_size()).slice();}
function restore(bytes){new Uint8Array(c.memory.buffer,c.checkpoint_buffer(),bytes.length).set(bytes);assert.equal(c.checkpoint_load(bytes.length),0);const s=state();tick=s[22]+s[23]*2**32;}
const factor='8c4c67757137cc527e4c7a9ee8955029af85252491a1127f8bba92b7e75347ba';
try{
  run(60000000);key(40,true);run(600000);key(40,false);run(59400000);
  key(40,true);run(600000);key(40,false);run(39400000);await picture('home');
  type('VERSION');tap(6);run(10000000);await picture('version','bef9069bbed7d994b37bbb8d12feb46114936b64101e6f93f4b7501c31e6d237');
  tap(59);tap(0);run(5000000);
  type('FACTOR');for(const scan of [58,4,16,29,19,4,26,45])tap(scan);tap(6);run(20000000);await picture('factor',factor);
  tap(41);run(5000000);await picture('apps','45bffac03251f577ea6a14676e047e7bce52912542e3f7c815d5c080fbb88377');
  tap(56);run(5000000);await picture('apps-return',factor);
  tap(46);run(5000000);await picture('mode','fede67d0bc1b92e424b8741441eec2853bd58ac77bcc0d8df971d742349dbe2b');
  tap(40);run(5000000);await picture('mode-return',factor);
  const before=checkpoint(),beforePath=resolve(output,'before.checkpoint');
  await writeFile(beforePath,before,{flag:'wx'});
  run(1000000);const after=checkpoint();await writeFile(resolve(output,'wasm-after.checkpoint'),after,{flag:'wx'});
  c.reset();restore(before);run(1000000);assert.deepEqual(checkpoint(),after,'Save/reset/restore continuation differs');
  // Native consumes the exact same immutable snapshot, not a separately read ROM.
  const snapshot=resolve(output,'private-full-nor.bin');await writeFile(snapshot,rom,{flag:'wx'});
  const nativeAfter=resolve(output,'native-after.checkpoint');
  const child=spawnSync(native,[String(config.model),snapshot,beforePath,'1000000',nativeAfter],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
  if(child.error)throw child.error;
  assert.equal(child.status,0,child.stderr||'Native checkpoint replay failed');
  assert.deepEqual(await readFile(nativeAfter),Buffer.from(after),'Native/WASM full checkpoint differs');
  report.resume={bytes:after.length,reset_restore_equal:true,native_wasm_equal:true,before_sha256:sha256(before),after_sha256:sha256(after)};
  restore(before);previous=-1;tap(59);tap(0);run(5000000);
  type('STEQ');for(const scan of [58,4,16,29,19,45])tap(scan);tap(6);run(15000000);
  type('ERASE');tap(6);run(5000000);type('DRAW');tap(6);run(80000000);
  type('PICTURE');tap(6);run(10000000);await picture('plot','4456afd374894f168ce36162995dd0569ef2276075edf9bb6c01b2c84967820c');
  // This sample was rechecked on frozen r23 and the TLB candidate; the old
  // r17 frame predates later timer/IRQ changes. Both current runs agree.
  tap(56);run(5000000);await picture('plot-return','452d0448886b565a68844beae881cd43eedec5e113f7d1e14a422aa5e25e3e2e');
  report.sram_alias_reads=c.sram_alias_reads().toString();report.sram_alias_writes=c.sram_alias_writes().toString();
  assert.equal(report.sram_alias_reads,'0');assert.equal(report.sram_alias_writes,'0');
  report.lcd_unverified_reads=c.lcd_probe68_reads().toString();
  report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1;console.error(error.message);}
report.final_tick=tick;report.final_state=state();
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(modified?'HP50gm modified-OS workflows':'HP49 stock workflows',report.passed?'PASSED':'FAILED');
