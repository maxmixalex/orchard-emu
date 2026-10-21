// SPDX-License-Identifier: MIT
// Local original-ROM experiment: physical contacts and sampled guest output.
// No host pacing, browser events, wall-time benchmark, or real-device calibration.
import assert from 'node:assert/strict';
import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { applySetup, setupHash, TapQueue } from '../web/hp48.js';
import { CLOCK_RATIO_SCOPE, decodeClockRatiosIfSettled } from './clock-ratios.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const WINDOW_TICKS = 20_000_000;
const CLOCK_REGISTERS = ['LOCKTIME', 'MPLLCON', 'UPLLCON', 'CLKCON', 'CLKSLOW', 'CLKDIVN'];
const clockRatios = values => decodeClockRatiosIfSettled({
  mpllcon: values[1], clkslow: values[4], clkdivn: values[5] });
const EXPRESSIONS = [
  { name: '1+1', scans: [26, 5, 26, 6] },
  { name: '7*8', scans: [24, 3, 17, 6] },
];
const MODELS = [
  { id: 1, name: 'hp39gplus', rom: '39g+.bin', preset: 'hp39-home',
    home: 100_000_000, f6: [50_000_000], hold: 1_500_000, gap: 900_000,
    expected: ['15c75f8dac2d8f7305338d281651523c95e11f80f564ba6cdb22031756f50759',
      '2086d3abf95089b25ef4ac8cf017b86e32826d5b881f46c3d97e0958c3d6e4d5'] },
  { id: 4, name: 'hp48gii', rom: '48gii.bin', preset: 'hp48-home',
    home: 160_000_000, f6: [60_000_000, 120_000_000], hold: 600_000, gap: 360_000,
    expected: ['f643bed4bd878d2d87975d1dc8462162492775030c948600f9f43d39d838ea54',
      '87f9df77d30bcc9cb31185a9bc8de94096e41f060ac5f3d174b63fc6865ab9f8'] },
];
const usage = 'Usage: node tools/profile-input-latency.mjs BASELINE.wasm CANDIDATE.wasm ROM-DIRECTORY NEW-REPORT.json [--model all|1|4] [--sample-ticks 1024..1200000] [--phase-ticks 0..12000000]';

export function parseArguments(args) {
  if (!Array.isArray(args) || args.length < 4 || args.slice(0, 4).some(
    value => typeof value !== 'string' || !value.trim() || value.startsWith('--')))
    throw new Error(usage);
  const result = { baseline: args[0], candidate: args[1], directory: args[2],
    output: args[3], model: 'all', sampleTicks: 12_000, phaseTicks: 0 };
  const seen = new Set();
  for (let i = 4; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!['--model', '--sample-ticks', '--phase-ticks'].includes(flag) ||
        seen.has(flag) || typeof value !== 'string') throw new Error(usage);
    seen.add(flag);
    if (flag === '--model') {
      if (!['all', '1', '4'].includes(value)) throw new Error('Model must be all, 1, or 4');
      result.model = value;
    } else {
      const n = Number(value), minimum = flag === '--sample-ticks' ? 1024 : 0;
      const maximum = flag === '--sample-ticks' ? 1_200_000 : 12_000_000;
      if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(n) ||
          n < minimum || n > maximum) throw new Error(`Invalid ${flag}: ${value}`);
      result[flag === '--sample-ticks' ? 'sampleTicks' : 'phaseTicks'] = n;
    }
  }
  return result;
}

function state(machine) {
  const c = machine.core;
  const words = Array.from(new Uint32Array(c.memory.buffer, c.snapshot(), 33));
  assert.equal(words[28], 0, `Core stopped: status ${words[28]}, PC ${words[29]}, instruction ${words[30]}, detail ${words[32]}`);
  const combine = index => words[index] + words[index + 1] * 0x100000000;
  const value = { ticks: combine(22), instructions: combine(20),
    exceptions: combine(24), sleeping: Boolean(words[26]), pc: words[15] };
  for (const key of ['ticks', 'instructions', 'exceptions'])
    assert(Number.isSafeInteger(value[key]), `Unsafe ${key} counter`);
  return value;
}

function checkpoint(machine) {
  const c = machine.core;
  assert.equal(c.checkpoint_save(), 0, 'Cannot save complete checkpoint');
  return Buffer.from(new Uint8Array(c.memory.buffer, c.checkpoint_buffer(), c.checkpoint_size()));
}

