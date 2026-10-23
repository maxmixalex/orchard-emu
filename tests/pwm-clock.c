/* SPDX-License-Identifier: MIT
 * Generated, ROM-free clock/PWM cases. Constants come from the S3C2410A
 * clock ratios and timer sequence in manual 7-4/8/11/22 and 10-6, rather
 * than a second implementation of the core's clock or timer algorithms.
 * Zero-count and TCFG mid-phase cases explicitly cover functional policy. */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(n)
#else
#define EXPORT(n) __attribute__((export_name(n)))
#endif

static orchard_machine a,b;
static uint8_t before[600000],after[600000],expected[600000];
static orchard_buzzer_edge edges[64];
static unsigned checks,failures,first;
#define CHECK(x) do{++checks;if(!(x)){if(!failures)first=__LINE__;++failures;}}while(0)
static bool equal(const void *x,const void *y,size_t n){const uint8_t *p=x,*q=y;for(size_t i=0;i<n;i++)if(p[i]!=q[i])return false;return true;}
static uint32_t word(const uint8_t *p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static void put(uint8_t *p,uint32_t v){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(i*8u));}
static void wr(orchard_machine *m,uint32_t address,uint32_t value){CHECK(o_mmio_write(m,address,4,value));}
static void step(unsigned ticks){CHECK(orchard_run(&a,ticks).status==ORCHARD_OK);}
static void init(unsigned model){
 CHECK(orchard_init(&a,sizeof a,model)==&a);a.loaded=true;put(a.flash,0xeafffffeu);
 a.soc.wtcon=0;a.cpu.cpsr=O_SVC|O_I|O_F;
}
static unsigned shift(unsigned ch){return ch?4u*ch+4u:0;}
static uint32_t count_address(unsigned ch){return 0x5100000cu+12u*ch;}
static void timer(orchard_machine *m,unsigned ch,unsigned count,unsigned compare,bool reload){
 unsigned s=shift(ch);uint32_t others=m->soc.tcon&~((ch==4?7u:15u)<<s);
 wr(m,count_address(ch),count);if(ch<4)wr(m,count_address(ch)+4u,compare);
 wr(m,0x51000008u,others|(2u<<s));
 wr(m,0x51000008u,others|(1u<<s)|(reload?(1u<<(s+(ch==4?2u:3u))):0u));
}
static void pll(orchard_machine *m,uint32_t value,uint32_t slow,uint32_t div){
 wr(m,0x4c000014u,div);wr(m,0x4c000010u,slow);wr(m,0x4c000004u,value);
}
static void irq_clear(orchard_machine *m,unsigned ch){wr(m,0x4a000000u,1u<<(10u+ch));}
static bool irq(unsigned ch){return (a.soc.srcpnd&(1u<<(10u+ch)))!=0;}
static void sound(void){CHECK(orchard_buzzer_enable(&a,true)==ORCHARD_OK);wr(&a,0x56000010u,0x20u);(void)orchard_buzzer_read(&a,edges,64);}
static void state_equal(void){
 size_t n=orchard_checkpoint_size(&a);CHECK(n<=sizeof after&&n==orchard_checkpoint_size(&b));
 CHECK(orchard_checkpoint_save(&a,after,n)==ORCHARD_OK);
 CHECK(orchard_checkpoint_save(&b,expected,n)==ORCHARD_OK);CHECK(equal(after,expected,n));
 CHECK(a.quiet_left==0&&a.deferred_ticks==0&&b.quiet_left==0&&b.deferred_ticks==0);
}

