// SPDX-License-Identifier: MIT
// Private original-ROM witness. Only physical keys enter the stock BEEP
// command; no patched ROM, RAM injection, synthetic guest tone, or command hook.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {HP49_ROM,applySetup} from '../web/hp48.js';
import {BuzzerStream} from '../web/buzzer-worker.js';
import {readFirmware,sha256} from './rom-inputs.mjs';

const usage='Usage: node tools/verify-buzzer-stock.mjs FULL-49GPLUS-NOR.bin NEW-PRIVATE-OUTPUT-DIRECTORY';
if(process.argv.length===3&&process.argv[2]==='--help'){
  console.log(usage+'\nCold boots the admitted HP49g+ ROM, chooses RPN in MODE, enters 440 .2 BEEP, and records Timer2 electrical edges. ORCHARD_WASM selects a private build. No ROM/LCD/audio bytes are exported.');process.exit(0);
}
if(process.argv.length!==4)throw Error(usage);
const output=resolve(process.argv[3]),rom=await readFirmware(resolve(process.argv[2]));
assert.equal(sha256(rom),HP49_ROM,'Requires the admitted original complete HP49g+ ROM');
const wasm=await readFile(process.env.ORCHARD_WASM||new URL('../dist/orchard.wasm',import.meta.url));
await mkdir(output);
const {instance:{exports:core}}=await WebAssembly.instantiate(wasm,{});
assert.equal(core.create(5),0);new Uint8Array(core.memory.buffer,core.rom_buffer(),rom.length).set(rom);
assert.equal(core.load(rom.length),0);applySetup(core,5,'hp49-home');
const stream=new BuzzerStream(core);
const report={schema:'orchard-stock-buzzer-v2',model:5,rom_sha256:HP49_ROM,wasm_sha256:sha256(wasm),
  tool_sha256:sha256(await readFile(new URL(import.meta.url))),physical_input_only:true,
  command:'440 .2 BEEP',clock:'12 MHz functional reference input; shared register-derived PCLK with immediate PLL settle, not a measured physical board clock',
  keys:[],buzzer_packets:[],passed:false};
let tick=0,previous=-1;
const state=()=>Array.from(new Uint32Array(core.memory.buffer,core.snapshot(),33));
const registers=()=>Array.from(new Uint32Array(core.memory.buffer,core.buzzer_snapshot(),12));
const clocks=()=>Array.from(new Uint32Array(core.memory.buffer,core.clock_snapshot(),6));
function run(n){while(n){
  const budget=Math.min(n,16384);assert.equal(core.run(budget),0,JSON.stringify(state()));tick+=budget;n-=budget;
  assert.equal(core.uart_receive(),0,'No unrelated transfer traffic is expected');
  const packet=stream.packet();
  if(packet?.edges.length)report.buzzer_packets.push({tick:packet.tick,epoch:packet.epoch,overflow:packet.overflow,edges:[...packet.edges],registers:registers(),clocks:clocks()});
}}
function key(scan,down){assert.equal(scan<56?core.keyboard_matrix(Math.floor(scan/7),scan%7,+down):core.keyboard_dedicated([0,4,5,6][scan-56],+down),0);report.keys.push({tick,scan,down});}
function tap(scan){if(scan===previous)run(2000000);previous=scan;key(scan,true);run(1200000);key(scan,false);run(1200000);}
function frameHash(){assert.equal(core.frame_view(1),0);return sha256(new Uint8Array(core.memory.buffer,core.frame_buffer(),131*80));}
try{
  run(60000000);key(40,true);run(600000);key(40,false);run(59400000);
  key(40,true);run(600000);key(40,false);run(40400000);
  for(const scan of [46,36,44,6,40]){tap(scan);run(5000000);} // MODE/CHOOSE/RPN/OK
  report.empty_stack_before=frameHash();stream.configure(true);
  for(const scan of [25,25,27,6,20,19,6])tap(scan); // 440 ENTER .2 ENTER
  const alphabet=[35,36,37,38,39,40,41,46,47,48,49,50,28,21,14,7,29,22,15,8,1,30,23,16,9,2];
  for(const letter of 'BEEP'){tap(57);tap(alphabet[letter.charCodeAt(0)-65]);}
  tap(6);run(12000000);report.empty_stack_after=frameHash();
  assert.equal(report.empty_stack_after,report.empty_stack_before,'The stock command must return normally to the original empty RPN stack');
  const edges=report.buzzer_packets.flatMap(p=>Array.from({length:p.edges.length/2},(_,i)=>[p.edges[i*2],p.edges[i*2+1]]));
  const active=edges.slice(1);assert.equal(edges[0][1],0);assert.equal(active.length,176,'440 Hz × 0.2 seconds requests 88 complete cycles');
  const high=active.filter(([,level])=>level===1).map(([at])=>at);
  // Independent manual/firmware constants: (59+1)*45*16 PCLK edges,
  // PCLK/Fin=25/16 from MPLLCON=0x43012 and CLKDIVN=3: 27,648 Fin ticks.
  const periods=high.slice(1).map((at,i)=>at-high[i]);assert(periods.every(value=>value===27648));
  assert(report.buzzer_packets.some(p=>((p.registers[0]>>4)&3)===2&&p.registers[5]===59&&p.registers[6]===29),'Actual firmware must select GPB2/TOUT2 with Timer2 count/compare');
  assert(report.buzzer_packets.every(p=>p.overflow===0));
  assert(report.buzzer_packets.some(p=>p.clocks[1]===0x43012&&p.clocks[4]===0&&p.clocks[5]===3));
  report.observed={cycles:high.length,edges:active.length,period_ticks:periods[0],functional_hz:12000000/periods[0],
    first_edge:active[0][0],last_edge:active.at(-1)[0],functional_edge_span_seconds:(active.at(-1)[0]-active[0][0])/12000000};
  report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1;}
report.final_tick=tick;report.final_stop=state()[28];
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:report.passed,observed:report.observed,error:report.error}));
