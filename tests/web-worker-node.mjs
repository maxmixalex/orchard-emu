// SPDX-License-Identifier: MIT
// Browser global adapters only; executes the unchanged production Worker module.
import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
globalThis.self=globalThis;
globalThis.postMessage=data=>parentPort.postMessage(data);
globalThis.fetch=async url=>{
  const u=new URL(url);
  if(u.href!==new URL('../dist/orchard.wasm',import.meta.url).href)throw new Error('Unexpected asset request');
  return new Response(await readFile(u),{status:200});
};
parentPort.on('message',data=>self.onmessage?.({data}));
await import('../dist/worker.js');