function frame(machine) {
  const c = machine.core;
  assert.equal(c.frame_view(1), 0, 'Cannot read LCD pixel snapshot');
  return Buffer.from(new Uint8Array(c.memory.buffer, c.frame_buffer(), machine.width * machine.height));
}

function indicators(machine) {
  const c = machine.core;
  assert.equal(c.annunciators(), 0, 'Cannot read annunciator snapshot');
  return Array.from(new Uint8Array(c.memory.buffer, c.annunciator_buffer(), 6));
}

// clock_snapshot returns the address of machine.soc.clock without mutating it.
// Copying these six words does not invoke guest MMIO or advance guest time.
export function createClockBoundaryRecorder(machine) {
  const read = () => Array.from(new Uint32Array(machine.core.memory.buffer,
    machine.core.clock_snapshot(), CLOCK_REGISTERS.length));
  let previousTick = machine.tick, previous = read(), samples = 1;
  let minimumInterval = Infinity, maximumInterval = 0;
  const initial = { tick: previousTick, values: previous.slice(),
    clock_ratios_if_settled: clockRatios(previous) }, changes = [];
  assert(Number.isSafeInteger(previousTick) && previousTick >= 0);
  return {
    observe() {
      const tick = machine.tick;
      assert(Number.isSafeInteger(tick) && tick > previousTick, 'Clock boundary must advance');
      const interval = tick - previousTick;
      minimumInterval = Math.min(minimumInterval, interval);
      maximumInterval = Math.max(maximumInterval, interval);
      const values = read();
      const changed = CLOCK_REGISTERS.filter((_, index) => values[index] !== previous[index]);
      if (changed.length) changes.push({ previous_boundary_tick: previousTick,
        observed_at_tick: tick, relative_tick: tick - initial.tick,
        changed_registers: changed, values, clock_ratios_if_settled: clockRatios(values) });
      previousTick = tick; previous = values; samples++;
    },
    finish() {
      assert.equal(machine.tick, previousTick, 'Missing final clock boundary sample');
      return { registers: CLOCK_REGISTERS.slice(), initial,
        final: { tick: previousTick, values: previous.slice(),
          clock_ratios_if_settled: clockRatios(previous) },
        boundary_samples: samples,
        interval_ticks: samples > 1 ? { minimum: minimumInterval, maximum: maximumInterval } : null,
        changes };
    },
  };
}

function restore(machine, bytes, expectedState) {
  const c = machine.core;
  assert.equal(c.checkpoint_size(), bytes.length, 'Checkpoint capacity differs');
  new Uint8Array(c.memory.buffer, c.checkpoint_buffer(), bytes.length).set(bytes);
  assert.equal(c.checkpoint_load(bytes.length), 0, 'Cannot restore starting checkpoint');
  machine.tick = expectedState.ticks;
  assert.deepEqual(state(machine), expectedState, 'Starting CPU counters differ');
  assert(checkpoint(machine).equals(bytes), 'Starting full checkpoint differs');
}

function createMachine(module, rom, model) {
  // A compiled module yields an Instance, unlike the byte-buffer overload.
  const core = new WebAssembly.Instance(module, {}).exports;
  for (const name of ['create', 'profile', 'load', 'rom_buffer', 'run', 'snapshot',
    'frame_view', 'frame_buffer', 'annunciators', 'annunciator_buffer', 'uart_receive',
    'uart_output', 'checkpoint_save', 'checkpoint_load', 'checkpoint_size',
    'checkpoint_buffer', 'clock_snapshot', 'clock_divisor', 'timebase_hz'])
    assert.equal(typeof core[name], 'function', `Missing WASM export: ${name}`);
  assert.equal(core.create(model.id), 0, 'Cannot create model');
  assert.equal(core.profile(model.id, 0), rom.length, 'ROM capacity differs');
  new Uint8Array(core.memory.buffer, core.rom_buffer(), rom.length).set(rom);
  assert.equal(core.load(rom.length), 0, 'Cannot load original ROM');
  applySetup(core, model.id, model.preset);
  const machine = { core, tick: 0, width: core.profile(model.id, 2), height: core.profile(model.id, 3) };
  assert.equal(machine.width, 131);
  assert.equal(machine.height, 64);
  assert.equal(core.timebase_hz(), 12_000_000, 'Unexpected functional reference timebase');
  assert.equal(state(machine).ticks, 0);
  return machine;
}

