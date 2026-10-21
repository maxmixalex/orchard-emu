// SPDX-License-Identifier: MIT
// Independent literal envelopes and directories; no calculator ROM or programs.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { inspectHp39File, parseHp39Directory, createHp39Directory, inspectHp39Bundle,
  validateHp39Filename, MAX_HP39_FILE_BYTES } from '../web/hp39-files.js';
import { readHp39File, inspectHp39Paths } from '../tools/hp39-file-info.mjs';
let checks = 0;
function test(fn) { fn(); ++checks; }
const bytes = text => Uint8Array.from(text, char => char.charCodeAt(0));
const cur = bytes('HP39AscA A 11 HP39DIR.0004 Root\r\n');
const dir = bytes('HP39AscA C 9 NOTE0.00010 First noteD 10 PROBE0.0005 Probe');
const note = bytes('HP39AscC 10 First note\nOriginal test text.\n');
// This payload is deliberately not a valid RPL object. The envelope may pass,
// but it MUST remain payloadValidated:false and never enable an upload.
const binary = Uint8Array.from([...bytes('HP39BinD'), 5, ...bytes('Probe'), 255, 0, 1]);
const files = () => [
  { name: 'HP39DIR.CUR', bytes: cur }, { name: 'HP39DIR.000', bytes: dir },
  { name: 'NOTE0.000', bytes: note }, { name: 'PROBE0.000', bytes: binary }
];
test(() => assert.deepEqual(parseHp39Directory(cur), [{ kind: 'A', file: 'HP39DIR.000', title: 'Root' }]));
test(() => assert.deepEqual(parseHp39Directory(dir), [
  { kind: 'C', file: 'NOTE0.000', title: 'First note' }, { kind: 'D', file: 'PROBE0.000', title: 'Probe' }
]));
test(() => assert.deepEqual(createHp39Directory(parseHp39Directory(dir)), dir));
test(() => assert.deepEqual(parseHp39Directory(bytes('HP39AscA\nC\t9 NOTE0.000  10 First note\r\n')), parseHp39Directory(dir).slice(0, 1)));
test(() => assert.deepEqual(parseHp39Directory(bytes('HP39AscA ')), []));
test(() => assert.deepEqual(parseHp39Directory(bytes('HP39AscA C 9 NOTE0.0000 ')), [{ kind: 'C', file: 'NOTE0.000', title: '' }]));
test(() => assert.equal(parseHp39Directory(bytes('HP39AscA C 9 NOTE0.0006  Probe'))[0].title, ' Probe'));
const info = inspectHp39File(binary);
test(() => assert.equal(info.title, 'Probe'));
test(() => assert.equal(info.payloadOffset, 14));
test(() => assert.equal(info.payloadBytes, 3));
test(() => assert.equal(info.payloadValidated, false));
test(() => assert.equal(info.hardwareValidated, false));
test(() => assert.equal(inspectHp39File(note).titleBytes, 10));
test(() => assert.equal(inspectHp39File(bytes('HP39AscC4 Test\nbody')).title, 'Test'));
test(() => assert.equal(inspectHp39File(bytes('HP39AscD 5 Probe\n1+1:')).kindDescription, 'program'));
test(() => assert.equal(inspectHp39File(bytes('HP39AscE 1 X\nopaque')).kindDescription, null));
test(() => assert.equal(inspectHp39File(Uint8Array.from([...bytes('HP39BinC'), 1, 0xe9, 0])).title, '\xe9'));
test(() => assert.deepEqual(createHp39Directory([{ kind: 'C', file: 'NOTE0.000', title: '\xe9' }]), bytes('HP39AscA C 9 NOTE0.0001 \xe9')));
for (const input of [undefined, [], new Uint16Array(20), bytes('HP39'), bytes('HPHP49-Cabc'), bytes('HP38AscA '),
  bytes('hp39AscA '), bytes('HP39AscZ '), bytes('HP39BinA '), bytes('HP39BinC'), bytes('HP39BinC\x04AB'),
  bytes('HP39BinC\x03ABC'), bytes('HP39AscC 4 abc'), bytes('HP39AscC 4 Test'), bytes('HP39AscC -1 X\ntext'),
  bytes('HP39AscC 256 x'), bytes('HP39AscC 0001 X\ntext'), bytes('HP39AscC 1\tX\ntext'),
  bytes('HP39AscC 3 A\0B\ntext'), new Uint8Array(MAX_HP39_FILE_BYTES + 1)])
  test(() => assert.throws(() => inspectHp39File(input)));
for (const input of ['HP39AscAB 1 X1 X', 'HP39AscA B1 X1 X', 'HP39AscA Z 1 X1 X', 'HP39AscA B 0 1 X',
  'HP39AscA C 9 NOTE0.00011 First note', 'HP39AscA C 9 NOTE0.00010 First noteX',
  'HP39AscA C 9 NOTE0.00010 First noteC 9 note0.00010 First note',
  'HP39AscA C 9 ../N0.0001 X', 'HP39AscA C 9 NOTE0.0001\nX'])
  test(() => assert.throws(() => parseHp39Directory(bytes(input))));
for (const bad of ['', '.', '..', '../X.000', 'a/b.000', 'a\\b.000', 'a:b.000', '/root', 'C:\\X',
  'CON', 'NUL.000', 'com1.txt', 'LPT9', 'A.', 'file name.000', '\u00e9.000', 'A\0.000', 'X'.repeat(256)])
  test(() => assert.throws(() => validateHp39Filename(bad)));
