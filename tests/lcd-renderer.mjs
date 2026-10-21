// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {frameRGBA,createLCDRenderer} from '../web/capture.js';

const saved={ImageData:globalThis.ImageData,Uint8ClampedArray,Uint32Array};
let images=0,bytes=0,words=0;
function expected(frame,background=[194,208,202]){
  const result=[];
  for(const pixel of frame.pixels){
    for(let c=0;c<3;c++)result.push(Math.round(background[c]*(1-pixel/255)+[31,47,42][c]*pixel/255));
    result.push(255);
  }
  return result;
}
function display(){
  const target={image:null,draws:0,putImageData(image,x,y){assert.equal(x,0);assert.equal(y,0);this.image=image;this.draws++;}};
  return {target,paint:createLCDRenderer(target)};
}
const frame=(width,height,pixels)=>({width,height,pixels,frameStatus:0});
try{
  globalThis.Uint8ClampedArray=new Proxy(saved.Uint8ClampedArray,{construct(type,args){bytes++;return Reflect.construct(type,args);}});
  globalThis.Uint32Array=new Proxy(saved.Uint32Array,{construct(type,args){words++;return Reflect.construct(type,args);}});
  globalThis.ImageData=class{
    constructor(width,height){images++;this.width=width;this.height=height;this.data=new Uint8ClampedArray(width*height*4);}
  };
  const a=display(),pixels=new Uint8Array([0,255]),small=frame(2,1,pixels),background=[194,208,202];
  a.paint(small,background);
  const image=a.target.image,packed=image.data.buffer;
  assert.deepEqual([...image.data],[194,208,202,255,31,47,42,255]);
  const allocations={images,bytes,words};
  for(let value=0;value<256;value++){
    // The input object and its pixel array may be reused and mutated by a caller.
    pixels[0]=value;pixels[1]=255-value;a.paint(small,[...background]);
    assert.equal(a.target.image,image);assert.equal(image.data.buffer,packed);
    assert.deepEqual([...image.data],expected(small,background));
  }
  assert.deepEqual({images,bytes,words},allocations,'same dimensions and RGB values allocate no image, RGBA/palette data or word views');
  background[0]=51;a.paint(small,background);
  assert.equal(a.target.image,image);assert.equal(images,allocations.images);
  assert.equal(bytes,allocations.bytes+1);assert.equal(words,allocations.words+1);
  assert.deepEqual([...image.data],expected(small,background),'an in-place RGB edit refreshes the palette');

  // Every input intensity, with each RGB channel taking every byte value.
  const ramp=frame(256,1,Uint8Array.from({length:256},(_,i)=>i));
  for(let value=0;value<256;value++){
    const rgb=[value,255-value,(value*37)&255];a.paint(ramp,rgb);
    assert.deepEqual([...a.target.image.data],expected(ramp,rgb));
    assert.deepEqual([...frameRGBA(ramp,rgb)],expected(ramp,rgb));
  }
  const square=frame(2,2,new Uint8Array([0,85,170,255]));a.paint(square);
  const squareImage=a.target.image;
  const tall=frame(1,4,square.pixels);a.paint(tall);
  assert.notEqual(a.target.image,squareImage,'dimension changes reallocate even when the pixel count is unchanged');
  assert.equal(a.target.image.width,1);assert.equal(a.target.image.height,4);
  assert.deepEqual([...a.target.image.data],expected(tall));
  const blank=frame(1,4,new Uint8Array(4));a.paint(blank);
  assert.deepEqual([...a.target.image.data],expected(blank),'the display null-LCD fallback fully clears prior ink');

  const b=display();b.paint(blank,[255,255,255]);
  assert.notEqual(b.target.image,a.target.image);assert.notEqual(b.target.image.data.buffer,a.target.image.data.buffer);
  const retained=[...a.target.image.data];b.paint(tall,[0,0,0]);
  assert.deepEqual([...a.target.image.data],retained,'separate display lifetimes never share mutable pixels');
  const capture=frameRGBA(tall),capture2=frameRGBA(tall);
  assert.notEqual(capture,capture2);assert.notEqual(capture.buffer,capture2.buffer);
  capture.fill(17);assert.deepEqual([...capture2],expected(tall));
  assert.deepEqual([...a.target.image.data],retained,'capture pixels cannot mutate a live display');
  a.paint(small);assert.deepEqual([...capture2],expected(tall),'drawing cannot mutate a retained capture');

  const good=a.target.image,draws=a.target.draws;
  for(const bad of [null,{...small,width:0},{...small,width:1025},{...small,height:0},{...small,height:1025},
    {...small,width:1.5},{...small,height:1.5},{...small,pixels:null},{...small,pixels:new Uint8Array(1)},
    {...small,pixels:new Uint8ClampedArray(2)},{...small,frameStatus:1}]){
    assert.throws(()=>a.paint(bad));assert.throws(()=>frameRGBA(bad));
    assert.equal(a.target.image,good);assert.equal(a.target.draws,draws);
  }
}finally{
  globalThis.Uint8ClampedArray=saved.Uint8ClampedArray;globalThis.Uint32Array=saved.Uint32Array;
  if(saved.ImageData===undefined)delete globalThis.ImageData;else globalThis.ImageData=saved.ImageData;
}
console.log('LCD renderer: exact channel colors, reusable image/palette, size/background changes, blank frames and capture/display isolation pass.');