function key(machine, scan, down) {
  const c = machine.core;
  const status = scan < 56 ? c.keyboard_matrix(Math.floor(scan / 7), scan % 7, Number(down)) :
    c.keyboard_dedicated([0, 4, 5, 6][scan - 56], Number(down));
  assert.equal(status, 0, 'Physical key update failed');
  assert.equal(state(machine).ticks, machine.tick, 'Physical contact changed the guest tick');
}

function runChunk(machine, budget, uart, clockRecorder) {
  assert(Number.isSafeInteger(budget) && budget > 0 && budget <= 1024);
  const c = machine.core;
  const status = c.run(budget);
  if (status !== 0) state(machine); // Preserve the exact stop diagnostic in the error.
  assert.equal(status, 0, 'Core run failed');
  machine.tick += budget;
  clockRecorder?.observe();
  const size = c.uart_receive();
  if (size && uart) uart.update(new Uint8Array(c.memory.buffer, c.uart_output(), size));
}

function boot(machine, model, phaseTicks) {
  const runTo = end => {
    while (machine.tick < end) runChunk(machine, Math.min(1024, end - machine.tick));
    assert.equal(state(machine).ticks, end, 'Boot guest tick differs from budget');
  };
  for (const at of model.f6) {
    runTo(at); key(machine, 40, true);
    runTo(at + 600_000); key(machine, 40, false);
  }
  runTo(model.home + phaseTicks);
}

function delta(before, after, hz) {
  const ticks = after.ticks - before.ticks;
  const instructions = after.instructions - before.instructions;
  const exceptions = after.exceptions - before.exceptions;
  assert(ticks >= 0 && instructions >= 0 && instructions <= ticks && exceptions >= 0);
  return { ticks, normal_reference_ms: ticks * 1000 / hz, instructions,
    exception_entries: exceptions, quanta_without_counted_instruction: ticks - instructions };
}

function execute(machine, model, expression, sampleTicks, expectedFrame) {
  const start = state(machine), end = start.ticks + WINDOW_TICKS;
  // Keep the canonical unsampled reference free of clock-loop observation.
  const clockRecorder = sampleTicks ? createClockBoundaryRecorder(machine) : null;
  const events = [], segmentChanges = [], pages = new Map(), uart = createHash('sha256');
  let enter = null, result = null, previousNonmatch = start.ticks;
  let previousLevels = null, sampleCount = 0, nextSample = start.ticks;
  const queue = new TapQueue((scan, down, tick) => {
    assert.equal(tick, machine.tick, 'TapQueue callback tick differs from actual core time');
    const before = state(machine);
    key(machine, scan, down);
    const after = state(machine);
    assert.deepEqual(after, before, 'Physical contact altered CPU counters');
    events.push({ tick, relative_tick: tick - start.ticks, scan, down: Number(down) });
    if (scan === 6 && down) { assert.equal(enter, null); enter = after; }
  }, model.hold, model.gap);
  queue.pushMany(expression.scans);
  const observe = () => {
    const current = state(machine);
    assert.equal(current.ticks, machine.tick, 'Sample tick differs from core');
    const levels = indicators(machine);
    if (previousLevels === null || levels.some((n, i) => n !== previousLevels[i])) {
      segmentChanges.push({ relative_tick: current.ticks - start.ticks, levels });
      previousLevels = levels;
    }
    const matches = frame(machine).equals(expectedFrame);
    if (!result) {
      if (matches) {
        assert(enter, 'Result frame was visible before Enter contact');
        result = current;
      } else previousNonmatch = current.ticks;
      if (enter) {
        const page = `0x${(Math.floor(current.pc / 4096) * 4096).toString(16).padStart(8, '0')}`;
        pages.set(page, (pages.get(page) ?? 0) + 1);
      }
    }
    sampleCount++;
  };
  while (machine.tick < end) {
    queue.update(machine.tick);
    if (sampleTicks && machine.tick === nextSample) {
      observe(); nextSample += sampleTicks;
    }
    const budget = Math.min(1024, end - machine.tick, queue.boundary(machine.tick) - machine.tick,
      sampleTicks ? nextSample - machine.tick : Infinity);
    runChunk(machine, budget, uart, clockRecorder);
  }
  queue.update(machine.tick);
  if (sampleTicks) observe();
  assert.equal(queue.pending, 0, 'Physical input remained queued or held at window end');
  assert(machine.tick >= queue.readyAt, 'Final key gap did not complete');
  const final = state(machine);
  assert.equal(final.ticks, end, 'Final guest tick differs from requested window');
  assert(enter, 'Enter physical contact was not executed');
  const expectedEvents = expression.scans.flatMap((scan, index) => {
    const at = index * (model.hold + model.gap);
    return [{ tick: start.ticks + at, relative_tick: at, scan, down: 1 },
      { tick: start.ticks + at + model.hold, relative_tick: at + model.hold, scan, down: 0 }];
  });
  assert.deepEqual(events, expectedEvents, 'Physical contact schedule differs');
  let profile = null;
  if (sampleTicks) {
    assert(result, 'Expected arithmetic frame was never sampled');
    const hz = machine.core.timebase_hz();
    assert(result.ticks - previousNonmatch <= sampleTicks, 'Result sample bracket exceeds resolution');
    profile = {
      start_to_enter_down: delta(start, enter, hz),
      enter_down_to_first_observed_result: delta(enter, result, hz),
      start_to_first_observed_result: delta(start, result, hz),
      last_sampled_nonmatch_relative_tick: previousNonmatch - start.ticks,
      first_observed_result_relative_tick: result.ticks - start.ticks,
      enter_release_relative_tick: events.find(event => event.scan === 6 && !event.down).relative_tick,
      sample_resolution_ticks: sampleTicks, sample_resolution_normal_ms: sampleTicks * 1000 / hz,
      sample_count: sampleCount, segment_changes: segmentChanges,
      clock_register_samples: clockRecorder.finish(),
      pc_page_samples: [...pages].sort((a, b) => b[1] - a[1]).map(([page, samples]) => ({ page, samples })),
    };
  }
  return { profile, events, final, checkpoint: checkpoint(machine), frame: frame(machine),
    uart_sha256: uart.digest('hex') };
}

