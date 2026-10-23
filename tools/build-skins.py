#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Build same-origin skins from immutable, hash-checked upstream outlined SVGs.
Set ORCHARD_SKIN_SOURCE to a previously acquired artifact directory for offline builds.
Only geometry/data is reused; no fonts or reference-emulator code are imported.
"""
from pathlib import Path
import hashlib, json, os, re, shutil, urllib.request, xml.etree.ElementTree as ET
ROOT = Path(__file__).resolve().parent.parent
SPEC = json.loads((ROOT/'tools/skin-sources.json').read_text())
SOURCE = Path(os.environ.get('ORCHARD_SKIN_SOURCE', str(ROOT/'build/skin-cache')))
OUT = ROOT/'dist/skins'
NS = '{http://www.w3.org/2000/svg}'
COMMON = dict(seven=24,eight=17,nine=10,four=25,five=18,six=11,one=26,two=19,three=12,zero=27,dot=20,
              divide=2,multiply=3,times=3,minus=4,plus=5,enter=6,on=56,up=42,left=43,down=44,right=45)
HP39 = dict(symb=41,plot=46,num=47,home=48,aplet=49,views=50,vars=28,math=21,deriv=14,xt=7,**{"del":0},
            sin=29,cos=22,tan=15,ln=8,log=1,power2=30,powery=23,openparen=16,closeparen=9,
            comma=57,alpha=58,shift=59,negative=13)
HP48 = dict(apps=41,mode=46,tool=47,var=48,sto=49,nxt=50,hist=28,eval=21,tick=14,symb=7,**{"del":0},
            ypower=29,root=22,sin=15,cos=8,tan=1,eex=30,plusminus=23,x=16,reciprocal=9,
            alpha=57,leftblue=58,rightred=59,spc=13)

def acquire():
    for item in SPEC['files']:
        path=SOURCE/item['path']
        if not path.exists():
            url=f"https://raw.githubusercontent.com/{SPEC['repository']}/{SPEC['revision']}/{item['path']}"
            with urllib.request.urlopen(url, timeout=30) as response: data=response.read(1000001)
            if len(data)>1000000: raise ValueError('Oversized skin asset')
            if hashlib.sha256(data).hexdigest()!=item['sha256']: raise ValueError('Skin download hash mismatch')
            path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        if hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']: raise ValueError(f'Wrong skin asset: {path}')

def shapes(model):
    directory=SOURCE/model; svg=next(directory.glob('*_outlined.svg')); root=ET.fromstring(svg.read_bytes())
    design=json.loads((directory/'resolved_design.json').read_text())
    for el in root.iter():
        if el.tag.removeprefix(NS) in {'script','foreignObject','text','image'}: raise ValueError('Not an inert outlined SVG')
        for k,v in el.attrib.items():
            if k.startswith('on') or (k.endswith('href') and not v.startswith('#')): raise ValueError('Active SVG reference')
    parents={child:el for el in root.iter() for child in el}
    def transform(el):
        chain=[]
        while el is not root:
            if el.get('transform'): chain.insert(0,el.get('transform'))
            el=parents[el]
        return ' '.join(chain)
    ids={el.get('id'):el for el in root.iter() if el.get('id')}
    mapping={**COMMON,**(HP39 if model in ['hp39gplus','hp39gs','hp40gs'] else HP48)}
    key_specs={k['id']:k for row in design['keyboard']['rows'] for k in row['keys']}
    labels={key_id:k.get('label') or key_id for key_id,k in key_specs.items()}
    hits=[]
    def hit(el,scan,label):
        shape=next(x for x in el if x.tag.removeprefix(NS) in {'path','rect','circle'})
        attrs={k:v for k,v in shape.attrib.items() if k in {'d','x','y','width','height','rx','ry','cx','cy','r'}}
        spec=key_specs.get(el.get('id','').removeprefix('key-'),{})
        legends=spec.get('legends',[])
        left=spec.get('shift') or next((v['text'] for v in legends if v.get('style')=='blue'),'')
        right=next((v['text'] for v in legends if v.get('style')=='red'),'')
        alpha=spec.get('alpha') or spec.get('key_alpha','')
        hits.append(dict(scan=scan,label=label,tag=shape.tag.removeprefix(NS),attrs=attrs,transform=transform(el),shift=left,right=right,alpha=alpha))
    for name,el in ids.items():
        if name.startswith('key-') and name[4:] in mapping: hit(el,mapping[name[4:]],labels.get(name[4:],name[4:]))
    for n in range(1,7): hit(ids[f'F{n}'],34+n,f'F{n}')
    for name in ['up','left','down','right']: hit(ids[name],mapping[name],name.title())
    if len(hits)!=51 or len({h['scan'] for h in hits})!=51: raise ValueError(f'{model}: incomplete or duplicate keys')
    # Coordinate transforms belong to upstream artwork, not a guessed CSS scale.
    display=ids['display']; tr=transform(display)
    if tr:
        match=re.fullmatch(r'scale\(([\d.]+) ([\d.]+)\)',tr)
        if not match: raise ValueError('Unexpected display transform')
        sx,sy=map(float,match.groups())
    else: sx=sy=1
    screen=design['display']
    if screen.get('screen_path'):
        # These pinned screen paths have only M/L/C/Q/Z and paired coordinates;
        # the convex control-point bounds give a conservative glass inset.
        if re.search(r'[AaHhVvSsTt]',screen['screen_path']): raise ValueError('Unexpected screen curve')
        coords=list(map(float,re.findall(r'-?\d+(?:\.\d+)?',screen['screen_path'])))
        xs,ys=coords[::2],coords[1::2];x,y=min(xs),min(ys);w,h=max(xs)-x,max(ys)-y
    else: x,y,w,h,_=screen['screen']
    glass=[x*sx,y*sy,w*sx,h*sy]
    # A landscape skin is the original art cut at the lowest painted bezel edge.
    # Both pinned bezel paths use paired M/C coordinates and reach their lowest
    # control point at a curve endpoint; half the stroke belongs to the top piece.
    bezel=screen['bezel']
    if re.search(r'[AaHhVvLlQqSsTt]',bezel): raise ValueError('Unexpected bezel curve')
    coords=list(map(float,re.findall(r'-?\d+(?:\.\d+)?',bezel)))
    bezel_sy=1
    if screen.get('bezel_transform'):
        match=re.fullmatch(r'scale\(([\d.]+) ([\d.]+)\)',screen['bezel_transform'])
        if not match: raise ValueError('Unexpected bezel transform')
        bezel_sy=float(match[2])
    split_y=(max(coords[1::2])+float(screen.get('bezel_stroke_width',0))/2)*bezel_sy*sy
    view_box=list(map(float,root.get('viewBox').split()))
    if not glass[1]+glass[3]<split_y<view_box[3]: raise ValueError('Invalid skin split')
    shutil.copyfile(svg,OUT/f'{model}.svg')
    return dict(name=design['metadata']['name'],viewBox=view_box,splitY=split_y,
                glass=glass,background=screen.get('screen_fill',design['palette']['glass']),keys=hits)

if __name__=='__main__':
    acquire();OUT.mkdir(parents=True,exist_ok=True)
    result={model:shapes(model) for model in ['hp39gplus','hp39gs','hp40gs','hp48gii','hp49gplus','hp50g','hp50g-blue']}
    (OUT/'manifest.json').write_text(json.dumps(dict(revision=SPEC['revision'],models=result),separators=(',',':'))+'\n')
    shutil.copytree(ROOT/'licenses/hp-calcs-svg',ROOT/'dist/licenses/hp-calcs-svg',dirs_exist_ok=True)
    print('Seven outlined skins: exact geometry, 51 unique keys each, hashes verified')
