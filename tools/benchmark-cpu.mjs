// SPDX-License-Identifier: MIT
// Compare two builds of tools/cpu-throughput.c; no firmware is loaded.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const args = process.argv.slice(2);
if (args.length < 3 || args.length > 5 || args.length === 5 && args[3] !== '--instructions')
  throw new Error('Usage: node tools/benchmark-cpu.mjs BEFORE AFTER NEW-REPORT.json [--instructions N]');
if (args.length === 4) throw new Error('Missing instruction count');
const [before, after, report] = args.map(value => resolve(value));
const instructions = args.length === 5 ? Number(args[4]) : 10000000;
assert(Number.isSafeInteger(instructions) && instructions > 0 && instructions <= 1000000000);
const wasm = before.endsWith('.wasm');
assert.equal(after.endsWith('.wasm'), wasm, 'Both runners must target the same host');
const files = [before, after], binaries = await Promise.all(files.map(path => readFile(path)));
const executeFile = promisify(execFile);
const names = ['ARM ALU', 'ARM word/byte', 'ARM halfword', 'ARM STM/LDM',
               'Thumb ALU', 'Thumb single transfer', 'Thumb PUSH/POP'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const reports = [];
for (const [workload, name] of names.entries()) {
  const times = [[], []];
  let digest;
  for (let repeat = 0; repeat < 3; ++repeat) {
    for (const variant of repeat % 2 ? [1, 0] : [0, 1]) {
      let sample;
      if (wasm) {
        const { instance: { exports: c } } = await WebAssembly.instantiate(binaries[variant], {});
        assert(['prepare', 'execute', 'digest'].every(name => typeof c[name] === 'function'),
          'Use a WASM build of tools/cpu-throughput.c, not the production application module');
        assert.equal(c.prepare(workload), 0);
        assert.equal(c.execute(100000), 0);
        assert.equal(c.prepare(workload), 0);
        const start = performance.now();
        const status = c.execute(instructions);
        const ms = performance.now() - start;
        sample = { status, ms, digest: c.digest() >>> 0 };
      } else {
        const { stdout } = await executeFile(files[variant], [String(workload), String(instructions)], { encoding: 'utf8' });
        const result = JSON.parse(stdout);
        assert.equal(result.workload, workload);
        assert.equal(result.instructions, instructions);
        sample = { status: result.status, ms: result.seconds * 1000, digest: result.digest };
      }
      assert.equal(sample.status, 0);
      assert(Number.isFinite(sample.ms) && sample.ms > 0, 'A timing sample must have positive finite duration');
      if (digest !== undefined) assert.equal(sample.digest, digest, `${name}: architectural/memory output changed`);
      digest = sample.digest;
      times[variant].push(sample.ms);
    }
  }
  const speedup = median(times[0]) / median(times[1]);
  reports.push({ workload, name, instructions, baseline_ms: times[0], candidate_ms: times[1], speedup, digest });
  console.log(`${name}: ${(median(times[0]) / 1000).toFixed(3)} s -> ${(median(times[1]) / 1000).toFixed(3)} s, ${speedup.toFixed(3)}x; digest matched`);
}
await writeFile(report, JSON.stringify({
  schema: 'orchard-cpu-throughput-v1', host: wasm ? 'WASM/Node' : 'native',
  node: process.version, platform: process.platform, architecture: process.arch,
  baseline_sha256: sha(binaries[0]), candidate_sha256: sha(binaries[1]),
  measures: 'ROM-free CPU-only loops; excludes compilation, initialization and peripheral scheduling; no real-calculator timing ratio',
  reports
}, null, 2) + '\n', { flag: 'wx' });
