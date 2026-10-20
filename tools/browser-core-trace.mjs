// SPDX-License-Identifier: MIT
// Opt-in diagnostic instrumentation. This module is never shipped in dist.
// It records guest-affecting API calls, not wall-time performance samples.
const operations = new Map([
  ['run', 1], ['run_divided', 1], ['frame', 0], ['frame_view', 1],
  ['annunciators', 0], ['uart_receive', 0], ['uart_send', 1],
  ['gpio_inputs', 3], ['gpio_bias', 3], ['adc_input', 3],
  ['keyboard_attach', 1], ['keyboard_matrix', 3], ['keyboard_dedicated', 2],
  ['sram_select', 1], ['nor_select', 1], ['lcd_probe68', 1],
  ['usb_connect', 1], ['usb_reset_signal', 1], ['usb_sof', 1],
  ['usb_out', 5], ['usb_in', 3], ['checkpoint_save', 0],
]);
const observers = new Set([
  'profile', 'rom_buffer', 'snapshot', 'clock_snapshot', 'clock_divisor',
  'frame_buffer', 'annunciator_buffer', 'uart_input', 'uart_output',
  'usb_buffer', 'usb_length', 'usb_data1', 'usb_snapshot', 'peripheral_snapshot',
  'checkpoint_buffer', 'checkpoint_size', 'timebase_hz',
  'sram_alias_reads', 'sram_alias_writes', 'lcd_probe68_reads',
]);
export const traceOperationArguments = Object.freeze(Object.fromEntries(operations));

export function attachCoreTrace(raw, {
  context = () => ({}), onEpoch = () => {}, onCapture = () => {}, maxCalls = 500000,
} = {}) {
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 1000000)
    throw Error('Diagnostic trace maxCalls must be between 1 and 1000000');
  const out = {...raw};
  let epoch = 0, initial = null, initialWords = null, started = null;
  let rows = [], calls = 0, problems = [], frozen = null, nowTick = 0, stop = 0;
  const words = () => {
    const pointer = raw.snapshot();
    return pointer ? Array.from(new Uint32Array(raw.memory.buffer, pointer, 33)) : null;
  };
  const tick = state => state ? state[22] + state[23] * 4294967296 : 0;
  const problem = text => { if (!problems.includes(text)) problems.push(text); };
  const checkpoint = () => {
    const length = raw.checkpoint_size();
    if (!length || length > 600000 || raw.checkpoint_save()) return null;
    return new Uint8Array(raw.memory.buffer, raw.checkpoint_buffer(), length).slice();
  };
  function begin(bytes, source) {
    ++epoch; initial = bytes; initialWords = words(); started = {...context()};
    rows = []; calls = 0; problems = []; frozen = null;
    nowTick = tick(initialWords); stop = initialWords?.[28] || 0;
    if (!initial) problem('Initial checkpoint is unavailable');
    if (!Number.isSafeInteger(nowTick)) problem('Guest tick exceeds the exact integer range');
    onEpoch({epoch, generation: started.generation, model: started.model, source, tick: nowTick});
  }
  function capture(reason) {
    if (frozen) return frozen;
    const state = words(), final = checkpoint(), current = {...context()};
    if (!final) problem('Final checkpoint is unavailable');
    if (!initial || !initialWords) problem('Trace has no loaded starting epoch');
    if (started?.generation !== current.generation || started?.model !== current.model)
      problem('Machine identity changed inside a trace epoch');
    frozen = {schema: 'orchard-browser-core-trace-v1', instrumented: true,
      performance_sample: false, epoch, generation: started?.generation, model: started?.model,
      reason, context: current, complete: problems.length === 0 && calls === rows.length,
      problems: problems.slice(), call_count: calls, calls: rows.slice(),
      initial_words: initialWords, final_words: state, initial, final};
    onCapture(frozen);
    return frozen;
  }
  out.trace_capture = capture;
  for (const name of ['create', 'load', 'reset']) out[name] = (...args) => {
    // Creating/loading/resetting replaces the old epoch. Never reuse its calls.
    initial = null; initialWords = null; started = null; frozen = null; rows = []; calls = 0;
    const result = raw[name](...args);
    if (name !== 'create' && !result && words()?.[27]) begin(checkpoint(), name);
    return result;
  };
  out.checkpoint_load = length => {
    const validLength = Number.isInteger(length) && length > 0 && length <= 600000;
    const bytes = validLength ? new Uint8Array(raw.memory.buffer, raw.checkpoint_buffer(), length).slice() : null;
    const result = raw.checkpoint_load(length);
    if (!result) begin(bytes, 'checkpoint-load');
    else if (initial && !frozen) problem('A failed checkpoint load occurred inside the epoch');
    return result;
  };
  for (const [name, argumentCount] of operations) {
    if (typeof raw[name] !== 'function') continue;
    out[name] = (...args) => {
      if (!initial || frozen) return raw[name](...args);
      const identity = context();
      if (identity.generation !== started.generation || identity.model !== started.model)
        problem('Machine identity changed inside a trace epoch');
      if (args.length !== argumentCount || args.some(n => !Number.isInteger(n) || n < -2147483648 || n > 0xffffffff))
        problem('Unsupported API arguments for ' + name);
      const canonical = args.map(n => n >>> 0), before = nowTick, prior = stop;
      let input = null;
      if (name === 'uart_send' || name === 'usb_out') {
        const length = canonical[name === 'uart_send' ? 0 : 4], maximum = name === 'uart_send' ? 1024 : 64;
        if (length <= maximum) input = Array.from(new Uint8Array(raw.memory.buffer,
          name === 'uart_send' ? raw.uart_input() : raw.usb_buffer(), length));
        else problem('Unsupported input payload length for ' + name);
      }
      let result;
      try { result = raw[name](...args); }
      catch (error) {
        problem('API trapped: ' + name + ': ' + String(error));
        capture('api-trap'); throw error;
      }
      if (name === 'run' && !result) nowTick += canonical[0];
      else { const state = words(); nowTick = tick(state); stop = state?.[28] || 0; }
      if (!Number.isSafeInteger(nowTick)) problem('Guest tick exceeds the exact integer range');
      if (!Number.isInteger(result)) problem('Unsupported API result for ' + name);
      const row = {seq: ++calls, epoch, generation: identity.generation, name, args: canonical,
        before, after: nowTick, result: result >>> 0, prior, status: stop};
      if (input !== null) row.input = input;
      if (name === 'uart_receive') row.output = Array.from(new Uint8Array(raw.memory.buffer, raw.uart_output(), result));
      if (name === 'usb_in') {
        row.output = Array.from(new Uint8Array(raw.memory.buffer, raw.usb_buffer(), raw.usb_length()));
        row.data1 = raw.usb_data1();
      }
      if (rows.length < maxCalls) rows.push(row);
      else problem('Trace call limit exceeded; recording is incomplete');
      if (stop) capture('core-stop');
      return result;
    };
  }
  for (const [name, fn] of Object.entries(raw)) {
    if (typeof fn !== 'function' || operations.has(name) || observers.has(name) ||
        ['create', 'load', 'reset', 'checkpoint_load'].includes(name)) continue;
    out[name] = (...args) => {
      if (initial && !frozen) problem('Unrepresented API call: ' + name);
      return fn(...args);
    };
  }
  return out;
}
