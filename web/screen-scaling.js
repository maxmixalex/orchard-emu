// SPDX-License-Identifier: MIT
// Separable intensity resampling. Kernel names describe the implemented
// mathematics, not browser-dependent imageSmoothingQuality hints.
export const SCREEN_SCALING=Object.freeze(['nearest','linear','cubic','lanczos']);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function sinc(x){return Math.abs(x)<1e-8?1:Math.sin(Math.PI*x)/(Math.PI*x);}
const kernels={
  linear:{radius:1,weight:x=>Math.max(0,1-Math.abs(x))},
  cubic:{radius:2,weight:x=>{x=Math.abs(x);return x<1?(1.5*x-2.5)*x*x+1:x<2?((-.5*x+2.5)*x-4)*x+2:0;}},
  lanczos:{radius:3,weight:x=>Math.abs(x)<3?sinc(x)*sinc(x/3):0},
};
function axis(source,target,method){
  const {radius,weight}=kernels[method],shrink=Math.max(1,source/target),support=radius*shrink;
  const offsets=new Uint32Array(target+1),indices=[],coefficients=[];
  for(let i=0;i<target;i++){
    offsets[i]=indices.length;
    const center=(i+.5)*source/target-.5,weights=new Map();let sum=0;
    for(let j=Math.ceil(center-support);j<=Math.floor(center+support);j++){
      const value=weight((j-center)/shrink);if(!value)continue;
      const at=clamp(j,0,source-1);weights.set(at,(weights.get(at)||0)+value);sum+=value;
    }
    for(const [at,value] of weights){indices.push(at);coefficients.push(value/sum);}
  }
  offsets[target]=indices.length;
  return {offsets,indices:Uint16Array.from(indices),weights:Float64Array.from(coefficients)};
}
export function createScreenScaler(){
  let identity='',horizontal,vertical,scratch,output;
  return (frame,width,height,method='nearest')=>{
    if(!SCREEN_SCALING.includes(method)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>2097152)
      throw Error('Invalid LCD scaling');
    if(!frame||!Number.isInteger(frame.width)||!Number.isInteger(frame.height)||frame.width<1||frame.height<1||frame.width>1024||frame.height>1024||!(frame.pixels instanceof Uint8Array)||frame.pixels.length!==frame.width*frame.height)throw Error('Invalid LCD pixels');
    if(width===frame.width&&height===frame.height)return frame;
    const key=`${frame.width}:${frame.height}:${width}:${height}:${method}`;
    if(identity!==key){
      identity=key;output=new Uint8Array(width*height);
      if(method!=='nearest'){
        horizontal=axis(frame.width,width,method);vertical=axis(frame.height,height,method);
        scratch=new Float32Array(width*frame.height);
      }
    }
    if(method==='nearest'){
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)
        output[y*width+x]=frame.pixels[Math.min(frame.height-1,Math.floor((y+.5)*frame.height/height))*frame.width+Math.min(frame.width-1,Math.floor((x+.5)*frame.width/width))];
    }else{
      const hx=horizontal.offsets,hi=horizontal.indices,hw=horizontal.weights,
        vy=vertical.offsets,vi=vertical.indices,vw=vertical.weights;
      for(let y=0;y<frame.height;y++)for(let x=0;x<width;x++){
        let value=0;for(let k=hx[x];k<hx[x+1];k++)value+=frame.pixels[y*frame.width+hi[k]]*hw[k];
        scratch[y*width+x]=value;
      }
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        let value=0;for(let k=vy[y];k<vy[y+1];k++)value+=scratch[vi[k]*width+x]*vw[k];
        output[y*width+x]=clamp(Math.round(value),0,255);
      }
    }
    return {...frame,width,height,pixels:output};
  };
}
