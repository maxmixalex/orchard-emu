// SPDX-License-Identifier: MIT
// Private recovery of the physical-input-only IR browser starting sessions.
// Cold boot is copied from tools/verify-serial-selftests.mjs; the RPN/IR setup
// and typed ORCHARD/SEND/RECV sequence are from tools/verify-irda-peer.mjs.
// Only ROM loading, ordinary board preset setup and physical keys affect the
// machines. No checkpoint/RAM patches or host protocol responses are used.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {applySetup} from '../web/hp48.js';
import {encodeSession} from '../web/session.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const usage='node tools/prepare-irda-browser.mjs WASM ROM-DIRECTORY NEW-PRIVATE-OUTPUT-DIRECTORY';
if(process.argv.length===3&&process.argv[2]==='--help'){console.log(usage);process.exit(0);}
if(process.argv.length!==5)throw Error(usage);
const [wasmPath,input,out]=process.argv.slice(2).map(p=>resolve(p));
const hash=b=>createHash('sha256').update(b).digest('hex');
const wasm=await readFile(wasmPath);
await mkdir(out,{recursive:false});
const report={schema:'orchard-original-irda-browser-preparation-v1',passed:false,
 cold_boot:true,physical_input_only:true,guest_memory_patched:false,host_protocol_responses:false,
 transport_tested:false,checkpoint_version:7,preparation_tool_sha256:hash(await readFile(fileURLToPath(import.meta.url))),wasm_sha256:hash(wasm),keys:[],frames:[],sources:{},roms:[]};
for(const name of ['tools/verify-serial-selftests.mjs','tools/verify-irda-peer.mjs'])
 report.sources[name]=hash(await readFile(join(root,name)));
const machines=[];
const state=m=>Array.from(new Uint32Array(m.c.memory.buffer,m.c.snapshot(),33));
function key(m,scan,down){assert.equal(scan<56?m.c.keyboard_matrix(Math.floor(scan/7),scan%7,+down):m.c.keyboard_dedicated([0,4,5,6][scan-56],+down),0);
 report.keys.push({model:m.model,tick:m.tick,scan,down});}
function advance(m,n,quantum=1024){while(n){const q=Math.min(n,quantum);assert.equal(m.c.run(q),0,JSON.stringify(state(m)));m.tick+=q;n-=q;
 for(let channel=0;channel<3;channel++)assert.equal(m.c.uart_receive_channel(channel),0,'No SEND/RECV command has been entered yet');}}
function run(n){while(n){const q=Math.min(n,512);for(const m of machines)advance(m,q,512);n-=q;}}
function tap(m,scan){if(m.last===scan)run(2000000);m.last=scan;key(m,scan,true);run(1200000);key(m,scan,false);run(1200000);}
const alphabet=[35,36,37,38,39,40,41,46,47,48,49,50,28,21,14,7,29,22,15,8,1,30,23,16,9,2];
const digits=[27,26,19,12,25,18,11,24,17,10];
function type(m,text){for(const ch of text){tap(m,57);tap(m,alphabet[ch.charCodeAt(0)-65]);}}
function command(m,text){type(m,text);tap(m,6);run(3000000);}
function number(m,n){for(const ch of String(Math.abs(n)))tap(m,digits[Number(ch)]);if(n<0)tap(m,23);tap(m,6);}
function name(m,text){tap(m,14);type(m,text);tap(m,6);}
async function save(m,label){
 assert.equal(m.c.frame_view(1),0);const height=m.model===5?80:64;
 const pixels=new Uint8Array(m.c.memory.buffer,m.c.frame_buffer(),131*height).slice();
 await writeFile(join(out,`${label}-${m.model}.pgm`),Buffer.concat([Buffer.from(`P5\n131 ${height}\n255\n`),pixels.map(n=>255-n)]),{flag:'wx'});
 assert.equal(m.c.checkpoint_save(),0);
 const checkpoint=new Uint8Array(m.c.memory.buffer,m.c.checkpoint_buffer(),m.c.checkpoint_size()).slice();
 assert.equal(new DataView(checkpoint.buffer,checkpoint.byteOffset,checkpoint.byteLength).getUint32(8,true),7);
 await writeFile(join(out,`${label}-${m.model}.checkpoint`),checkpoint,{flag:'wx'});
 const session=await encodeSession({model:m.model,romHash:m.romHash,preset:m.preset,frameView:1,state:checkpoint});
 await writeFile(join(out,`${label}-${m.model}.ord`),session,{flag:'wx'});
 report.frames.push({label,model:m.model,tick:m.tick,frame_sha256:hash(pixels),checkpoint_sha256:hash(checkpoint),session_sha256:hash(session),state:state(m)});
 console.log('PREPARED',label,m.model,hash(session));
}
try{
 for(const[model,file,preset,romHash]of[
  [5,'hp49gplus-full.bin','hp49-home','3283731a0553400e2a2a04e213b0c6583f4f9d38466ce5185a40ce0b2f7a44ab'],
  [4,'48gii.bin','hp48-home','4899102743d3420dc517ae1b489fe2405229be616dbdb1b9f00cc1d0aeae1937']
 ]){
  const rom=await readFile(join(input,file));assert.equal(hash(rom),romHash);
  const{instance:{exports:c}}=await WebAssembly.instantiate(wasm,{});
  assert.equal(c.create(model),0);new Uint8Array(c.memory.buffer,c.rom_buffer(),rom.length).set(rom);
  assert.equal(c.load(rom.length),0);applySetup(c,model,preset);
  const m={c,model,romHash,preset,tick:0,last:-1};machines.push(m);report.roms.push({model,rom_sha256:romHash});
  advance(m,60000000);key(m,40,true);advance(m,1500000);key(m,40,false);advance(m,58500000);
  key(m,40,true);advance(m,1500000);key(m,40,false);advance(m,58500000);
  await save(m,'home');
 }
 for(const m of machines){for(const scan of[46,23,40])tap(m,scan);number(m,-33);command(m,'SF');}
 const [from,to]=machines;
 number(from,12345);name(from,'ORCHARD');command(from,'STO');
 name(from,'ORCHARD');type(from,'SEND');type(to,'RECV');
 for(const m of machines)await save(m,'ready');
 report.passed=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
await writeFile(join(out,'preparation-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
if(!report.passed)throw Error(report.error);
