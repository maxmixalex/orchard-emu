/* SPDX-License-Identifier: MIT
 * Independent S3C2410A chapter-11 register/stream cases. No calculator ROM,
 * optical peer or firmware PASS value is synthesized here. */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(n)
#else
#define EXPORT(n) __attribute__((export_name(n)))
#endif
static orchard_machine a,b;
static uint8_t checkpoint[600000],continued[600000];
static unsigned checks,failures,first;
#define CHECK(x) do{++checks;if(!(x)){if(!failures)first=__LINE__;++failures;}}while(0)
static void put(uint8_t *p,uint32_t n){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(n>>(8u*i));}
static uint32_t base(unsigned ch){return 0x50000000u+ch*0x4000u;}
static void init(void){CHECK(orchard_init(&a,sizeof a,2)==&a);a.loaded=true;a.soc.wtcon=0;put(a.flash,0xeafffffe);}
static void wr(unsigned ch,unsigned off,uint32_t n){CHECK(o_mmio_write(&a,base(ch)+off,4,n));}
static uint32_t rd(unsigned ch,unsigned off){uint32_t n=0;CHECK(o_mmio_read(&a,base(ch)+off,4,&n));return n;}
static void tick(unsigned n){CHECK(orchard_run(&a,n).status==ORCHARD_OK);}
static void reset_and_isolation(void){
 init();uint8_t bytes[3]={0x96,0x42,0xe7},got[4];
 for(unsigned ch=0;ch<3;ch++){
  CHECK(rd(ch,0)==0&&rd(ch,4)==0&&rd(ch,8)==0&&rd(ch,16)==6&&rd(ch,24)==0);
  wr(ch,0,3);wr(ch,4,5);CHECK(orchard_uart_send_channel(&a,ch,&bytes[ch],1)==1);
 }
 for(unsigned ch=0;ch<3;ch++){
  CHECK(rd(ch,16)==7&&rd(ch,36)==bytes[ch]&&rd(ch,16)==6);
  wr(ch,32,bytes[ch]);CHECK(orchard_uart_receive_channel(&a,ch,got,sizeof got)==1&&got[0]==bytes[ch]);
  CHECK(orchard_uart_receive_channel(&a,(ch+1u)%3u,got,sizeof got)==0);
 }
 CHECK(orchard_uart_send_channel(&a,3,bytes,1)==0);
 CHECK(orchard_uart_receive_channel(&a,3,got,sizeof got)==0);
 CHECK(orchard_uart_send_channel(NULL,0,bytes,1)==0);
 CHECK(orchard_uart_send_channel(&a,0,NULL,1)==0);
 CHECK(orchard_uart_receive_channel(&a,0,NULL,1)==0);
}
static void modes_and_clock(void){
 for(unsigned ch=0;ch<3;ch++){
  init();uint8_t bytes[3]={0x4a,0xa5,0x63},got[3];
  wr(ch,0,3);wr(ch,32,bytes[0]);CHECK(rd(ch,16)==0);
  CHECK(orchard_uart_receive_channel(&a,ch,got,sizeof got)==0);
  wr(ch,4,4);CHECK(rd(ch,16)==6);
  CHECK(orchard_uart_receive_channel(&a,ch,got,sizeof got)==1&&got[0]==bytes[0]);
  CHECK(orchard_uart_send_channel(&a,ch,bytes+1,1)==1);CHECK(rd(ch,16)==6);
  wr(ch,4,5);CHECK(rd(ch,36)==bytes[1]);
  uint32_t clock=a.soc.clock[3];CHECK(o_mmio_write(&a,0x4c00000cu,4,clock&~(0x400u<<ch)));
  wr(ch,32,bytes[2]);tick(100);CHECK(orchard_uart_receive_channel(&a,ch,got,sizeof got)==0);
  CHECK(o_mmio_write(&a,0x4c00000cu,4,clock));tick(1);
  CHECK(orchard_uart_receive_channel(&a,ch,got,sizeof got)==1&&got[0]==bytes[2]);
  for(unsigned length=0;length<4;length++){
   wr(ch,0,length);wr(ch,32,255);CHECK(orchard_uart_receive_channel(&a,ch,got,sizeof got)==1);
   CHECK(got[0]==(uint8_t)((1u<<(length+5u))-1u));
  }
 }
}
static void loopback_and_ir(void){
 for(unsigned ch=0;ch<3;ch++){
  init();uint8_t got[20];wr(ch,0,0x43);wr(ch,4,0x725);
  wr(ch,32,0xc6);CHECK(rd(ch,16)==7&&rd(ch,36)==0xc6);
  CHECK(orchard_uart_receive_channel(&a,ch,got,sizeof got)==0);
  wr(ch,32,0x11);wr(ch,32,0x22);CHECK(rd(ch,20)==1&&rd(ch,20)==0);
  CHECK(rd(ch,36)==0x22);wr(ch,4,0x705);wr(ch,32,0xa7);
  CHECK(rd(ch,16)==6);CHECK(orchard_uart_receive_channel(&a,ch,got,sizeof got)==1&&got[0]==0xa7);
  /* Merely selecting IR never connects the transmitter back to its receiver. */
  tick(20);CHECK(rd(ch,16)==6&&rd(ch,36)==0);
 }
 /* Real decoded-byte peer: two independent machines exchange octets. */
 init();CHECK(orchard_init(&b,sizeof b,5)==&b);b.loaded=true;b.soc.wtcon=0;put(b.flash,0xeafffffe);
 wr(2,0,0x43);wr(2,4,0x705);
 CHECK(o_mmio_write(&b,base(2),4,0x43)&&o_mmio_write(&b,base(2)+4,4,0x705));
 uint8_t byte;for(unsigned n=0;n<256;n++){
  wr(2,32,n);CHECK(orchard_uart_receive_channel(&a,2,&byte,1)==1);
  CHECK(orchard_uart_send_channel(&b,2,&byte,1)==1);uint32_t value=999;
  CHECK(o_mmio_read(&b,base(2)+36,1,&value)&&value==n);
  CHECK(o_mmio_write(&b,base(2)+32,1,value^0xffu));CHECK(orchard_uart_receive_channel(&b,2,&byte,1)==1);
  CHECK(orchard_uart_send_channel(&a,2,&byte,1)==1);CHECK(rd(2,36)==(n^0xffu));
 }
}
static void fifo_and_irqs(void){
 for(unsigned ch=0;ch<3;ch++){
  init();wr(ch,0,3);wr(ch,4,0x305);wr(ch,8,7);CHECK(rd(ch,8)==1);
  uint8_t data[20];for(unsigned n=0;n<20;n++)data[n]=(uint8_t)(n*13u);
  CHECK(orchard_uart_send_channel(&a,ch,data,20)==20);tick(1);
  CHECK(rd(ch,24)==0x100);CHECK(a.soc.subsrcpnd&(1u<<(3u*ch)));
  for(unsigned n=0;n<20;n++)CHECK(rd(ch,36)==data[n]);CHECK(rd(ch,24)==0);
  CHECK(o_mmio_write(&a,0x4a000018u,4,7u<<(ch*3u)));tick(1);
  CHECK(a.soc.subsrcpnd==(2u<<(3u*ch)));
  wr(ch,4,5);CHECK(o_mmio_write(&a,0x4a000018u,4,0x7ff));tick(1);CHECK(a.soc.subsrcpnd==0);
  wr(ch,32,0xa4);tick(1);CHECK(a.soc.subsrcpnd==(2u<<(3u*ch)));
  CHECK(o_mmio_write(&a,0x4a000018u,4,0x7ff));tick(1);CHECK(a.soc.subsrcpnd==0);
  wr(ch,4,0x365);wr(ch,8,7);for(unsigned n=0;n<17;n++)wr(ch,32,n);
  tick(1);CHECK(rd(ch,24)==0x100);CHECK(a.soc.subsrcpnd&(4u<<(3u*ch)));
  CHECK(rd(ch,20)==1&&rd(ch,20)==0);for(unsigned n=0;n<16;n++)CHECK(rd(ch,36)==n);
  wr(ch,8,7);CHECK(rd(ch,8)==1&&rd(ch,24)==0);
 }
}
static void modem_and_flow(void){
 for(unsigned ch=0;ch<2;ch++){
  init();unsigned pin=ch?7u:0u,fn=ch?3u:2u;uint32_t mask=1u<<pin;uint8_t out;
  CHECK(o_mmio_write(&a,0x56000070u,4,fn<<(pin*2u)));
  CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_H,mask,mask)==ORCHARD_OK);
  CHECK(rd(ch,28)==0);CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_H,mask,0)==ORCHARD_OK);
  tick(1);CHECK(rd(ch,28)==17&&rd(ch,28)==1);
  wr(ch,0,3);wr(ch,4,5);wr(ch,12,16);wr(ch,32,0x42);
  CHECK(orchard_uart_receive_channel(&a,ch,&out,1)==1&&out==0x42);
  CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_H,mask,mask)==ORCHARD_OK);wr(ch,32,0x96);
  CHECK(rd(ch,16)==0&&orchard_uart_receive_channel(&a,ch,&out,1)==0);
  CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_H,mask,0)==ORCHARD_OK);tick(1);
  CHECK(orchard_uart_receive_channel(&a,ch,&out,1)==1&&out==0x96);
 }
}
static bool equal(const void *x,const void *y,size_t n){const uint8_t *p=x,*q=y;for(size_t i=0;i<n;i++)if(p[i]!=q[i])return false;return true;}
static void board_tx_net(void){
 init();CHECK(orchard_irda_attach(&a,true)==ORCHARD_BAD_ARGUMENT);
 CHECK(orchard_init(&a,sizeof a,5)==&a);a.loaded=true;a.soc.wtcon=0;put(a.flash,0xeafffffe);
 CHECK(orchard_irda_attach(&a,true)==ORCHARD_OK);
 CHECK(o_mmio_write(&a,0x56000040u,4,0x54555555u)); /* E12 input, other E pads output. */
 CHECK(o_mmio_write(&a,0x56000048u,4,0xffffu));
 CHECK(o_mmio_write(&a,0x56000070u,4,0x156555u)); /* H6 TXD2, other H pads output. */
 CHECK(o_mmio_write(&a,0x56000078u,4,0x7ffu));
 wr(2,0,0x43);wr(2,4,5);uint32_t value=999,known,levels,conflicts;
 CHECK(o_mmio_read(&a,0x56000044u,4,&value)&&value==0);
 wr(2,0,3);CHECK(o_mmio_read(&a,0x56000044u,4,&value)&&value==0x1000);
 CHECK(o_mmio_write(&a,0x56000070u,4,0x155555u)); /* GPIO H6 drives the same net. */
 CHECK(o_mmio_write(&a,0x56000074u,4,0x40u));
 CHECK(o_mmio_read(&a,0x56000044u,4,&value)&&value==0x1000);
 CHECK(o_mmio_write(&a,0x56000074u,4,0));
 CHECK(o_mmio_read(&a,0x56000044u,4,&value)&&value==0);
 CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_E,0x1000,0x1000)==ORCHARD_OK);
 o_gpio_sample(&a,ORCHARD_GPIO_E,&known,&levels,&conflicts);CHECK(conflicts&0x1000);
 o_gpio_sample(&a,ORCHARD_GPIO_H,&known,&levels,&conflicts);CHECK(conflicts&0x40);
 CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_E,0,0)==ORCHARD_OK);
 CHECK(o_mmio_write(&a,0x56000070u,4,0x154555u)); /* Both pads undriven inputs. */
 o_gpio_sample(&a,ORCHARD_GPIO_E,&known,&levels,&conflicts);CHECK(!(known&0x1000)&&!conflicts);
 CHECK(orchard_gpio_bias(&a,ORCHARD_GPIO_H,0x40,0x40)==ORCHARD_OK);
 o_gpio_sample(&a,ORCHARD_GPIO_E,&known,&levels,&conflicts);CHECK((known&levels&0x1000)&&!conflicts);
 CHECK(orchard_gpio_bias(&a,ORCHARD_GPIO_E,0x1000,0)==ORCHARD_OK);
 o_gpio_sample(&a,ORCHARD_GPIO_E,&known,&levels,&conflicts);CHECK(!(known&0x1000)&&!conflicts);
 CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_H,0x40,0)==ORCHARD_OK);
 o_gpio_sample(&a,ORCHARD_GPIO_E,&known,&levels,&conflicts);CHECK((known&0x1000)&&!(levels&0x1000)&&!conflicts);
 CHECK(orchard_irda_attach(&a,false)==ORCHARD_OK);
 CHECK(orchard_gpio_bias(&a,ORCHARD_GPIO_E,0,0)==ORCHARD_OK);
 o_gpio_sample(&a,ORCHARD_GPIO_E,&known,&levels,&conflicts);CHECK(!(known&0x1000)&&!conflicts);
 CHECK(orchard_irda_attach(&a,true)==ORCHARD_OK);o_copy(a.flash_base,a.flash,a.profile->flash_bytes);
 size_t n=orchard_checkpoint_size(&a);CHECK(n<=sizeof checkpoint);
 CHECK(orchard_checkpoint_save(&a,checkpoint,n)==ORCHARD_OK);
 CHECK(orchard_init(&b,sizeof b,5)==&b);
 CHECK(orchard_load_rom(&b,a.flash_base,a.profile->flash_bytes)==ORCHARD_OK);
 CHECK(orchard_checkpoint_load(&b,checkpoint,n)==ORCHARD_OK&&b.soc.irda_attached);
 CHECK(orchard_checkpoint_save(&b,continued,n)==ORCHARD_OK&&equal(checkpoint,continued,n));
}
static void unsupported_modes(void){
 for(unsigned ch=0;ch<3;ch++)for(unsigned mode=0;mode<4;mode++){
  init();wr(ch,0,3);wr(ch,4,5);if(mode==3)wr(ch,8,7);
  const uint32_t values[4]={0x15,6,9,0x85};
  CHECK(!o_mmio_write(&a,base(ch)+4,4,values[mode]));
  CHECK(a.stop.status==ORCHARD_UNIMPLEMENTED_MMIO&&a.stop.address==base(ch)+4);
  CHECK(a.soc.uart[ch][1]==5);
 }
}
static void checkpoint_stream(void){
 init();o_copy(a.flash_base,a.flash,a.profile->flash_bytes);
 uint8_t data[20],got[20],other[20];for(unsigned n=0;n<20;n++)data[n]=(uint8_t)(n*19u);
 for(unsigned ch=0;ch<3;ch++){
  wr(ch,0,0x43);wr(ch,4,0x305);wr(ch,8,7);
  CHECK(orchard_uart_send_channel(&a,ch,data,sizeof data)==sizeof data);
  CHECK(rd(ch,36)==data[0]&&rd(ch,36)==data[1]);
  wr(ch,32,0xa1+ch);wr(ch,32,0xb2+ch);
  CHECK(orchard_uart_receive_channel(&a,ch,got,1)==1&&got[0]==0xa1+ch);
  wr(ch,4,0x301);wr(ch,32,0xc3+ch);wr(ch,32,0xd4+ch);
  CHECK(a.soc.uart_state[ch].rx_count==16&&a.soc.uart_state[ch].tx_count==2);
 }
 /* Different ring heads, in-flight buffers and unopened host packets must
    survive both portable load and optimized/reference continuation. */
 size_t n=orchard_checkpoint_size(&a);CHECK(n<=sizeof checkpoint);
 CHECK(orchard_checkpoint_save(&a,checkpoint,n)==ORCHARD_OK);
 CHECK(orchard_init(&b,sizeof b,2)==&b);
 CHECK(orchard_load_rom(&b,a.flash_base,a.profile->flash_bytes)==ORCHARD_OK);
 CHECK(orchard_checkpoint_load(&b,checkpoint,n)==ORCHARD_OK);
 CHECK(equal(a.soc.uart_state,b.soc.uart_state,sizeof a.soc.uart_state));
 CHECK(equal(a.soc.uart_rx,b.soc.uart_rx,sizeof a.soc.uart_rx));
 CHECK(equal(a.soc.uart_tx,b.soc.uart_tx,sizeof a.soc.uart_tx));
 tick(500);CHECK(o_run_reference(&b,500).status==ORCHARD_OK);
 CHECK(orchard_checkpoint_save(&a,checkpoint,n)==ORCHARD_OK);
 CHECK(orchard_checkpoint_save(&b,continued,n)==ORCHARD_OK);CHECK(equal(checkpoint,continued,n));
 for(unsigned ch=0;ch<3;ch++){
  for(unsigned i=2;i<20;i++){
   uint32_t value=999;CHECK(rd(ch,36)==data[i]);
   CHECK(o_mmio_read(&b,base(ch)+36,4,&value)&&value==data[i]);
  }
  wr(ch,4,0x305);CHECK(o_mmio_write(&b,base(ch)+4,4,0x305));
  CHECK(orchard_uart_receive_channel(&a,ch,got,sizeof got)==3);
  CHECK(orchard_uart_receive_channel(&b,ch,other,sizeof other)==3);
  CHECK(equal(got,other,3)&&got[0]==0xb2+ch&&got[1]==0xc3+ch&&got[2]==0xd4+ch);
 }
 CHECK(orchard_checkpoint_load(&a,checkpoint,n)==ORCHARD_OK);
 CHECK(orchard_checkpoint_save(&a,continued,n)==ORCHARD_OK);CHECK(equal(checkpoint,continued,n));
}
EXPORT("regression") unsigned test(void){checks=failures=first=0;reset_and_isolation();modes_and_clock();loopback_and_ir();fifo_and_irqs();modem_and_flow();board_tx_net();unsupported_modes();checkpoint_stream();return failures;}
EXPORT("checks") unsigned count(void){return checks;}
EXPORT("first_failure") unsigned first_failure(void){return first;}
#ifndef __wasm__
int main(void){test();printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
