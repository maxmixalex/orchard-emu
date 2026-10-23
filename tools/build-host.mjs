// SPDX-License-Identifier: MIT
import {mkdir,rm,copyFile,readdir} from 'node:fs/promises';
const root='build/host-package';await rm(root,{recursive:true,force:true});
for(const dir of ['host','web','dist'])await mkdir(`${root}/${dir}`,{recursive:true});
for(const name of (await readdir('host')).filter(n=>/\.(?:mjs|md|py)$/.test(n)))await copyFile(`host/${name}`,`${root}/host/${name}`);
for(const name of ['catalog.js','hp48.js','pacing.js','session.js','virtual-usb.js','usb-device.js','host-bridge-client.js','host-bridge-protocol.js'])await copyFile(`web/${name}`,`${root}/web/${name}`);
await copyFile('dist/orchard.wasm',`${root}/dist/orchard.wasm`);await copyFile('LICENSE',`${root}/LICENSE`);
// Node determines .js module type from this minimal package descriptor.
const {writeFile}=await import('node:fs/promises');await writeFile(`${root}/package.json`,'{"type":"module","private":true}\n');
console.log('Standalone host: loopback USB/IP + UART; no npm dependencies, ROMs or drivers bundled.');
