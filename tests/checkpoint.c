/* SPDX-License-Identifier: MIT */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(n)
#else
#define EXPORT(n) __attribute__((export_name(n)))
#endif
static orchard_machine a,b;
#define V6_FIELDS 4377u
static uint8_t original[600000+8200],expected[600000+8200],actual[600000+8200];
static unsigned checks,failures,first;
#define CHECK(x) do {++checks;if(!(x)){if(!failures)first=__LINE__;++failures;}}while(0)
static bool equal(const void *x,const void *y,size_t n){const uint8_t *a=x,*b=y;for(size_t i=0;i<n;i++)if(a[i]!=b[i])return false;return true;}
static uint32_t crc(const uint8_t *p,size_t n){uint32_t v=~0u;for(size_t i=0;i<n;i++){v^=p[i];for(unsigned j=0;j<8;j++)v=(v>>1)^((0u-(v&1u))&0xedb88320u);}return ~v;}
static void put(uint8_t *p,uint32_t v){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(8*i));}
static void init(unsigned model){
 CHECK(orchard_init(&a,sizeof a,model)==&a);a.loaded=true;put(a.flash,0xeafffffe);
 for(unsigned i=4;i<a.profile->flash_bytes;i++)a.flash[i]=(uint8_t)(i*17);
 o_copy(a.flash_base,a.flash,a.profile->flash_bytes);
 for(unsigned i=0;i<a.profile->ram_bytes;i++)a.ram[i]=(uint8_t)(i*13);
 for(unsigned i=0;i<O_BOOT_SRAM_SIZE;i++)a.boot_sram[i]=(uint8_t)(i*23);
 a.soc.wtcon=0;a.cpu.cpsr=O_SVC|O_F|O_I;
 for(unsigned i=0;i<15;i++)a.cpu.r[i]=i*0x1234567u;
 for(unsigned i=0;i<7;i++){a.cpu.fiq[i]=i*51;a.cpu.usr[i]=i*103;}
 a.cpu.bank[2][1]=0x98765432;a.cpu.spsr[0]=O_USR;
 a.soc.adc.con=0;a.soc.adc.remaining=175;a.soc.adc.sample=789;
 a.soc.adc.inputs[7]=887;a.soc.adc.known=128;
 a.soc.rx.head=1020;a.soc.rx.count=8;a.soc.rx.data[0]=199;
 a.soc.usb.ep[3].rx_count=17;a.soc.usb.ep[3].rx_pos=3;a.soc.usb.ep[3].rx[5]=244;
 a.soc.usb.ep[1].tx_count=63;a.soc.usb.ep[1].tx[12]=137;a.soc.usb.ep[1].tx_toggle=1;
 a.soc.rtc.phase=11734421;a.soc.rtc.divider=254;a.soc.rtc.reg[1]=0x81;
 a.soc.tcon=1;a.soc.count[0]=123;a.soc.tcntb[0]=456;
 a.soc.lcd_probe68_idle_zero=true;a.soc.lcd_probe68_reads=99;
 a.soc.lcd[19]=0x12210; /* Documented DITHMODE persists with the full LCD register file. */
 a.sram_alias_reads=77;a.sram_alias_writes=12;
}
static void export_to(uint8_t *p,size_t n){CHECK(orchard_checkpoint_save(&a,p,n)==ORCHARD_OK);}
static void legacy_pwm(void){
 init(5);a.soc.clock[1]=0x43012;a.soc.clock[4]=0;a.soc.clock[5]=3;
 a.soc.mpll_configured=1;a.soc.pclk_phase=7;
 a.soc.tcon=0x9000;a.soc.tcntb[2]=7;a.soc.tcmpb[2]=4;
 a.soc.count[2]=0;a.soc.phase[2]=1;a.soc.active_compare[2]=1;
 a.soc.pending_count[2]=5;a.soc.pending_compare[2]=2;a.soc.reload_pending=4;
 size_t n=orchard_checkpoint_size(&a),ram_offset=n-a.profile->ram_bytes-O_BOOT_SRAM_SIZE;
 export_to(original,n);
 for(unsigned version=1;version<=3;version++){
  size_t removed=V6_FIELDS+76+64+(version<3?709:0)+(version==1?52:0),legacy_n=n-removed;
  o_copy(actual,original,ram_offset-removed);
  o_copy(actual+ram_offset-removed,original+ram_offset,n-ram_offset);
  put(actual+8,version);put(actual+12,(uint32_t)legacy_n);
  put(actual+28,crc(actual+32,legacy_n-32));
  CHECK(orchard_checkpoint_load(&a,actual,legacy_n)==ORCHARD_OK);
  CHECK(a.soc.count[2]==0&&a.soc.phase[2]==1&&a.soc.tcntb[2]==7&&a.soc.tcmpb[2]==4);
  CHECK(a.soc.active_compare[2]==4&&!a.soc.reload_pending&&!a.soc.pending_count[2]&&!a.soc.pending_compare[2]);
  CHECK(!a.soc.pclk_phase&&a.soc.mpll_configured==1&&a.soc.clock[1]==0x43012&&a.soc.clock[5]==3);
  CHECK(equal(a.ram,original+ram_offset,a.profile->ram_bytes));
 }
 /* A legacy format cannot distinguish a reset MPLL word from software
    writing the same value. Migration explicitly chooses unconfigured. */
 a.soc.clock[1]=0x5c080;a.soc.mpll_configured=1;export_to(original,n);
 o_copy(actual,original,ram_offset-V6_FIELDS-140);o_copy(actual+ram_offset-V6_FIELDS-140,original+ram_offset,n-ram_offset);
 put(actual+8,3);put(actual+12,(uint32_t)n-V6_FIELDS-140);put(actual+28,crc(actual+32,n-V6_FIELDS-140-32));
 CHECK(orchard_checkpoint_load(&a,actual,n-V6_FIELDS-140)==ORCHARD_OK);
 CHECK(!a.soc.mpll_configured&&a.soc.clock[1]==0x5c080);
 /* v4 already represents the exact active PWM cycle and PLL history. Only
    new SPI/reset state is defaulted; do not apply the lossy v1-v3 migration. */
 init(5);a.soc.clock[1]=0x43012;a.soc.clock[5]=3;
 a.soc.mpll_configured=1;a.soc.pclk_phase=7;
 a.soc.tcon=0x9000;a.soc.tcntb[2]=7;a.soc.tcmpb[2]=4;
 a.soc.count[2]=0;a.soc.phase[2]=1;a.soc.active_compare[2]=1;
 a.soc.pending_count[2]=5;a.soc.pending_compare[2]=2;a.soc.reload_pending=4;
 export_to(original,n);
 o_copy(actual,original,ram_offset-V6_FIELDS-76);o_copy(actual+ram_offset-V6_FIELDS-76,original+ram_offset,n-ram_offset);
 put(actual+8,4);put(actual+12,(uint32_t)n-V6_FIELDS-76);put(actual+28,crc(actual+32,n-V6_FIELDS-76-32));
 a.soc.spi[0].status=0;a.soc.spi[0].remaining=1;a.soc.wtreset=77;
 CHECK(orchard_checkpoint_load(&a,actual,n-V6_FIELDS-76)==ORCHARD_OK);
 CHECK(a.soc.active_compare[2]==1&&a.soc.pending_count[2]==5&&a.soc.pending_compare[2]==2&&a.soc.reload_pending==4);
 CHECK(a.soc.pclk_phase==7&&a.soc.mpll_configured==1);
 CHECK(a.soc.spi[0].status==1&&a.soc.spi[0].pin==2&&!a.soc.spi[0].remaining&&!a.soc.wtreset);
 export_to(actual,n);CHECK(equal(original,actual,n));
}
EXPORT("regression") unsigned regression(void){
 checks=failures=first=0;
 CHECK(orchard_checkpoint_size(NULL)==0);
 for(unsigned id=1;id<=6;id++){
  init(id);size_t n=orchard_checkpoint_size(&a),ram_bytes=a.profile->ram_bytes;
  bool valid_size=n>ram_bytes+O_BOOT_SRAM_SIZE+52u+31u+1032u+8u&&n<sizeof original;
  CHECK(valid_size);
  if(!valid_size)return failures; /* Do not underflow the test's wire offsets. */
  export_to(original,n);
  CHECK(o_read_le(original+20,4)==crc(a.flash,a.profile->flash_bytes));
  CHECK(o_read_le(original+28,4)==crc(original+32,n-32));
  CHECK(orchard_checkpoint_save(&a,a.ram,n)==ORCHARD_BAD_ARGUMENT);
  CHECK(orchard_checkpoint_save(&a,actual,n-1)==ORCHARD_BAD_ARGUMENT);
  CHECK(orchard_checkpoint_load(&a,a.ram,n)==ORCHARD_BAD_ARGUMENT);
  /* Capture a conversion mid-flight, restore to a different arena and resume. */
  b=a;CHECK(orchard_run(&a,1000).status==ORCHARD_OK);export_to(expected,n);
  a=b;CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_OK);
  CHECK(a.translations[0].virtual_page==0);CHECK(!a.soc.eint_cache.valid);
  CHECK(orchard_run(&a,1000).status==ORCHARD_OK);export_to(actual,n);CHECK(equal(expected,actual,n));
  CHECK(orchard_checkpoint_load(&b,original,n)==ORCHARD_OK);
  CHECK(o_run_reference(&b,1000).status==ORCHARD_OK);
  CHECK(orchard_checkpoint_save(&b,actual,n)==ORCHARD_OK);CHECK(equal(expected,actual,n));
  /* Every rejection must preserve the current state, not partially restore. */
  for(unsigned i=0;i<32;i++){
   original[i]^=1;CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_BAD_ARGUMENT);original[i]^=1;
   export_to(actual,n);CHECK(equal(expected,actual,n));
  }
  original[n-1]^=1;CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_BAD_ARGUMENT);original[n-1]^=1;
  CHECK(orchard_checkpoint_load(&a,original,0)==ORCHARD_BAD_ARGUMENT);
  CHECK(orchard_checkpoint_load(&a,original,n+1)==ORCHARD_BAD_ARGUMENT);
  a.flash_base[777]^=1;CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_BAD_ARGUMENT);a.flash_base[777]^=1;
  /* Valid checksum but illegal CPU mode still fails. */
  uint32_t cpsr=o_read_le(original+96,4);put(original+96,0);put(original+28,crc(original+32,n-32));
  CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_BAD_ARGUMENT);
  put(original+96,cpsr);put(original+28,crc(original+32,n-32));
  export_to(actual,n);CHECK(equal(expected,actual,n));
  /* Noncanonical bool and out-of-range FIFO cursor, with repaired CRC. */
  original[256]=2;put(original+28,crc(original+32,n-32));
  CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_BAD_ARGUMENT);
  original[256]=0;
  size_t head=n-ram_bytes-O_BOOT_SRAM_SIZE-V6_FIELDS-76-64-709-52-31-1032-8;
  CHECK(o_read_le(original+head,4)==1020);
  put(original+head,0xffffffffu);put(original+28,crc(original+32,n-32));
  CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_BAD_ARGUMENT);
  put(original+head,1020);put(original+28,crc(original+32,n-32));
  export_to(actual,n);CHECK(equal(expected,actual,n));
  /* All legacy formats lack SPI/reset state; v1-v3 lack PCLK/PWM state,
     v1/v2 lack FIFO/media and v1 lacks SDI. Preserve every legacy byte. */
  export_to(original,n);
  size_t ram_offset=n-ram_bytes-O_BOOT_SRAM_SIZE;
  for(unsigned version=1;version<=5;version++){
   size_t removed=V6_FIELDS+(version<5?76:0)+(version<4?64:0)+(version<3?709:0)+(version==1?52:0),legacy_n=n-removed;
   o_copy(actual,original,ram_offset-removed);
   o_copy(actual+ram_offset-removed,original+ram_offset,n-ram_offset);
   put(actual+8,version);put(actual+12,(uint32_t)legacy_n);
   put(actual+28,crc(actual+32,legacy_n-32));
   a.soc.sdi.argument=0xdeadbeef;
   size_t needed=99;CHECK(orchard_checkpoint_sd_size(&a,actual,legacy_n,&needed)==ORCHARD_OK&&needed==0);
   CHECK(orchard_checkpoint_load(&a,actual,legacy_n)==ORCHARD_OK);
   CHECK(a.soc.sdi.argument==0 && a.soc.sdi.data_timer==0x2000);
   CHECK(a.soc.sdi.card_rca==1 && a.soc.sdi.card_block_size==512 && a.soc.sdi.card_bus_width==1);
   CHECK(a.soc.spi[0].status==1&&a.soc.spi[1].status==1&&a.soc.spi[0].pin==2&&a.soc.spi[1].pin==2&&!a.soc.wtreset);
   export_to(actual,n);CHECK(equal(original,actual,n));
  }
  /* Correct-CRC, invalid SD phase must be rejected atomically. */
  put(original+ram_offset-V6_FIELDS-76-64-709-4,3);put(original+28,crc(original+32,n-32));
  CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_BAD_ARGUMENT);
  export_to(original,n);CHECK(equal(original,actual,n));
  /* DMA remains unsupported. Repaired CRCs cannot bypass that restriction. */
  const uint32_t active_data_modes[]={0x8000,0x9001,0xa001,0xbfff};
  for(unsigned i=0;i<sizeof active_data_modes/sizeof active_data_modes[0];i++) {
   put(original+ram_offset-V6_FIELDS-76-64-709-52+7*4,active_data_modes[i]);
   put(original+28,crc(original+32,n-32));
   CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_BAD_ARGUMENT);
   export_to(original,n);CHECK(equal(original,actual,n));
  }
  const uint32_t bad_extension[][2]={{36,64},{40,65},{48,5},{52,1},{68,99},{72,0},{76,513},{80,3},{96,512}};
  for(unsigned i=0;i<sizeof bad_extension/sizeof bad_extension[0];i++) {
   put(original+ram_offset-V6_FIELDS-76-64-709+bad_extension[i][0],bad_extension[i][1]);
   put(original+28,crc(original+32,n-32));
   CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_BAD_ARGUMENT);
   export_to(original,n);CHECK(equal(original,actual,n));
  }
  /* STOP by force is a valid quiescent value even with mode/DMA bits retained. */
  CHECK(o_mmio_write(&a,0x5a00002c,4,0xf001));export_to(original,n);
  a.soc.sdi.data_control=0;
  CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_OK);
  export_to(actual,n);CHECK(equal(original,actual,n));
  /* A repaired CRC cannot inject an invalid PCLK fraction, over-wide PWM
     latch, unknown PLL history, or a pending reload before terminal count. */
  a.soc.count[0]=1;export_to(original,n);export_to(actual,n);
  const uint32_t bad_clock_pwm[][2]={{0,1},{4,2},{8,65536},{24,65536},{44,65536},{60,32},{60,1}};
  for(unsigned i=0;i<sizeof bad_clock_pwm/sizeof bad_clock_pwm[0];i++){
   put(original+ram_offset-V6_FIELDS-76-64+bad_clock_pwm[i][0],bad_clock_pwm[i][1]);
   put(original+28,crc(original+32,n-32));
   CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_BAD_ARGUMENT);
   export_to(original,n);CHECK(equal(original,actual,n));
  }
  /* Repaired CRC cannot introduce unsupported SPI modes, impossible partial
     clocks, over-wide bytes or an unbounded held-reset interval. */
  const uint32_t bad_spi[][2]={{0,0x40},{4,2},{4,0},{8,0},{12,256},{16,256},
      {20,256},{24,1},{28,1},{28,16},{32,1},{32,256},{72,129}};
  for(unsigned i=0;i<sizeof bad_spi/sizeof bad_spi[0];i++){
   put(original+ram_offset-V6_FIELDS-76+bad_spi[i][0],bad_spi[i][1]);
   put(original+28,crc(original+32,n-32));
   CHECK(orchard_checkpoint_load(&a,original,n)==ORCHARD_BAD_ARGUMENT);
   export_to(original,n);CHECK(equal(original,actual,n));
  }
 }
 legacy_pwm();
 return failures;
}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){regression();printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
