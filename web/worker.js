// SPDX-License-Identifier: MIT
// One owner of CPU/peripheral state. No pthreads, SharedArrayBuffer, or wall-clock RTC.
let core;
let model = 6;
let generation = 0;
let running = false;
let timer;
let lastFrame = 0;
let loaded = false;
const errors = ['ready', 'bad argument', 'full-NOR size mismatch', 'not a full ARM NOR image',
  'no ROM loaded', 'unsupported instruction', 'unsupported CP15 operation', 'unimplemented MMIO',
  'unimplemented NOR command', 'unpredictable ARM operation', 'UART host queue full',
  'big-endian mode not implemented', 'unsupported LCD mode', 'physical bus error'];
function pause() { running = false; clearTimeout(timer); timer = undefined; }
function snapshot() {
  const state = new Uint32Array(core.memory.buffer, core.snapshot(), 33).slice();
  const frameStatus = core.frame();
  const width = core.profile(model, 2), height = core.profile(model, 3);
  const pixels = frameStatus ? null : new Uint8Array(core.memory.buffer, core.frame_buffer(), width * height).slice();
  const n = core.uart_receive();
  const uart = new Uint8Array(core.memory.buffer, core.uart_output(), n).slice();
  postMessage({ type: 'snapshot', generation, state, width, height, pixels, uart, running,
    frameStatus, reason: errors[state[28]] || 'unknown stop' });
  lastFrame = performance.now();
}
function pump() {
  if (!running) return;
  const status = core.run(256);
  // Drain host I/O every bounded slice, independently of the display cadence.
  const count = core.uart_receive();
  if (count) postMessage({ type: 'uart-output', generation,
    bytes: new Uint8Array(core.memory.buffer, core.uart_output(), count).slice() });
  if (status) pause();
  if (!running || performance.now() - lastFrame >= 40) snapshot();
  if (running) timer = setTimeout(pump, 0);
}
self.onmessage = ({ data }) => {
  if (!core || !data || typeof data.type !== 'string') return;
  try {
    if (data.type === 'create') {
      pause();
      if (!Number.isInteger(data.model) || !core.profile(data.model, 0)) throw new Error('Unknown model');
      generation = data.generation;
      model = data.model;
      loaded = false;
      core.create(model);
      postMessage({ type: 'created', generation, flash: core.profile(model, 0), ram: core.profile(model, 1) });
      snapshot();
      return;
    }
    if (data.generation !== generation) return;
    if (data.type === 'load') {
      pause();
      if (!(data.rom instanceof ArrayBuffer) || data.rom.byteLength !== core.profile(model, 0))
        throw new Error('Select a complete physical NOR of the expected size, not an update file');
      new Uint8Array(core.memory.buffer, core.rom_buffer(), data.rom.byteLength).set(new Uint8Array(data.rom));
      const status = core.load(data.rom.byteLength);
      if (status) throw new Error(errors[status]);
      loaded = true;
      postMessage({ type: 'loaded', generation });
      snapshot();
    } else if (data.type === 'pause') { pause(); snapshot(); }
    else if (data.type === 'run' && loaded && !running) { running = true; pump(); snapshot(); }
    else if (data.type === 'step' && loaded) { pause(); core.run(1); snapshot(); }
    else if (data.type === 'reset' && loaded) { pause(); core.reset(); snapshot(); }
    else if (data.type === 'uart' && loaded) {
      if (!(data.bytes instanceof Uint8Array) || data.bytes.length > 1024) throw new Error('UART input limit is 1024 bytes');
      new Uint8Array(core.memory.buffer, core.uart_input(), data.bytes.length).set(data.bytes);
      const accepted = core.uart_send(data.bytes.length);
      if (accepted !== data.bytes.length) throw new Error(`UART queue full: accepted ${accepted} of ${data.bytes.length} bytes`);
      snapshot();
    }
  } catch (error) {
    pause();
    postMessage({ type: 'error', generation, message: error instanceof Error ? error.message : String(error) });
  }
};
try {
  const response = await fetch(new URL('orchard.wasm', import.meta.url));
  if (!response.ok) throw new Error(`WASM download failed: HTTP ${response.status}`);
  ({ instance: { exports: core } } = await WebAssembly.instantiate(await response.arrayBuffer(), {}));
  postMessage({ type: 'ready' });
} catch (error) {
  postMessage({ type: 'fatal', message: error instanceof Error ? error.message : String(error) });
}
