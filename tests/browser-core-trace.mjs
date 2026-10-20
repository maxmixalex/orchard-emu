// SPDX-License-Identifier: MIT
// Generated guests verify recording/replay, including trace corruption controls.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {attachCoreTrace} from '../tools/browser-core-trace.mjs';
import {replayBrowserTrace, validateBrowserTrace} from '../tools/replay-browser-trace.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const wasm = await readFile(new URL('../dist/orchard.wasm', import.meta.url));
const rom = new Uint8Array(1048576).fill(255), view = new DataView(rom.buffer);
view.setUint32(0, 0xea000002, true); // Branch to the explicit diagnostic stop.
view.setUint32(16, 0xe7f000f0, true);
const metadata = {generation: 7, model: 1, preset: 'strict'};
let captured, epochs = [];
async function make(options = {}) {
  const {instance: {exports: raw}} = await WebAssembly.instantiate(wasm, {});
  const c = attachCoreTrace({...raw, unrepresented_mutation: () => 0}, {
    context: () => metadata, onCapture: trace => { captured = trace; },
    onEpoch: epoch => epochs.push(epoch), ...options,
  });
  assert.equal(c.create(1), 0);
  new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
  assert.equal(c.load(rom.length), 0);
  return c;
}
function artifact(trace) {
  const {initial, final, ...data} = trace;
  return {trace: {...structuredClone(data), rom_sha256: hash(rom), wasm_sha256: hash(wasm),
    initial_sha256: hash(initial), final_sha256: hash(final)}, initial, final, wasm, rom};
}
const c = await make();
assert.equal(c.keyboard_attach(1), 0);
assert.equal(c.keyboard_matrix(3, 3, 1), 0);
assert.equal(c.run(1), 0);
new Uint8Array(c.memory.buffer, c.uart_input(), 2).set([0x35, 0x61]);
assert.equal(c.uart_send(2), 2);
assert.equal(c.uart_receive(), 0);
assert.equal(c.keyboard_matrix(3, 3, 0), 0);
assert.equal(c.run(1), 9);
assert(captured && captured.complete && captured.reason === 'core-stop');
assert.equal(captured.final_words[22], 2);
assert.deepEqual(captured.final_words.slice(28), [9, 16, 0xe7f000f0, 16, 0xe7f000f0]);
assert.deepEqual(captured.calls.filter(r => r.name === 'keyboard_matrix').map(r => [r.before, r.after, r.args]),
  [[0, 0, [3, 3, 1]], [1, 1, [3, 3, 0]]]);
const valid = artifact(captured);
const report = await replayBrowserTrace(valid);
assert.equal(report.run_calls, 2); assert(report.complete_checkpoint_equal);

let negativeChecks = 0;
function rejectEdit(edit, match) {
  const trace = structuredClone(valid.trace); edit(trace);
  assert.throws(() => validateBrowserTrace(trace), match); ++negativeChecks;
}
rejectEdit(t => t.calls.splice(2, 1), /Missing or duplicated/);
rejectEdit(t => t.calls.push(structuredClone(t.calls.at(-1))), /Missing or duplicated/);
rejectEdit(t => { [t.calls[1], t.calls[2]] = [t.calls[2], t.calls[1]]; }, /reordered/);
rejectEdit(t => { t.calls[1].generation++; }, /different Worker generation/);
rejectEdit(t => { t.calls[1].epoch++; }, /different checkpoint epoch/);
rejectEdit(t => { t.calls.find(r => r.name === 'uart_send').input = null; }, /Missing input payload/);
rejectEdit(t => { t.calls[0].name = 'unrepresented_mutation'; }, /Unrepresented API/);
rejectEdit(t => { t.calls.find(r => r.name === 'run').name = ['run']; }, /Invalid API operation name/);
rejectEdit(t => { t.performance_sample = true; }, /not performance samples/);
const wrongReturn = structuredClone(valid.trace);
wrongReturn.calls.find(r => r.name === 'run').result = 5;
await assert.rejects(replayBrowserTrace({...valid, trace: wrongReturn}), /API result\/state mismatch/); ++negativeChecks;
const wrongRelease = structuredClone(valid.trace);
wrongRelease.calls.find(r => r.name === 'keyboard_matrix' && r.args[2] === 0).args[2] = 1;
await assert.rejects(replayBrowserTrace({...valid, trace: wrongRelease}), /Complete replay checkpoint differs/); ++negativeChecks;
const corrupt = valid.initial.slice(); corrupt[100] ^= 1;
await assert.rejects(replayBrowserTrace({...valid, initial: corrupt}), /initial bytes differ/); ++negativeChecks;

