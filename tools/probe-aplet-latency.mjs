// SPDX-License-Identifier: MIT
// Private original-ROM Aplet Library fixtures and fixed-phase input profiles.
// Covers opening the library and starting the initially selected Function.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const usage = 'Usage: node tools/probe-aplet-latency.mjs DIST ROM-DIRECTORY NEW-OUTPUT-DIRECTORY [--home-checkpoint FILE] [--runner run|run_divided|run_clocked] [--compare-divided|--compare-clocked]';
const args = process.argv.slice(2);
if (args.length < 3 || args.slice(0, 3).some(value => !value || value.startsWith('--'))) throw Error(usage);
const [dist, romDir, out] = args;
let homeCheckpoint = null, primaryRunner = 'run', compareRunner = null;
const seen = new Set();
for (let i = 3; i < args.length; ++i) {
  const flag = args[i];
  if (seen.has(flag)) throw Error(usage);
  seen.add(flag);
  if (flag === '--compare-divided' || flag === '--compare-clocked') {
    if (compareRunner) throw Error(usage);
    compareRunner = flag === '--compare-divided' ? 'run_divided' : 'run_clocked';
  }
  else if (flag === '--runner' && ['run', 'run_divided', 'run_clocked'].includes(args[i + 1])) primaryRunner = args[++i];
  else if (flag === '--home-checkpoint' && args[i + 1] && !args[i + 1].startsWith('--')) homeCheckpoint = args[++i];
  else throw Error(usage);
}
const hash = b => createHash('sha256').update(b).digest('hex');
const { applySetup, setupHash, TapQueue } = await import(pathToFileURL(resolve(dist, 'hp48.js')));
const { encodeSession } = await import(pathToFileURL(resolve(dist, 'session.js')));
const wasm = await readFile(resolve(dist, 'orchard.wasm'));
const rom = await readFile(resolve(romDir, '39g+.bin'));
assert.equal(hash(rom), setupHash('hp39-home'));
const module = await WebAssembly.compile(wasm);
function create() {
  const c = new WebAssembly.Instance(module, {}).exports;
  for (const runner of [primaryRunner, compareRunner].filter(Boolean)) assert.equal(typeof c[runner], 'function', `Missing ${runner} export`);
  assert.equal(c.create(1), 0);
  assert.equal(c.profile(1, 0), rom.length);
  new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
  assert.equal(c.load(rom.length), 0); applySetup(c, 1, 'hp39-home');
  return { c, tick: 0 };
}
function snapshot(m) {
  const w = Array.from(new Uint32Array(m.c.memory.buffer, m.c.snapshot(), 33));
  assert.equal(w[28], 0, `Stopped at ${w[29].toString(16)}`);
  return { ticks: w[22] + w[23] * 2 ** 32, instructions: w[20] + w[21] * 2 ** 32, exceptions: w[24] + w[25] * 2 ** 32 };
}
function cp(m) {
  assert.equal(m.c.checkpoint_save(), 0);
  return Buffer.from(new Uint8Array(m.c.memory.buffer, m.c.checkpoint_buffer(), m.c.checkpoint_size()));
}
function load(m, state) {
  assert.equal(state.length, m.c.checkpoint_size());
  new Uint8Array(m.c.memory.buffer, m.c.checkpoint_buffer(), state.length).set(state);
  assert.equal(m.c.checkpoint_load(state.length), 0); m.tick = snapshot(m).ticks;
  assert(cp(m).equals(state));
}
function frame(m) {
  assert.equal(m.c.frame_view(1), 0);
  return Buffer.from(new Uint8Array(m.c.memory.buffer, m.c.frame_buffer(), 131 * 64));
}
function runTo(m, end) {
  while (m.tick < end) {
    const n = Math.min(256, end - m.tick);
    const status = m.c[primaryRunner](n);
    if (status) snapshot(m);
    assert.equal(status, 0); m.tick += n; m.c.uart_receive();
  }
}
function boot(m) {
  runTo(m, 50000000);
  assert.equal(m.c.keyboard_matrix(5, 5, 1), 0); // F6 accepts the startup prompt.
  runTo(m, 50600000);
  assert.equal(m.c.keyboard_matrix(5, 5, 0), 0);
  runTo(m, 100000000);
}
function execute(m, scans, expected = null, runner = primaryRunner) {
  const initial = snapshot(m), start = m.tick, end = start + 20000000;
  const events = [], changes = [];
  const queue = new TapQueue((scan, down, tick) => {
    assert.equal(m.c.keyboard_matrix(Math.floor(scan / 7), scan % 7, Number(down)), 0);
    events.push([tick, scan, Number(down)]);
  }, 1500000, 900000);
  queue.pushMany(scans);
  let next = start, first = null, previous = null;
  const expectedHash = expected ? hash(expected) : null;
  while (m.tick < end) {
    queue.update(m.tick);
    if (expected && m.tick === next) {
      const digest = hash(frame(m));
      if (digest !== previous) changes.push({ relative_tick: m.tick - start, sha256: digest });
      previous = digest;
      if (digest === expectedHash && first === null) first = { relative_tick: m.tick - start, ...snapshot(m) };
      next += 12000;
    }
    const n = Math.min(256, end - m.tick, queue.boundary(m.tick) - m.tick, expected ? next - m.tick : Infinity);
    assert(n > 0); const status = m.c[runner](n); if (status) snapshot(m); assert.equal(status, 0);
    m.tick += n; m.c.uart_receive();
  }
  queue.update(m.tick); assert.equal(queue.pending, 0);
  assert(m.tick >= queue.readyAt);
  const final = snapshot(m), pixels = frame(m), state = cp(m);
  if (expected) { assert(pixels.equals(expected)); assert(first, 'Expected screen not sampled'); }
  return { state, pixels, events, first, changes, initial, final };
}
// A fresh directory preserves all prior evidence; ROMs and checkpoints remain
// local and are never copied into a production build or report checked into git.
await mkdir(out);
const stages = [
  { name: 'APLET library', scans: [49], expected: '6f7de6bb96994c41e97f2e1cefc0f453414714e02e56a05ca84384763c7f1a60' },
  { name: 'APLET Function START', scans: [40], expected: 'b0b7cde04193b91d9c95e6679590b8f4911a0c05a4f9082f75a1b184df6d71e0' },
];
// This small progress record never includes pixels, RAM or session payloads.
// A partial run does not create fixtures.json; only a complete run can be used
// as the browser probe's input fixture.
const progressPath = resolve(out, 'progress.json');
const progress = { schema: 'orchard-aplet-progress-v1', baseline_wasm_sha256: hash(wasm),
  primary_runner: primaryRunner, compare_runner: compareRunner, complete: false,
  failed: false, home_verified: false, current_stage: 'HOME', stages: [] };
