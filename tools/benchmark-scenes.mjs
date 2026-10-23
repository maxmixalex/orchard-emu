// SPDX-License-Identifier: MIT
// Local original-ROM throughput at fixed, complete-result checkpoints.
// Requires private fixtures from the browser/APLET probes; never fetches ROMs.
import assert from 'node:assert/strict';
import { readFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { applySetup, setupHash, TapQueue } from '../web/hp48.js';
import { decodeSession } from '../web/session.js';
import { canonicalCheckpoint } from './checkpoint-equivalence.mjs';

const args = process.argv.slice(2);
assert(args.length === 5 || args.length === 7 && args[5] === '--repeats',
  'Usage: node tools/benchmark-scenes.mjs BASELINE.wasm CANDIDATE.wasm ROM-DIRECTORY FIXTURES.json NEW-REPORT.json [--repeats N]');
const [before, after, romDirectory, fixturePath, output] = args;
const repeats = args.length === 7 ? Number(args[6]) : 3;
assert(Number.isSafeInteger(repeats) && repeats >= 1 && repeats <= 7);
const hash = b => createHash('sha256').update(b).digest('hex');
const median = a => {
  const sorted = a.toSorted((x, y) => x - y), middle = Math.floor(a.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const binaries = await Promise.all([before, after].map(p => readFile(p)));
const modules = await Promise.all(binaries.map(b => WebAssembly.compile(b)));
const fixtureBytes = await readFile(fixturePath), fixtures = JSON.parse(fixtureBytes);
assert.equal(fixtures.baseline_wasm_sha256, hash(binaries[0]), 'Fixture baseline WASM differs');
assert(Array.isArray(fixtures.models) && fixtures.models.length > 0);
assert.equal(new Set(fixtures.models.map(m => m.model)).size, fixtures.models.length);
const affinity = process.platform === 'linux'
  ? (await readFile('/proc/self/status', 'utf8')).match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1] ?? null : null;
const report = { schema: 'orchard-scene-throughput-v1', passed: false,
  generated_at: new Date().toISOString(), node: process.version, exec_argv: process.execArgv,
  cpu_affinity: affinity,
  platform: process.platform, architecture: process.arch,
  baseline_wasm_sha256: hash(binaries[0]), candidate_wasm_sha256: hash(binaries[1]),
  fixture_sha256: hash(fixtureBytes), probe_sha256: hash(await readFile(new URL(import.meta.url))),
  checkpoint_equivalence_sha256: hash(await readFile(new URL('./checkpoint-equivalence.mjs', import.meta.url))),
  checkpoint_comparison: 'Validate each wire checksum and exact schema layout, then migrate v1 to v2 by inserting only the documented 52-byte SDI reset state. Compare every canonical byte, including SDI, CPU, peripheral state, RAM and boot SRAM. Raw wire hashes are retained separately.',
  runner: 'run', quantum: 1024, result_sample_ticks: 12000, repeats,
  process_cpu_measurement: 'process.cpuUsage user plus system time; may include V8 background work. exec_argv records engine switches. --no-liftoff requests optimizing WASM compilation up front for a separate steady-state experiment; default-engine browser measurements are still required.',
  measurement: 'Node/V8 execution from exact private scene checkpoints to the baseline first full LCD result, including all key releases and their final gap. Each variant executes the complete workload twice before alternating timed replays; the first baseline replay locates the result. Loading, explicit WASM compilation, restore, LCD sampling and final checkpoint hashing are outside timed intervals. JS key scheduling, UART draining and incremental UART hashing are included. This is host execution throughput, not browser latency or real-calculator calibration.',
  cases: [] };
const file = await open(output, 'wx');
function state(c) {
  const w = Array.from(new Uint32Array(c.memory.buffer, c.snapshot(), 33));
  assert.equal(w[28], 0, `Guest stopped: ${w.slice(28).join(',')}`);
  const n = i => w[i] + w[i + 1] * 2 ** 32;
  return { ticks: n(22), instructions: n(20), exceptions: n(24), pc: w[15] };
}
function checkpoint(c) {
  assert.equal(c.checkpoint_save(), 0);
  return Buffer.from(new Uint8Array(c.memory.buffer, c.checkpoint_buffer(), c.checkpoint_size()));
}
function pixels(c) {
  assert.equal(c.frame_view(1), 0);
  return Buffer.from(new Uint8Array(c.memory.buffer, c.frame_buffer(), 131 * 64));
}
function create(module, model, rom) {
  const c = new WebAssembly.Instance(module, {}).exports;
  assert.equal(c.create(model.model), 0);
  new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
  assert.equal(c.load(rom.length), 0); applySetup(c, model.model, model.preset);
  return c;
}
function restore(c, saved) {
  assert(saved.length <= c.checkpoint_size(), 'Checkpoint exceeds destination capacity');
  new Uint8Array(c.memory.buffer, c.checkpoint_buffer(), saved.length).set(saved);
  assert.equal(c.checkpoint_load(saved.length), 0);
  assert(Buffer.from(canonicalCheckpoint(checkpoint(c))).equals(canonicalCheckpoint(saved)),
    'Restore changed the full canonical checkpoint');
}
function replay(c, model, frame, saved, endpoint = null) {
  restore(c, saved);
  const initial = state(c), start = initial.ticks;
  assert.equal(start, frame.startTick);
  assert.equal(hash(pixels(c)), frame.start_sha256);
  assert.notEqual(frame.start_sha256, frame.sha256);
  const hold = model.model === 1 ? 1500000 : 600000;
  const gap = model.model === 1 ? 600000 : 360000;
  const events = [], uart = createHash('sha256');
  let tick = start, nextSample = start, firstResult = null;
  const limit = start + (endpoint ?? 20000000);
  const queue = new TapQueue((scan, down, at) => {
    assert.equal(at, tick);
    assert.equal(c.keyboard_matrix(Math.floor(scan / 7), scan % 7, Number(down)), 0);
    events.push([at - start, scan, Number(down)]);
  }, hold, gap);
  queue.pushMany(frame.scans);
  const cpuBegan = process.cpuUsage(), began = performance.now();
  while (tick < limit) {
    queue.update(tick);
    if (tick === nextSample) {
      if (endpoint === null && firstResult === null && hash(pixels(c)) === frame.sha256)
        firstResult = tick - start;
      nextSample += 12000;
    }
    if (endpoint === null && firstResult !== null && !queue.pending && tick >= queue.readyAt) break;
    const n = Math.min(1024, limit - tick, queue.boundary(tick) - tick, nextSample - tick);
    assert(n > 0);
    assert.equal(c.run(n), 0); tick += n;
    const size = c.uart_receive();
    if (size) uart.update(new Uint8Array(c.memory.buffer, c.uart_output(), size));
  }
  queue.update(tick);
  const ms = performance.now() - began, cpu = process.cpuUsage(cpuBegan);
  assert.equal(queue.pending, 0); assert(tick >= queue.readyAt);
  assert.deepEqual(events, frame.scans.flatMap((scan, i) => [
    [i * (hold + gap), scan, 1], [i * (hold + gap) + hold, scan, 0]]));
  assert.equal(hash(pixels(c)), frame.sha256, 'Full result LCD differs');
  if (endpoint === null) assert(firstResult !== null, 'No full result in 20M quanta');
  else assert.equal(tick - start, endpoint);
  const final = state(c);
  assert.equal(final.ticks, tick);
  return { ms, cpuMs: (cpu.user + cpu.system) / 1000,
    endpoint: tick - start, firstResult, events, initial, final,
    checkpoint: checkpoint(c), uart: uart.digest('hex'), hold, gap };
}
try {
  for (const model of fixtures.models) {
    assert([1, 4].includes(model.model));
    assert(Array.isArray(model.frames) && model.frames.length > 0);
    const rom = await readFile(resolve(romDirectory, model.name));
    assert.equal(hash(rom), model.rom_sha256); assert.equal(hash(rom), setupHash(model.preset));
    const machines = modules.map(module => create(module, model, rom));
    for (const frame of model.frames) {
      assert.equal(frame.pixels.length, 131 * 64); assert.equal(frame.start_pixels.length, 131 * 64);
      assert.equal(hash(Buffer.from(frame.pixels)), frame.sha256);
      assert.equal(hash(Buffer.from(frame.start_pixels)), frame.start_sha256);
      const bytes = new Uint8Array(await readFile(frame.session));
      const saved = await decodeSession(bytes.buffer);
      assert.equal(saved.model, model.model); assert.equal(saved.romHash, hash(rom));
      assert.equal(saved.preset, model.preset); assert.equal(saved.frameView, 1);
      const reference = replay(machines[0], model, frame, saved.state);
      const canonicalReference = Buffer.from(canonicalCheckpoint(reference.checkpoint));
      const wireCheckpoints = [reference.checkpoint, null];
      const check = result => {
        assert(canonicalReference.equals(canonicalCheckpoint(result.checkpoint)),
          'Complete canonical result checkpoint differs');
        assert.equal(result.uart, reference.uart, 'UART output differs');
        assert.deepEqual(result.final, reference.final); assert.deepEqual(result.events, reference.events);
      };
      // Match the baseline's result-finding execution before warming both
      // variants once more. Keep all raw timed values for host/JIT variability.
      const candidate = replay(machines[1], model, frame, saved.state, reference.endpoint);
      wireCheckpoints[1] = candidate.checkpoint;
      check(candidate);
      for (const c of machines) check(replay(c, model, frame, saved.state, reference.endpoint));
      const times = [[], []], cpuTimes = [[], []];
      for (let repeat = 0; repeat < repeats; ++repeat) {
        for (const variant of repeat % 2 ? [1, 0] : [0, 1]) {
          const result = replay(machines[variant], model, frame, saved.state, reference.endpoint);
          check(result); times[variant].push(result.ms); cpuTimes[variant].push(result.cpuMs);
        }
      }
      const row = { model: model.model, expression: frame.expression,
        rom_sha256: hash(rom), initial_checkpoint_sha256: hash(saved.state),
        final_checkpoint_sha256: hash(reference.checkpoint), pixel_sha256: frame.sha256,
        candidate_final_checkpoint_sha256: hash(candidate.checkpoint),
        canonical_final_checkpoint_sha256: hash(canonicalReference),
        checkpoint_versions: wireCheckpoints.map(bytes => bytes.readUInt32LE(8)),
        uart_sha256: reference.uart, hold_ticks: reference.hold, gap_ticks: reference.gap,
        first_result_ticks: reference.firstResult, measured_ticks: reference.endpoint,
        instructions: reference.final.instructions - reference.initial.instructions,
        baseline_ms: times[0], candidate_ms: times[1],
        baseline_process_cpu_ms: cpuTimes[0], candidate_process_cpu_ms: cpuTimes[1],
        speedup: median(times[0]) / median(times[1]),
        process_cpu_speedup: median(cpuTimes[0]) / median(cpuTimes[1]), events: reference.events,
        complete_checkpoint_equal: reference.checkpoint.equals(candidate.checkpoint),
        canonical_checkpoint_equal: true };
      report.cases.push(row);
      console.log(JSON.stringify({ model: row.model, expression: row.expression,
        baseline_ms: row.baseline_ms, candidate_ms: row.candidate_ms, speedup: row.speedup,
        process_cpu_speedup: row.process_cpu_speedup,
        complete_checkpoint_equal: row.complete_checkpoint_equal,
        canonical_checkpoint_equal: true }));
    }
  }
  report.passed = true;
} catch (error) { report.error = error.message; throw error; }
finally { await file.writeFile(JSON.stringify(report, null, 2) + '\n'); await file.close(); }
