/* SPDX-License-Identifier: MIT
 * ROM-free reset-domain cases from S3C2410A manual 9-28, 17-1/5 and 18-1/3.
 * The synthetic reset vector executes guest instructions, never a host HOME
 * shortcut. Independent per-tick replay checks the complete checkpoint. */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(n)
#else
#define EXPORT(n) __attribute__((export_name(n)))
#endif
static orchard_machine a,b;
static uint8_t saved[600000],left[600000],right[600000],card[1048576];
static unsigned checks,failures,first;
#define CHECK(x) do{++checks;if(!(x)){if(!failures)first=__LINE__;++failures;}}while(0)
static void put(uint8_t *p,uint32_t v){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(i*8u));}
static bool equal(const void *x,const void *y,size_t n){const uint8_t *p=x,*q=y;for(size_t i=0;i<n;i++)if(p[i]!=q[i])return false;return true;}
static uint32_t crc(const uint8_t *p,size_t n){uint32_t v=~0u;for(size_t i=0;i<n;i++){v^=p[i];for(unsigned j=0;j<8;j++)v=(v>>1)^((0u-(v&1u))&0xedb88320u);}return ~v;}
static void init(unsigned model){
 CHECK(orchard_init(&a,sizeof a,model)==&a);a.loaded=true;
 put(a.flash,0xea00003eu); /* B 0x100; distinguish the reset vector from old PC. */
 put(a.flash+0x100,0xe3a0302au);put(a.flash+0x104,0xeafffffeu);
 put(a.flash+0x200,0xeafffffeu);a.cpu.r[15]=0x200;a.cpu.r[3]=0x99;
 a.soc.wtcon=0;
}
static void arm(uint32_t control){
 CHECK(o_mmio_write(&a,0x53000004u,4,3));
 CHECK(o_mmio_write(&a,0x53000008u,4,1));
 CHECK(o_mmio_write(&a,0x53000000u,4,control));
}
static void run(unsigned ticks){CHECK(orchard_run(&a,ticks).status==ORCHARD_OK);}
static void compare(unsigned ticks){
 CHECK(orchard_run(&a,ticks).status==ORCHARD_OK);CHECK(o_run_reference(&b,ticks).status==ORCHARD_OK);
 size_t n=orchard_checkpoint_size(&a);CHECK(n<=sizeof left);
 CHECK(orchard_checkpoint_save(&a,left,n)==ORCHARD_OK);CHECK(orchard_checkpoint_save(&b,right,n)==ORCHARD_OK);
 CHECK(equal(left,right,n));
}
static void vector_and_pulse(void){
 for(unsigned model=1;model<=6;model++)for(unsigned both=0;both<2;both++){
  init(model);a.soc.intmsk=~(1u<<9);a.cpu.cpsr&=~O_I;arm(both?0x25:0x21);
  run(15);CHECK(!a.soc.wtreset&&a.cpu.r[15]==0x200&&a.cpu.r[3]==0x99);
  uint64_t instructions=a.cpu.instructions,exceptions=a.cpu.exceptions;
  run(1);CHECK(a.soc.wtreset==128&&a.cpu.r[15]==0&&a.cpu.r[3]==0);
  CHECK(a.cpu.instructions==instructions&&a.cpu.exceptions==exceptions);
  CHECK(a.cpu.cpsr==(O_SVC|O_I|O_F)&&a.cpu.control==0x78);
  CHECK(a.soc.gpio[0xb4/4]==5&&a.soc.srcpnd==0&&a.soc.intpnd==0&&a.soc.intmsk==UINT32_MAX);
  CHECK(a.soc.wtcon==0x8021&&a.soc.wtcnt==0x8000&&a.soc.wtdat==0x8000&&!a.soc.wtphase);
  run(127);CHECK(a.soc.wtreset==1&&a.cpu.r[15]==0&&a.cpu.instructions==instructions);
  run(1);CHECK(!a.soc.wtreset&&a.cpu.r[15]==0x100&&a.cpu.instructions==instructions+1u);
  run(1);CHECK(a.cpu.r[3]==42&&a.cpu.r[15]==0x104&&a.ticks==145);
  CHECK(o_mmio_write(&a,0x560000b4u,4,4));CHECK(a.soc.gpio[0xb4/4]==1);
  CHECK(o_mmio_write(&a,0x560000b4u,4,1));CHECK(a.soc.gpio[0xb4/4]==0);
 }
 /* IRQ without RESET remains the normal interval timer and reloads WTDAT. */
 init(5);a.soc.intmsk=~(1u<<9);a.cpu.cpsr&=~O_I;arm(0x24);run(16);
 CHECK(!a.soc.wtreset&&a.soc.wtcnt==3&&(a.soc.srcpnd&(1u<<9)));
 CHECK(a.cpu.r[15]==0x18&&a.cpu.exceptions==1&&a.soc.gpio[0xb4/4]==1);
}
static void domains(void){
 init(5);a.ram[19]=0x92;a.boot_sram[2]=0x73;a.flash[512]=0x5a;
 a.soc.gpio[0xb4/4]=2;a.soc.gpio[0xb8/4]=0x12345678;a.soc.gpio[0xbc/4]=0xabcdef01;
 CHECK(orchard_keyboard_attach(&a,true)==ORCHARD_OK);
 CHECK(orchard_keyboard_matrix(&a,3,2,true)==ORCHARD_OK);
 CHECK(orchard_keyboard_dedicated(&a,0,true)==ORCHARD_OK);
 CHECK(orchard_gpio_inputs(&a,ORCHARD_GPIO_D,3,2)==ORCHARD_OK);
 CHECK(orchard_gpio_bias(&a,ORCHARD_GPIO_G,0xf800,0xf800)==ORCHARD_OK);
 CHECK(orchard_adc_input(&a,7,true,512)==ORCHARD_OK);
 CHECK(orchard_usb_connect(&a,true)==ORCHARD_OK);
 a.soc.usb.address=19;a.soc.usb.active_address=19;a.soc.usb.ep[1].tx_count=7;
 a.soc.spi[0].control=0x38;a.soc.spi[0].remaining=1;a.soc.spi[0].half=7;a.soc.spi[0].status=0;
 a.soc.tcon=0x9000;a.soc.count[2]=5;a.soc.active_compare[2]=3;a.soc.reload_pending=4;
 a.soc.rx.count=7;a.soc.tx.count=2;a.soc.adc.remaining=11;a.soc.lcd[0]=1;
 a.soc.rtc.reg[0]=1;a.soc.rtc.reg[1]=0x91;a.soc.rtc.reg[4]=0x41;
 a.soc.rtc.reg[5]=0x37;a.soc.rtc.reg[12]=0x36;a.soc.rtc.reg[13]=0x28;
 a.soc.rtc.reg[14]=0x17;a.soc.rtc.reg[15]=0x29;a.soc.rtc.reg[17]=2;a.soc.rtc.reg[18]=0x24;
 a.soc.rtc.phase=1234;a.soc.rtc.divider=32767;a.soc.rtc.tick_count=5;
 o_rtc oldrtc=a.soc.rtc;
 a.nor_sequence=1;a.nor_id_mode=true;
 a.cpu.control=0xc0001079u;a.cpu.ttb=0x08004000;a.cpu.domain=3;
 a.translations[0].virtual_page=0x1234;a.sram_alias_reads=7;a.sram_alias_writes=9;
 for(unsigned i=0;i<sizeof card;i++)card[i]=(uint8_t)(i*17u+3u);
 CHECK(orchard_sd_bind(&a,card,sizeof card)==ORCHARD_OK);CHECK(orchard_sd_insert(&a,sizeof card,true)==ORCHARD_OK);
 a.sd_dirty=true;a.soc.sdi.card_state=4;a.soc.sdi.remaining=7;a.soc.sdi.command=0x140;
 CHECK(orchard_buzzer_enable(&a,true)==ORCHARD_OK);uint32_t epoch=a.buzzer.epoch;
 arm(0x25);a.soc.wtphase=15;o_watchdog_tick(&a);
 CHECK(a.stop.status==ORCHARD_OK&&a.soc.wtreset==128);
 CHECK(a.ram[19]==0x92&&a.boot_sram[2]==0x73&&a.flash[512]==0x5a);
 CHECK(a.soc.gpio[0xb4/4]==6&&!a.soc.gpio[0xb8/4]&&!a.soc.gpio[0xbc/4]);
 CHECK(a.soc.gpio_input_known[3]==3&&a.soc.gpio_input_levels[3]==2);
 CHECK(a.soc.gpio_bias_known[6]==0xf800&&a.soc.gpio_bias_levels[6]==0xf800);
 CHECK(a.soc.keyboard_attached&&a.soc.keyboard_switches==(UINT64_C(1)<<(3u*7u+2u))&&a.soc.keyboard_direct==1);
 CHECK(a.soc.adc.known==128&&a.soc.adc.inputs[7]==512&&!a.soc.adc.remaining);
 CHECK(a.soc.usb.connected&&!a.soc.usb.address&&!a.soc.usb.active_address&&!a.soc.usb.ep[1].tx_count);
 CHECK(a.soc.spi[0].status==1&&!a.soc.spi[0].remaining&&!a.soc.spi[0].half&&!a.soc.spi[0].control);
 CHECK(!a.soc.tcon&&!a.soc.count[2]&&!a.soc.reload_pending&&!a.soc.lcd[0]&&!a.soc.rx.count&&!a.soc.tx.count);
 CHECK(!a.cpu.ttb&&!a.cpu.domain&&a.cpu.control==0x78&&!a.translations[0].virtual_page);
 CHECK(a.sram_alias_reads==7&&a.sram_alias_writes==9&&a.nor_sequence==1&&a.nor_id_mode);
 CHECK(equal(a.soc.rtc.reg+12,oldrtc.reg+12,7)&&a.soc.rtc.phase==oldrtc.phase&&a.soc.rtc.divider==oldrtc.divider);
 CHECK(!a.soc.rtc.reg[0]&&!a.soc.rtc.reg[1]&&!a.soc.rtc.reg[4]&&!a.soc.rtc.tick_count);
 CHECK(a.buzzer.enabled&&a.buzzer.epoch!=epoch&&a.buzzer.count==1&&!a.buzzer.edges[0].level);
 CHECK(a.sd_storage==card&&a.sd_bytes==sizeof card&&a.sd_write_protected&&a.sd_dirty);
 CHECK(!a.soc.sdi.card_state&&!a.soc.sdi.remaining&&!a.soc.sdi.command);
 bool retained=true;for(unsigned i=0;i<sizeof card;i++)if(card[i]!=(uint8_t)(i*17u+3u))retained=false;CHECK(retained);
 /* Oscillator phase advances while CPU and non-retained peripherals are held. */
 a.soc.rtc.phase=O_FUNCTIONAL_TIMEBASE_HZ-32768u;
 o_soc_tick(&a);CHECK(a.soc.rtc.reg[12]==0x37&&a.soc.rtc.divider==0&&a.soc.wtreset==127);
 CHECK(!a.soc.srcpnd&&!a.soc.wtphase);
}
static void enable_and_clocks(void){
 init(5);arm(1);run(10000);CHECK(a.soc.wtcnt==1&&!a.soc.wtreset&&a.soc.gpio[0xb4/4]==1);
 /* There is no CLKCON bit for WDT. Gating every optional peripheral does
    not stop it; Power_OFF does stop the entire non-retained PCLK domain. */
 init(5);CHECK(o_mmio_write(&a,0x4c00000cu,4,0));arm(0x21);run(16);CHECK(a.soc.wtreset==128);
 init(5);arm(0x21);a.soc.clock[3]=8;run(1000);CHECK(!a.soc.wtreset&&a.soc.wtcnt==1&&!a.soc.wtphase);
 init(5);CHECK(o_mmio_write(&a,0x4c000010u,4,0x11));arm(0x21);
 run(31);CHECK(!a.soc.wtreset);run(1);CHECK(a.soc.wtreset==128&&!a.soc.pclk_phase&&!a.soc.mpll_configured);
 init(5);CHECK(o_mmio_write(&a,0x4c000014u,4,3));CHECK(o_mmio_write(&a,0x4c000004u,4,0x8000));arm(0x21);
 run(7);CHECK(!a.soc.wtreset);run(1);CHECK(a.soc.wtreset==128&&a.soc.clock[5]==0);
 run(127);CHECK(a.soc.wtreset==1);run(1);CHECK(!a.soc.wtreset&&a.cpu.r[15]==0x100);
 /* A host cold reset cancels a held WDT pulse and uses its existing domains. */
 init(5);arm(0x21);run(16);a.ram[9]=3;orchard_reset(&a);
 CHECK(!a.soc.wtreset&&!a.ram[9]&&a.soc.gpio[0xb4/4]==1);run(1);CHECK(a.cpu.r[15]==0x100);
}
static void checkpoint_and_scheduler(void){
 const unsigned phases[]={1,2,63,127,128};
 for(unsigned i=0;i<sizeof phases/sizeof phases[0];i++){
  init(5);arm(0x25);run(16);run(128u-phases[i]);
  size_t n=orchard_checkpoint_size(&a);CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
  b=a;compare(0);compare(1);compare(13);compare(117);compare(15);
  CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);run(146);
  CHECK(orchard_checkpoint_save(&a,left,n)==ORCHARD_OK);CHECK(equal(left,right,n));
 }
 /* Old live snapshots retain a partly elapsed WDT timer. New execution
    continues through the real reset; a saved historical status14 diagnostic
    stays stopped, rather than silently changing its checkpoint meaning. */
 for(unsigned version=1;version<=4;version++)for(unsigned stopped=0;stopped<2;stopped++){
  init(5);arm(0x21);run(15);
  if(stopped)o_stop(&a,ORCHARD_UNIMPLEMENTED_RESET,0x53000000u,0x21);
  size_t n=orchard_checkpoint_size(&a),ram=n-a.profile->ram_bytes-O_BOOT_SRAM_SIZE;
  CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
  size_t remove=76+(version<4?64:0)+(version<3?709:0)+(version==1?52:0),oldn=n-remove;
  o_copy(left,saved,ram-remove);o_copy(left+ram-remove,saved+ram,n-ram);
  put(left+8,version);put(left+12,(uint32_t)oldn);put(left+28,crc(left+32,oldn-32));
  CHECK(orchard_checkpoint_load(&a,left,oldn)==ORCHARD_OK);
  if(stopped){uint64_t ticks=a.ticks;CHECK(orchard_run(&a,500).status==ORCHARD_UNIMPLEMENTED_RESET);CHECK(a.ticks==ticks&&!a.soc.wtreset);}
  else{run(1);CHECK(a.soc.wtreset==128&&a.cpu.r[15]==0);run(129);CHECK(a.cpu.r[3]==42);}
 }
}
EXPORT("regression") unsigned regression(void){checks=failures=first=0;vector_and_pulse();domains();enable_and_clocks();checkpoint_and_scheduler();return failures;}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){regression();printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
