// SPDX-License-Identifier: MIT
// Local-only explicit updater assembly. Inputs are never overwritten.
import { writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { models, readFirmware, prepareFirmwareUpdate, sha256 } from './rom-inputs.mjs';

const usage = 'Usage: node tools/install-firmware-update.mjs MODEL BASE-NOR UPDATE NEW-NOR NEW-REPORT.json';
if (process.argv.length === 3 && process.argv[2] === '--help') { console.log(usage); process.exit(0); }
if (process.argv.length !== 7) throw new Error(usage);
const [model, basePath, updatePath, outPath, reportPath] = process.argv.slice(2), id = models.indexOf(model) + 1;
const output = resolve(outPath), report = resolve(reportPath);
if (!id || new Set([resolve(basePath), resolve(updatePath), output, report]).size !== 4)
  throw new Error('Use a known model and four distinct input/output paths');
const prepared = prepareFirmwareUpdate(id, await readFirmware(basePath), await readFirmware(updatePath));
const { image, ...metadata } = prepared;
const record = { schema:'orchard-local-firmware-install-v1', model,
  output_bytes:image.length, output_sha256:sha256(image), ...metadata };
// Exclusive creation prevents accidental replacement of private captures.
await writeFile(output, image, { flag:'wx' });
try { await writeFile(report, JSON.stringify(record, null, 2) + '\n', { flag:'wx' }); }
catch (error) { await rm(output); throw error; }
console.log(`Prepared ${image.length} bytes, SHA-256 ${record.output_sha256}\n${output}\n${report}`);
