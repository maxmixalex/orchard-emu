// SPDX-License-Identifier: MIT
// A bounded, in-process USB host. All descriptors come from guest EP0 FIFOs.
// poll() never executes guest instructions; the owning Worker advances time.
const RESULTS=['ACK','NAK','STALL','No response','Invalid request','Unsupported operation','Buffer too small'];
const setup=(type,request,value=0,index=0,length=0)=>Uint8Array.of(type,request,value&255,value>>8,index&255,index>>8,length&255,length>>8);
export function endpoints(config){
  if(!(config instanceof Uint8Array)||config.length<9||config[0]!==9||config[1]!==2||
    config.length!==(config[2]|config[3]<<8))throw new Error('Invalid USB configuration descriptor.');
  const out=[];
  for(let i=0;i<config.length;){const n=config[i];if(n<2||i+n>config.length)throw new Error('Invalid USB descriptor length.');
    if(config[i+1]===5){if(n<7)throw new Error('Invalid USB endpoint.');const address=config[i+2],size=config[i+4]|config[i+5]<<8;
      if(!(address&15)||address&0x70||size<1||size>1024)throw new Error('Invalid USB endpoint.');
      out.push({address,type:config[i+3]&3,maxPacket:size});}i+=n;}
  return out;
}
export class VirtualUSB {
  constructor(core,hz,notify){this.c=core;this.hz=hz;this.notify=notify;this.connected=false;this.info=null;this.job=null;this.toggles=new Map();}
  resetLocal(){this.connected=false;this.job=null;this.info=null;this.device=null;this.config=null;this.next=Infinity;this.toggles.clear();}
  disconnect(){this.c.usb_connect(0);this.resetLocal();this.notify({connected:false,phase:'Disconnected'});}
  start(tick){
    this.disconnect();
    if(this.c.usb_connect(1)||this.c.usb_reset_signal(1))throw new Error('USB connection failed.');
    this.connected=true;this.address=0;this.mps=8;this.next=tick+Math.ceil(this.hz*.01);this.phase='reset';this.sof=this.next;
    this.end=tick+this.hz*10;this.tick=tick;this.notify({connected:true,phase:'Connecting…'});
  }
  request(bytes,next){
    this.job={bytes,next,stage:'setup',data:[],size:0,toggle:1,deadline:this.tick+this.hz*2};this.next=this.tick;
  }
  readDescriptor(type,index,length,next,language=0){this.request(setup(128,6,type*256+index,language,length),next);}
  enumerate(){
    this.readDescriptor(1,0,8,first=>{
      if(first.length!==8||first[0]!==18||first[1]!==1||![8,16,32,64].includes(first[7]))throw new Error('Invalid USB device response.');
      this.mps=first[7];
      this.readDescriptor(1,0,18,device=>{
        if(device.length!==18||device[0]!==18||device[1]!==1)throw new Error('Incomplete USB device descriptor.');
        this.device=device.slice();
        this.info={vendor:device[8]|device[9]<<8,product:device[10]|device[11]<<8,manufacturer:'',name:'',endpoints:[]};
        this.request(setup(0,5,7),()=>{
          this.address=7;
          this.readDescriptor(2,0,9,header=>{
            if(header.length!==9||header[1]!==2)throw new Error('Missing USB configuration.');
            const n=header[2]|header[3]<<8;if(n<9||n>4096)throw new Error('USB configuration too large.');
            this.readDescriptor(2,0,n,config=>{
              this.info.endpoints=endpoints(config);this.config=config.slice();
              this.request(setup(0,9,config[5]),()=>this.strings(device));
            });
          });
        });
      });
    });
  }
  strings(device){
    const fields=[[device[14],'manufacturer'],[device[15],'name']].filter(([index])=>index);
    const done=()=>{this.job=null;this.phase='ready';this.toggles.clear();this.notify({connected:true,phase:'Connected',info:this.info});};
    if(!fields.length){done();return;}
    this.readDescriptor(3,0,255,langs=>{
      if(langs.length<4||langs[1]!==3||langs[0]!==langs.length)throw new Error('Invalid USB language descriptor.');
      const language=langs[2]|langs[3]<<8;
      const read=()=>{const field=fields.shift();if(!field){done();return;}
        this.readDescriptor(3,field[0],255,bytes=>{
          if(bytes.length<2||bytes[1]!==3||bytes[0]!==bytes.length||bytes.length%2)throw new Error('Invalid USB string descriptor.');
          this.info[field[1]]=new TextDecoder('utf-16le').decode(bytes.subarray(2));read();
        },language);};read();
    });
  }
  out(ep,isSetup,pid,bytes){
    new Uint8Array(this.c.memory.buffer,this.c.usb_buffer(),bytes.length).set(bytes);
    return this.c.usb_out(this.address,ep,Number(isSetup),pid,bytes.length);
  }
  receive(ep){
    const result=this.c.usb_in(this.address,ep,1);
    return {result,pid:this.c.usb_data1(),bytes:new Uint8Array(this.c.memory.buffer,this.c.usb_buffer(),this.c.usb_length()).slice()};
  }
  poll(tick){
    this.tick=tick;if(!this.connected)return;
    try{
      if(this.phase==='reset'){if(tick<this.next)return;this.c.usb_reset_signal(0);this.phase='enumerating';this.enumerate();}
      if(tick>=this.sof){const frame=Math.floor(tick/(this.hz/1000))&2047;this.c.usb_sof(frame);this.sof=tick+Math.ceil(this.hz/1000);}
      const j=this.job;if(!j||tick<this.next)return;
      if(tick>=j.deadline||tick>=this.end)throw new Error('USB timed out. Open the calculator’s USB transfer mode, then reconnect.');
      this.next=tick+2048;
      let result;
      if(j.stage==='setup'){
        result=this.out(0,true,0,j.bytes);if(result===0)j.stage='in';
      }else if(j.stage==='in'){
        const p=this.receive(0);result=p.result;
        if(result===0){
          if(p.pid!==j.toggle)throw new Error('Unexpected USB packet toggle.');j.toggle^=1;
          const requested=j.bytes[6]|j.bytes[7]<<8;
          j.size+=p.bytes.length;if(j.size>requested||p.bytes.length>this.mps)throw new Error('USB response exceeds requested size.');
          j.data.push(...p.bytes);
          if(!requested||j.size===requested||p.bytes.length<this.mps){
            if(requested&&(j.bytes[0]&128))j.stage='status';else{this.job=null;j.next(Uint8Array.from(j.data));}
          }
        }
      }else if(j.stage==='status'){
        result=this.out(0,false,1,new Uint8Array());
        if(result===0){this.job=null;j.next(Uint8Array.from(j.data));}
      }
      if(result!==undefined&&![0,1,3].includes(result))throw new Error('USB: '+(RESULTS[result]||'transaction failed'));
    }catch(error){this.c.usb_connect(0);this.resetLocal();this.notify({connected:false,phase:'Disconnected',error:error.message});}
  }
  endpoint(input){
    if(this.phase!=='ready'||!this.connected)throw new Error('Connect USB first.');
    const e=this.info.endpoints.find(e=>e.type===2&&Boolean(e.address&128)===input&&e.maxPacket<=64&&(e.address&15)<5);
    if(!e)throw new Error('No supported bulk endpoint in this direction.');return e;
  }
  send(bytes){
    const e=this.endpoint(false);if(!(bytes instanceof Uint8Array)||bytes.length>e.maxPacket)throw new Error(`Send at most ${e.maxPacket} bytes per USB packet.`);
    const pid=this.toggles.get(e.address)||0,result=this.out(e.address&15,false,pid,bytes);
    if(!result)this.toggles.set(e.address,pid^1);return {result,status:RESULTS[result],accepted:result?0:bytes.length};
  }
  read(){const e=this.endpoint(true),p=this.receive(e.address&15);return {...p,status:RESULTS[p.result]};}
}
