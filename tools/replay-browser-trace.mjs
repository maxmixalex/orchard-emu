// SPDX-License-Identifier: MIT
// Replay a private opt-in browser API trace; does not acquire any firmware.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {basename, dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {traceOperationArguments} from './browser-core-trace.mjs';
import {validateRuntimeTrace} from './browser-runtime-trace.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const unsigned = n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const bytes = a => Array.isArray(a) && a.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
const words33 = a => Array.isArray(a) && a.length === 33 && a.every(unsigned);

export function validateBrowserTrace(trace) {
  assert.equal(trace.schema, 'orchard-browser-core-trace-v1', 'Unsupported trace schema');
  assert.equal(trace.instrumented, true, 'A trace must identify its instrumentation');
  assert.equal(trace.performance_sample, false, 'Instrumented traces are not performance samples');
  assert.equal(trace.complete, true, 'Incomplete trace cannot establish replay equality');
  assert.deepEqual(trace.problems, [], 'Trace reports incomplete coverage');
  assert(Number.isSafeInteger(trace.epoch) && trace.epoch > 0, 'Invalid epoch');
  assert(Number.isSafeInteger(trace.generation) && trace.generation >= 0, 'Invalid generation');
  assert(Number.isInteger(trace.model) && trace.model >= 1 && trace.model <= 6, 'Invalid model');
  assert.equal(trace.context?.generation, trace.generation, 'Capture belongs to a different generation');
  assert.equal(trace.context?.model, trace.model, 'Capture belongs to a different model');
  assert(Array.isArray(trace.calls) && trace.calls.length <= 1000000, 'Invalid call array');
  assert.equal(trace.call_count, trace.calls.length, 'Missing or duplicated recorded calls');
  assert(words33(trace.initial_words) && words33(trace.final_words), 'Invalid CPU state words');
  if (trace.runtime !== undefined) validateRuntimeTrace(trace.runtime, trace);
  for (const [index, row] of trace.calls.entries()) {
    assert.equal(row.seq, index + 1, 'Missing, reordered or duplicated API call');
    assert.equal(row.epoch, trace.epoch, 'Call from a different checkpoint epoch');
    assert.equal(row.generation, trace.generation, 'Call from a different Worker generation');
    assert(typeof row.name === 'string', 'Invalid API operation name at call ' + row.seq);
    assert(Object.hasOwn(traceOperationArguments, row.name), 'Unrepresented API operation: ' + row.name);
    assert(Array.isArray(row.args) && row.args.length === traceOperationArguments[row.name] && row.args.every(unsigned),
      'Invalid arguments at call ' + row.seq);
    assert([row.before, row.after].every(n => Number.isSafeInteger(n) && n >= 0) && row.after >= row.before,
      'Invalid guest tick at call ' + row.seq);
    assert([row.result, row.prior, row.status].every(unsigned), 'Invalid API result at call ' + row.seq);
    if (row.name === 'uart_send' || row.name === 'usb_out') {
      const length = row.args[row.name === 'uart_send' ? 0 : 4];
      assert(bytes(row.input) && row.input.length === length && length <= (row.name === 'uart_send' ? 1024 : 64),
        'Missing input payload at call ' + row.seq);
    } else assert(!Object.hasOwn(row, 'input'), 'Unexpected input payload at call ' + row.seq);
    if (row.name === 'uart_receive') assert(bytes(row.output) && row.output.length === row.result && row.output.length <= 1024,
      'Missing UART output at call ' + row.seq);
    else if (row.name === 'usb_in') assert(bytes(row.output) && row.output.length <= 64 && unsigned(row.data1),
      'Missing USB output at call ' + row.seq);
    else assert(!Object.hasOwn(row, 'output') && !Object.hasOwn(row, 'data1'), 'Unexpected output payload at call ' + row.seq);
  }
}

