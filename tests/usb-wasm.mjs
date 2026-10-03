// SPDX-License-Identifier: MIT
// Original ROM-free ARM guest: USB reset/setup/IN/OUT through the real IRQ
// vector. Replies with a synthetic three-byte pattern and echoes bulk packets.
import assert from 'node:assert/strict';
import { createUSBSession } from '../tools/usb-host.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function guest() {
  const image = Buffer.alloc(0x200000, 255), base = 0x100;
  const words = [], literals = [], branches = [], labels = new Map();
  const word = n => words.push(n >>> 0);
  function load(rd, value) { literals.push({ at: words.length, rd, value }); word(0); }
  function write(address, value) { load(0, address); load(1, value); word(0xe5801000); }
  function read(address, rd) { load(0, address); word(0xe5900000 | (rd << 12)); }
  function label(name) { labels.set(name, base + words.length * 4); }
  function branch(name, condition = 14) { branches.push({ at: words.length, name, condition }); word(0); }
  function configure() {
    write(0x52000178, 0); write(0x52000180, 1);
    write(0x52000178, 1); write(0x52000180, 8); write(0x52000188, 32);
    write(0x52000178, 3); write(0x52000180, 8); write(0x52000188, 0);
    write(0x5200015c, 11); write(0x5200016c, 4);
  }
  write(0x53000000, 0); configure(); write(0x4a000008, 0xfdffffff);
  word(0xe10f0000); word(0xe3c00080); word(0xe121f000);
  label('wait'); word(0xee070f90); branch('wait');
  label('irq'); word(0xe2888001); // count all guest USB IRQ entries
  read(0x52000158, 2); word(0xe3120004); branch('ep0', 0);
  configure(); write(0x52000158, 4); word(0xe2899001); // reset count
  label('ep0'); write(0x52000178, 0); read(0x52000184, 2);
  word(0xe3120001); branch('bulk', 0);
  for (let i = 0; i < 8; ++i) read(0x520001c0, 2); // consume the synthetic SETUP
  for (const byte of [0x91, 0x23, 0xab]) write(0x520001c0, byte);
  write(0x52000184, 74); // service SETUP + arm IN + DATA_END
  label('bulk'); write(0x52000178, 3); read(0x52000190, 2);
  word(0xe3120001); branch('ack', 0);
  read(0x52000198, 3); word(0xe08aa003); // total bulk bytes
  label('copy'); word(0xe3530000); branch('sent', 0);
  read(0x520001cc, 2); load(0, 0x520001c4); word(0xe5802000);
  word(0xe2533001); branch('copy', 1);
  label('sent'); write(0x52000190, 0);write(0x52000178, 1);write(0x52000184, 1);
  label('ack'); write(0x52000148, 31);write(0x4a000000, 1 << 25);write(0x4a000010, 1 << 25);
  word(0xe25ef004);
  for (const { at, rd, value } of literals) {
    const off = words.length * 4 - at * 4 - 8;assert(off >= 0 && off < 4096);
    words[at] = (0xe59f0000 | rd << 12 | off) >>> 0;word(value);
  }
  for (const { at, name, condition } of branches) words[at] = ((condition << 28) | 0x0a000000 | (((labels.get(name) - (base + at * 4) - 8) >> 2) & 0xffffff)) >>> 0;
  image.writeUInt32LE(0xea00003e, 0);image.writeUInt32LE(0xe59ff000, 0x18);image.writeUInt32LE(labels.get('irq'), 0x20);
  words.forEach((w, i) => image.writeUInt32LE(w, base + 4 * i));
  return image;
}
export async function checkUSB(root, build) {
  const s = await createUSBSession(root, build, 6, guest());
  assert.equal(s.command('run 1000').cpu[26], 1);
  assert.equal(s.out(0, 0, true, 0, [128, 6, 0, 1, 0, 0, 3, 0]).result, 3, 'Detached host');
  s.command('connect 1');s.command('reset 1');s.command('run 1000');s.command('reset 0');s.command('run 1000');
  assert.equal(s.command('sof 2047').usb[8], 2047);
  const reply = s.control([128, 6, 0, 1, 0, 0, 3, 0]);assert.equal(reply.toString('hex'), '9123ab');
  let toggle = 0, total = 0;
  for (const size of [1, 7, 63, 64, 0]) {
    const p = Uint8Array.from({ length: size }, (_, i) => (i * 13 + size) & 255);
    assert.equal(s.out(0, 3, false, toggle, p).result, 0);
    assert.equal(s.out(0, 3, false, toggle, p).result, 0, 'Duplicate acknowledged without delivery');
    const echo = s.receive(0, 1);assert.equal(echo.data, Buffer.from(p).toString('hex'));assert.equal(echo.pid, toggle);
    toggle ^= 1;total += size;
    const snap = s.command('run 2000');assert.equal(snap.cpu[10], total);assert.equal(snap.cpu[26], 1);
  }
  assert.equal(s.results.at(-1).cpu[9], 1);
  s.command('connect 0');assert.equal(s.command('in 0 1 1').result, 3);
  // Cold reset releases the bus, pending transfers and component state.
  s.command('cold');assert.equal(s.command('in 0 1 1').result, 3);s.command('run 1000');
  await s.verify();
  await rejectedCommands(build);
  console.log(`USB guest: ${s.commands.length} exact native/WASM steps, reset/setup IRQ, control response, 5 bulk echoes incl ZLP, retry/disconnect/cold replay`);
}

async function rejectedCommands(build) {
  const invalid = ['run -1', 'run +1', 'run 0x10', 'run 10000001', 'run 4294967296',
    'run 1 2', 'run', 'connect 2', 'reset 2', 'keyboard 2', 'key 1 2 3',
    'pad A 1 0', 'bias 6 gg 1', 'in 0 0 2', 'out 0 0 2 0 1234',
    'out 0 0 1 0 0', 'out 0 0 1 0 zz', `out 0 0 1 0 ${'00'.repeat(65)}`,
    'cold 0', 'unknown', 'run 1 2 3 4 5 6 7 8', 'a'.repeat(512)];
  const dir = await mkdtemp(resolve(tmpdir(), 'orchard-usb-cli-'));
  try {
    const image = resolve(dir, 'synthetic.bin'); await writeFile(image, guest(), { flag: 'wx' });
    const exe = resolve(build, process.platform === 'win32' ? 'orchard-usb-session.exe' : 'orchard-usb-session');
    function invoke(text) {
      const p = spawnSync(exe, ['6', image], { input: text, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
      assert.ifError(p.error); return p;
    }
    for (const command of invalid) {
      const p = invoke(command + '\n');
      assert.equal(p.status, 64, command); assert.equal(p.stdout, '', 'Malformed first command must not produce a state record');
    }
    const exhausted = invoke('sof 0\n'.repeat(4097));
    assert.equal(exhausted.status, 64); assert.equal(exhausted.stdout.trim().split('\n').length, 4096);
    console.log(`USB session CLI: ${invalid.length} malformed commands and the 4096-command limit rejected`);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
