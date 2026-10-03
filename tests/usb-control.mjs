// SPDX-License-Identifier: MIT
// Retain the original 80a1466 control-endpoint guest while extending the host API.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createUSBSession } from '../tools/usb-host.mjs';
export async function checkUSBControl(root, build) {
  const dir = await mkdtemp(resolve(tmpdir(), 'orchard-control-'));
  try {
    const binary = resolve(dir, 'guest.bin');
    const cc = spawnSync(process.env.CLANG || 'clang', ['--target=armv4t-none-eabi', '-nostdlib', '-fuse-ld=lld',
      '-Wl,-Ttext=0,-e,_start,--oformat=binary', resolve(root, 'tests/usb-guest.S'), '-o', binary], { encoding: 'utf8', timeout: 30000 });
    assert.ifError(cc.error); assert.equal(cc.status, 0, cc.stderr);
    const payload = await readFile(binary), image = Buffer.alloc(0x200000, 255);
    assert(payload.length < 0x10000); payload.copy(image);
    const s = await createUSBSession(root, build, 6, image);
    for (const c of ['run 5000','connect 1','reset 1','run 1000','reset 0','run 5000']) assert.equal(s.command(c).result, 0);
    const first = s.control([128,6,0,1,0,0,8,0]);
    assert.equal(first.length, 8);
    assert.equal(s.control([0,5,7,0,0,0,0,0]).length, 0);
    assert.equal(s.command('in 0 0 1').result, 3);
    const device=s.control([128,6,0,1,0,0,18,0],7);
    assert.equal(device.toString('hex'),'12011001ff00000834127856000100000001');
    assert.deepEqual(device.subarray(0,8), first);
    const cfg=s.control([128,6,0,2,0,0,32,0],7);
    assert.equal(cfg.toString('hex'),'0902200001010080190904000002ff0000000705810240000007050302400000');
    assert.equal(s.control([0,9,1,0,0,0,0,0],7).length,0);
    assert.deepEqual(s.control([128,8,0,0,0,0,1,0],7),Buffer.from([1]));
    const result=await s.verify();
    assert(result);
    console.log(`Retained control guest: ${s.commands.length} native/WASM steps, descriptors/address/configuration and GET_CONFIGURATION pass; cold replay agrees`);
  } finally { await rm(dir, {recursive:true,force:true}); }
}
