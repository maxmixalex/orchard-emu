// SPDX-License-Identifier: MIT
// Key outlines/legends derive from the separate Apache-2.0 hp-calcs-svg manifest.
// Keep licenses/hp-calcs-svg/LICENSE.txt and NOTICE.txt with distributed artwork.
import {bindCalculatorKey} from './key-input.js';
const NS='http://www.w3.org/2000/svg';
const ATTRS=new Set(['d','x','y','width','height','rx','ry','cx','cy','r']);
const legend=value=>({'double-colon':'∷','return-arrow':'↵',uparrow:'↑',downarrow:'↓'}[value]||value);
const svg=(name,attrs={})=>{const node=document.createElementNS(NS,name);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));return node;};
export const MODEL_SLUGS=['','hp39gplus','hp39gs','hp40gs','hp48gii','hp49gplus','hp50g'];
const measure=root=>{const b=root.getBBox();return {x:b.x-8,y:b.y-8,width:b.width+16,height:b.height+16};};
const dimensions=(node,bounds)=>{node.setAttribute('viewBox',Object.values(bounds).join(' '));node.style.aspectRatio=`${bounds.width}/${bounds.height}`;};
const reveal=node=>{for(const name of ['position','visibility','left','top'])node.style.removeProperty(name);};
export class TraditionalKeypad {
  constructor(host,spec,tap,{softHost=null,press,release}={}){
    if(!spec||spec.keys?.length!==51)throw Error('Invalid keyboard geometry');
    this.host=host;this.softHost=softHost;this.enabled=false;this.buttons=[];this.placements=[];this.landscape=false;this.cancelInputs=[];
    this.svg=svg('svg',{'class':'traditional-geometry','aria-label':spec.name,role:'group'});
    this.root=svg('g');this.svg.append(this.root);
    // Measure in an attached, unhidden tree, including when immersive mode is active.
    Object.assign(this.svg.style,{position:'absolute',visibility:'hidden',left:'0',top:'0'});document.body.append(this.svg);
    for(const key of spec.keys){
      if(!['path','rect','circle'].includes(key.tag)||!Number.isInteger(key.scan))throw Error('Invalid physical key');
      const placement=svg('g',{transform:key.transform||''});
      const group=svg('g',{'class':'traditional-key',role:'button',tabindex:-1,'aria-disabled':true,'aria-pressed':false,'aria-label':[key.label,key.shift,key.right,key.alpha].filter(Boolean).join(' · ')});
      group.dataset.scan=key.scan;
      const shape=svg(key.tag,{'class':'key-outline'});
      for(const [name,value] of Object.entries(key.attrs))if(ATTRS.has(name))shape.setAttribute(name,value);
      group.append(shape);placement.append(group);this.root.append(placement);this.placements.push({scan:key.scan,node:placement});
      const {x,y,width:w,height:h}=shape.getBBox();
      const text=(value,tx,ty,cls,anchor='middle',size=16)=>{
        if(!value)return;
        const t=svg('text',{x:tx,y:ty,'text-anchor':anchor,'class':cls,'font-size':size});t.textContent=value;group.append(t);
        // Fit long function names without stretching short labels or moving keys.
        const available=(cls==='key-shift'&&key.right)||(cls==='key-right'&&key.shift)?w*.47:w-6;
        if(t.getComputedTextLength()>available){t.setAttribute('textLength',available);t.setAttribute('lengthAdjust','spacingAndGlyphs');}
      };
      const face={Up:'↑',Down:'↓',Left:'←',Right:'→',leftblue:'⇧',rightred:'⇧',uparrow:'↑',downarrow:'↓'}[key.label]||key.label;
      if(key.label==='leftblue')group.classList.add('key-left-shift');if(key.label==='rightred')group.classList.add('key-right-shift');
      text(face,x+w/2,y+h*.62,'key-face','middle',Math.min(20,h*.42));
      text(legend(key.shift),x,y-7,'key-shift','start',13);
      text(legend(key.right),x+w,y-7,'key-right','end',13);
      text(key.alpha,x+w-5,y+h-4,'key-alpha','end',11);
      this.cancelInputs.push(bindCalculatorKey(group,{enabled:()=>this.enabled,tap:()=>tap(key.scan),press:press?source=>press(key.scan,source):undefined,release}));
      this.buttons.push(group);
    }
    this.portraitBounds=measure(this.root);this.bounds=this.portraitBounds;
    if(softHost){
      this.softSVG=svg('svg',{'class':'traditional-geometry','aria-label':spec.name,role:'group'});
      this.softRoot=svg('g');this.softSVG.append(this.softRoot);
      Object.assign(this.softSVG.style,{position:'absolute',visibility:'hidden',left:'0',top:'0'});document.body.append(this.softSVG);
      for(const {scan,node} of this.placements)if(scan>=35&&scan<=40)this.softRoot.append(node);
      this.mainBounds=measure(this.root);this.softBounds=measure(this.softRoot);dimensions(this.softSVG,this.softBounds);
      for(const {node} of this.placements)this.root.append(node);
      reveal(this.softSVG);softHost.replaceChildren(this.softSVG);
    }
    dimensions(this.svg,this.bounds);reveal(this.svg);host.replaceChildren(this.svg);
  }
  setLayout(landscape){
    landscape=Boolean(landscape&&this.softHost);if(this.landscape===landscape)return;
    this.landscape=landscape;
    for(const {scan,node} of this.placements)(landscape&&scan>=35&&scan<=40?this.softRoot:this.root).append(node);
    this.bounds=landscape?this.mainBounds:this.portraitBounds;dimensions(this.svg,this.bounds);
  }
  releaseInputs(){this.cancelInputs.forEach(cancel=>cancel());}
  setEnabled(value){this.enabled=Boolean(value);if(!this.enabled)this.releaseInputs();for(const b of this.buttons){b.setAttribute('aria-disabled',String(!this.enabled));b.setAttribute('tabindex',this.enabled?'0':'-1');}}
  update(active,activeKeys){const pressed=activeKeys??(active===null?[]:[active]);for(const b of this.buttons)b.setAttribute('aria-pressed',String(pressed.includes(Number(b.dataset.scan))));}
  destroy(){this.releaseInputs();this.cancelInputs=[];this.host.replaceChildren();this.softHost?.replaceChildren();this.buttons=[];this.placements=[];}
}
