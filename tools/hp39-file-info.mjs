// SPDX-License-Identifier: MIT
// Read-only, offline HP39 transport metadata. No calculator interaction.
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { MAX_HP39_FILE_BYTES, MAX_HP39_BUNDLE_BYTES, inspectHp39File, inspectHp39Bundle } from '../web/hp39-files.js';

export async function readHp39File(path) {
  const linked = await lstat(path);
  if (!linked.isFile()) throw new Error('HP39 input must be a regular file, not a link or device.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await file.stat();
    if (!before.isFile() || before.dev !== linked.dev || before.ino !== linked.ino ||
        before.size < 8 || before.size > MAX_HP39_FILE_BYTES)
      throw new Error('HP39 input must be a regular file of 8 bytes to 2 MiB.');
    const data = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < data.length) {
      const { bytesRead } = await file.read(data, length, data.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await file.stat();
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      throw new Error('HP39 input changed during the read.');
    return data.subarray(0, length);
  } finally { await file.close(); }
}

export async function inspectHp39Paths(paths, bundle = false) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 256) throw new Error('Specify 1 to 256 input paths.');
  const files = [];
  // Bound allocations across the complete batch, not only each individual file.
  let total = 0;
  for (const path of paths) {
    const bytes = await readHp39File(path);
    total += bytes.length;
    if (total > MAX_HP39_BUNDLE_BYTES) throw new Error('HP39 input batch exceeds 16 MiB.');
    files.push({ name: basename(path), bytes });
  }
  const result = bundle ? inspectHp39Bundle(files) : { files: files.map(file => ({ file: file.name, ...inspectHp39File(file.bytes) })) };
  return { format: 'orchard-hp39-file-inspection-v1', ...result,
    sha256: files.map(file => ({ file: file.name, sha256: createHash('sha256').update(file.bytes).digest('hex') })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), bundle = args[0] === '--bundle';
  if (bundle) args.shift();
  if (!args.length || args.some(arg => arg.startsWith('--'))) {
    console.error('Usage: node tools/hp39-file-info.mjs [--bundle] FILE [FILE ...]');
    process.exitCode = 64;
  } else {
    try { console.log(JSON.stringify(await inspectHp39Paths(args, bundle), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
