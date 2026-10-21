// SPDX-License-Identifier: MIT
// Original-ROM local experiment. This compares functional run policies, not
// host throughput or physical-calculator clock calibration.
import assert from 'node:assert/strict';
import { readFile, open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { applySetup, setupHash, TapQueue } from '../web/hp48.js';
import { CLOCK_RATIO_SCOPE, decodeClockRatiosIfSettled } from './clock-ratios.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const args = process.argv.slice(2);
const usage = 'Usage: node tools/probe-clock-latency.mjs WASM ROM-DIRECTORY NEW-REPORT.json [all|1|4] [run_divided|run_clocked|run_idle] [continuation|cold]';
assert(args.length >= 3 && args.length <= 6 && args.slice(0, 3).every(
  value => typeof value === 'string' && value.trim() && !value.startsWith('--')), usage);
const [wasmPath, romDirectory, outputPath, selection = 'all', candidatePolicy = 'run_divided',
  bootPolicy = 'continuation'] = args;
assert(['all', '1', '4'].includes(selection), usage);
assert(['run_divided', 'run_clocked', 'run_idle'].includes(candidatePolicy), usage);
assert(['continuation', 'cold'].includes(bootPolicy), usage);
const cachedHomePrefix = process.env.ORCHARD_CLOCK_PROBE_HOME_PREFIX;
assert(cachedHomePrefix === undefined || cachedHomePrefix.trim(), 'HOME cache prefix must not be empty');
const WINDOW = 20_000_000, SAMPLE = 12_000, QUANTUM = 256;
const models = [
  { id: 1, name: 'hp39gplus', rom: '39g+.bin', preset: 'hp39-home', home: 100_000_000,
    homeCheckpoint: '50810ec0d7d654ac260da7b53017833321f4af39d5b0ccbd43f0285c9ed3a8fb',
    f6: [50_000_000], hold: 1_500_000, gap: 900_000, expected: [
      '15c75f8dac2d8f7305338d281651523c95e11f80f564ba6cdb22031756f50759',
      '2086d3abf95089b25ef4ac8cf017b86e32826d5b881f46c3d97e0958c3d6e4d5'] },
  { id: 4, name: 'hp48gii', rom: '48gii.bin', preset: 'hp48-home', home: 160_000_000,
    homeCheckpoint: '96e45b6d2188b2e0d8a2ed207bb430a5da36f9105a9be0f968ed0cd1c77cc69c',
    f6: [60_000_000, 120_000_000], hold: 600_000, gap: 360_000, expected: [
      'f643bed4bd878d2d87975d1dc8462162492775030c948600f9f43d39d838ea54',
      '87f9df77d30bcc9cb31185a9bc8de94096e41f060ac5f3d174b63fc6865ab9f8'] },
].filter(m => selection === 'all' || m.id === Number(selection));
const expressions = [{ name: '1+1', scans: [26, 5, 26, 6] },
  { name: '7*8', scans: [24, 3, 17, 6] }];
const bytes = await readFile(wasmPath), module = await WebAssembly.compile(bytes);
const output = await open(outputPath, 'wx');
const report = { schema: 'orchard-clock-policy-latency-v1', passed: false,
  generated_at: new Date().toISOString(), wasm_sha256: hash(bytes),
  probe_sha256: hash(await readFile(new URL(import.meta.url))),
  input_source_sha256: hash(await readFile(new URL('../web/hp48.js', import.meta.url))),
  clock_ratio_decoder_sha256: hash(await readFile(new URL('./clock-ratios.mjs', import.meta.url))),
  clock_ratio_scope: CLOCK_RATIO_SCOPE,
  quantum: QUANTUM, sample_ticks: SAMPLE, window_ticks: WINDOW,
  timebase_hz: 12_000_000, candidate_policy: candidatePolicy, boot_policy: bootPolicy,
  legacy_home_origin: cachedHomePrefix ? 'verified canonical checkpoint cache' : 'fresh legacy boot',
  scope: 'Continuation starts both policies at the same canonical legacy HOME checkpoint; cold starts the candidate from reset and compares with canonical legacy HOME, which may be cached. Physical contact schedules stay fixed and each policy is checked against an unsampled execution. Cross-policy checkpoints are expected to differ. Times are functional reference times, not measured hardware times or wall-time speedups.', cases: [] };

function state(m) {
  const w = Array.from(new Uint32Array(m.c.memory.buffer, m.c.snapshot(), 33));
  assert.equal(w[28], 0, `Stopped ${w[28]} PC ${w[29]} instruction ${w[30]} detail ${w[32]}`);
  const n = i => w[i] + w[i + 1] * 0x100000000;
  const result = { ticks: n(22), instructions: n(20), exceptions: n(24), pc: w[15],
    cp15_control: w[17], sleeping: Boolean(w[26]) };
  for (const key of ['ticks', 'instructions', 'exceptions'])
    assert(Number.isSafeInteger(result[key]) && result[key] >= 0, `Unsafe ${key} counter`);
  return result;
}
function checkpoint(m) {
  assert.equal(m.c.checkpoint_save(), 0);
  return Buffer.from(new Uint8Array(m.c.memory.buffer, m.c.checkpoint_buffer(), m.c.checkpoint_size()));
}
function pixels(m) {
  assert.equal(m.c.frame_view(1), 0);
  return Buffer.from(new Uint8Array(m.c.memory.buffer, m.c.frame_buffer(), 131 * 64));
}
function clocks(m) {
  return Array.from(new Uint32Array(m.c.memory.buffer, m.c.clock_snapshot(), 6));
}
function make(rom, model, policy) {
  const c = new WebAssembly.Instance(module, {}).exports;
  assert.equal(typeof c[policy], 'function', `Missing runner ${policy}`);
  assert.equal(c.timebase_hz(), 12_000_000, 'Unexpected functional reference timebase');
  assert.equal(c.profile(model.id, 2), 131);
  assert.equal(c.profile(model.id, 3), 64);
  assert.equal(c.create(model.id), 0);
  new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
  assert.equal(c.load(rom.length), 0); applySetup(c, model.id, model.preset);
  return { c, policy, tick: 0 };
}
function restore(m, cp) {
  assert.equal(cp.length, m.c.checkpoint_size());
  new Uint8Array(m.c.memory.buffer, m.c.checkpoint_buffer(), cp.length).set(cp);
  assert.equal(m.c.checkpoint_load(cp.length), 0);
  m.tick = state(m).ticks; assert(checkpoint(m).equals(cp));
}
function key(m, scan, down) {
  assert.equal(m.c.keyboard_matrix(Math.floor(scan / 7), scan % 7, Number(down)), 0);
}
function run(m, n, uart) {
  assert(Number.isSafeInteger(n) && n > 0 && n <= QUANTUM);
  const status = m.c[m.policy](n);
  if (status) state(m);
  assert.equal(status, 0); m.tick += n;
  const size = m.c.uart_receive();
  if (size && uart) uart.update(new Uint8Array(m.c.memory.buffer, m.c.uart_output(), size));
}
function runTo(m, end) { while (m.tick < end) run(m, Math.min(QUANTUM, end - m.tick)); }
function boot(m, model) {
  for (const at of model.f6) {
    runTo(m, at); key(m, 40, true); runTo(m, at + 600_000); key(m, 40, false);
  }
  runTo(m, model.home);
}
function execute(m, model, expression, expected, sampled) {
  const start = state(m), end = start.ticks + WINDOW, events = [];
  const uart = createHash('sha256'), clockModes = new Map();
  let enter, enterCheckpoint, firstResult, lastNonmatch = start.ticks, nextSample = start.ticks;
  const taps = new TapQueue((scan, down, tick) => {
    assert.equal(tick, m.tick); key(m, scan, down);
    events.push({ relative_tick: tick - start.ticks, scan, down: Number(down) });
    if (scan === 6 && down) { enter = state(m); enterCheckpoint = checkpoint(m); }
  }, model.hold, model.gap);
  taps.pushMany(expression.scans);
  const observe = () => {
    const s = state(m), clock = clocks(m);
    assert.equal(s.ticks, m.tick);
    const mode = `${s.cp15_control.toString(16)}:${clock[1].toString(16)}:${clock[4].toString(16)}:${clock[5].toString(16)}`;
    const old = clockModes.get(mode);
    if (old) old.samples++;
    else clockModes.set(mode, { cp15_control: s.cp15_control, mpll: clock[1],
      clkslow: clock[4], clkdivn: clock[5], first_relative_tick: s.ticks - start.ticks, samples: 1,
      clock_ratios_if_settled: decodeClockRatiosIfSettled({
        mpllcon: clock[1], clkslow: clock[4], clkdivn: clock[5] }) });
    if (!firstResult) {
      if (hash(pixels(m)) === expected) { assert(enter); firstResult = s; }
      else lastNonmatch = s.ticks;
    }
  };
  while (m.tick < end) {
    taps.update(m.tick);
    if (sampled && m.tick === nextSample) { observe(); nextSample += SAMPLE; }
    run(m, Math.min(QUANTUM, end - m.tick, taps.boundary(m.tick) - m.tick,
      sampled ? nextSample - m.tick : Infinity), uart);
  }
  taps.update(m.tick); if (sampled) observe();
  assert.equal(taps.pending, 0); assert(m.tick >= taps.readyAt); assert(enter);
  const expectedEvents = expression.scans.flatMap((scan, index) => {
    const at = index * (model.hold + model.gap);
    return [{ relative_tick: at, scan, down: 1 },
      { relative_tick: at + model.hold, scan, down: 0 }];
  });
  assert.deepEqual(events, expectedEvents, 'Physical contact schedule differs');
  assert.equal(hash(pixels(m)), expected, 'Arithmetic result pixels differ');
  if (sampled) {
    assert(firstResult, 'Arithmetic result was not observed');
    assert(firstResult.ticks - lastNonmatch <= SAMPLE, 'Result bracket exceeds sample resolution');
  }
  return { events, cp: checkpoint(m), state: state(m), uart: uart.digest('hex'), enterCheckpoint,
    metrics: sampled ? { enter_reference_ms: (enter.ticks - start.ticks) / 12_000,
      result_reference_ms: (firstResult.ticks - start.ticks) / 12_000,
      post_enter_reference_ms: (firstResult.ticks - enter.ticks) / 12_000,
      post_enter_instructions: firstResult.instructions - enter.instructions,
      post_enter_exceptions: firstResult.exceptions - enter.exceptions,
      result_bracket_ticks: [lastNonmatch - start.ticks, firstResult.ticks - start.ticks],
      clocks: [...clockModes.values()] } : null };
}

try {
  for (const model of models) {
    const rom = await readFile(resolve(romDirectory, model.rom));
    assert.equal(hash(rom), setupHash(model.preset));
    const home = make(rom, model, 'run');
    if (cachedHomePrefix) restore(home, await readFile(`${cachedHomePrefix}.${model.id}.home.checkpoint`));
    else boot(home, model);
    assert.equal(home.tick, model.home, 'Unexpected legacy HOME checkpoint phase');
    const initial = checkpoint(home);
    // These fixed canonical hashes were established with the default legacy
    // runner. A same-tick/same-ROM checkpoint can still have a different boot
    // policy or input history; it must not silently become a legacy baseline.
    assert.equal(hash(initial), model.homeCheckpoint, 'Canonical legacy HOME checkpoint identity differs');
    await writeFile(`${outputPath}.${model.id}.home.checkpoint`, initial, { flag: 'wx' });
    console.log(`${model.name} HOME saved at ${home.tick}; CP15 0x${state(home).cp15_control.toString(16)}`);
    const policyResults = [];
    for (const policy of ['run', candidatePolicy]) {
      const canonical = make(rom, model, policy), sampled = make(rom, model, policy);
      if (policy === candidatePolicy && bootPolicy === 'cold') {
        boot(canonical, model);
        assert(pixels(canonical).equals(pixels(home)), 'Cold policy HOME pixels differ from legacy HOME');
        await writeFile(`${outputPath}.${model.id}.${policy}.home.checkpoint`, checkpoint(canonical), { flag: 'wx' });
        console.log(`${model.name} ${policy} cold HOME saved at ${canonical.tick}`);
      } else restore(canonical, initial);
      for (let i = 0; i < expressions.length; i++) {
        const cp = checkpoint(canonical);
        const raw = execute(canonical, model, expressions[i], model.expected[i], false);
        restore(sampled, cp);
        const measured = execute(sampled, model, expressions[i], model.expected[i], true);
        assert(measured.cp.equals(raw.cp), 'Sampled and unsampled complete checkpoints differ');
        assert.deepEqual(measured.events, raw.events); assert.deepEqual(measured.state, raw.state);
        assert.equal(measured.uart, raw.uart);
        await writeFile(`${outputPath}.${model.id}.${policy}.${i}.enter.checkpoint`, raw.enterCheckpoint, { flag: 'wx' });
        const row = { model: model.id, expression: expressions[i].name, policy,
          rom_sha256: hash(rom), setup: model.preset, hold_ticks: model.hold, gap_ticks: model.gap,
          initial_checkpoint_sha256: hash(cp), final_checkpoint_sha256: hash(raw.cp),
          pixel_sha256: model.expected[i], final_state: raw.state, same_policy_checkpoint_equal: true,
          events: raw.events, uart_sha256: raw.uart, ...measured.metrics };
        report.cases.push(row); policyResults.push(row);
        console.log(`${model.name} ${expressions[i].name} ${policy}: Enter ${row.post_enter_reference_ms} ms, total ${row.result_reference_ms} ms`);
      }
    }
    for (let i = 0; i < expressions.length; i++) {
      assert.deepEqual(policyResults[i].events, policyResults[i + expressions.length].events);
      assert.equal(policyResults[i].pixel_sha256, policyResults[i + expressions.length].pixel_sha256);
    }
  }
  report.passed = true;
} catch (error) { report.error = error.message; throw error; }
finally { await output.writeFile(JSON.stringify(report, null, 2) + '\n'); await output.close(); }
