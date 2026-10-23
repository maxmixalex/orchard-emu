// SPDX-License-Identifier: MIT
// Artwork is a separate Apache-2.0 asset; preserve its own NOTICE and provenance.
const NS='http://www.w3.org/2000/svg';
const SLUGS=['','hp39gplus','hp39gs','hp40gs','hp48gii','hp49gplus','hp50g'];
const ATTRS=new Set(['d','x','y','width','height','rx','ry','cx','cy','r']);
const NAMES=['I/O','Left shift','Right shift','Alpha','Battery','Busy'];
const LANDSCAPE_GAP=24;
export class SkinView {
  constructor(stage, tap) {
    this.stage=stage;this.tap=tap;this.epoch=0;this.enabled=false;this.appliedEnabled=null;this.buttons=[];this.lastActive=-1;this.lastSegments='';this.rgb=[194,208,202];
    this.image=stage.querySelector('.skin-image');this.keyboardImage=stage.querySelector('.skin-keyboard-image');this.hits=stage.querySelector('.skin-keys');
    this.spec=null;this.landscape=false;
    this.glass=stage.querySelector('.glass-overlay');this.indicators=stage.querySelectorAll('[data-segment]');
    this.manifest=fetch(new URL('skins/manifest.json',import.meta.url)).then(r=>{
      if(!r.ok)throw new Error(`Skin metadata HTTP ${r.status}`);return r.json();
    });
    // The caller displays a visible error. Avoid an early unhandled rejection.
    this.manifest.catch(()=>{});
  }
  async show(model,blue=false) {
    const token=++this.epoch;this.buttons=[];this.appliedEnabled=null;this.lastActive=-1;this.lastSegments='';this.hits.replaceChildren();this.image.hidden=true;
    this.glass.hidden=true;if(this.keyboardImage)this.keyboardImage.hidden=true;
    const manifest=await this.manifest;
    if(token!==this.epoch)return;
    const slug=model===6&&blue?'hp50g-blue':SLUGS[model], spec=manifest.models[slug];
    if(!spec||spec.keys.length!==51)throw new Error('Invalid skin geometry');
    const [vx,vy,width,height]=spec.viewBox;
    if(vx!==0||vy!==0||width<=0||height<=0)throw new Error('Unsupported skin coordinates');
    if(!Number.isFinite(spec.splitY)||spec.splitY<=spec.glass[1]+spec.glass[3]||spec.splitY>=height)throw new Error('Invalid skin split');
    this.spec=spec;this.setLayout(this.landscape);this.hits.setAttribute('viewBox',spec.viewBox.join(' '));
    const imageURL=new URL(`skins/${slug}.svg`,import.meta.url);
    this.image.src=imageURL;this.image.alt=spec.name;
    if(this.keyboardImage){this.keyboardImage.src=imageURL;this.keyboardImage.hidden=false;}
    this.image.hidden=false;this.stage.dataset.model=slug;
    const [x,y,w,h]=spec.glass;
    // Leave real glass around both the rectangular LCD body and separate segments.
    this.glass.style.left=`${(x+w*.05)/width*100}%`;
    this.glass.style.width=`${w*.90/width*100}%`;
    this.glass.style.top=`${(y+h*.5)/height*100}%`;
    this.stage.style.setProperty('--glass',spec.background);
    if(/^#[\da-f]{6}$/i.test(spec.background)) this.rgb=[1,3,5].map(i=>parseInt(spec.background.slice(i,i+2),16));
    this.glass.hidden=false;
    for(const key of spec.keys) {
      if(!['path','rect','circle'].includes(key.tag)||!Number.isInteger(key.scan))throw new Error('Invalid key geometry');
      const group=document.createElementNS(NS,'g'),shape=document.createElementNS(NS,key.tag),title=document.createElementNS(NS,'title');
      for(const [name,value] of Object.entries(key.attrs))if(ATTRS.has(name))shape.setAttribute(name,String(value));
      if(key.transform)group.setAttribute('transform',key.transform);
      group.dataset.scan=String(key.scan);group.classList.add('skin-key');group.setAttribute('role','button');
      group.setAttribute('aria-label',`Calculator ${key.label}`);group.setAttribute('aria-pressed','false');
      title.textContent=key.label;group.append(title,shape);
      const activate=()=>{if(this.enabled){this.tap(key.scan);this.stage.closest('#calculator').focus({preventScroll:true});}};
      group.addEventListener('click',activate);
      group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();activate();}});
      this.hits.append(group);this.buttons.push(group);
    }
    this.appliedEnabled=null;
    this.setEnabled(this.enabled);
  }
  setLayout(landscape) {
    this.landscape=Boolean(landscape&&this.keyboardImage);
    const [,,width,height]=this.spec?.viewBox??[0,0,665,1340],split=this.spec?.splitY??506.575;
    const bounds=this.landscape?[width*2+LANDSCAPE_GAP,Math.max(split,height-split)]:[width,height];
    this.stage.dataset.layout=this.landscape?'landscape':'portrait';
    this.stage.style.aspectRatio=bounds.join('/');
    this.stage.style.setProperty('--skin-ratio',`${width}/${height}`);
    this.stage.style.setProperty('--screen-ratio',`${width}/${split}`);
    this.stage.style.setProperty('--keyboard-ratio',`${width}/${height-split}`);
    this.stage.style.setProperty('--keyboard-shift',`${-split/height*100}%`);
    this.stage.style.setProperty('--split-gap',`${LANDSCAPE_GAP/bounds[0]*100}%`);
    return bounds;
  }
  setEnabled(enabled) {
    this.enabled=enabled;
    if(this.appliedEnabled===enabled)return;
    this.appliedEnabled=enabled;
    for(const key of this.buttons){key.setAttribute('aria-disabled',String(!enabled));key.setAttribute('tabindex',enabled?'0':'-1');}
  }
  update(active,levels,status,model) {
    if(this.lastActive!==active){for(const key of this.buttons)key.setAttribute('aria-pressed',String(Number(key.dataset.scan)===active));this.lastActive=active;}
    // Packed routing: 39g+/39gs/48gII Shift/Alpha transitions were checked against
    // original guests; the remaining labels follow recorded reference routing.
    // A visible unavailable state is distinct from six known-off segments.
    const hp39=model===1||model===2,mapped=hp39||model>=4,known=mapped&&status===0&&levels?.length===6;
    const signature=`${model}:${known}:${Array.from(levels||[]).join(',')}`;
    if(this.lastSegments!==signature) for(const indicator of this.indicators){
      const i=Number(indicator.dataset.segment),level=known?levels[i]:0;
      indicator.style.opacity=String(level/255);
      indicator.setAttribute('aria-label',`${hp39&&i===1?'Shift':NAMES[i]}: ${known?(level?'on':'off'):'unmapped'}`);
    }
    if(this.lastSegments!==signature)this.stage.querySelector('.annunciator-strip').dataset.known=String(known);
    this.lastSegments=signature;
    return !mapped?'Status segments: mapping for this model is not yet verified.':status?`Status segments unavailable (LCD format ${status}).`:'Status segments: guest data · Shift/Alpha checked on 39g+, 39gs and 48gII; other routing remains provisional.';
  }
}