export async function main(args) {
  const options = parseArguments(args);
  const models = MODELS.filter(model => options.model === 'all' || Number(options.model) === model.id);
  const [baselineBytes, candidateBytes, source, inputSource, clockSource, ...roms] = await Promise.all([
    readFile(options.baseline), readFile(options.candidate), readFile(fileURLToPath(import.meta.url)),
    readFile(new URL('../web/hp48.js', import.meta.url)),
    readFile(new URL('./clock-ratios.mjs', import.meta.url)),
    ...models.map(model => readFile(resolve(options.directory, model.rom))),
  ]);
  roms.forEach((rom, index) => assert.equal(hash(rom), setupHash(models[index].preset), 'Original ROM identity differs'));
  const [baselineModule, candidateModule] = await Promise.all([
    WebAssembly.compile(baselineBytes), WebAssembly.compile(candidateBytes),
  ]);
  const report = { schema: 'orchard-virtual-input-latency-v1', passed: false,
    generated_at: new Date().toISOString(), node: process.version,
    baseline_wasm_sha256: hash(baselineBytes), candidate_wasm_sha256: hash(candidateBytes),
    profiler_sha256: hash(source), input_source_sha256: hash(inputSource),
    clock_ratio_decoder_sha256: hash(clockSource),
    sample_ticks: options.sampleTicks, phase_ticks: options.phaseTicks, window_ticks: WINDOW_TICKS,
    boundaries: {
      start: 'All four keys are queued together at the exact restored baseline checkpoint tick; first physical down occurs at that tick.',
      enter: 'Actual keyboard_matrix call for calculator Enter down; no PC event or Worker delivery measurement.',
      result: 'First sampled LCD pixel buffer exactly matching the established arithmetic result; not notification delivery or canvas paint.',
      sampling: 'Last sampled nonmatch to first sampled match brackets an observation; short earlier matches may be missed.',
      time: 'Guest functional quanta converted at the unchanged timebase_hz; no wall-time speedup or physical-calculator calibration.',
      noninstruction: 'ticks minus counted instructions includes WFI and exception entry or other uncounted quanta; it is not a direct sleep-duration measurement.',
      pc: 'PC page histogram uses guest-time samples, not a host CPU hotspot profile.',
      segments: 'Raw six annunciator levels; physical mapping of the UI busy indicator remains provisional.',
      clocks: 'Six clock words are copied initially and after each existing successful run call in the sampled profiles. The minimum and maximum intervals between consecutive reads are recorded in guest ticks. Changed values are first observed at that run boundary; intervening writes, including changes reverted within a call, can be missed. This is not a complete MMIO write trace. The canonical reference does not sample inside its run loop.',
      clock_ratios: CLOCK_RATIO_SCOPE,
      equivalence: 'Sampled baseline and candidate start from the same full checkpoint and end byte-identical to an unsampled baseline run, with identical key events and UART bytes.',
      privacy: 'ROM and complete checkpoint bytes remain local in memory; this report contains identities and aggregates only.',
    }, cases: [] };
  // Refuse existing files before any guest work. Failed runs retain a partial report.
  const output = await open(options.output, 'wx');
  try {
    for (let index = 0; index < models.length; index++) {
      const model = models[index], rom = roms[index];
      const canonical = createMachine(baselineModule, rom, model);
      const baseline = createMachine(baselineModule, rom, model);
      const candidate = createMachine(candidateModule, rom, model);
      boot(canonical, model, options.phaseTicks);
      for (let expressionIndex = 0; expressionIndex < EXPRESSIONS.length; expressionIndex++) {
        const expression = EXPRESSIONS[expressionIndex];
        const initialState = state(canonical), initialCheckpoint = checkpoint(canonical), initialFrame = frame(canonical);
        const clock = Array.from(new Uint32Array(canonical.core.memory.buffer, canonical.core.clock_snapshot(), 6));
        const row = { model: model.id, model_name: model.name, expression: expression.name,
          rom_sha256: hash(rom), setup: model.preset, initial_tick: initialState.ticks,
          initial_state: initialState, initial_checkpoint_sha256: hash(initialCheckpoint),
          initial_frame_sha256: hash(initialFrame), hold_ticks: model.hold, gap_ticks: model.gap,
          initial_clock_registers: clock, clock_divisor: canonical.core.clock_divisor(),
          initial_clock_ratios_if_settled: clockRatios(clock),
          runner: 'run', functional_timebase_hz: canonical.core.timebase_hz(),
          expected_frame_sha256: model.expected[expressionIndex], samples: [] };
        report.cases.push(row);
        const reference = execute(canonical, model, expression, 0, null);
        assert.equal(hash(reference.frame), row.expected_frame_sha256, 'Canonical arithmetic frame differs from established original-OS result');
        assert(!reference.frame.equals(initialFrame), 'Arithmetic witness equals initial frame');
        row.canonical_final_checkpoint_sha256 = hash(reference.checkpoint);
        row.canonical_uart_sha256 = reference.uart_sha256;
        for (const [variant, machine] of [['baseline', baseline], ['candidate', candidate]]) {
          restore(machine, initialCheckpoint, initialState);
          const measured = execute(machine, model, expression, options.sampleTicks, reference.frame);
          assert(measured.checkpoint.equals(reference.checkpoint), `${variant}: complete final checkpoint differs from unsampled baseline`);
          assert(measured.frame.equals(reference.frame), `${variant}: final LCD pixels differ`);
          assert.deepEqual(measured.final, reference.final, `${variant}: final CPU counters differ`);
          assert.deepEqual(measured.events, reference.events, `${variant}: physical key events differ`);
          assert.equal(measured.uart_sha256, reference.uart_sha256, `${variant}: UART stream differs`);
          if (row.samples.length) assert.deepEqual(measured.profile, row.samples[0].profile, 'Baseline/candidate virtual latency profiles differ');
          row.samples.push({ variant, profile: measured.profile, key_events: measured.events,
            final_state: measured.final, final_checkpoint_sha256: hash(measured.checkpoint),
            initial_full_checkpoint_equal: true, final_full_checkpoint_equal: true,
            final_frame_equal: true, uart_equal: true });
          console.log(`${model.name} ${expression.name} ${variant}: Enter down to observed result ${measured.profile.enter_down_to_first_observed_result.normal_reference_ms} reference ms`);
        }
      }
    }
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    try { await output.writeFile(JSON.stringify(report, null, 2) + '\n'); }
    finally { await output.close(); }
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
