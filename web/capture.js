// SPDX-License-Identifier: MIT
import {sessionName} from './preferences.js';
export function frameRGBA(frame,background=[194,208,202]){
  if(!frame||frame.frameStatus||!Number.isInteger(frame.width)||!Number.isInteger(frame.height)||frame.width<1||frame.width>1024||frame.height<1||frame.height>1024||!(frame.pixels instanceof Uint8Array)||frame.pixels.length!==frame.width*frame.height)throw Error('No valid LCD frame');
  const out=new Uint8ClampedArray(frame.pixels.length*4),table=new Uint8ClampedArray(1024);
  for(let ink=0;ink<256;ink++){for(let c=0;c<3;c++)table[ink*4+c]=Math.round(background[c]*(1-ink/255)+[31,47,42][c]*ink/255);table[ink*4+3]=255;}
  // Views share byte order, so this remains correct on either host endianness.
  const colors=new Uint32Array(table.buffer),packed=new Uint32Array(out.buffer);
  for(let i=0;i<frame.pixels.length;i++)packed[i]=colors[frame.pixels[i]];
  return out;
}
export function captureName(model,now=new Date()){return sessionName(model,now).replace(/\.ord$/,'.png');}
export async function capturePNG(frame,scale=4,background){
  if(![1,4].includes(scale))throw Error('Unsupported capture scale');
  const rgba=frameRGBA(frame,background),native=document.createElement('canvas');native.width=frame.width;native.height=frame.height;
  native.getContext('2d').putImageData(new ImageData(rgba,frame.width,frame.height),0,0);
  const canvas=document.createElement('canvas');canvas.width=frame.width*scale;canvas.height=frame.height*scale;
  const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;context.drawImage(native,0,0,canvas.width,canvas.height);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG encoding failed')),'image/png'));
}