static void ratio_cases(void){
 static const struct {uint32_t mpll,configured,slow,div,num,den,ticks,edges;} cases[]={
  {0x5c080,0,4,0,1,1,16,16}, {0x5c080,1,4,0,10,1,16,160},
  {0x43012,1,0,0,25,4,16,100}, {0x43012,1,0,1,25,8,16,50},
  {0x43012,1,0,2,25,8,16,50}, {0x43012,1,0,3,25,16,16,25},
  {0x43012,1,0,4,25,16,16,25}, {0x43012,1,0x30,3,1,4,16,4},
  {0x43012,1,0x33,3,1,24,24,1}, {0xff000,1,0,0,263,2,2,263}
 };
 for(unsigned model=1;model<=6;model++)for(unsigned i=0;i<sizeof cases/sizeof *cases;i++){
  init(model);CHECK(a.soc.clock[4]==4&&a.soc.clock[5]==0&&!a.soc.mpll_configured);
  wr(&a,0x4c000014u,cases[i].div);wr(&a,0x4c000010u,cases[i].slow);
  if(cases[i].configured)wr(&a,0x4c000004u,cases[i].mpll);
  CHECK(a.soc.mpll_configured==cases[i].configured);
  uint32_t num=0,den=0;CHECK(o_pclk_ratio(&a.soc,&num,&den));
  CHECK(num==cases[i].num&&den==cases[i].den);
  CHECK(o_pclk_advance(&a.soc,cases[i].ticks)==cases[i].edges);CHECK(!a.soc.pclk_phase);
 }
 init(5);pll(&a,0x43012,0,3);
 static const uint32_t edge_counts[]={1,2,1,2,1,2},phases[]={9,2,11,4,13,6};
 for(unsigned i=0;i<6;i++){CHECK(o_pclk_advance(&a.soc,1)==edge_counts[i]);CHECK(a.soc.pclk_phase==phases[i]);}
 /* Reserved sources fail before inventing peripheral progress. */
 init(5);wr(&a,0x4c000014u,5);CHECK(orchard_run(&a,1).status==ORCHARD_UNIMPLEMENTED_MMIO);
 CHECK(a.stop.address==0x4c000014u&&!a.soc.pclk_phase);
 init(5);pll(&a,0x43012,0x20,3);CHECK(orchard_run(&a,1).status==ORCHARD_UNIMPLEMENTED_MMIO);
 CHECK(a.stop.address==0x4c000010u&&!a.soc.pclk_phase);
}

static void gate_and_transition(void){
 init(5);pll(&a,0x43012,0,3);wr(&a,0x51000004u,1u<<8);timer(&a,2,5,2,true);sound();
 step(1);CHECK(a.soc.pclk_phase==9&&a.soc.phase[2]==1&&a.soc.count[2]==5);
 wr(&a,0x4c00000cu,a.soc.clock[3]&~0x100u);step(3);
 CHECK(a.soc.pclk_phase==4&&a.soc.phase[2]==1&&a.soc.count[2]==5&&!a.buzzer.level);
 wr(&a,0x4c00000cu,a.soc.clock[3]|0x100u);step(1);
 CHECK(a.soc.pclk_phase==13&&a.soc.phase[2]==2&&a.soc.count[2]==5);
 step(1);CHECK(a.soc.pclk_phase==6&&!a.soc.phase[2]&&a.soc.count[2]==4);
 /* Register changes retain the specified quantized fractional progress. */
 init(5);pll(&a,0x43012,0,3);step(1);CHECK(a.soc.pclk_phase==9);
 wr(&a,0x4c000010u,0x30);CHECK(a.soc.pclk_phase==2);step(1);CHECK(a.soc.pclk_phase==3);
 b=a;step(1);CHECK(a.soc.pclk_phase==0);
 a=b;wr(&a,0x4c000010u,0);CHECK(a.soc.pclk_phase==12);step(1);CHECK(a.soc.pclk_phase==5);
 /* The retained per-channel TCFG phase is a functional policy. A smaller
    new divisor must not replay seven hypothetical ticks in one PCLK. */
 for(unsigned ch=0;ch<5;ch++){
  init(5);wr(&a,0x51000004u,3u<<(ch*4u));timer(&a,ch,10,4,true);step(13);
  CHECK(a.soc.phase[ch]==13&&a.soc.count[ch]==10);
  wr(&a,0x51000004u,0);step(1);CHECK(!a.soc.phase[ch]&&a.soc.count[ch]==9);
  step(1);CHECK(a.soc.phase[ch]==1&&a.soc.count[ch]==9);
  step(1);CHECK(!a.soc.phase[ch]&&a.soc.count[ch]==8);
 }
}