// Later API calls cannot replace the frozen immediate stopped state.
const savedCapture = captured;
c.keyboard_matrix(1, 1, 1);
assert.equal(c.trace_capture('later-request'), savedCapture);
metadata.generation++;
assert.equal(c.create(1), 0);
new Uint8Array(c.memory.buffer, c.rom_buffer(), rom.length).set(rom);
assert.equal(c.load(rom.length), 0);
const fresh = c.trace_capture('new-epoch');
assert.equal(fresh.generation, metadata.generation);
assert.equal(fresh.calls.length, 0); assert(fresh.epoch > savedCapture.epoch);
await replayBrowserTrace(artifact(fresh));

const limited = await make({maxCalls: 1});
limited.keyboard_attach(1); limited.keyboard_matrix(0, 0, 1);
assert.throws(() => validateBrowserTrace(limited.trace_capture('bounded')), /Incomplete trace/); ++negativeChecks;
const unknown = await make(); unknown.unrepresented_mutation();
assert.throws(() => validateBrowserTrace(unknown.trace_capture('unknown-call')), /Incomplete trace/); ++negativeChecks;
const mixed = await make(); metadata.generation++; mixed.keyboard_attach(1);
assert.throws(() => validateBrowserTrace(mixed.trace_capture('mixed-generation')), /Incomplete trace/); ++negativeChecks;

// Stop while a key is held, then perform the release used by Worker Pause.
// Replay must reproduce the captured held state, not the later released state.
const held = await make();
assert.equal(held.keyboard_attach(1), 0);
assert.equal(held.keyboard_matrix(3, 3, 1), 0);
assert.equal(held.run(2), 9);
const heldCapture = captured, heldBytes = heldCapture.final.slice();
assert(heldCapture.complete && heldCapture.reason === 'core-stop');
assert.equal(heldCapture.final_words[22], 2);
assert.deepEqual(heldCapture.calls.map(row => row.name), ['keyboard_attach', 'keyboard_matrix', 'run']);
const heldArtifact = artifact(heldCapture);
assert.equal(held.keyboard_matrix(3, 3, 0), 0);
assert.equal(held.trace_capture('after-release'), heldCapture);
assert.deepEqual(heldCapture.final, heldBytes, 'Release must not change the immediate stopped checkpoint');
assert.equal(held.checkpoint_save(), 0);
const releasedBytes = new Uint8Array(held.memory.buffer, held.checkpoint_buffer(), held.checkpoint_size()).slice();
assert(!releasedBytes.every((byte, index) => byte === heldBytes[index]),
  'Releasing the held key must actually change the complete checkpoint');
const heldReport = await replayBrowserTrace(heldArtifact);
assert.equal(heldReport.run_calls, 1); assert.equal(heldReport.key_transition_calls, 1);
assert(heldReport.every_call_result_equal && heldReport.complete_checkpoint_equal);

console.log(JSON.stringify({passed: true, generated_guest: true, original_rom_reproduced: false,
  call_results_equal: true, complete_checkpoint_equal: true, exact_key_ticks: true,
  immutable_stop_capture: true, held_key_stop_preserved: true, release_changes_checkpoint: true,
  held_key_calls: heldReport.calls, held_key_run_calls: heldReport.run_calls,
  isolated_epochs: true, negative_checks: negativeChecks,
  wasm_sha256: hash(wasm), calls: report.calls, run_calls: report.run_calls, stop: report.stop}));
