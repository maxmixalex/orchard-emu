// SPDX-License-Identifier: MIT
// Pure harness/summary checks. The C collector test is separately compiled.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instrumentCPU } from '../tools/build-arm-block-profile.mjs';
import { parseArguments, summarizeCounters, readPairRecords } from '../tools/profile-arm-blocks.mjs';

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
assert.equal(summary.bounded_operand_pairs.disjoint_instruction_fraction_of_all_fetches, null);
assert.deepEqual(summary.bounded_operand_pairs.signatures, []);
const sample = empty.slice();
Object.assign(sample, { 0: 5, 1: 5, 7: 5, 9: 5, 10: 1, 11: 5, 12: 2, 13: 3,
  15: 1, 18: 1, 20: 4, 21: 2, 22: 2, 23: 1, 24: 3, 25: 2, 26: 1, 27: 1,
  36: 5, 48: 5, 68: 1, 129: 1, 130: 1, 260: 4, 465: 2 });
for (let i = 0; i < 4; ++i) {
  sample[448 + i] = 4; sample[452 + i] = 1;
  sample[456 + i] = 3; sample[460 + i] = 2;
}
const pairs = [[0x70044, 3, 2]], s = summarizeCounters(sample, pairs);
assert.equal(s.natural_blocks.mean, 5); assert.equal(s.bounded_blocks.mean, 2.5);
assert.equal(s.natural_blocks.instructions_in_blocks_at_least_4, 5);
assert.equal(s.bounded_blocks.instructions_in_blocks_at_least_4, 0);
assert.equal(s.adjacent_kind_matrix[4][4], 4);
assert.equal(s.opcode_cache_simulation.capacities[0].cleared_each_run.hit_fraction, 0.6);
assert.equal(s.bounded_operand_pairs.adjacent_count, 3);
assert.equal(s.bounded_operand_pairs.disjoint_count, 2);
assert.equal(s.bounded_operand_pairs.unpaired_tail_instructions, 1);
assert.equal(s.bounded_operand_pairs.disjoint_instruction_fraction_of_all_fetches, 0.8);
assert.equal(s.bounded_operand_pairs.signatures[0].first, 'ADD');
assert.equal(s.bounded_operand_pairs.signatures[0].first_form, 'immediate_unrotated');
assert.deepEqual(s.bounded_operand_pairs.signatures[0].dependencies, {
  register_RAW: true, register_WAR: true, register_WAW: true, flags_to_condition: false,
  flags_to_carry_input: false, flags_WAR: false, flags_WAW: false });
const fakeCore = { arm_block_profile_pair(slot, field) {
  return slot === 65535 ? BigInt(field === 0 ? pairs[0][0] + 1 : pairs[0][field]) : 0n;
} };
assert.deepEqual(readPairRecords(fakeCore), pairs);
assert.throws(() => readPairRecords({}));
for (const index of [0, 1, 7, 9, 10, 19, 20, 21, 24, 25, 26, 27, 28,
  32, 48, 64, 128, 192, 448, 456, 464]) {
  const broken = sample.slice(); broken[index]++;
  assert.throws(() => summarizeCounters(broken, pairs), `Inconsistent counter accepted: ${index}`);
}
for (const bad of [[], [...pairs, ...pairs], [[0x70044, 4, 2]], [[0x70044, 3, 3]],
  [[0x70000, 3, 2]], [[0x70244, 3, 2]], [[0x70c44, 3, 2]], [[2 ** 27, 3, 2]],
  [[0x70044, 3, -1]], [[0x70044, Infinity, 2]], [[0x70044, 3]]])
  assert.throws(() => summarizeCounters(sample, bad));
assert.throws(() => summarizeCounters(empty.slice(1)));
assert.throws(() => summarizeCounters(empty.with(0, Infinity)));
console.log('ARM block instrumentation anchors, CLI, operand signatures and disjoint-pair conservation checks passed.');
