// SPDX-License-Identifier: MIT
// Bounded control-pipe replay. No sockets, physical USB or descriptor fabrication.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const queries = [
  [128,6,0,1,0,0,8,0], [128,6,0,1,0,0,18,0], [0,5,7,0,0,0,0,0],
  [128,6,0,2,0,0,9,0], [128,6,0,2,0,0,32,0], [0,9,1,0,0,0,0,0], [128,8,0,0,0,0,1,0],
];
export const controlQueries = queries.map(q => Buffer.from(q).toString('hex'));
export function nativeSession(executable, image, mode) {
  const result = spawnSync(executable, [image, mode], { encoding: 'utf8', timeout: 120_000 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}
export function wasmSession(c, image, mode) {
  assert(['recovery', 'synthetic'].includes(mode)); assert.equal(image.length, 0x200000);
  assert.equal(c.create(6), 0);
  new Uint8Array(c.memory.buffer, c.rom_buffer(), image.length).set(image);
  assert.equal(c.load(image.length), 0);
  assert.equal(c.usb_attach(1), 0); assert.equal(c.keyboard_attach(1), 0);
  assert.equal(c.gpio_inputs(3, 0xcc7f, 0), 0); assert.equal(c.gpio_inputs(6, 1, 0), 0);
  assert.equal(c.gpio_bias(6, 0xf800, 0xf800), 0);
  const run = count => { while (count) { const n = Math.min(count, 256); assert.equal(c.run(n), 0, 'Guest diagnostic stop'); count -= n; } };
  run(2000000); assert.equal(c.keyboard_matrix(3,5,1), 0); run(400000);
  assert.equal(c.keyboard_matrix(3,5,0), 0); run(600000);
  assert.equal(c.usb_bus_reset(1), 0); run(500); assert.equal(c.usb_bus_reset(0), 0); run(20000);
  function request(address, setup) {
    new Uint8Array(c.memory.buffer, c.usb_packet(), 8).set(setup);
    assert.equal(c.usb_setup(address, 8), 0);
    const expected = setup[6] | setup[7] << 8, read = Boolean(setup[0] & 128), parts = [];
    let total = 0, dataDone = !expected;
    for (let attempt = 0; !dataDone && attempt < 100; ++attempt) {
      run(1000); const r = c.usb_in(address, 16);
      if (r === 1) continue;
      assert.equal(r, 0); const n = c.usb_length(); assert(total + n <= expected);
      parts.push(Buffer.from(new Uint8Array(c.memory.buffer, c.usb_packet(), n)));
      total += n; dataDone = total === expected || n < 8;
    }
    assert(dataDone, 'Control data stage timed out');
    for (let attempt = 0; attempt < 100; ++attempt) {
      run(1000); const r = read && expected ? c.usb_out(address, 0) : c.usb_in(address, 0);
      if (r === 1) continue;
      assert.equal(r, 0, 'Control status failed');
      if (!(read && expected)) assert.equal(c.usb_length(), 0);
      run(1000); return Buffer.concat(parts).toString('hex');
    }
    throw new Error('Control status stage timed out');
  }
  const count = mode === 'synthetic' ? 7 : 6, replies = [];
  for (let i = 0; i < count; ++i) {
    replies.push(request(i < 3 ? 0 : 7, queries[i]));
    if (i === 0) assert.equal(Buffer.from(replies[0], 'hex')[7], 8, 'Replay requires discovered EP0 MPS=8');
  }
  const s = [...new Uint32Array(c.memory.buffer, c.snapshot(), 33)];
  const u64 = i => ((BigInt(s[i+1]) << 32n) | BigInt(s[i])).toString();
  return { replies, registers: s.slice(0,16), cpsr: s[16], cp15_control: s[17], fault_status: s[18], fault_address: s[19],
    ticks: u64(22), instructions: u64(20), exceptions: u64(24), sleeping: Boolean(s[26]), stop_code: s[28],
    usb: [...new Uint32Array(c.memory.buffer, c.usb_snapshot(), 48)] };
}
