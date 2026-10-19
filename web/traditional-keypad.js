// SPDX-License-Identifier: MIT
// Key outlines/legends derive from the separate Apache-2.0 hp-calcs-svg manifest.
// Keep licenses/hp-calcs-svg/LICENSE.txt and NOTICE.txt with distributed artwork.
const NS='http://www.w3.org/2000/svg';
const ATTRS=new Set(['d','x','y','width','height','rx','ry','cx','cy','r']);
const svg=(name,attrs={})=>{const node=document.createElementNS(NS,name);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));return node;};
export const MODEL_SLUGS=['','hp39gplus','hp39gs','hp40gs','hp48gii','hp49gplus','hp50g'];
export class TraditionalKeypad {
  constructor(host,spec,tap){
    if(!spec||spec.keys?.length!==51)throw Error('Invalid keyboard geometry');
    this.host=host;this.enabled=false;this.buttons=[];
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
      group.append(shape);placement.append(group);this.root.append(placement);
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
      text(({uparrow:'↑',downarrow:'↓'})[key.shift]||key.shift,x,y-7,'key-shift','start',13);
      text(({uparrow:'↑',downarrow:'↓'})[key.right]||key.right,x+w,y-7,'key-right','end',13);
      text(key.alpha,x+w-5,y+h-4,'key-alpha','end',11);
      const activate=()=>{if(this.enabled)tap(key.scan);};
      group.addEventListener('click',activate);
      group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();activate();}});
      this.buttons.push(group);
    }
    const b=this.root.getBBox();this.bounds={x:b.x-8,y:b.y-8,width:b.width+16,height:b.height+16};
    this.svg.setAttribute('viewBox',Object.values(this.bounds).join(' '));
    this.svg.style.aspectRatio=`${this.bounds.width}/${this.bounds.height}`;
    for(const name of ['position','visibility','left','top'])this.svg.style.removeProperty(name);host.replaceChildren(this.svg);
  }
  setEnabled(value){this.enabled=Boolean(value);for(const b of this.buttons){b.setAttribute('aria-disabled',String(!this.enabled));b.setAttribute('tabindex',this.enabled?'0':'-1');}}
  update(active){for(const b of this.buttons)b.setAttribute('aria-pressed',String(Number(b.dataset.scan)===active));}
  destroy(){this.host.replaceChildren();this.buttons=[];}
}