for (const good of ['HP39DIR.CUR', 'LIB275L.000', 'long_name.apt', 'x-y.000', 'a'.repeat(255)])
  test(() => assert.equal(validateHp39Filename(good), good));
for (const bad of [null, [{ kind: 'Z', file: 'X', title: 'X' }], [{ kind: 'C', file: 'X', title: '\u4e2d' }],
  [{ kind: 'C', file: 'X', title: '\n' }], [{ kind: 'C', file: 'X', title: 'a'.repeat(256) }],
  Array.from({ length: 257 }, (_, i) => ({ kind: 'C', file: `X${i}`, title: 'X' }))])
  test(() => assert.throws(() => createHp39Directory(bad)));
const valid = inspectHp39Bundle(files());
test(() => assert.equal(valid.referencesValidated, true));
test(() => assert.equal(valid.files, 4));
test(() => assert.equal(valid.payloadValidated, false));
test(() => assert.equal(valid.hardwareValidated, false));
test(() => assert.equal(valid.uploadEnabled, false));
test(() => assert.equal(inspectHp39Bundle(files().map(f => ({ ...f, name: f.name.toLowerCase() }))).files, 4));
test(() => assert.throws(() => inspectHp39Bundle(files().slice(0, 3)), /Missing/));
test(() => assert.throws(() => inspectHp39Bundle([...files(), { name: 'note0.000', bytes: note }]), /Duplicate/));
test(() => assert.throws(() => inspectHp39Bundle([...files(), { name: 'EXTRA.000', bytes: note }]), /Unreferenced/));
test(() => assert.throws(() => inspectHp39Bundle(files().map(f => f.name === 'PROBE0.000' ? { ...f, bytes: note } : f)), /type mismatch/));
test(() => assert.throws(() => inspectHp39Bundle(files().map(f => f.name === 'NOTE0.000' ? { ...f, bytes: bytes('HP39AscC 3 Bad\nbody') } : f)), /Unsupported HP39 directory title alias/));
// Original opaque fixture: outer formats remain valid when the directory uses
// a display alias. The bundle's stricter host policy remains unsupported.
const aliasDirectory = bytes('HP39AscA H 8 LIB0.0005 Alias');
const aliasLibrary = Uint8Array.from([...bytes('HP39BinH'), 6, ...bytes('Actual'), 255]);
test(() => assert.equal(parseHp39Directory(aliasDirectory)[0].title, 'Alias'));
test(() => assert.equal(inspectHp39File(aliasLibrary).title, 'Actual'));
test(() => assert.throws(() => inspectHp39Bundle([
  { name: 'HP39DIR.CUR', bytes: cur }, { name: 'HP39DIR.000', bytes: aliasDirectory },
  { name: 'LIB0.000', bytes: aliasLibrary }
]), { code: 'HP39_UNSUPPORTED_TITLE_ALIAS' }));
test(() => assert.throws(() => inspectHp39Bundle([
  { name: 'HP39DIR.CUR', bytes: cur }, { name: 'HP39DIR.000', bytes: bytes('HP39AscA A 11 HP39DIR.CUR4 Root') }
]), /Cycle/));
test(() => assert.throws(() => inspectHp39Bundle(files().filter(f => f.name !== 'HP39DIR.CUR')), /CUR/));
const many = 'HP39AscA ' + Array.from({ length: 257 }, (_, i) => `C ${String(i).length + 1} X${i}1 X`).join('');
test(() => assert.throws(() => parseHp39Directory(bytes(many)), /Too many/));
const maxName = 'Z'.repeat(255), maxBinary = Uint8Array.from([...bytes('HP39BinB'), 255, ...bytes(maxName), 0]);
test(() => assert.equal(inspectHp39File(maxBinary).titleBytes, 255));
const subarray = Uint8Array.from([0, ...binary, 0]).subarray(1, binary.length + 1);
test(() => assert.equal(inspectHp39File(subarray).title, 'Probe'));

const temp = await mkdtemp(resolve(tmpdir(), 'orchard-hp39-files-'));
try {
  const paths = [];
  for (const file of files()) {
    const path = resolve(temp, file.name); await writeFile(path, file.bytes); paths.push(path);
  }
  assert.deepEqual(await readHp39File(paths[0]), Buffer.from(cur)); ++checks;
  const report = await inspectHp39Paths(paths, true);
  assert.equal(report.referencesValidated, true); ++checks;
  assert.equal(report.sha256.length, 4); ++checks;
  assert.match(report.sha256[0].sha256, /^[a-f0-9]{64}$/); ++checks;
  assert.equal((await inspectHp39Paths([paths[2]])).files[0].title, 'First note'); ++checks;
  await assert.rejects(readHp39File(temp)); ++checks;
  const short = resolve(temp, 'short'); await writeFile(short, 'HP39');
  await assert.rejects(readHp39File(short)); ++checks;
  const linked = resolve(temp, 'link'); await symlink(paths[0], linked);
  await assert.rejects(readHp39File(linked)); ++checks;
  await assert.rejects(inspectHp39Paths([])); ++checks;
} finally { await rm(temp, { force: true, recursive: true }); }
console.log(`HP39 typed-file checks: ${checks} passed (ROM-free; payload execution unverified)`);
