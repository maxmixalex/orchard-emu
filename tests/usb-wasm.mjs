// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeSession, wasmSession } from '../tools/usb-session.mjs';
export async function checkUSB(root, build) {
  const dir = await mkdtemp(resolve(tmpdir(), 'orchard-usb-'));
  try {
    const binary = resolve(dir, 'guest.bin'), input = resolve(dir, 'image.bin');
    const compiled = spawnSync(process.env.CLANG || 'clang', ['--target=armv4t-none-eabi', '-nostdlib', '-fuse-ld=lld',
      '-Wl,-Ttext=0,-e,_start,--oformat=binary', resolve(root, 'tests/usb-guest.S'), '-o', binary], { encoding: 'utf8', timeout: 30000 });
    assert.ifError(compiled.error); assert.equal(compiled.status, 0, compiled.stderr);
    const payload = await readFile(binary), image = Buffer.alloc(0x200000, 0xff);
    assert(payload.length < 0x10000); payload.copy(image); await writeFile(input, image, { flag: 'wx' });
    const executable = resolve(build, process.platform === 'win32' ? 'orchard-usb-session.exe' : 'orchard-usb-session');
    const native = nativeSession(executable, input, 'synthetic');
    const { instance: { exports: c } } = await WebAssembly.instantiate(await readFile(resolve(root, 'dist/orchard.wasm')), {});
    const wasm = wasmSession(c, image, 'synthetic');
    assert.deepEqual(wasm, native); assert.deepEqual(nativeSession(executable,input,'synthetic'), native);
    assert.deepEqual(wasmSession(c,image,'synthetic'), wasm);
    assert.equal(wasm.replies[1], '12011001ff00000834127856000100000001');
    assert.equal(wasm.replies[4], '0902200001010080190904000002ff0000000705810240000007050302400000');
    assert.equal(wasm.replies[6], '01'); assert.equal(wasm.usb[8], 7); assert.equal(wasm.usb[9], 0);
    assert.equal(wasm.exceptions, '26'); assert.equal(wasm.sleeping, true); assert.equal(wasm.stop_code, 0);
    assert.equal(c.usb_attach(2), 1); assert.equal(c.usb_bus_reset(2), 4);
    assert.equal(c.usb_setup(7, 7), 4); assert.equal(c.usb_out(7, 17), 4); assert.equal(c.usb_in(7, 17), 4);
    c.reset(); assert.equal(c.usb_setup(0,8),3);
    console.log('USB guest: native/WASM descriptor/address/configuration control transfers, 26 guest IRQs and WFI; two cold replays agree');
  } finally { await rm(dir, { recursive: true, force: true }); }
}
