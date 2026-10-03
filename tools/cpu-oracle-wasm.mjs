// SPDX-License-Identifier: MIT
// Test-only binary transport. Never builds or modifies the production WASM.
import { readFile } from 'node:fs/promises';
if (process.argv.length !== 3) throw new Error('Usage: node cpu-oracle-wasm.mjs TEST-ORACLE.wasm');
const recordSize = 328, maxBytes = recordSize * 100000;
let size = 0;
const chunks = [];
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > maxBytes) throw new Error('100000-case limit exceeded');
  chunks.push(chunk);
}
if (size % recordSize) throw new Error('Truncated input record');
const input = Buffer.concat(chunks), output = Buffer.alloc(size);
const { instance: { exports: c } } = await WebAssembly.instantiate(await readFile(process.argv[2]), {});
if (c.oracle_init()) throw new Error('Test machine initialization failed');
for (let at = 0; at < size; at += recordSize) {
  new Uint8Array(c.memory.buffer, c.oracle_input(), recordSize).set(input.subarray(at, at + recordSize));
  if (c.oracle_step()) throw new Error(`Invalid record at case ${at / recordSize}`);
  output.set(new Uint8Array(c.memory.buffer, c.oracle_output(), recordSize), at);
}
process.stdout.write(output);
