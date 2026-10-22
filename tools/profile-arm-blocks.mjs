// SPDX-License-Identifier: MIT
// Untimed, bounded original-ROM instruction-structure diagnostic. Input ROMs,
// sessions and LCD bytes stay local; reports contain only counts and hashes.
import assert from 'node:assert/strict';
import { open, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { applySetup, setupHash, TapQueue } from '../web/hp48.js';
import { decodeSession } from '../web/session.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['AND', 'EOR', 'SUB', 'RSB', 'ADD', 'ADC', 'SBC', 'RSC',
  'TST', 'TEQ', 'CMP', 'CMN', 'ORR', 'MOV', 'BIC', 'MVN'];
const operandForms = ['immediate_unrotated', 'immediate_rotated', 'register_unshifted',
  'LSL_immediate', 'LSR_immediate', 'ASR_immediate', 'ROR_immediate', 'RRX',
  'LSL_register', 'LSR_register', 'ASR_register', 'ROR_register'];
const dependencies = ['register_RAW', 'register_WAR', 'register_WAW',
  'flags_to_condition', 'flags_to_carry_input', 'flags_WAR', 'flags_WAW'];
const total = xs => xs.reduce((a, b) => a + b, 0);
export function parseArguments(args) {
  assert(args.length === 6 && args.every(a => a && !a.startsWith('--')),
    'Usage: node tools/profile-arm-blocks.mjs BASELINE.wasm PROFILE.wasm ROM-DIRECTORY FIXTURES.json ENDPOINTS.json NEW-REPORT.json');
  return { baseline: args[0], profile: args[1], roms: args[2], fixtures: args[3],
    endpoints: args[4], output: args[5] };
}
export function readPairRecords(core) {
  assert.equal(typeof core.arm_block_profile_pair, 'function', 'A v2 operand-pair collector is required');
  const rows = [];
  for (let slot = 0; slot < 65536; ++slot) {
    const tag = Number(core.arm_block_profile_pair(slot, 0));
    if (tag) rows.push([tag - 1, Number(core.arm_block_profile_pair(slot, 1)),
      Number(core.arm_block_profile_pair(slot, 2))]);
  }
  return rows;
}
export function summarizeCounters(raw, pairRecords = []) {
  assert.equal(raw.length, 480);
  assert(raw.every(n => Number.isSafeInteger(n) && n >= 0));
  const c = raw;
  assert.equal(c[0], c[1] + c[2]);
  assert.equal(c[1], c[3] + c[4] + c[5] + c[6] + c[7] + c[8]);
  assert.equal(c[9], c[7] + c[8]);
  assert.equal(c[19], 0, 'Exact opcode set overflowed; no partial profile is accepted');
  assert.equal(c[28], 0, 'Exact pair-signature set overflowed; no partial profile is accepted');
  const kinds = c.slice(32, 48), forms = c.slice(48, 52), pairs = c.slice(192, 448);
  assert.equal(total(kinds), c[7]); assert.equal(total(forms), c[7]);
  assert.equal(total(pairs), c[20]);
  assert.equal(c[20], c[7] - c[10]);
  assert.equal(c[24], c[7] - c[12], 'Every bounded neighbor must have one pair signature');
  assert.equal(c[25] * 2 + c[26], c[7], 'Disjoint pairs plus odd block tails must cover every eligible instruction');
  assert(c[26] <= c[12] && c[25] <= c[24] && c[24] <= c[20]);
  assert.equal(total(c.slice(464, 476)), c[21]);
  const blocks = (offset, count, maximum) => {
    const histogram = c.slice(offset, offset + 64);
    assert.equal(total(histogram), count);
    const weighted = total(histogram.map((n, i) => n * (i + 1)));
    if (!histogram[63]) assert.equal(weighted, c[7]);
    else assert(weighted <= c[7]);
    return { count, maximum, mean: count ? c[7] / count : null,
      histogram_1_through_63_then_64_plus: histogram,
      instructions_in_blocks_at_least_2: c[7] - histogram[0],
      instructions_in_blocks_at_least_4: c[7] - total(histogram.slice(0, 3).map((n, i) => n * (i + 1))) };
  };
  const caches = [64, 256, 1024, 4096].map((entries, i) => {
    assert.equal(c[448 + i] + c[452 + i], c[7]);
    assert.equal(c[456 + i] + c[460 + i], c[7]);
    return { entries,
      persistent: { hits: c[448 + i], misses: c[452 + i], hit_fraction: c[7] ? c[448 + i] / c[7] : null },
      cleared_each_run: { hits: c[456 + i], misses: c[460 + i], hit_fraction: c[7] ? c[456 + i] / c[7] : null } };
  });
  assert.equal(pairRecords.length, c[27]);
  assert.equal(new Set(pairRecords.map(row => row[0])).size, pairRecords.length);
  for (const row of pairRecords) {
    assert(Array.isArray(row) && row.length === 3);
    assert(row.every(n => Number.isSafeInteger(n) && n >= 0));
    const [key, adjacent, disjoint] = row;
    assert(key < 2 ** 27 && ((key >>> 8) & 15) < 12 && ((key >>> 12) & 15) < 12);
    assert(adjacent > 0 && disjoint <= adjacent);
  }
  assert.equal(total(pairRecords.map(row => row[1])), c[24]);
  assert.equal(total(pairRecords.map(row => row[2])), c[25]);
  const pairedKinds = Array(16).fill(0), pairedForms = Array(4).fill(0);
  for (const [key, , disjoint] of pairRecords) {
    for (const shift of [0, 4]) pairedKinds[(key >>> shift) & 15] += disjoint;
    for (const shift of [8, 12]) {
      const form = (key >>> shift) & 15;
      pairedForms[form < 2 ? 0 : form === 2 ? 1 : form < 8 ? 2 : 3] += disjoint;
    }
  }
  assert(pairedKinds.every((n, i) => n <= kinds[i]), 'Disjoint kind counts exceed all eligible instructions');
  assert(pairedForms.every((n, i) => n <= forms[i]), 'Disjoint form counts exceed all eligible instructions');
  const signatures = pairRecords.map(([key, adjacent, disjoint]) => ({
    first: names[key & 15], second: names[(key >>> 4) & 15],
    first_form: operandForms[(key >>> 8) & 15], second_form: operandForms[(key >>> 12) & 15],
    dependencies: Object.fromEntries(dependencies.map((name, i) => [name, Boolean(key & (1 << (16 + i)))])),
    first_writes_flags: Boolean(key & (1 << 23)), second_writes_flags: Boolean(key & (1 << 24)),
    first_conditional: Boolean(key & (1 << 25)), second_conditional: Boolean(key & (1 << 26)),
    adjacent, disjoint, signature: key,
  })).sort((a, b) => b.disjoint - a.disjoint || b.adjacent - a.adjacent || a.signature - b.signature);
  // Fixed families from the original v1 kind counts; do not choose a family
  // after observing this run. Full signatures remain available for audit.
  const families = [[13, 13], [4, 10], [13, 0]].map(([a, b]) => {
    const selected = pairRecords.filter(([key]) => (key & 255) === (a | (b << 4)));
    const plain = selected.filter(([key]) => !(key & 0x7800000) &&
      [0, 2].includes((key >>> 8) & 15) && [0, 2].includes((key >>> 12) & 15));
    return { first: names[a], second: names[b], adjacent: total(selected.map(row => row[1])),
      disjoint: total(selected.map(row => row[2])),
      unconditional_no_flags_simple_operands_disjoint: total(plain.map(row => row[2])),
      unconditional_no_flags_simple_operands_no_register_hazards_disjoint:
        total(plain.filter(([key]) => !(key & 0x70000)).map(row => row[2])) };
  });
  return { fetched: c[0], arm: c[1], thumb: c[2], condition_failed: c[3],
    branches: c[4], word_byte_or_block_transfers: c[5], other: c[6],
    pure_dp: c[7], fast_dp_excluded_pc: c[8], fast_dp: c[9],
    pure_dp_fraction: c[0] ? c[7] / c[0] : null,
    natural_blocks: blocks(64, c[10], c[11]),
    bounded_blocks: blocks(128, c[12], c[13]),
    cuts: { quiet_countdown: c[14], public_run: c[15], discontinuity: c[16], other_instruction: c[17] },
    unique_pure_opcodes: c[18], pure_opcode_set_capacity: 65536,
    runs: c[21], per_run_unique: { sum: c[22], maximum: c[23], mean: c[21] ? c[22] / c[21] : null,
      histogram_0_1_2to3_4to7_8to15_16to31_32to63_64to127_128to255_256to511_512to1023_1024plus: c.slice(464, 476) },
    kinds: Object.fromEntries(names.map((n, i) => [n, kinds[i]])),
    forms: Object.fromEntries(['immediate', 'unshifted_register', 'immediate_shift', 'register_shift'].map((n, i) => [n, forms[i]])),
    adjacent_kind_order: names, adjacent_kind_matrix: names.map((_, i) => pairs.slice(i * 16, i * 16 + 16)),
    bounded_operand_pairs: { adjacent_count: c[24], disjoint_count: c[25],
      unpaired_tail_instructions: c[26], signature_capacity: 65536,
      disjoint_instruction_fraction_of_all_fetches: c[0] ? 2 * c[25] / c[0] : null,
      grouping: 'Adjacent pairs overlap. Disjoint pairs are positions (1,2),(3,4),... within each original bounded block; they are counted before filtering by family.',
      flag_dependencies: 'Only flags consumed by conditions or carry-valued operands count as reads; flags merely preserved are not reads/writes. Register-shift carry writes use the observed low eight bits of Rs.',
      preselected_families: families, signatures },
    opcode_cache_simulation: { hash: '(opcode * 0x9e3779b9 mod 2^32) high log2(entries) bits',
      policy: 'direct mapped, complete opcode tag, only eligible pure DP references; no timing or production lookup-cost model',
      capacities: caches } };
}
function checkpoint(c) {
  assert.equal(c.checkpoint_save(), 0);
  return Buffer.from(new Uint8Array(c.memory.buffer, c.checkpoint_buffer(), c.checkpoint_size()));
}
function state(c) {
  const words = Array.from(new Uint32Array(c.memory.buffer, c.snapshot(), 33));
  assert.equal(words[28], 0, `Guest stopped (${words[28]})`);
  const n = i => words[i] + words[i + 1] * 2 ** 32;
  return { words, ticks: n(22), instructions: n(20), exceptions: n(24) };
}
function pixels(c) {
  assert.equal(c.frame_view(1), 0);
  return Buffer.from(new Uint8Array(c.memory.buffer, c.frame_buffer(), 131 * 64));
}
function replay(module, model, frame, rom, saved, endpoint, instrumented) {
  const c = new WebAssembly.Instance(module, {}).exports;
  assert.equal(c.create(model.model), 0);
  new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
  assert.equal(c.load(rom.length), 0); applySetup(c, model.model, model.preset);
  assert.equal(saved.length, c.checkpoint_size());
  new Uint8Array(c.memory.buffer, c.checkpoint_buffer(), saved.length).set(saved);
  assert.equal(c.checkpoint_load(saved.length), 0);
  assert(checkpoint(c).equals(saved), 'Full starting checkpoint changed');
  const initial = state(c), start = initial.ticks;
  assert.equal(start, frame.startTick);
  assert.equal(hash(pixels(c)), frame.start_sha256);
  let tick = start, nextSample = start, calls = 0;
  const events = [], uart = createHash('sha256');
  const queue = new TapQueue((scan, down, at) => {
    assert.equal(at, tick);
    assert.equal(c.keyboard_matrix(Math.floor(scan / 7), scan % 7, Number(down)), 0);
    events.push([at - start, scan, Number(down)]);
  }, endpoint.hold_ticks, endpoint.gap_ticks);
  queue.pushMany(frame.scans);
  if (instrumented) c.arm_block_profile_reset();
  while (tick < start + endpoint.measured_ticks) {
    queue.update(tick);
    if (tick === nextSample) nextSample += 12000;
    const n = Math.min(1024, start + endpoint.measured_ticks - tick,
      queue.boundary(tick) - tick, nextSample - tick);
    assert(n > 0);
    if (instrumented) c.arm_block_profile_run_boundary();
    assert.equal(c.run(n), 0); tick += n; ++calls;
    const size = c.uart_receive();
    if (size) uart.update(new Uint8Array(c.memory.buffer, c.uart_output(), size));
  }
  queue.update(tick);
  if (instrumented) c.arm_block_profile_finish();
  assert.equal(queue.pending, 0); assert(tick >= queue.readyAt);
  assert.deepEqual(events, endpoint.events);
  const final = state(c), finalCheckpoint = checkpoint(c), finalPixels = pixels(c);
  assert.equal(final.ticks, tick);
  assert.equal(final.instructions - initial.instructions, endpoint.instructions);
  assert.equal(hash(finalCheckpoint), endpoint.final_checkpoint_sha256);
  assert.equal(hash(finalPixels), endpoint.pixel_sha256);
  assert.equal(hash(finalPixels), frame.sha256);
  const uartHash = uart.digest('hex'); assert.equal(uartHash, endpoint.uart_sha256);
  let profile;
  if (instrumented) {
    profile = summarizeCounters(Array.from({ length: 480 }, (_, i) => Number(c.arm_block_profile_count(i))), readPairRecords(c));
    assert.equal(profile.runs, calls);
    assert.equal(profile.fetched, final.instructions - initial.instructions);
  }
  return { final, finalCheckpoint, finalPixels, uartHash, events, calls, profile };
}
export async function profileScenes(args) {
  const report = { schema: 'orchard-arm-block-profile-v2', passed: false,
    generated_at: new Date().toISOString(), node: process.version, exec_argv: process.execArgv,
    scope: 'Three existing HP39g+ complete-result workloads. Diagnostic counts only; no elapsed times, benchmark gate or hardware speed claim.',
    eligibility: 'Condition-passed ARM data-processing accepted by the current conservative fast path, excluding all PC inputs/outputs; no memory, branch, PSR, Thumb or condition-failed instructions.',
    grouping: 'Natural: adjacent PC +4, tick +1, unchanged exception count and CPSR low byte. Bounded: additionally same public run and positive quiet countdown decreasing exactly by one. Fetch/IRQ/fault work is not removed.',
    runner: 'run', quantum: 1024, sample_boundary_ticks: 12000, cases: [] };
  const output = await open(args.output, 'wx');
  try {
    const [baseline, profiled, fixturesBytes, endpointsBytes, buildBytes] = await Promise.all([
      readFile(args.baseline), readFile(args.profile), readFile(args.fixtures), readFile(args.endpoints),
      readFile(resolve(dirname(args.profile), 'build.json'))]);
    const fixtures = JSON.parse(fixturesBytes), endpoints = JSON.parse(endpointsBytes), build = JSON.parse(buildBytes);
    assert.equal(build.passed, true); assert.equal(build.wasm_sha256, hash(profiled));
    assert.equal(endpoints.passed, true); assert.equal(endpoints.runner, 'run');
    assert.equal(endpoints.quantum, 1024); assert.equal(endpoints.result_sample_ticks, 12000);
    assert.equal(hash(baseline), fixtures.baseline_wasm_sha256);
    assert.equal(hash(baseline), endpoints.baseline_wasm_sha256);
    assert.equal(hash(fixturesBytes), endpoints.fixture_sha256);
    const header = await readFile(new URL('arm-block-profile.h', import.meta.url));
    assert.equal(hash(header), build.source_sha256['tools/arm-block-profile.h']);
    Object.assign(report, { baseline_wasm_sha256: hash(baseline), profile_wasm_sha256: hash(profiled),
      fixtures_sha256: hash(fixturesBytes), endpoints_sha256: hash(endpointsBytes),
      profile_build_sha256: hash(buildBytes), collector_sha256: hash(header),
      harness_sha256: hash(await readFile(new URL(import.meta.url))), source_sha256: build.source_sha256 });
    const modules = await Promise.all([baseline, profiled].map(b => WebAssembly.compile(b)));
    assert.equal(fixtures.models.filter(m => m.model === 1).length, 1);
    const model = fixtures.models.find(m => m.model === 1);
    const rom = await readFile(resolve(args.roms, model.name));
    assert.equal(hash(rom), model.rom_sha256); assert.equal(hash(rom), setupHash(model.preset));
    for (const expression of ['1+1', 'APLET library', 'APLET Function START']) {
      assert.equal(model.frames.filter(f => f.expression === expression).length, 1);
      assert.equal(endpoints.cases.filter(e => e.model === 1 && e.expression === expression).length, 1);
      const frame = model.frames.find(f => f.expression === expression);
      const endpoint = endpoints.cases.find(e => e.model === 1 && e.expression === expression);
      assert.equal(endpoint.rom_sha256, hash(rom));
      assert(Number.isSafeInteger(endpoint.measured_ticks) && endpoint.measured_ticks > 0 && endpoint.measured_ticks <= 20000000);
      assert.equal(endpoint.hold_ticks, 1500000); assert.equal(endpoint.gap_ticks, 600000);
      assert.equal(hash(Buffer.from(frame.pixels)), frame.sha256);
      assert.equal(hash(Buffer.from(frame.start_pixels)), frame.start_sha256);
      const bytes = new Uint8Array(await readFile(frame.session));
      const saved = await decodeSession(bytes.buffer);
      assert.equal(saved.model, 1); assert.equal(saved.romHash, hash(rom));
      assert.equal(saved.preset, model.preset); assert.equal(saved.frameView, 1);
      assert.equal(hash(saved.state), endpoint.initial_checkpoint_sha256);
      const reference = replay(modules[0], model, frame, rom, saved.state, endpoint, false);
      const observed = replay(modules[1], model, frame, rom, saved.state, endpoint, true);
      assert(observed.finalCheckpoint.equals(reference.finalCheckpoint));
      assert(observed.finalPixels.equals(reference.finalPixels));
      assert.deepEqual(observed.final, reference.final); assert.deepEqual(observed.events, reference.events);
      assert.equal(observed.uartHash, reference.uartHash); assert.equal(observed.calls, reference.calls);
      const row = { model: 1, expression, rom_sha256: hash(rom), session_sha256: hash(bytes),
        initial_checkpoint_sha256: hash(saved.state), final_checkpoint_sha256: hash(observed.finalCheckpoint),
        final_pixels_sha256: hash(observed.finalPixels), uart_sha256: observed.uartHash,
        measured_ticks: endpoint.measured_ticks, instructions: endpoint.instructions,
        run_calls: observed.calls, complete_checkpoint_equal: true, complete_pixels_equal: true,
        exact_contacts_equal: true, counters: observed.profile };
      report.cases.push(row);
      console.log(JSON.stringify({ expression, pure_dp: row.counters.pure_dp,
        bounded_mean: row.counters.bounded_blocks.mean, unique_opcodes: row.counters.unique_pure_opcodes,
        complete_checkpoint_equal: true }));
    }
    report.passed = true;
    return report;
  } catch (error) { report.error = error.message; throw error; }
  finally { await output.writeFile(JSON.stringify(report, null, 2) + '\n'); await output.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await profileScenes(parseArguments(process.argv.slice(2)));
