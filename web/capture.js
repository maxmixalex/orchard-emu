// SPDX-License-Identifier: MIT
import {sessionName} from './preferences.js';
const BACKGROUND=[194,208,202],FOREGROUND=[31,47,42];
function validateFrame(frame){
  if(!frame||frame.frameStatus||!Number.isInteger(frame.width)||!Number.isInteger(frame.height)||frame.width<1||frame.width>1024||frame.height<1||frame.height>1024||!(frame.pixels instanceof Uint8Array)||frame.pixels.length!==frame.width*frame.height)throw Error('No valid LCD frame');
}
export function displayFrame(frame){
  // An unavailable LCD is shown as an empty screen. Use the same fallback for
  // the live canvas, screenshots and recordings, without erasing its status
  // in the controller/debugger or retaining an obsolete successful picture.
  if(frame&&(frame.frameStatus||frame.pixels===null)){
    const {width,height}=frame;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||width>1024||height<1||height>1024)throw Error('No valid LCD dimensions');
    return {...frame,frameStatus:0,pixels:new Uint8Array(width*height)};
  }
  validateFrame(frame);return frame;
}
function frameColors(background){
  const table=new Uint8ClampedArray(1024);
  for(let ink=0;ink<256;ink++){for(let c=0;c<3;c++)table[ink*4+c]=Math.round(background[c]*(1-ink/255)+FOREGROUND[c]*ink/255);table[ink*4+3]=255;}
  return new Uint32Array(table.buffer);
}
function writePixels(pixels,colors,packed){
  // Views share byte order, so this remains correct on either host endianness.
  for(let i=0;i<pixels.length;i++)packed[i]=colors[pixels[i]];
}
export function frameRGBA(frame,background=BACKGROUND){
  validateFrame(frame);
  const out=new Uint8ClampedArray(frame.pixels.length*4);
  writePixels(frame.pixels,frameColors(background),new Uint32Array(out.buffer));
  return out;
}
export function createLCDRenderer(context){
  // Each display owns its mutable image. Capture/recording keep independent pixels.
  let image,packed,colors,red,green,blue;
  return (frame,background=BACKGROUND)=>{
    validateFrame(frame);
    if(!colors||red!==background[0]||green!==background[1]||blue!==background[2]){
      colors=frameColors(background);[red,green,blue]=background;
    }
    if(!image||image.width!==frame.width||image.height!==frame.height){
      image=new ImageData(frame.width,frame.height);packed=new Uint32Array(image.data.buffer);
    }
    writePixels(frame.pixels,colors,packed);context.putImageData(image,0,0);
  };
}
export function captureName(model,now=new Date()){return sessionName(model,now).replace(/\.ord$/,'.png');}
export async function capturePNG(frame,scale=4,background){
  if(![1,4].includes(scale))throw Error('Unsupported capture scale');
  frame=displayFrame(frame);
  const rgba=frameRGBA(frame,background),native=document.createElement('canvas');native.width=frame.width;native.height=frame.height;
  native.getContext('2d').putImageData(new ImageData(rgba,frame.width,frame.height),0,0);
  const canvas=document.createElement('canvas');canvas.width=frame.width*scale;canvas.height=frame.height*scale;
  const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;context.drawImage(native,0,0,canvas.width,canvas.height);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG encoding failed')),'image/png'));
}
