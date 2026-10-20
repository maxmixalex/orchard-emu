// SPDX-License-Identifier: MIT
// Pure tooling checks: no dist, firmware, guest execution, or timing benchmark.
import assert from 'node:assert/strict';
import { createClockBoundaryRecorder, parseArguments } from '../tools/profile-input-latency.mjs';

const paths = ['baseline.wasm', 'candidate.wasm', 'roms', 'new-report.json'];
assert.deepEqual(parseArguments(paths), { baseline: paths[0], candidate: paths[1],
  directory: paths[2], output: paths[3], model: 'all', sampleTicks: 12_000, phaseTicks: 0 });
assert.deepEqual(parseArguments([...paths, '--model', '4', '--sample-ticks', '1024', '--phase-ticks', '12000000']),
  { baseline: paths[0], candidate: paths[1], directory: paths[2], output: paths[3],
    model: '4', sampleTicks: 1024, phaseTicks: 12_000_000 });
const invalid = [[], paths.slice(0, 3), ['', ...paths.slice(1)], [...paths, '--model'],
  ...['2', '01'].map(value => [...paths, '--model', value]),
  ...['0', '1023', '1200001', '1e4', 'NaN'].map(value => [...paths, '--sample-ticks', value]),
  ...['-1', '12000001', 'Infinity', '2.5', '00'].map(value => [...paths, '--phase-ticks', value]),
  [...paths, '--unknown', '0'], [...paths, '--model', 'all', '--model', '4']];
for (const args of invalid) assert.throws(() => parseArguments(args), `Invalid CLI accepted: ${args}`);

const memory = new WebAssembly.Memory({ initial: 1 });
const words = new Uint32Array(memory.buffer, 256, 6);
words.set([1, 2, 3, 4, 5, 6]);
let reads = 0;
const machine = { tick: 100, core: { memory,
  clock_snapshot() { reads++; return 256; },
  run() { throw new Error('Clock inspection must not execute the guest'); },
} };
const bytes = () => Buffer.from(new Uint8Array(memory.buffer));
const before = bytes(), recorder = createClockBoundaryRecorder(machine);
assert(bytes().equals(before), 'Initial clock sample mutated memory');
function sample(tick) {
  machine.tick = tick;
  const before = bytes(); recorder.observe();
  assert(bytes().equals(before), 'Boundary clock sample mutated memory');
}
sample(110); // An unchanged read still becomes the previous observation boundary.
words[3] = 44; words[5] = 0xffffffff; sample(125);
words[3] = 4; sample(130);
words[3] = 99; words[3] = 4; sample(147); // Intra-call changes may be missed.
const result = recorder.finish();
assert.equal(reads, 5);
assert.equal(result.boundary_samples, reads);
assert.deepEqual(result.interval_ticks, { minimum: 5, maximum: 17 });
assert.deepEqual(result.initial, { tick: 100, values: [1, 2, 3, 4, 5, 6] });
assert.deepEqual(result.final, { tick: 147, values: [1, 2, 3, 4, 5, 0xffffffff] });
assert.deepEqual(result.changes.map(change => [change.previous_boundary_tick, change.observed_at_tick,
  change.relative_tick, change.changed_registers]),
[[110, 125, 25, ['CLKCON', 'CLKDIVN']], [125, 130, 30, ['CLKCON']]]);
words.fill(0);
assert.equal(result.initial.values[3], 4, 'Initial snapshot aliases live memory');
assert.equal(result.changes[0].values[3], 44, 'Change snapshot aliases live memory');
assert.equal(result.final.values[5], 0xffffffff, 'Final snapshot aliases live memory');
assert.throws(() => recorder.observe(), /must advance/);
machine.tick = 146; assert.throws(() => recorder.observe(), /must advance/);
machine.tick = 148; assert.throws(() => recorder.finish(), /Missing final/);

const stable = createClockBoundaryRecorder(machine);
assert.equal(stable.finish().interval_ticks, null, 'No-run recording invents an interval');
machine.tick = 150; stable.observe();
const stableResult = stable.finish();
assert.deepEqual(stableResult.changes, []);
assert.deepEqual(stableResult.interval_ticks, { minimum: 2, maximum: 2 });
assert.deepEqual(stableResult.initial.values, stableResult.final.values);
machine.tick = -1;
assert.throws(() => createClockBoundaryRecorder(machine));

console.log('Input profiler CLI and read-only clock boundary checks passed (no ROM or guest execution).');
