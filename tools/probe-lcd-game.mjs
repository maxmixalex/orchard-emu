// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {measureLCDGame} from './lcd-game-sample.js';
const usage='Usage: node tools/probe-lcd-game.mjs FULL-NOR PRIVATE-GAME-CHECKPOINT MODEL PRESET NEW-REPORT.json [TICKS]';
if(process.argv[2]==='--help'){console.log(usage);process.exit(0);}
assert(process.argv.length>=7&&process.argv.length<=8,usage);
const [rom,checkpoint,wasm]=await Promise.all([readFile(process.argv[2]),readFile(process.argv[3]),readFile(process.env.ORCHARD_WASM||new URL('../dist/orchard.wasm',import.meta.url))]);
const report=await measureLCDGame({rom,checkpoint,wasm,model:Number(process.argv[4]),preset:process.argv[5],ticks:Number(process.argv[7]||12000000)});
report.execution_host='Node';
await writeFile(process.argv[6],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:report.passed,median_ms:report.median_ms,guest_state_equal:report.guest_state_equal,
  variants:report.variants.map(({frames,...v})=>v)}));
