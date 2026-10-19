// SPDX-License-Identifier: MIT
// User-facing compatibility catalog, separate from the workbench's setup controls.
import { setupHash } from './hp48.js';
export const CALCULATORS = Object.freeze([
  Object.freeze({ id:1, height:64, name:'HP 39g+', preset:'hp39-home', bytes:1048576,
    hash:setupHash('hp39-home'), help:'When “Memory Clear” appears, press the top-right key (OK).' }),
  Object.freeze({ id:4, height:64, name:'HP 48gII', preset:'hp48-home', bytes:2097152,
    hash:setupHash('hp48-home'), help:'At “Try To Recover Memory?”, press the top-right key (NO). At “Memory Clear”, press that key again (OK).' }),
  ...[[5,'HP 49g+','hp49-home'],[6,'HP 50g','hp50-home']].map(([id,name,preset])=>Object.freeze({id,name,preset,height:80,bytes:2097152,hash:setupHash(preset),prepared:true,help:'Select the matching original boot region and the 2.15 update together. At recovery/clear, press the top-right key twice, waiting between prompts.'})),
]);
export async function identifyROM(buffer) {
  if (!(buffer instanceof ArrayBuffer) || !CALCULATORS.some(c=>c.bytes===buffer.byteLength))
    throw new Error('Open a complete 1 MB or 2 MB calculator ROM, not a firmware update or ZIP.');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
  const match=CALCULATORS.find(c=>c.hash===hash);
  if (!match) throw new Error('This ROM version is not supported by the calculator yet. The developer workbench can inspect other versions.');
  return match;
}
