/* SPDX-License-Identifier: MIT
 * ROM-free S3C2410A SPI cases, with independent bit patterns and edge counts
 * from manual 22-3/4/7..10. No peripheral response or self-test PASS fixture. */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(n)
#else
#define EXPORT(n) __attribute__((export_name(n)))
#endif
static orchard_machine a,b;
static uint8_t saved[600000],left[600000],right[600000];
static unsigned checks,failures,first;
#define CHECK(x) do{++checks;if(!(x)){if(!failures)first=__LINE__;++failures;}}while(0)
static void put(uint8_t *p,uint32_t v){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(i*8u));}
static bool equal(const void *x,const void *y,size_t n){const uint8_t *p=x,*q=y;for(size_t i=0;i<n;i++)if(p[i]!=q[i])return false;return true;}
static uint32_t base(unsigned channel){return 0x59000000u+32u*channel;}
static void wr(unsigned ch,unsigned off,uint32_t value){CHECK(o_mmio_write(&a,base(ch)+off,4,value));}
static uint32_t rd(unsigned ch,unsigned off){uint32_t value=0;CHECK(o_mmio_read(&a,base(ch)+off,4,&value));return value;}
static void run(unsigned ticks){CHECK(orchard_run(&a,ticks).status==ORCHARD_OK);}
static void init(void){
 CHECK(orchard_init(&a,sizeof a,5)==&a);a.loaded=true;put(a.flash,0xeafffffeu);
 a.soc.wtcon=0;a.cpu.cpsr=O_SVC|O_F|O_I;
 CHECK(o_mmio_write(&a,0x56000040u,4,2u<<(11u*2u)));
 CHECK(o_mmio_write(&a,0x56000060u,4,3u<<(5u*2u)));
}
static void input(unsigned ch,bool high){
 CHECK(orchard_gpio_inputs(&a,ch?ORCHARD_GPIO_G:ORCHARD_GPIO_E,1u<<(ch?5u:11u),high?1u<<(ch?5u:11u):0)==ORCHARD_OK);
}
static void compare(unsigned ticks){
 CHECK(orchard_run(&a,ticks).status==ORCHARD_OK);CHECK(o_run_reference(&b,ticks).status==ORCHARD_OK);
 size_t n=orchard_checkpoint_size(&a);CHECK(n<=sizeof left);
 CHECK(orchard_checkpoint_save(&a,left,n)==ORCHARD_OK);CHECK(orchard_checkpoint_save(&b,right,n)==ORCHARD_OK);
 CHECK(equal(left,right,n));
}
static void reset_and_widths(void){
 init();const uint32_t expected[]={0,1,2,0,0,0};
 for(unsigned ch=0;ch<2;ch++)for(unsigned width=1;width<=4;width*=2)
  for(unsigned off=0;off<=20;off+=4){uint32_t value=99;CHECK(o_mmio_read(&a,base(ch)+off,width,&value));CHECK(value==expected[off/4]);}
 for(unsigned width=1;width<=4;width*=2){
  CHECK(o_mmio_write(&a,base(1)+12,width,0xa7));CHECK(rd(1,12)==0xa7);
  CHECK(rd(0,12)==0);CHECK(o_mmio_write(&a,base(1)+8,width,1));CHECK(rd(1,8)==3);
 }
 for(unsigned off=1;off<=31;off++)if((off&3u)||off>=24u){
  init();uint32_t value=0;CHECK(!o_mmio_read(&a,base(0)+off,1,&value));CHECK(a.stop.status==ORCHARD_UNIMPLEMENTED_MMIO);
 }
 for(unsigned off=4;off<=20;off+=16){init();CHECK(!o_mmio_write(&a,base(0)+off,4,0));}
}
static void formats_and_prescalers(void){
 const unsigned prescalers[]={0,1,7,255};
 for(unsigned ch=0;ch<2;ch++)for(unsigned format=0;format<4;format++)for(unsigned p=0;p<4;p++){
  init();wr(ch,12,prescalers[p]);wr(ch,0,0x18u|(format<<1));wr(ch,16,0xa5);
  CHECK(!(rd(ch,4)&1u));unsigned total=16u*(prescalers[p]+1u);
  uint64_t tick=a.ticks;for(unsigned i=0;i<20;i++)CHECK(!(rd(ch,4)&1u));CHECK(a.ticks==tick);
  run(total-1u);CHECK(!(rd(ch,4)&1u));run(1);CHECK(rd(ch,4)==1);
  CHECK(rd(ch,20)==255u);CHECK(rd(ch,16)==0xa5u);CHECK(!(a.soc.srcpnd&(1u<<(ch?29u:22u))));
 }
 /* Supply each input bit before its specified sample edge. The transmitted
    pattern deliberately differs; RX must never be an internal TX loopback. */
 for(unsigned ch=0;ch<2;ch++)for(unsigned format=0;format<4;format++){
  init();wr(ch,12,3);wr(ch,0,0x18u|(format<<1));wr(ch,16,0xa5);
  const unsigned pattern=0x96;
  for(unsigned bit=0;bit<8;bit++){
   input(ch,(pattern&(0x80u>>bit))!=0);run(!bit&&!(format&1u)?4u:8u);
  }
  if(!(format&1u)){CHECK(!(rd(ch,4)&1u));run(4);}
  CHECK(rd(ch,4)==1&&rd(ch,20)==pattern);
 }
}
static void collisions_auto_and_interrupts(void){
 init();wr(0,0,0x18);wr(0,16,0xa5);run(3);wr(0,16,0x42);
 CHECK(rd(0,16)==0xa5);CHECK(rd(0,20)==0);CHECK(rd(0,4)==4);CHECK(rd(0,4)==0);
 run(13);CHECK(rd(0,4)==1&&rd(0,20)==255);
 wr(0,0,0x19);CHECK(rd(0,20)==255);CHECK(rd(0,16)==255);CHECK(rd(0,4)==0);
 run(16);CHECK(rd(0,4)==1);CHECK(rd(0,20)==255);CHECK(rd(0,4)==0);
 for(unsigned ch=0;ch<2;ch++){
  init();wr(ch,0,0x38);wr(ch,16,9);run(15);CHECK(!(a.soc.srcpnd&(1u<<(ch?29u:22u))));
  run(1);CHECK(a.soc.srcpnd&(1u<<(ch?29u:22u)));
  CHECK(o_mmio_write(&a,0x4a000000u,4,1u<<(ch?29u:22u)));run(32);
  CHECK(!(a.soc.srcpnd&(1u<<(ch?29u:22u))));
 }
}
static void clock_gate_and_reset(void){
 init();uint32_t clock=a.soc.clock[3];CHECK(o_mmio_write(&a,0x4c00000cu,4,clock&~0x40000u));
 wr(0,0,0x18);wr(0,16,0);run(100);CHECK(a.soc.spi[0].half==0&&a.soc.spi[0].remaining==1);
 CHECK(o_mmio_write(&a,0x4c00000cu,4,clock));run(5);CHECK(a.soc.spi[0].half==5);
 wr(0,0,8);run(100);CHECK(a.soc.spi[0].half==5&&a.soc.spi[0].remaining==1);
 wr(0,0,0x18);run(10);CHECK(!(rd(0,4)&1u));run(1);CHECK(rd(0,4)==1);
 /* Reset cancels a partial byte; no completion/interrupt escapes afterwards. */
 wr(0,0,0x38);wr(0,16,0x66);run(7);orchard_reset(&a);a.soc.wtcon=0;
 CHECK(rd(0,4)==1&&rd(0,8)==2&&rd(0,20)==0);run(100);CHECK(!(a.soc.srcpnd&(1u<<22)));
 /* A slave with no external SCK receives no fictional byte. */
 init();wr(0,16,0x44);run(1000);CHECK(rd(0,4)==0&&a.soc.spi[0].half==0);
 /* The shared PCLK ratio, not CPU instruction count, clocks the transfer. */
 init();CHECK(o_mmio_write(&a,0x4c000014u,4,1));wr(0,12,3);wr(0,0,0x18);wr(0,16,0);
 run(127);CHECK(!(rd(0,4)&1u));run(1);CHECK(rd(0,4)==1);
 init();CHECK(o_mmio_write(&a,0x4c000014u,4,3));CHECK(o_mmio_write(&a,0x4c000004u,4,0x8000));
 wr(0,0,0x18);wr(0,16,0);run(7);CHECK(!(rd(0,4)&1u));run(1);CHECK(rd(0,4)==1);
}
static void unknown_and_unsupported(void){
 init();CHECK(o_mmio_write(&a,0x56000048u,4,1u<<11));wr(0,0,0x18);wr(0,16,0);
 CHECK(orchard_run(&a,1).status==ORCHARD_UNIMPLEMENTED_MMIO);
 CHECK(a.stop.address==base(0)+20&&a.soc.spi[0].rx==0&&!(a.soc.spi[0].status&1u));
 init();input(0,false);wr(0,0,0x18);wr(0,16,255);run(16);CHECK(rd(0,20)==0);
 /* Keyboard-connected pads use the same net resolver, including strong-drive
    conflicts; selecting SPI1 does not manufacture a separate disconnected net. */
 init();CHECK(orchard_keyboard_attach(&a,true)==ORCHARD_OK);input(1,false);
 CHECK(o_mmio_write(&a,0x56000060u,4,(3u<<10)|(1u<<16)));
 CHECK(o_mmio_write(&a,0x56000064u,4,1u<<8));CHECK(orchard_keyboard_matrix(&a,0,4,true)==ORCHARD_OK);
 wr(1,0,0x18);wr(1,16,0);
 CHECK(orchard_run(&a,1).status==ORCHARD_GPIO_CONTENTION);
 const uint32_t unsupported[]={0x40,0x60,0x80};
 for(unsigned i=0;i<3;i++){init();CHECK(!o_mmio_write(&a,base(0),4,unsupported[i]));CHECK(a.soc.spi[0].control==0);}
 init();CHECK(!o_mmio_write(&a,base(0)+8,4,6));CHECK(a.soc.spi[0].pin==2);
 init();wr(0,0,0x18);wr(0,16,0);run(3);o_spi old=a.soc.spi[0];
 CHECK(!o_mmio_write(&a,base(0)+12,4,8));CHECK(equal(&old,&a.soc.spi[0],sizeof old));
}
static void shared_input_direction(void){
 /* SPI1 MISO can affect a connected EINT pad even when GPIO mux, input
    level and the physical switch stay unchanged. Memoization must observe
    the direction change, including release of a low level source. */
 init();CHECK(orchard_keyboard_attach(&a,true)==ORCHARD_OK);input(1,false);
 CHECK(o_mmio_write(&a,0x56000060u,4,(3u<<10)|(2u<<16)));
 CHECK(orchard_keyboard_matrix(&a,0,4,true)==ORCHARD_OK);
 run(1);CHECK(!(a.soc.eint_known&(1u<<16)));
 wr(1,0,0x18);run(1);
 CHECK((a.soc.eint_known&(1u<<16))&&(a.soc.gpio[0xa8/4]&(1u<<16)));
 wr(1,0,0);CHECK(o_mmio_write(&a,0x560000a8u,4,1u<<16));run(1);
 CHECK(!(a.soc.eint_known&(1u<<16))&&!(a.soc.gpio[0xa8/4]&(1u<<16)));
}
static void checkpoint_and_scheduler(void){
 for(unsigned format=0;format<4;format++)for(unsigned phase=0;phase<19;phase++){
  init();wr(0,12,5);wr(0,0,0x18u|(format<<1));wr(0,16,0xa5);
  wr(1,12,8);wr(1,0,0x38u|(format<<1));wr(1,16,0x3c);run(phase);
  size_t n=orchard_checkpoint_size(&a);CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
  b=a;compare(1);compare(17);compare(151);
  CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);run(169);
  CHECK(orchard_checkpoint_save(&a,left,n)==ORCHARD_OK);CHECK(equal(left,right,n));
 }
}
EXPORT("regression") unsigned regression(void){checks=failures=first=0;reset_and_widths();formats_and_prescalers();collisions_auto_and_interrupts();clock_gate_and_reset();unknown_and_unsupported();shared_input_direction();checkpoint_and_scheduler();return failures;}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){regression();printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
