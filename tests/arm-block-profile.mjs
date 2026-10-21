// SPDX-License-Identifier: MIT
// Pure harness/summary checks. The C collector test is separately compiled.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instrumentCPU } from '../tools/build-arm-block-profile.mjs';
import { parseArguments, summarizeCounters } from '../tools/profile-arm-blocks.mjs';

const paths = ['baseline.wasm', 'profile.wasm', 'roms', 'fixtures.json', 'endpoints.json', 'report.json'];
assert.deepEqual(parseArguments(paths), { baseline: paths[0], profile: paths[1], roms: paths[2],
  fixtures: paths[3], endpoints: paths[4], output: paths[5] });
for (const args of [[], paths.slice(1), [...paths, 'extra'], ['', ...paths.slice(1)], ['--x', ...paths.slice(1)]])
  assert.throws(() => parseArguments(args));
const source = await readFile(new URL('../src/cpu.c', import.meta.url), 'utf8');
const instrumented = instrumentCPU(source);
assert(instrumented.includes('#include "arm-block-profile.h"'));
assert(instrumented.includes('arm_block_profile_fetch(m, instruction, width,'));
assert.equal(instrumented.replace('#include "arm-block-profile.h"\n', '')
  .replace('    arm_block_profile_fetch(m, instruction, width,\n' +
    '                            width == 4 && o_condition(c, instruction >> 28));\n', ''), source);
assert.throws(() => instrumentCPU(instrumented));
assert.throws(() => instrumentCPU(''));
assert.throws(() => instrumentCPU(source + source));
const empty = Array(480).fill(0), summary = summarizeCounters(empty);
assert.equal(summary.pure_dp_fraction, null);
assert.equal(summary.bounded_blocks.mean, null);
assert.equal(summary.unique_pure_opcodes, 0);
const sample = empty.slice();
Object.assign(sample, { 0: 5, 1: 5, 7: 5, 9: 5, 10: 1, 11: 5, 12: 2, 13: 3,
  15: 1, 18: 1, 20: 4, 21: 2, 22: 2, 23: 1,
  36: 5, 48: 5, 68: 1, 129: 1, 130: 1, 260: 4, 465: 2 });
for (let i = 0; i < 4; ++i) {
  sample[448 + i] = 4; sample[452 + i] = 1;
  sample[456 + i] = 3; sample[460 + i] = 2;
}
const s = summarizeCounters(sample);
assert.equal(s.natural_blocks.mean, 5); assert.equal(s.bounded_blocks.mean, 2.5);
assert.equal(s.natural_blocks.instructions_in_blocks_at_least_4, 5);
assert.equal(s.bounded_blocks.instructions_in_blocks_at_least_4, 0);
assert.equal(s.adjacent_kind_matrix[4][4], 4);
assert.equal(s.opcode_cache_simulation.capacities[0].cleared_each_run.hit_fraction, 0.6);
for (const index of [0, 1, 7, 9, 10, 19, 20, 21, 32, 48, 64, 128, 192, 448, 456, 464]) {
  const broken = sample.slice(); broken[index]++;
  assert.throws(() => summarizeCounters(broken), `Inconsistent counter accepted: ${index}`);
}
assert.throws(() => summarizeCounters(empty.slice(1)));
assert.throws(() => summarizeCounters(empty.with(0, Infinity)));
console.log('ARM block instrumentation anchors, CLI and summary conservation checks passed.');