const progressBytes = () => JSON.stringify(progress, null, 2) + '\n';
await writeFile(progressPath, progressBytes(), { flag: 'wx' });
const persistProgress = () => writeFile(progressPath, progressBytes());
try {
const m = create(), replay = create();
if (homeCheckpoint) load(m, await readFile(homeCheckpoint));
else boot(m);
assert.equal(m.tick, 100000000, 'Expected the canonical 100M-quanta HOME checkpoint');
assert.equal(hash(frame(m)), '23902312bb3b7b3d753a65fa786d54c2b8de05625979bcbea2f9bf2c33880aaa',
  'Starting checkpoint is not the canonical HP39g+ HOME screen');
progress.home_verified = true;
const homeAt = m.tick, frames = [];
for (const { name, scans, expected } of stages) {
  progress.current_stage = name;
  await persistProgress();
  const startTick = m.tick, before = frame(m), beforeCp = cp(m), index = frames.length;
  const canonical = execute(m, scans);
  assert.equal(hash(canonical.pixels), expected, 'Canonical Aplet output changed');
  load(replay, beforeCp);
  const sampled = execute(replay, scans, canonical.pixels);
  assert(sampled.state.equals(canonical.state), 'LCD sampling changed complete final checkpoint');
  assert.deepEqual(sampled.events, canonical.events);
  assert(!before.equals(canonical.pixels), 'Scenario did not change screen');
  let comparison = null;
  if (compareRunner && compareRunner !== primaryRunner) {
    load(replay, beforeCp);
    const alternateCanonical = execute(replay, scans, null, compareRunner);
    assert(alternateCanonical.pixels.equals(canonical.pixels), 'Alternate runner changed final Aplet output');
    load(replay, beforeCp);
    const alternate = execute(replay, scans, canonical.pixels, compareRunner);
    assert(alternate.state.equals(alternateCanonical.state), 'Sampling changed the alternate runner checkpoint');
    assert.deepEqual(alternate.events, alternateCanonical.events);
    comparison = { runner: compareRunner, first_result_tick: alternate.first.relative_tick,
      first_result_ms: alternate.first.relative_tick / 12000,
      instructions_to_result: alternate.first.instructions - alternate.initial.instructions,
      exceptions_to_result: alternate.first.exceptions - alternate.initial.exceptions,
      sampled_unsampled_checkpoint_equal: true, checkpoint_sha256: hash(alternate.state) };
  }
  const session = resolve(out, `1-${index}.ord`);
  await writeFile(session, await encodeSession({ model: 1, romHash: hash(rom), preset: 'hp39-home', frameView: 1, state: beforeCp }), { flag: 'wx' });
  await writeFile(resolve(out, `1-${index}-final.pgm`), Buffer.concat([Buffer.from('P5\n131 64\n255\n'), Buffer.from(Array.from(canonical.pixels, x => x ? 0 : 255))]), { flag: 'wx' });
  frames.push({ expression: name, input_kind: 'pointer', scans, startTick, session,
    start_sha256: hash(before), start_pixels: [...before], sha256: hash(canonical.pixels), pixels: [...canonical.pixels],
    comparison, profile: { first_result_tick: sampled.first.relative_tick, first_result_ms: sampled.first.relative_tick / 12000,
      instructions_to_result: sampled.first.instructions - sampled.initial.instructions,
      exceptions_to_result: sampled.first.exceptions - sampled.initial.exceptions,
      sample_ticks: 12000, events: sampled.events, changes: sampled.changes,
      sampled_unsampled_checkpoint_equal: true,
      initial_checkpoint_sha256: hash(beforeCp), final_checkpoint_sha256: hash(canonical.state) } });
  progress.stages.push({ name, scans, complete: true,
    first_result_ms: sampled.first.relative_tick / 12000,
    frame_sha256: hash(canonical.pixels), sampled_unsampled_checkpoint_equal: true,
    comparison: comparison ? { runner: comparison.runner, first_result_ms: comparison.first_result_ms,
      sampled_unsampled_checkpoint_equal: true } : null });
  progress.current_stage = null;
  await persistProgress();
  console.log(JSON.stringify({ index, scans, startTick, first_result_ms: sampled.first.relative_tick / 12000, result_sha256: hash(canonical.pixels), comparison }));
}
await writeFile(resolve(out, 'fixtures.json'), JSON.stringify({ schema: 'orchard-aplet-fixtures-v1',
  node: process.version, baseline_wasm_sha256: hash(wasm), primary_runner: primaryRunner, instrumented: true,
  host_timing_sample: false, reference_hz: 12000000, hold_ticks: 1500000, gap_ticks: 900000,
  scenario: 'HP39g+ HOME to Aplet Library; selected Function to Function Symbolic View.',
  models: [{ model: 1, name: '39g+.bin', preset: 'hp39-home', homeAt, rom_sha256: hash(rom), frames }] }, null, 2) + '\n', { flag: 'wx' });
progress.complete = true;
await persistProgress();
} catch (error) {
  progress.complete = false;
  progress.failed = true;
  // Keep detailed exceptions in local stderr, not in the portable progress
  // record: future assertion payloads may contain private guest state.
  progress.error = { name: String(error?.name ?? 'Error'),
    code: typeof error?.code === 'string' ? error.code : null };
  await persistProgress();
  throw error;
}
