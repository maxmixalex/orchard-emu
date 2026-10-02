// SPDX-License-Identifier: MIT
const $ = id => document.getElementById(id);
const hex = n => n.toString(16).padStart(8, '0');
const integer64 = (low, high) => (BigInt(high) << 32n) | BigInt(low);
const worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
let generation = 0, loaded = false, running = false, stopped = false, ready = false, machineReady = false;
let current = null, fingerprint = '', uartText = '', expectedSize = 0;
const canvas = $('lcd'), context = canvas.getContext('2d', { alpha: false });
const regs = Array.from({ length: 16 }, (_, i) => {
  const item = document.createElement('div'), name = document.createElement('dt'), value = document.createElement('dd');
  name.textContent = i === 13 ? 'SP · r13' : i === 14 ? 'LR · r14' : i === 15 ? 'PC · r15' : `r${i}`;
  value.textContent = '00000000'; item.append(name, value); $('registers').append(item); return value;
});
function message(type, extra = {}) { worker.postMessage({ type, generation, ...extra }); }
function error(text) { $('error').textContent = text; $('error').hidden = !text; }
function controls() {
  $('model').disabled = !ready;
  $('rom').disabled = !ready || !machineReady;
  $('run').disabled = !loaded || stopped;
  $('step').disabled = !loaded || stopped || running;
  $('reset').disabled = !loaded;
  $('export').disabled = !loaded || !current;
  $('uart-input').disabled = $('uart-send').disabled = !loaded;
  $('run').textContent = running ? 'Pause' : 'Run';
}
function create() {
  ++generation; machineReady = false; loaded = false; running = false; stopped = false; current = null;
  fingerprint = ''; uartText = ''; $('uart-log').textContent = 'No guest output.';
  $('digest').textContent = 'No ROM loaded'; $('filename').textContent = 'No file selected';
  $('status').textContent = 'Initializing…'; error(''); controls();
  message('create', { model: Number($('model').value) });
}
function draw(pixels, width, height) {
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const image = context.createImageData(width, height);
  for (let i = 0; i < width * height; ++i) {
    const ink = pixels ? pixels[i] / 255 : 0;
    image.data[i * 4] = 227 - 190 * ink;
    image.data[i * 4 + 1] = 232 - 188 * ink;
    image.data[i * 4 + 2] = 222 - 189 * ink;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}
function stateView(data) {
  current = data; const s = data.state;
  running = data.running; stopped = s[28] !== 0;
  regs.forEach((node, i) => { node.textContent = hex(s[i]); });
  $('instructions').textContent = integer64(s[20], s[21]).toLocaleString();
  $('ticks').textContent = integer64(s[22], s[23]).toLocaleString();
  $('exceptions').textContent = integer64(s[24], s[25]).toLocaleString();
  $('cpsr').textContent = hex(s[16]); $('control').textContent = hex(s[17]);
  const modes = { 16: 'user', 17: 'FIQ', 18: 'IRQ', 19: 'supervisor', 23: 'abort', 27: 'undefined', 31: 'system' };
  $('isa').textContent = `${s[16] & 32 ? 'Thumb' : 'ARM'} · ${modes[s[16] & 31] || 'invalid mode'}`;
  $('status').textContent = stopped ? 'Stopped' : !loaded ? 'No ROM loaded' : running ? (s[26] ? 'Waiting for interrupt' : 'Running') : 'Paused';
  $('stop').textContent = stopped
    ? `${data.reason}\nPC ${hex(s[29])}   instruction ${hex(s[30])}\nAddress ${hex(s[31])}   detail ${hex(s[32])}`
    : `No stop recorded.\nData fault status ${hex(s[18])} · address ${hex(s[19])}`;
  $('frame-status').textContent = data.frameStatus ? `LCD preview unavailable · code ${data.frameStatus}` : `Raw ${data.width} × ${data.height} · panel mapping unverified`;
  draw(data.pixels, data.width, data.height);
  appendUart(data.uart);
  controls();
}
function appendUart(bytes) {
  if (!bytes.length) return;
  uartText += `${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(' ')}\n`;
  if (uartText.length > 16384) uartText = `[Earlier log truncated]\n${uartText.slice(-15000)}`;
  $('uart-log').textContent = uartText;
}
worker.onmessage = ({ data }) => {
  if (data.type === 'ready') { ready = true; create(); return; }
  if (data.type === 'fatal') { ready = false; loaded = false; running = false; controls(); error(data.message); $('status').textContent = 'Core failed'; return; }
  if (data.generation !== generation) return;
  if (data.type === 'created') {
    expectedSize = data.flash; machineReady = true; controls();
    $('memory').textContent = `${data.flash / 1024} KiB NOR · ${data.ram / 1024} KiB RAM`;
  } else if (data.type === 'loaded') { loaded = true; error(''); controls(); }
  else if (data.type === 'snapshot') stateView(data);
  else if (data.type === 'uart-output') appendUart(data.bytes);
  else if (data.type === 'error') { running = false; error(data.message); controls(); }
};
worker.onerror = event => { ready = false; loaded = false; running = false; controls(); error(event.message || 'Emulator Worker failed'); };
$('model').addEventListener('change', () => { $('rom').value = ''; create(); });
$('rom').addEventListener('change', async () => {
  const file = $('rom').files[0]; if (!file) return;
  const size = expectedSize;
  create(); const token = generation;
  try {
    if (file.size !== size) throw new Error(`Expected exactly ${size.toLocaleString()} bytes of full physical NOR. Update packages and Saturn images are not accepted.`);
    const rom = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', rom);
    if (token !== generation) return;
    fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    $('digest').textContent = fingerprint; $('filename').textContent = file.name;
    worker.postMessage({ type: 'load', generation, rom }, [rom]);
  } catch (exception) {
    if (token === generation) error(exception instanceof Error ? exception.message : String(exception));
  }
});
$('run').addEventListener('click', () => message(running ? 'pause' : 'run'));
$('step').addEventListener('click', () => message('step'));
$('reset').addEventListener('click', () => { error(''); message('reset'); });
$('uart-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('uart-input').value.trim();
  if (!/^(?:[0-9a-f]{2})(?:\s+[0-9a-f]{2})*$/i.test(text)) { error('Use space-separated hexadecimal bytes, for example: 48 65 6c 6c 6f'); return; }
  const parts = text.split(/\s+/);
  if (parts.length > 1024) { error('At most 1024 bytes can be submitted at once.'); return; }
  error(''); message('uart', { bytes: Uint8Array.from(parts, part => parseInt(part, 16)) });
});
$('uart-clear').addEventListener('click', () => { uartText = ''; $('uart-log').textContent = 'No guest output.'; });
$('export').addEventListener('click', () => {
  if (!current) return;
  const payload = { schema: 'orchard-debug-v1', version: '0.1.0', model: Number($('model').value),
    rom_sha256: fingerprint, boot_verified: false, state_words: Array.from(current.state),
    state_layout: 'r0..r15,cpsr,control,dfsr,far,instructions_lo,hi,ticks_lo,hi,exceptions_lo,hi,sleeping,loaded,stop_status,stop_pc,stop_instruction,stop_address,stop_detail',
    stop_reason: current.reason, uart_log_hex: uartText };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'orchard-debug.json';
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('pagehide', () => worker.terminate());
controls(); draw(null, 131, 80);
