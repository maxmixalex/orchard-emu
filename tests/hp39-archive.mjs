// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readHp39Archive,writeHp39Archive,isHp39Archive,zipCrc32} from '../web/hp39-archive.js';
import {prepareHp39Files} from '../web/hp39-transfer.js';
import {createHp39Directory,parseHp39Directory} from '../web/hp39-files.js';
import {CalculatorController} from '../web/controller.js';

const text=s=>new TextEncoder().encode(s),program=text('HP39AscD 4 TEST\nDISP 1;"Hello";'),
  library=Uint8Array.from([...text('HP39BinH'),3,...text('Lib'),0,127,128,255]);
const files=[{name:'TEST.000',bytes:program},{name:'LIB.000',bytes:library},
  {name:'HP39DIR.000',bytes:createHp39Directory([{kind:'D',file:'TEST.000',title:'Program alias'},{kind:'H',file:'LIB.000',title:'Library alias'}])}];
const source=prepareHp39Files(files);
assert.equal(source.length,4,'Stock SEND needs only its missing fixed CUR entry rebuilt');
assert.deepEqual(source.slice(0,3).map(f=>f.bytes),files.map(f=>f.bytes),'Keep received directory aliases and all payloads');
assert.deepEqual(parseHp39Directory(source.at(-1).bytes),[{kind:'A',file:'HP39DIR.000',title:'Orchard'}]);
assert.equal(zipCrc32(text('123456789')),0xcbf43926,'Standard CRC-32 check value');

// Python's standard ZIP implementation is independent of the browser writer.
function zip(entries=source,{deflate=true,streaming=false}={}){
  const input=JSON.stringify({deflate,streaming,files:entries.map(f=>({name:f.name,bytes:Buffer.from(f.bytes).toString('base64')}))});
  return new Uint8Array(execFileSync('python3',['-c',`
import io,json,base64,sys,zipfile
p=json.load(sys.stdin)
class Stream(io.BytesIO):
 def seekable(self): return False
 def seek(self,*a): raise io.UnsupportedOperation()
b=Stream() if p['streaming'] else io.BytesIO()
with zipfile.ZipFile(b,'w',compression=zipfile.ZIP_DEFLATED if p['deflate'] else zipfile.ZIP_STORED) as z:
 for f in p['files']: z.writestr(f['name'],base64.b64decode(f['bytes']))
sys.stdout.buffer.write(b.getvalue())
`],{input,maxBuffer:16*1024*1024}));
}
const byName=items=>Object.fromEntries(items.map(f=>[f.name,Buffer.from(f.bytes).toString('hex')]));
for(const deflate of [false,true])for(const streaming of [false,true]){
  const bytes=zip(source,{deflate,streaming}),roundtrip=await readHp39Archive(bytes);
  assert.deepEqual(byName(roundtrip),byName(source));
}
const archived=writeHp39Archive(files);
assert(isHp39Archive(archived));assert(!isHp39Archive(program));assert(!isHp39Archive(new Uint8Array()));
assert.deepEqual(byName(await readHp39Archive(archived)),byName(source));
const checked=JSON.parse(execFileSync('python3',['-c',`
import io,json,sys,zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 assert z.testzip() is None
 print(json.dumps({n:z.read(n).hex() for n in z.namelist()}))
`],{input:archived}));
assert.deepEqual(checked,byName(source),'Generated archive is portable and CRC-valid outside Orchard');

// Full release bundles may contain source, a receiver EXE and earlier test
// exports. Only the explicit calculator/ catalog and dependencies are read.
const bundle=zip([...source.map(f=>({...f,name:'calculator/'+f.name})),
  ...source.map(f=>({...f,name:'test/'+f.name})),{name:'receiver.exe',bytes:text('not a calculator program')},
  {name:'README.txt',bytes:text('This package contains calculator files.')}]);
assert.deepEqual(byName(await readHp39Archive(bundle)),byName(source));
assert.deepEqual(byName(await readHp39Archive(zip(files))),byName(source),'Import stock export without CUR');
assert.deepEqual(byName(await readHp39Archive(zip([{name:'ONE.000',bytes:program}]))),
  byName(prepareHp39Files([{name:'ONE.000',bytes:program}])));
const arbitrary=[{name:'ONE.any-suffix',bytes:program},{name:'LIBRARY',bytes:library}];
assert.deepEqual(byName(await readHp39Archive(zip([...arbitrary,{name:'README.bin',bytes:text('This is only a README, not an object.')}]))),
  byName(prepareHp39Files(arbitrary)),'Loose ZIP entries are selected by typed content, not suffix');