static void buffer_cases(void){
 for(unsigned ch=0;ch<5;ch++)for(unsigned disable=0;disable<2;disable++){
  init(5);timer(&a,ch,3,1,true);wr(&a,count_address(ch),5);
  if(ch<4)wr(&a,count_address(ch)+4u,2);
  step(2);CHECK(a.soc.count[ch]==2&&!irq(ch));
  step(2);CHECK(a.soc.count[ch]==1&&!irq(ch));
  step(2);CHECK(a.soc.count[ch]==0&&irq(ch)&&(a.soc.reload_pending&(1u<<ch)));
  CHECK(a.soc.pending_count[ch]==5);if(ch<4)CHECK(a.soc.active_compare[ch]==1&&a.soc.pending_compare[ch]==2);
  irq_clear(&a,ch);wr(&a,count_address(ch),7);if(ch<4)wr(&a,count_address(ch)+4u,4);
  if(disable)wr(&a,0x51000008u,a.soc.tcon&~(1u<<(shift(ch)+(ch==4?2u:3u))));
  step(2);CHECK(a.soc.count[ch]==5&&!irq(ch)&&!(a.soc.reload_pending&(1u<<ch)));
  if(ch<4)CHECK(a.soc.active_compare[ch]==2);
  step(6);CHECK(a.soc.count[ch]==2&&!irq(ch));if(ch<4)CHECK(a.soc.active_compare[ch]==2);
  step(4);CHECK(!a.soc.count[ch]&&irq(ch));irq_clear(&a,ch);
  if(disable){CHECK(!(a.soc.tcon&(1u<<shift(ch))));step(101);CHECK(!irq(ch)&&!a.soc.count[ch]);}
  else{
   CHECK((a.soc.reload_pending&(1u<<ch))&&a.soc.pending_count[ch]==7);
   if(ch<4)CHECK(a.soc.pending_compare[ch]==4);
   step(2);CHECK(a.soc.count[ch]==7&&!irq(ch));if(ch<4)CHECK(a.soc.active_compare[ch]==4);
  }
 }
 /* A manual update overrides an already captured reload, even while stopped. */
 init(5);timer(&a,2,1,0,true);wr(&a,0x51000024u,5);wr(&a,0x51000028u,2);step(2);
 CHECK(a.soc.reload_pending==4);wr(&a,0x51000024u,9);wr(&a,0x51000028u,4);wr(&a,0x51000008u,0x2000);
 CHECK(!a.soc.reload_pending&&a.soc.count[2]==9&&a.soc.active_compare[2]==4&&!a.soc.phase[2]);
 wr(&a,0x51000008u,0x9000);step(2);CHECK(a.soc.count[2]==8);
}

static void short_counts(void){
 for(unsigned ch=0;ch<5;ch++){
  init(5);timer(&a,ch,1,0,true);step(2);CHECK(!a.soc.count[ch]&&irq(ch));irq_clear(&a,ch);
  step(1);CHECK(!a.soc.count[ch]&&!irq(ch));step(1);CHECK(a.soc.count[ch]==1&&!irq(ch));
  step(2);CHECK(!a.soc.count[ch]&&irq(ch));
  /* N=0 is a bounded functional extension: one terminal event per timer
     edge, no zero-time loop. No physical zero-count witness is claimed. */
  init(5);timer(&a,ch,0,0,true);if(ch==2){sound();CHECK(a.buzzer.level);}
  step(1);CHECK(!irq(ch));step(1);CHECK(irq(ch)&&(a.soc.reload_pending&(1u<<ch)));irq_clear(&a,ch);
  step(2);CHECK(irq(ch)&&!a.soc.count[ch]);irq_clear(&a,ch);
  if(ch==2){wr(&a,0x51000008u,a.soc.tcon|0x4000u);CHECK(!a.buzzer.level);}
  wr(&a,0x51000008u,a.soc.tcon&~(1u<<(shift(ch)+(ch==4?2u:3u))));
  step(2);CHECK(irq(ch)&&!(a.soc.tcon&(1u<<shift(ch))));irq_clear(&a,ch);step(101);CHECK(!irq(ch));
 }
}

