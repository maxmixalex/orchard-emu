// SPDX-License-Identifier: MIT
// User-facing compatibility catalog, separate from the workbench's setup controls.
import { setupHash } from './hp48.js';
export const CALCULATORS = Object.freeze([
  Object.freeze({ id:1, name:'HP 39g+', preset:'hp39-home', bytes:1048576,
    hash:setupHash('hp39-home'), help:'When “Memory Clear” appears, press the top-right key (OK).' }),
  Object.freeze({ id:2, name:'HP 39gs', preset:'hp39gs-home', bytes:1048576,
    hash:setupHash('hp39gs-home'), help:'When “Memory Clear” appears, press the top-right key (OK).' }),
  Object.freeze({ id:4, name:'HP 48gII', preset:'hp48-home', bytes:2097152,
    hash:setupHash('hp48-home'), help:'At “Try To Recover Memory?”, press the top-right key (NO). At “Memory Clear”, press that key again (OK).' }),
  Object.freeze({ id:5, name:'HP 49g+', preset:'hp49-home', bytes:2097152,
    hash:setupHash('hp49-home'), help:'At “Try To Recover Memory?”, press the top-right key (NO). At “Memory Clear”, press that key again (OK).' }),
]);
export async function identifyROM(buffer) {
  if (!(buffer instanceof ArrayBuffer) || !CALCULATORS.some(c=>c.bytes===buffer.byteLength))
    throw new Error('Open a complete 1 MB or 2 MB calculator ROM, not a firmware update or ZIP.');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
  const match=CALCULATORS.find(c=>c.hash===hash);
  if (!match) throw new Error('This ROM version is not supported by the calculator yet. The developer workbench can inspect other versions.');
  return match;
}