await assert.rejects(()=>readHp39Archive(zip([{name:'BROKEN.anything',bytes:text('HP39BinD\xffshort')}])) ,/Truncated/,'A malformed typed object cannot hide behind an unknown suffix');
await assert.rejects(()=>readHp39Archive(zip([...source.map(f=>({...f,name:'one/'+f.name})),...source.map(f=>({...f,name:'two/'+f.name}))])),/several/);
await assert.rejects(()=>readHp39Archive(zip([{name:'HP39DIR.000',bytes:files[2].bytes}])) ,/Missing/);
await assert.rejects(()=>readHp39Archive(zip([...source,{name:'../escape',bytes:text('ignored')}])) ,/relative/);
await assert.rejects(()=>readHp39Archive(zip([...source,{name:'test.000',bytes:program}])) ,/Duplicate/);
await assert.rejects(()=>readHp39Archive(archived.subarray(0,archived.length-1)),/truncated/);
const broken=archived.slice();broken[30+'TEST.000'.length+20]^=1;
await assert.rejects(()=>readHp39Archive(broken),/checksum/);
let calls=0;
await assert.rejects(()=>readHp39Archive(bundle,{cancelled:()=>++calls>2}),/cancelled/);
const inflated=zip([{name:'BIG.000',bytes:text('HP39AscD 3 BIG\n'+'A'.repeat(10000))}]);
const v=new DataView(inflated.buffer),end=inflated.length-22,central=v.getUint32(end+16,true);
v.setUint32(central+24,64,true);v.setUint32(22,64,true);
await assert.rejects(()=>readHp39Archive(inflated),/expands/,'Refuse a compressed size lie while streaming');

function controller(){
  const sent=[],downloads=[];
  const c=new CalculatorController({worker:{postMessage:d=>sent.push(d),terminate(){}},download:(bytes,name)=>downloads.push({bytes,name})});
  c.patch({model:{id:1},ready:true,loaded:true,running:true,usbReady:true});return {c,sent,downloads};
}
const browserFile=(name,bytes)=>({name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});
for(const name of ['renamed.data','NO_EXTENSION']){
  const {c,sent}=controller();await c.startHp39Server('usb',[{file:browserFile(name,bundle)}]);
  assert.deepEqual(byName(sent.at(-1).files),byName(source),'ZIP content wins over the outer filename');c.dispose();
}
{
  const {c,sent}=controller();await c.startHp39Server('usb',[{file:browserFile('ACTUAL_OBJECT.zip',program)}]);
  assert.deepEqual(sent.at(-1).files[0].bytes,program,'A typed file named .zip is still a typed file');c.dispose();
}
{
  const {c,sent,downloads}=controller();
  await c.startHp39Server('usb',[{file:browserFile('中文 package(1).zip',bundle)}]);
  assert.equal(sent.at(-1).mode,'serve');assert.deepEqual(byName(sent.at(-1).files),byName(source));
  for(const f of files)c.receive({type:'file-transfer-received',generation:c.generation,request:c.transferRequest,...f});
  // An overwritten name in a later completed transfer becomes the disk's
  // latest version, but the earlier individual download remains in the list.
  c.receive({type:'file-transfer-received',generation:c.generation,request:c.transferRequest,name:'TEST.000',bytes:program});
  await c.downloadHp39Package();
  assert.equal(downloads.length,1);assert.equal(downloads[0].name,'orchard-hp39-files.zip');
  assert.deepEqual(byName(await readHp39Archive(downloads[0].bytes)),byName(source));
  assert.equal(c.received.size,4);c.dispose();
}
{
  const {c,sent}=controller(),maximum=prepareHp39Files(Array.from({length:16},(_,i)=>({name:`FILE${i}.000`,bytes:program})));
  await c.startHp39Server('usb',maximum.map(f=>({file:browserFile(f.name,f.bytes)})));
  assert.equal(sent.at(-1).files.length,18,'Complete 16-object catalog also works through the controller');c.dispose();
}
{
  const {c,sent}=controller();await c.startHp39Server('usb',[{file:browserFile('bad.zip',broken)}]);
  assert.equal(c.state.transfer.phase,'error');assert(!sent.some(m=>m.type==='file-transfer-start'));c.dispose();
}
{
  const {c,sent}=controller();let release;const file=browserFile('package.zip',bundle);
  file.arrayBuffer=()=>new Promise(r=>{release=r;});
  const pending=c.startHp39Server('usb',[{file}]);c.cancelTransfer();release(bundle.slice().buffer);await pending;
  assert(!sent.some(m=>m.type==='file-transfer-start'));c.dispose();
}
console.log('HP39 archive: independent stored/DEFLATE/data-descriptor ZIPs, package selection, exact aliases/payloads, stock export re-import, CRC/expansion limits, cancellation and controller roundtrip pass.');
