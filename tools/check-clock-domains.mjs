// SPDX-License-Identifier: MIT
// Independent of ROMs. Build exactly the same C regression for native and WASM.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const directory=process.env.ORCHARD_BUILD_DIR||'build';await mkdir(directory,{recursive:true});
const sources=['machine','cpu','thumb','mmu','bus','soc','checkpoint','scheduler','watchdog','gpio','interrupt','rtc','keyboard','nor','sram','lcd','adc','usb'].map(x=>`src/${x}.c`);
function run(program,args){const r=spawnSync(program,args,{encoding:'utf8',timeout:60000});if(r.error)throw r.error;if(r.status!==0)throw Error(`${program}: ${r.stdout}\n${r.stderr}`);return r.stdout;}
const file=`${directory}/clock-domains.wasm`;
run(process.env.CLANG||'clang',['--target=wasm32','-std=c17','-O3','-flto','-mbulk-memory','-ffreestanding','-nostdlib','-fno-builtin','-Wall','-Wextra','-Wpedantic','-Werror','-Iinclude','-Isrc',...sources,'tests/clock-domains.c','-o',file,'-Wl,--no-entry','-Wl,--stack-first','-Wl,-z,stack-size=524288','-Wl,--initial-memory=16777216','-Wl,--max-memory=16777216']);
const native=JSON.parse(run(`${directory}/orchard-clock-domains${process.platform==='win32'?'.exe':''}`,[]));
const {instance:{exports:test}}=await WebAssembly.instantiate(await readFile(file),{});
assert.equal(test.regression(),0,`Clock regression failed at line ${test.first_failure()}`);
assert.equal(test.checks(),native.checks);assert.equal(native.failures,0);
console.log(`Functional clocks: ${native.checks} checks on native and WASM; six profiles, legacy/divided/clocked policies, CPU modes and divider ratios, WFI/IRQ, stop precision, MMIO, checkpoint and full-state partition replay. Not physical clock calibration.`);
