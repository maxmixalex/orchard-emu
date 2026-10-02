// SPDX-License-Identifier: MIT
// Read-only metadata: full dumps, native boot regions and updates stay distinct.
import { inspectInput, readFirmware } from './rom-inputs.mjs';
const path = process.argv[2];
if (!path || process.argv.length !== 3) {
  console.error('Usage: node tools/rom-info.mjs LOCAL-FIRMWARE-FILE');
  process.exit(64);
}
console.log(JSON.stringify(inspectInput(await readFirmware(path)), null, 2));