export async function replayBrowserTrace({trace, rom, wasm, initial, final, compareBuild = false}) {
  validateBrowserTrace(trace);
  for (const [name, data] of [['rom', rom], ['initial', initial], ['final', final]]) {
    assert(data instanceof Uint8Array, 'Missing bytes for ' + name);
    assert.equal(hash(data), trace[name + '_sha256'], name + ' bytes differ from the captured artifact');
  }
  const wasmHash = hash(wasm);
  assert(typeof trace.wasm_sha256 === 'string' && /^[a-f0-9]{64}$/.test(trace.wasm_sha256), 'Missing captured WASM hash');
  if (!compareBuild) assert.equal(wasmHash, trace.wasm_sha256, 'Use --compare-build explicitly for a different WASM');
  const {instance: {exports: c}} = await WebAssembly.instantiate(wasm, {});
  assert.equal(c.create(trace.model), 0);
  assert.equal(rom.length, c.profile(trace.model, 0), 'ROM capacity differs from the captured model');
  new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
  assert.equal(c.load(rom.length), 0);
  assert.equal(initial.length, c.checkpoint_size(), 'Invalid initial checkpoint size');
  assert.equal(final.length, initial.length, 'Invalid final checkpoint size');
  new Uint8Array(c.memory.buffer, c.checkpoint_buffer(), initial.length).set(initial);
  assert.equal(c.checkpoint_load(initial.length), 0, 'Invalid initial checkpoint/ROM identity or CRC');
  const state = () => Array.from(new Uint32Array(c.memory.buffer, c.snapshot(), 33));
  const tick = words => words[22] + words[23] * 4294967296;
  assert.deepEqual(state(), trace.initial_words, 'Captured starting CPU state differs');
  let runCalls = 0, inputCalls = 0, uartBytes = 0;
  for (const row of trace.calls) {
    assert.equal(typeof c[row.name], 'function', 'Missing API: ' + row.name);
    if (row.input) new Uint8Array(c.memory.buffer,
      row.name === 'uart_send' ? c.uart_input() : c.usb_buffer(), row.input.length).set(row.input);
    const before = state(), result = c[row.name](...row.args), after = state();
    assert.deepEqual([tick(before), tick(after), result >>> 0, before[28], after[28]],
      [row.before, row.after, row.result, row.prior, row.status],
      'API result/state mismatch at call ' + row.seq + ' (' + row.name + ')');
    if (row.name === 'uart_receive') {
      assert.deepEqual(Array.from(new Uint8Array(c.memory.buffer, c.uart_output(), result)), row.output,
        'UART output differs at call ' + row.seq); uartBytes += result;
    } else if (row.name === 'usb_in') {
      assert.deepEqual(Array.from(new Uint8Array(c.memory.buffer, c.usb_buffer(), c.usb_length())), row.output,
        'USB output differs at call ' + row.seq);
      assert.equal(c.usb_data1(), row.data1, 'USB DATA toggle differs at call ' + row.seq);
    }
    runCalls += Number(['run','run_divided','run_clocked','run_idle'].includes(row.name));
    inputCalls += Number(row.name === 'keyboard_matrix' || row.name === 'keyboard_dedicated');
  }
  const finalWords = state();
  assert.deepEqual(finalWords, trace.final_words, 'Final CPU state differs');
  assert.equal(c.checkpoint_save(), 0, 'Replay final checkpoint cannot be saved');
  const saved = new Uint8Array(c.memory.buffer, c.checkpoint_buffer(), c.checkpoint_size());
  assert.equal(hash(saved), trace.final_sha256, 'Complete replay checkpoint differs from the captured checkpoint');
  assert.deepEqual(saved, new Uint8Array(final), 'Complete checkpoint bytes differ');
  return {schema: 'orchard-browser-core-replay-v1', passed: true, instrumented: true,
    performance_sample: false, model: trace.model, epoch: trace.epoch, generation: trace.generation,
    calls: trace.calls.length, run_calls: runCalls, key_transition_calls: inputCalls, uart_bytes: uartBytes,
    every_call_result_equal: true, complete_checkpoint_equal: true,
    start_tick: tick(trace.initial_words), end_tick: tick(finalWords), stop: finalWords.slice(28, 33),
    rom_sha256: hash(rom), wasm_sha256: wasmHash, captured_wasm_sha256: trace.wasm_sha256,
    same_wasm: wasmHash === trace.wasm_sha256, initial_sha256: hash(initial), final_sha256: hash(final)};
}

async function main() {
  const args = process.argv.slice(2), compareBuild = args.at(-1) === '--compare-build';
  if (compareBuild) args.pop();
  assert.equal(args.length, 4, 'Usage: node tools/replay-browser-trace.mjs TRACE.json ROM WASM NEW-REPORT.json [--compare-build]');
  const [tracePath, romPath, wasmPath, reportPath] = args.map(p => resolve(p));
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  validateBrowserTrace(trace);
  const localCheckpoint = field => {
    const name = trace[field + '_file'];
    assert(typeof name === 'string' && name && name === basename(name) && name !== '.' && name !== '..',
      'Checkpoint files must be siblings of the private trace');
    return resolve(dirname(tracePath), name);
  };
  const [rom, wasm, initial, final] = await Promise.all([
    readFile(romPath), readFile(wasmPath), readFile(localCheckpoint('initial')), readFile(localCheckpoint('final')),
  ]);
  const report = await replayBrowserTrace({trace, rom, wasm, initial, final, compareBuild});
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(report));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
