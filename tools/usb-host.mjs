// SPDX-License-Identifier: MIT
// Deterministic local packet host. The native side replays the same bounded
// command sequence through public APIs; neither side decodes firmware code.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

export async function createUSBSession(root, build, model, image) {
  const wasm = await readFile(resolve(root, 'dist/orchard.wasm'));
  const { instance: { exports: c } } = await WebAssembly.instantiate(wasm, {});
  function initialize() {
    assert.equal(c.create(model), 0);
    assert.equal(image.length, c.profile(model, 0));
    new Uint8Array(c.memory.buffer, c.rom_buffer(), image.length).set(image);
    assert.equal(c.load(image.length), 0);
  }
  initialize();
  const commands = [], results = [];
  function execute(text) {
    const [op, ...args] = text.split(' '), v = args.map(Number);
    let result, length = 0, pid = 0, data = '';
    switch (op) {
      case 'run': result = c.run(v[0]); break;
      case 'connect': result = c.usb_connect(v[0]); break;
      case 'reset': result = c.usb_reset_signal(v[0]); break;
      case 'sof': result = c.usb_sof(v[0]); break;
      case 'keyboard': result = c.keyboard_attach(v[0]); break;
      case 'key': result = c.keyboard_matrix(...v); break;
      case 'pad': result = c.gpio_inputs(v[0], parseInt(args[1], 16), parseInt(args[2], 16)); break;
      case 'bias': result = c.gpio_bias(v[0], parseInt(args[1], 16), parseInt(args[2], 16)); break;
      case 'cold': c.reset(); result = 0; break;
      case 'out': {
        const payload = Buffer.from(args[4] === '-' ? '' : args[4], 'hex');
        assert(payload.length <= 64);
        new Uint8Array(c.memory.buffer, c.usb_buffer(), payload.length).set(payload);
        result = c.usb_out(v[0], v[1], v[2], v[3], payload.length); break;
      }
      case 'in':
        result = c.usb_in(...v); length = c.usb_length(); pid = c.usb_data1();
        data = Buffer.from(new Uint8Array(c.memory.buffer, c.usb_buffer(), length)).toString('hex'); break;
      default: throw new Error(`Unsupported session command: ${op}`);
    }
    const cpu = [...new Uint32Array(c.memory.buffer, c.snapshot(), 33)];
    const usb = [...new Uint32Array(c.memory.buffer, c.usb_snapshot(), 44)];
    return { result, length, pid, data, cpu, usb };
  }
  function command(text) {
    assert(commands.length < 4096, 'Session command budget');
    const result = execute(text); commands.push(text); results.push(result);
    assert.equal(result.cpu[28], 0, `Guest stopped on ${text}: ${JSON.stringify(result.cpu)}`);
    return result;
  }
  function out(address, ep, setup, pid, data) {
    return command(`out ${address} ${ep} ${setup ? 1 : 0} ${pid} ${Buffer.from(data).toString('hex') || '-'}`);
  }
  function receive(address, ep, retries = 200) {
    for (let i = 0; i < retries; ++i) {
      command('run 2000');
      const peek = command(`in ${address} ${ep} 0`);
      if (peek.result === 1) continue;
      assert.equal(peek.result, 0, `IN failed: ${JSON.stringify(peek)}`);
      const packet = command(`in ${address} ${ep} 1`);
      assert.equal(packet.result, 0); assert.equal(packet.data, peek.data); assert.equal(packet.pid, peek.pid);
      return packet;
    }
    throw new Error(`IN timeout after ${retries * 2000} quanta`);
  }
  function control(setup, address = 0, maxPacket = 8) {
    assert.equal(setup.length, 8);
    const requested = setup[6] + 256 * setup[7], input = (setup[0] & 128) !== 0;
    assert(input || requested === 0, 'This helper supports control reads and no-data writes');
    assert.equal(out(address, 0, true, 0, setup).result, 0);
    const chunks = [];
    let size = 0;
    for (let i = 0; i < 512; ++i) {
      const p = receive(address, 0);
      assert.equal(p.pid, 1 ^ (i & 1));
      const data = Buffer.from(p.data, 'hex');chunks.push(data);size += data.length;
      if (!requested || size >= requested || data.length < maxPacket) {
        assert(size <= requested, 'Guest returned more bytes than requested');
        if (input && requested) assert.equal(out(address, 0, false, 1, []).result, 0);
        command('run 2000'); return Buffer.concat(chunks);
      }
    }
    throw new Error('Control packet budget');
  }
  async function verify() {
    initialize();const second = commands.map(execute);
    assert.deepEqual(second, results, 'WASM cold replay differs');
    const dir = await mkdtemp(resolve(tmpdir(), 'orchard-usb-session-'));
    try {
      const path = resolve(dir, 'input.bin');await writeFile(path, image, { flag: 'wx' });
      const executable = resolve(build, process.platform === 'win32' ? 'orchard-usb-session.exe' : 'orchard-usb-session');
      const script = commands.join('\n') + '\n';
      function native() {
        const p = spawnSync(executable, [String(model), path], { input: script, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
        assert.ifError(p.error);assert.equal(p.status, 0, p.stderr + p.stdout.slice(-2048));
        return p.stdout.trim().split('\n').map(line => JSON.parse(line));
      }
      const first = native();assert.deepEqual(native(), first, 'Native cold replay differs');
      assert.deepEqual(first, results, 'Native/WASM packet or architectural state differs');
      return { commands: [...commands], results, native_replay_equal: true, wasm_replay_equal: true, native_wasm_equal: true };
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  return { command, out, receive, control, verify, commands, results, wasm };
}