static void shared_setup(void){
 init(5);wr(&a,0x5a00000cu,0x140);step(76);CHECK(a.soc.sdi.remaining==20);
 CHECK(orchard_adc_input(&a,0,true,613)==ORCHARD_OK);wr(&a,0x58000000u,0x40c1);CHECK(a.soc.adc.remaining==20);
 wr(&a,0x53000004u,7);wr(&a,0x53000008u,2);wr(&a,0x53000000u,0x24);
 wr(&a,0x51000004u,0x33333);for(unsigned ch=0;ch<5;ch++)timer(&a,ch,10,4,true);
 wr(&a,0x4d000000u,0x221);pll(&a,0x43012,0,3);
}
static void shared_domain(void){
 shared_setup();uint32_t rtc=a.soc.rtc.phase;step(10);
 CHECK(a.soc.adc.remaining==5&&a.soc.sdi.remaining==5&&a.soc.wtphase==15&&a.soc.wtcnt==2);
 for(unsigned ch=0;ch<5;ch++)CHECK(a.soc.phase[ch]==15&&a.soc.count[ch]==10);
 step(1);CHECK(a.soc.adc.remaining==3&&a.soc.sdi.remaining==3&&a.soc.wtphase==1&&a.soc.wtcnt==1);
 for(unsigned ch=0;ch<5;ch++)CHECK(a.soc.phase[ch]==1&&a.soc.count[ch]==9);
 step(1);CHECK(a.soc.adc.remaining==2&&a.soc.sdi.remaining==2);
 step(1);CHECK(!a.soc.adc.remaining&&a.soc.adc.data==613&&(a.soc.subsrcpnd&(1u<<10)));
 CHECK(!a.soc.sdi.remaining&&(a.soc.sdi.status&0x800u)&&a.soc.wtphase==4);
 CHECK(a.soc.rtc.phase==rtc+425984u&&a.soc.lcd_phase==13&&a.soc.pclk_phase==5);
 /* ADC, SDI and PWM gates do not gate WDT or the reference RTC/LCD. */
 shared_setup();rtc=a.soc.rtc.phase;wr(&a,0x4c00000cu,a.soc.clock[3]&~0x8300u);step(11);
 CHECK(a.soc.adc.remaining==20&&a.soc.sdi.remaining==20&&a.soc.wtphase==1&&a.soc.wtcnt==1);
 for(unsigned ch=0;ch<5;ch++)CHECK(!a.soc.phase[ch]&&a.soc.count[ch]==10);
 wr(&a,0x4c00000cu,a.soc.clock[3]|0x8300u);step(13);
 CHECK(!a.soc.adc.remaining&&!a.soc.sdi.remaining&&a.soc.pclk_phase==8);
 for(unsigned ch=0;ch<5;ch++)CHECK(a.soc.phase[ch]==4&&a.soc.count[ch]==9);
 CHECK(a.soc.rtc.phase==rtc+786432u&&a.soc.lcd_phase==24);
 /* A single quantum must deliver all 131 or 132 edges, not one tick. */
 init(5);for(unsigned ch=0;ch<5;ch++)timer(&a,ch,1000,400,true);
 wr(&a,0x53000008u,1000);wr(&a,0x53000000u,0x24);
 CHECK(orchard_adc_input(&a,0,true,617)==ORCHARD_OK);wr(&a,0x58000000u,0x7fc1);
 wr(&a,0x5a000004u,7);wr(&a,0x5a00000cu,0x140);pll(&a,0xff000,0,0);
 step(1);CHECK(a.soc.pclk_phase==1&&a.soc.wtcnt==992&&a.soc.wtphase==3);
 CHECK(a.soc.adc.remaining==1149&&a.soc.sdi.remaining==637);
 for(unsigned ch=0;ch<5;ch++)CHECK(a.soc.count[ch]==935&&a.soc.phase[ch]==1);
 step(1);CHECK(!a.soc.pclk_phase&&a.soc.wtcnt==984&&a.soc.wtphase==7);
 CHECK(a.soc.adc.remaining==1017&&a.soc.sdi.remaining==505);
 for(unsigned ch=0;ch<5;ch++)CHECK(a.soc.count[ch]==869&&a.soc.phase[ch]==1);
}

static void beep_period(void){
 init(5);pll(&a,0x43012,0,3);wr(&a,0x51000000u,44u<<8);wr(&a,0x51000004u,3u<<8);
 timer(&a,2,59,29,true);sound();step(100000);
 size_t n=orchard_buzzer_read(&a,edges,64);CHECK(n==7);
 if(n==7){
  CHECK(edges[0].tick==13824&&edges[0].level==1);
  for(unsigned i=1;i<7;i++)CHECK(edges[i].tick-edges[i-1].tick==13824&&edges[i].level==(i%2==0));
  CHECK(edges[2].tick-edges[0].tick==27648);
 }
}

