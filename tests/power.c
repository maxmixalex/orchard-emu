/* SPDX-License-Identifier: MIT
 * Independent generated suspend/wakeup cases. No firmware fixture is linked. */
#include "internal.h"
#include "orchard/clock.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(n)
#else
#define EXPORT(n) __attribute__((export_name(n)))
#endif
static orchard_machine a,b;
static uint8_t checkpoint[600000];
static uint8_t card[1048576];
static unsigned checks,failures,first;
#define CHECK(x) do{++checks;if(!(x)){++failures;if(!first)first=__LINE__;}}while(0)
static void word(uint8_t *p,uint32_t v){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(8u*i));}
static bool equal(const void *p,const void *q,size_t n){const uint8_t *x=p,*y=q;for(size_t i=0;i<n;i++)if(x[i]!=y[i])return false;return true;}
static void init(unsigned id){
 CHECK(orchard_init(&a,sizeof a,id)==&a);a.loaded=true;
 word(a.flash,0xeafffffe);word(a.flash+0x100,0xe5801000); /* STR r1,[r0] */
 word(a.flash+0x104,0xe2822001); /* Must not execute before reset. */
 a.cpu.r[15]=0x100;a.cpu.r[0]=0x4c00000c;a.cpu.r[1]=8;
 a.soc.wtcon=0;a.soc.tcon=9;a.soc.count[0]=23;a.soc.tcntb[0]=23;
 a.ram[19]=0x92;a.boot_sram[2]=0x73;
 CHECK(orchard_keyboard_attach(&a,true)==ORCHARD_OK);
 CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_D,3,2)==ORCHARD_OK);
 CHECK(orchard_gpio_bias(&a,ORCHARD_GPIO_G,0xf800,0xf800)==ORCHARD_OK);
 CHECK(orchard_adc_input(&a,7,true,512)==ORCHARD_OK);
 a.soc.gpio[0xb4/4]=0;a.soc.gpio[0xb8/4]=0x12345678;a.soc.gpio[0xbc/4]=0xabcdef01;
 a.soc.gpio[0x50/4]=2; a.soc.gpio[0x88/4]=4; /* ON rising-edge EINT0 */
 a.soc.usb.connected=true;
}
static void same(void){
 o_soc x=a.soc,y=b.soc;o_zero(&x.eint_cache,sizeof x.eint_cache);o_zero(&y.eint_cache,sizeof y.eint_cache);
 CHECK(equal(&x,&y,sizeof x));CHECK(equal(&a.cpu,&b.cpu,sizeof a.cpu));
 CHECK(equal(a.ram,b.ram,a.profile->ram_bytes));CHECK(a.ticks==b.ticks);
 CHECK(a.power_wake==0 && b.power_wake==0);
}
static void asleep(unsigned n){
 uint64_t instructions=a.cpu.instructions;
 uint32_t count=a.soc.count[0],phase=a.soc.phase[0],watchdog=a.soc.wtcnt;
 CHECK(orchard_run(&a,n).status==ORCHARD_OK);
 CHECK(a.cpu.sleeping && a.cpu.instructions==instructions && a.cpu.r[2]==0);
 CHECK(a.soc.count[0]==count && a.soc.phase[0]==phase && a.soc.wtcnt==watchdog);
 CHECK(a.soc.clock[3]==8 && a.ram[19]==0x92 && a.boot_sram[2]==0x73);
}
static void woke(uint32_t expected){
 CHECK(!a.cpu.sleeping && !(a.soc.clock[3]&8));
 CHECK(a.cpu.r[15]==0 && a.cpu.r[2]==0 && a.cpu.control==0x78);
 CHECK(a.soc.gpio[0xb4/4]==2 && a.soc.srcpnd==expected);
 CHECK(a.soc.gpio[0xb8/4]==0x12345678 && a.soc.gpio[0xbc/4]==0xabcdef01);
 CHECK(a.ram[19]==0x92 && !a.boot_sram[2]);
 CHECK(a.soc.gpio_input_known[3]==3 && a.soc.gpio_input_levels[3]==2);
 CHECK(a.soc.gpio_bias_known[6]==0xf800 && a.soc.adc.inputs[7]==512 && a.soc.adc.known==128);
 CHECK(a.soc.keyboard_attached && a.soc.usb.connected);
}
EXPORT("regression") unsigned regression(void){
 checks=failures=first=0;
 for(unsigned id=1;id<=6;id++){
  init(id);CHECK(orchard_run(&a,1).status==ORCHARD_OK);CHECK(a.cpu.instructions==1 && a.cpu.r[15]==0x104);
  asleep(12000000);CHECK(a.soc.rtc.reg[12]==1); /* Independent RTC still counts. */
  size_t n=orchard_checkpoint_size(&a);CHECK(n<sizeof checkpoint);
  CHECK(orchard_checkpoint_save(&a,checkpoint,n)==ORCHARD_OK);
  b=a;CHECK(orchard_checkpoint_load(&b,checkpoint,n)==ORCHARD_OK);
  CHECK(orchard_run(&a,97).status==ORCHARD_OK);CHECK(o_run_reference(&b,97).status==ORCHARD_OK);same();
  CHECK(orchard_keyboard_dedicated(&a,0,true)==ORCHARD_OK);
  CHECK(orchard_keyboard_dedicated(&b,0,true)==ORCHARD_OK);
  CHECK(orchard_run(&a,1).status==ORCHARD_OK);CHECK(o_run_reference(&b,1).status==ORCHARD_OK);same();woke(1);
  CHECK(a.soc.keyboard_direct==1 && a.soc.rtc.reg[12]==1);
  /* A sticky OFFRST flag is W1C and host cold reset remains destructive. */
  CHECK(o_mmio_write(&a,0x560000b4,4,2));CHECK(!a.soc.gpio[0xb4/4]);
  orchard_reset(&a);CHECK(!a.ram[19] && a.soc.rtc.reg[12]==0 && a.soc.gpio[0xb4/4]==1);
  /* A masked external source still wakes Power_OFF, without a pending bit.
     EINT15 is in the wake domain; its IRQ group and CPU masks are irrelevant. */
  for(unsigned masked=0;masked<2;masked++){
   init(id);a.soc.gpio[0x60/4]=2u<<14;a.soc.gpio[0x8c/4]=4u<<28;
   a.soc.gpio[0xa4/4]=masked?0xfffff0u:0xff7ff0u;
   CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_G,0x80,0)==ORCHARD_OK);
   CHECK(orchard_run(&a,20).status==ORCHARD_OK);asleep(1000);
   CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_G,0x80,0x80)==ORCHARD_OK);
   CHECK(orchard_run(&a,1).status==ORCHARD_OK);woke(0);
   CHECK(a.soc.gpio[0xa8/4]==(masked?0u:0x8000u));
  }
  /* EINT16 cannot wake the Power_OFF domain, even though it can wake IDLE. */
  init(id);a.soc.gpio[0x60/4]=2u<<16;a.soc.gpio[0x90/4]=4;
  CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_G,0x100,0)==ORCHARD_OK);
  CHECK(orchard_run(&a,20).status==ORCHARD_OK);
  CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_G,0x100,0x100)==ORCHARD_OK);asleep(1000);
  /* Calendar alarm wakes through the reset path without an RTC SRCPND bit. */
  init(id);CHECK(orchard_run(&a,1).status==ORCHARD_OK);
  a.soc.rtc.reg[4]=0x41;a.soc.rtc.reg[5]=1;
  a.soc.rtc.phase=12000000u-32768u;a.soc.rtc.divider=32767;
  CHECK(orchard_run(&a,1).status==ORCHARD_OK);woke(0);CHECK(a.soc.rtc.reg[12]==1);
  /* All remaining issue slots are suppressed after the writing instruction. */
  init(id);a.soc.clock[5]=3;a.cpu.control|=0xc0000000u;
  CHECK(orchard_run_clocked(&a,1).status==ORCHARD_OK);
  CHECK(a.cpu.sleeping && a.cpu.instructions==1 && a.cpu.r[15]==0x104 && a.cpu.r[2]==0);
  /* The SD image is an external, powered medium. Only the on-chip controller
     resets on an OFF wake: neither the bytes nor host protection/dirty flags
     may disappear with it. Exercise writable and read-only media. */
  if(id>=5)for(unsigned protected=0;protected<2;protected++){
   init(id);for(unsigned i=0;i<sizeof card;i++)card[i]=(uint8_t)(i*17u+3u);
   CHECK(orchard_sd_bind(&a,card,sizeof card)==ORCHARD_OK);
   CHECK(orchard_sd_insert(&a,sizeof card,protected!=0)==ORCHARD_OK);
   a.sd_dirty=true;a.soc.sdi.card_state=4;a.soc.sdi.card_rca=0x1234;
   a.soc.sdi.command=0x140;a.soc.sdi.remaining=25;a.soc.sdi.fifo_count=3;
   CHECK(orchard_run(&a,1).status==ORCHARD_OK);asleep(1000000);
   CHECK(orchard_keyboard_dedicated(&a,0,true)==ORCHARD_OK);
   CHECK(orchard_run(&a,1).status==ORCHARD_OK);woke(1);
   CHECK(a.sd_storage==card && a.sd_capacity==sizeof card && a.sd_bytes==sizeof card);
   CHECK(a.sd_write_protected==(protected!=0) && a.sd_dirty);
   CHECK(!a.soc.sdi.card_state && a.soc.sdi.card_rca==1 && !a.soc.sdi.command &&
         !a.soc.sdi.remaining && !a.soc.sdi.fifo_count);
   bool retained=true;for(unsigned i=0;i<sizeof card;i++)if(card[i]!=(uint8_t)(i*17u+3u))retained=false;
   CHECK(retained);
  }
 }
 return failures;
}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){regression();printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);return failures?1:0;}
#endif

