// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createScreenScaler,SCREEN_SCALING} from '../web/screen-scaling.js';
const frame=(width,height,pixels)=>({width,height,pixels:Uint8Array.from(pixels),frameStatus:0});
const scale=createScreenScaler(),pair=frame(2,1,[0,255]);
assert.equal(scale(pair,2,1),pair);
assert.deepEqual([...scale(pair,4,1).pixels],[0,0,255,255]);
assert.deepEqual([...scale(pair,4,1,'linear').pixels],[0,64,191,255]);
assert.deepEqual([...scale(pair,4,1,'cubic').pixels],[0,52,203,255]);
for(const method of SCREEN_SCALING){
  for(const value of [0,47,128,255]){
    const constant=frame(4,3,Array(12).fill(value));
    for(const [w,h] of [[11,8],[2,1]])assert.deepEqual([...scale(constant,w,h,method).pixels],Array(w*h).fill(value),`${method} preserves a constant including borders`);
  }
  const horizontal=scale(pair,8,1,method).pixels.slice(),vertical=scale(frame(1,2,[0,255]),1,8,method).pixels;
  assert.deepEqual(vertical,horizontal,`${method} has identical horizontal and vertical kernels`);
  assert.deepEqual([...horizontal],[...horizontal].reverse().map(x=>255-x),`${method} centers the sampled transition`);
}
for(const method of SCREEN_SCALING.filter(x=>x!=='nearest')){
  const board=frame(12,12,Array.from({length:144},(_,i)=>(Math.floor(i/12)+i%12)%2*255));
  const reduced=scale(board,1,1,method);
  assert.equal(reduced.pixels[0],128,`${method} integrates downsampled checkerboard instead of aliasing`);
}
const original=pair.pixels.slice();
const first=scale(pair,9,1,'lanczos'),storage=first.pixels;
assert.equal(scale(pair,9,1,'lanczos').pixels,storage,'Stable output sizes reuse output buffers and coefficient maps');
assert.deepEqual(pair.pixels,original,'Display filtering never changes guest pixels');
assert.notEqual(createScreenScaler()(pair,9,1,'lanczos').pixels,storage,'Separate displays own separate output buffers');
for(const args of [[pair,0,1],[pair,1.5,1],[pair,2048,2048],[pair,4,1,'browser-high'],[frame(-1,-1,[1]),4,1],[{...pair,pixels:null},4,1]])assert.throws(()=>scale(...args));
console.log('Screen scaling: nearest, bilinear, Catmull-Rom bicubic and Lanczos-3; pixel centers, constants, antialiased downsampling, stable buffers and guest isolation pass.');
