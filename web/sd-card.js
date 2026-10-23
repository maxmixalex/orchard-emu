// SPDX-License-Identifier: MIT
export const MAX_SD_BYTES=32*1024*1024;
export const SD_SIZES=[1,2,4,8,16,32].map(n=>n*1024*1024);
export function validateSDSize(length){
  if(!SD_SIZES.includes(length))throw new Error('Choose a complete 1, 2, 4, 8, 16 or 32 MiB SD card image.');
  return length;
}
// A standard MBR with one FAT16 partition. Firmware owns all subsequent
// filesystem reads/writes; this formatter never edits calculator memory.
export function createSDImage(){
  const image=new Uint8Array(16*1024*1024),v=new DataView(image.buffer);
  const sector=512,start=1,total=image.length/sector-start,cluster=2,rootEntries=512;
  const reserved=1,rootSectors=rootEntries*32/sector;
  let fatSectors=1;
  while(Math.ceil((Math.floor((total-reserved-rootSectors-2*fatSectors)/cluster)+2)*2/sector)>fatSectors)fatSectors++;
  const put=(offset,text)=>image.set(new TextEncoder().encode(text),offset);
  image.set([0,0,2,0,6,63,32,15],446); // LBA 1..32767, matching the BPB's 64 heads / 32 sectors.
  v.setUint32(454,start,true);v.setUint32(458,total,true);v.setUint16(510,0xaa55,true);
  const b=start*sector;
  image.set([0xeb,0x3c,0x90],b);put(b+3,'ORCHARD ');
  v.setUint16(b+11,sector,true);image[b+13]=cluster;v.setUint16(b+14,reserved,true);
  image[b+16]=2;v.setUint16(b+17,rootEntries,true);v.setUint16(b+19,total,true);
  image[b+21]=0xf8;v.setUint16(b+22,fatSectors,true);v.setUint16(b+24,32,true);
  v.setUint16(b+26,64,true);v.setUint32(b+28,start,true);
  image[b+36]=0x80;image[b+38]=0x29;v.setUint32(b+39,0x4f524348,true);
  put(b+43,'NO NAME    ');put(b+54,'FAT16   ');v.setUint16(b+510,0xaa55,true);
  for(let f=0;f<2;f++){const o=(start+reserved+f*fatSectors)*sector;v.setUint16(o,0xfff8,true);v.setUint16(o+2,0xffff,true);}
  // Use FAT's no-label BPB text and leave the optional root label entry absent.
  // HP49g+ Filer otherwise displays that entry as a user file; an unmatched
  // BPB label would also be inconsistent to independent filesystem checkers.
  return image;
}
export function sdImageName(name='orchard-sd.img'){
  const base=String(name).split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f<>:"|?*]/g,'_').slice(0,120);
  return /\.(?:img|bin|sd)$/i.test(base)?base:(base||'orchard-sd')+'.img';
}
export function readSDState(core){
  if(!core.sd_snapshot)return null;
  const p=core.sd_snapshot();if(!p)return null;
  const v=new Uint32Array(core.memory.buffer,p,12);
  return {bytes:v[0],present:Boolean(v[1]),writeProtected:Boolean(v[2]),dirty:Boolean(v[3]),
    cardState:v[4],lastCommand:v[5],commands:v[6]+v[7]*2**32,
    readBlocks:v[8]+v[9]*2**32,writtenBlocks:v[10]+v[11]*2**32};
}