static void repair_crc(uint8_t *p,size_t n){
 uint32_t crc=UINT32_MAX;for(size_t i=32;i<n;i++){crc^=p[i];for(unsigned bit=0;bit<8;bit++)crc=(crc>>1)^((0u-(crc&1u))&0xedb88320u);}put(p+28,~crc);
}
static void checkpoint_cases(void){
 init(5);pll(&a,0x43012,0,3);wr(&a,0x51000004u,1u<<8);timer(&a,2,1,0,true);sound();
 wr(&a,0x51000024u,5);wr(&a,0x51000028u,2);step(3);
 CHECK(a.soc.pclk_phase==11&&a.soc.reload_pending==4&&a.soc.active_compare[2]==0&&a.soc.pending_compare[2]==2);
 wr(&a,0x51000024u,9);wr(&a,0x51000028u,4);
 for(unsigned gated=0;gated<2;gated++){
  wr(&a,0x4c00000cu,gated?a.soc.clock[3]&~0x100u:a.soc.clock[3]|0x100u);
  size_t n=orchard_checkpoint_size(&a);CHECK(n<=sizeof before);CHECK(orchard_checkpoint_save(&a,before,n)==ORCHARD_OK);
  CHECK(word(before+8)==5);step(9);CHECK(orchard_checkpoint_load(&a,before,n)==ORCHARD_OK);
  CHECK(orchard_checkpoint_save(&a,after,n)==ORCHARD_OK);CHECK(equal(before,after,n));
  CHECK(a.soc.pclk_phase==11&&a.soc.reload_pending==4&&a.soc.pending_count[2]==5&&a.soc.pending_compare[2]==2&&a.soc.active_compare[2]==0);
  b=a;CHECK(orchard_buzzer_enable(&b,false)==ORCHARD_OK);
  wr(&a,0x4c00000cu,a.soc.clock[3]|0x100u);wr(&b,0x4c00000cu,b.soc.clock[3]|0x100u);
  step(66);CHECK(o_run_reference(&b,66).status==ORCHARD_OK);state_equal();
  /* after/expected now contain the same continuation. Retain it while
     restoring the earlier pending+fractional snapshot into the chunked run. */
  CHECK(orchard_checkpoint_load(&a,before,n)==ORCHARD_OK);wr(&a,0x4c00000cu,a.soc.clock[3]|0x100u);
  static const unsigned chunks[]={1,2,7,16,31,9};for(unsigned i=0;i<6;i++)step(chunks[i]);
  CHECK(orchard_checkpoint_save(&a,after,n)==ORCHARD_OK);CHECK(equal(after,expected,n));
  CHECK(orchard_checkpoint_load(&a,before,n)==ORCHARD_OK);
 }
 /* The 64-byte v4 extension is bounded and imports atomically, including
    with a valid repaired CRC; no invalid new field can partly change RAM. */
 size_t n=orchard_checkpoint_size(&a);CHECK(orchard_checkpoint_save(&a,before,n)==ORCHARD_OK);
 size_t extension=n-a.profile->ram_bytes-O_BOOT_SRAM_SIZE-76u-64u;
 static const unsigned offsets[]={0,4,8,24,44,60};
 static const uint32_t invalid[]={16,2,65536,65536,65536,32};
 for(unsigned i=0;i<6;i++){
  o_copy(after,before,n);put(after+extension+offsets[i],invalid[i]);repair_crc(after,n);
  CHECK(orchard_checkpoint_load(&a,after,n)==ORCHARD_BAD_ARGUMENT);
  CHECK(orchard_checkpoint_save(&a,after,n)==ORCHARD_OK);CHECK(equal(after,before,n));
 }
}

static void paired_run(unsigned n){
 static const unsigned chunks[]={1,7,31,2,127,13};unsigned part=0,left=n;
 while(left){unsigned chunk=chunks[part++%6];if(chunk>left)chunk=left;step(chunk);left-=chunk;}
 CHECK(o_run_reference(&b,n).status==ORCHARD_OK);state_equal();
}
static void paired_write(uint32_t address,uint32_t value){wr(&a,address,value);wr(&b,address,value);}
static void partition_cases(void){
 for(unsigned asleep=0;asleep<2;asleep++){
  shared_setup();a.cpu.sleeping=asleep!=0;b=a;
  paired_run(17);paired_write(0x4c00000cu,a.soc.clock[3]&~0x8300u);paired_run(37);
  paired_write(0x4c00000cu,a.soc.clock[3]|0x8300u);paired_run(5);
  paired_write(0x4c000010u,0x30);paired_run(211);
  paired_write(0x4c000004u,0x52013);paired_write(0x4c000010u,0);paired_run(19);
  paired_write(0x4c000014u,4);paired_run(33);
  paired_write(0x51000000u,0x301);paired_run(117);
  paired_write(0x51000004u,0);paired_run(801);
  paired_write(0x51000024u,23);paired_write(0x51000028u,7);paired_run(2031);
  paired_write(0x51000008u,a.soc.tcon|0x2000);paired_write(0x51000008u,a.soc.tcon&~0x2000u);paired_run(7117);
 }
}

EXPORT("regression") unsigned regression(void){
 checks=failures=first=0;ratio_cases();gate_and_transition();buffer_cases();short_counts();
 shared_domain();beep_period();checkpoint_cases();partition_cases();return failures;
}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){regression();printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
