// SPDX-License-Identifier: MIT
// Original HP39g+ ROM input acceptance at bounded, explicit guest phases.
// Uses canonical run() HOME states and exact full-LCD arithmetic witnesses;
// this is a continuation experiment, not physical-clock or browser timing.
import assert from 'node:assert/strict';
import { open, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { applySetup, setupHash, TapQueue } from '../web/hp48.js';

const usage = 'Usage: node tools/probe-input-dwell.mjs WASM ROM-DIRECTORY NEW-REPORT.json [--runner run|run_divided|run_clocked|run_idle] [--hold TICKS] [--gap TICKS] [--phases COMMA-SEPARATED-TICKS] [--home-checkpoint FILE]';
const args = process.argv.slice(2);
if (args.length < 3 || args.slice(0, 3).some(s => !s || s.startsWith('--'))) throw Error(usage);
const [wasmPath, romDirectory, output] = args;
let runner = 'run', hold = 1500000, gap = 900000, homeCheckpoint = null;
let phases = [0, 12000, 24000, 120000, 600000, 1200000, 2400000, 6000000];
const seen = new Set();
function ticks(value, minimum, maximum) {
  const n = Number(value);
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(n) || n < minimum || n > maximum) throw Error(usage);
  return n;
}
for (let i = 3; i < args.length; i += 2) {
  const flag = args[i], value = args[i + 1];
  if (!value || value.startsWith('--') || seen.has(flag)) throw Error(usage);
  seen.add(flag);
  if (flag === '--runner' && ['run', 'run_divided', 'run_clocked', 'run_idle'].includes(value)) runner = value;
  else if (flag === '--hold') hold = ticks(value, 120000, 2400000);
  else if (flag === '--gap') gap = ticks(value, 120000, 2400000);
  else if (flag === '--home-checkpoint') homeCheckpoint = value;
  else if (flag === '--phases') {
    phases = value.split(',').map(s => ticks(s, 0, 12000000));
    if (!phases.length || phases.length > 16 || new Set(phases).size !== phases.length) throw Error(usage);
  } else throw Error(usage);
}
const timings = [[hold, gap]];
const hash = b => createHash('sha256').update(b).digest('hex');
const wasm = await readFile(wasmPath), rom = await readFile(`${romDirectory}/39g+.bin`);
assert.equal(hash(rom), setupHash('hp39-home'));
const module = await WebAssembly.compile(wasm);
function machine() {
  const c = new WebAssembly.Instance(module, {}).exports;
  assert.equal(typeof c[runner], 'function', `Missing ${runner} export`);
  assert.equal(c.create(1), 0);
  new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
  assert.equal(c.load(rom.length), 0); applySetup(c, 1, 'hp39-home');
  return { c, tick: 0 };
}
function state(m) {
  const words = Array.from(new Uint32Array(m.c.memory.buffer, m.c.snapshot(), 33));
  return { ticks: words[22] + words[23] * 2 ** 32, instructions: words[20] + words[21] * 2 ** 32,
    stop: words[28], pc: words[15] };
}
function key(m, scan, down) { assert.equal(m.c.keyboard_matrix(Math.floor(scan / 7), scan % 7, Number(down)), 0); }
function run(m, end, selected = runner) {
  while (m.tick < end) {
    const budget = Math.min(256, end - m.tick);
    const rc = m.c[selected](budget);
    if (rc) { m.tick = state(m).ticks; return false; }
    m.tick += budget;
    m.c.uart_receive();
  }
  return true;
}
function pixels(m) {
  assert.equal(m.c.frame_view(1), 0);
  return Buffer.from(new Uint8Array(m.c.memory.buffer, m.c.frame_buffer(), 131 * 64));
}
function save(m) {
  assert.equal(m.c.checkpoint_save(), 0);
  return Buffer.from(new Uint8Array(m.c.memory.buffer, m.c.checkpoint_buffer(), m.c.checkpoint_size()));
}
function restore(m, cp) {
  assert.equal(cp.length, m.c.checkpoint_size());
  new Uint8Array(m.c.memory.buffer, m.c.checkpoint_buffer(), cp.length).set(cp);
  assert.equal(m.c.checkpoint_load(cp.length), 0); m.tick = state(m).ticks;
  assert(save(m).equals(cp), 'Restored full checkpoint differs');
}
function trial(m, expression, timing, expected) {
  const start = m.tick, end = start + 20000000;
  assert(!pixels(m).equals(expected), 'Result was already visible before input');
  const events = [];
  const queue = new TapQueue((scan, down, at) => { key(m, scan, down); events.push([at - start, scan, Number(down)]); }, ...timing);
  queue.pushMany(expression);
  let firstMatch = null, nextSample = start, stopped = false;
  while (m.tick < end) {
    queue.update(m.tick);
    if (m.tick === nextSample) {
      if (expected && firstMatch === null && pixels(m).equals(expected)) firstMatch = m.tick - start;
      nextSample += 12000;
    }
    // Once the result is visible, complete the physical release/gap and check
    // the final frame again. No need to spend the rest of the 20M window idle.
    if (firstMatch !== null && !queue.pending && m.tick >= queue.readyAt) break;
    if (!run(m, Math.min(end, queue.boundary(m.tick), nextSample, m.tick + 256))) { stopped = true; break; }
  }
  queue.update(m.tick);
  const frame = pixels(m), checkpoint = save(m);
  const expectedEvents = expression.flatMap((scan, i) => [
    [i * (timing[0] + timing[1]), scan, 1],
    [i * (timing[0] + timing[1]) + timing[0], scan, 0],
  ]);
  if (!stopped) assert.deepEqual(events, expectedEvents, 'Physical contacts differ from the requested schedule');
  return { hold: timing[0], gap: timing[1], result_ms: firstMatch === null ? null : firstMatch / 12000,
    enter_ms: events.find(x => x[1] === 6 && x[2] === 1)?.[0] / 12000,
    correct: !stopped && firstMatch !== null && !queue.pending && frame.equals(expected), stopped, state: state(m), events,
    frame_sha256: hash(frame), checkpoint_sha256: hash(checkpoint), frame, checkpoint };
}
const baseline = machine();
if (homeCheckpoint) restore(baseline, await readFile(homeCheckpoint));
else {
  assert(run(baseline, 50000000, 'run')); key(baseline, 40, true);
  assert(run(baseline, 50600000, 'run')); key(baseline, 40, false);
  assert(run(baseline, 100000000, 'run'));
}
assert.equal(baseline.tick, 100000000);
assert.equal(hash(pixels(baseline)), '23902312bb3b7b3d753a65fa786d54c2b8de05625979bcbea2f9bf2c33880aaa',
  'Starting checkpoint is not the canonical HP39g+ HOME screen');
const homeHash = hash(save(baseline));
const expressions = [{ name: '1+1', scans: [26, 5, 26, 6], expected: '15c75f8dac2d8f7305338d281651523c95e11f80f564ba6cdb22031756f50759' },
  { name: '7*8', scans: [24, 3, 17, 6], expected: '2086d3abf95089b25ef4ac8cf017b86e32826d5b881f46c3d97e0958c3d6e4d5' }];
const fixtures = [];
for (const expression of expressions) {
  const before = save(baseline);
  // Canonical fixtures always retain the legacy runner and original timing.
  const start = baseline.tick;
  const q = new TapQueue((s, d) => key(baseline, s, d), 1500000, 900000);
  q.pushMany(expression.scans);
  while (baseline.tick < start + 20000000) {
    q.update(baseline.tick);
    assert(run(baseline, Math.min(start + 20000000, q.boundary(baseline.tick), baseline.tick + 256), 'run'));
  }
  q.update(baseline.tick);
  const expected = pixels(baseline); assert.equal(hash(expected), expression.expected);
  fixtures.push({ ...expression, before, expected });
}
const rows = [];
const candidate = machine();
const report = { schema: 'orchard-input-dwell-v1', wasm_sha256: hash(wasm), runner,
  home_checkpoint_sha256: homeHash,
  baseline_runner: 'run', continuation_from_legacy_home: true, instrumented: true,
  host_timing_sample: false, reference_hz: 12000000, hold_ticks: hold, gap_ticks: gap,
  phases, planned_cases: phases.length * fixtures.length, complete: false, rejected: false, rows };
const file = await open(output, 'wx');
async function persist() {
  const data = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  let offset = 0;
  while (offset < data.length) offset += (await file.write(data, offset, data.length - offset, offset)).bytesWritten;
  await file.truncate(data.length);
}
await persist();
try {
outer: for (const timing of timings) for (const phase of phases) for (const fixture of fixtures) {
  restore(candidate, fixture.before);
  assert(run(candidate, candidate.tick + phase));
  const result = trial(candidate, fixture.scans, timing, fixture.expected);
  delete result.frame; delete result.checkpoint;
  rows.push({ expression: fixture.name, phase, ...result });
  console.log(JSON.stringify({ expression: fixture.name, phase, timing, result_ms: result.result_ms,
    correct: result.correct, stopped: result.stopped }));
  report.rejected ||= !result.correct;
  await persist();
  // Rejected timings are not eligible for production. Preserve the first
  // counterexample and stop rather than spending more CPU on that candidate.
  if (report.rejected) break outer;
}
report.complete = !report.rejected && rows.length === report.planned_cases;
await persist();
} finally { await file.close(); }
if (report.rejected) process.exitCode = 1;
