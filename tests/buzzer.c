/* SPDX-License-Identifier: MIT */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(n)
#else
#define EXPORT(n) __attribute__((export_name(n)))
#endif
static orchard_machine a,b;
static orchard_buzzer_edge edges[ORCHARD_BUZZER_CAPACITY];
static o_buzzer saved_buzzer;
static uint8_t before[600000],after[600000];
static unsigned checks,failures,first;
#define CHECK(x) do{++checks;if(!(x)){if(!failures)first=__LINE__;++failures;}}while(0)
static bool equal(const void *x,const void *y,size_t n){const uint8_t *p=x,*q=y;for(size_t i=0;i<n;i++)if(p[i]!=q[i])return false;return true;}
static void write32(uint32_t address,uint32_t value){CHECK(o_mmio_write(&a,address,4,value));}
static void run(unsigned ticks){CHECK(orchard_run(&a,ticks).status==ORCHARD_OK);}
static size_t drain(void){return orchard_buzzer_read(&a,edges,ORCHARD_BUZZER_CAPACITY);}
static void init(void){
 CHECK(orchard_init(&a,sizeof a,5)==&a);a.loaded=true;
 a.flash[0]=0xfe;a.flash[1]=0xff;a.flash[2]=0xff;a.flash[3]=0xea;
 a.soc.wtcon=0;a.cpu.cpsr=O_SVC|O_I|O_F;
 CHECK(orchard_buzzer_enable(&a,true)==ORCHARD_OK);
 CHECK(drain()==1&&edges[0].tick==0&&edges[0].level==0);
}
static void pwm(unsigned count,unsigned compare,uint32_t flags){
 write32(0x51000024,count);write32(0x51000028,compare);
 write32(0x51000008,0x2000);write32(0x56000010,0x20);
 write32(0x51000008,0x1000|flags);
}
EXPORT("regression") unsigned regression(void){
 checks=failures=first=0;
 CHECK(orchard_buzzer_enable(NULL,true)==ORCHARD_BAD_ARGUMENT);
 CHECK(orchard_buzzer_read(NULL,edges,1)==0);
 orchard_buzzer_state s;orchard_get_buzzer_state(NULL,&s);CHECK(!s.enabled&&s.queued==0);
 init();write32(0x56000014,4);CHECK(drain()==0); /* Input latch is not a driver. */
 write32(0x56000010,0x10);run(17);write32(0x56000014,0);run(19);write32(0x56000014,4);
 CHECK(drain()==3);CHECK(edges[0].tick==0&&edges[0].level==1);
 CHECK(edges[1].tick==17&&edges[1].level==0);CHECK(edges[2].tick==36&&edges[2].level==1);
 write32(0x56000014,4);CHECK(drain()==0);write32(0x56000010,0x30);
 CHECK(drain()==1&&edges[0].level==0); /* Reserved mux is undriven. */
 init();pwm(6,3,0x8000);run(6);
 CHECK(drain()==1&&edges[0].tick==6&&edges[0].level==1);
 write32(0x51000028,1);CHECK(drain()==0); /* A buffer write cannot cut a pulse short. */
 run(6);CHECK(drain()==1&&edges[0].tick==12&&edges[0].level==0);
 run(8);CHECK(drain()==0);run(2);CHECK(drain()==1&&edges[0].tick==22&&edges[0].level==1);
 write32(0x51000008,0xd000);CHECK(drain()==1&&edges[0].level==0); /* Invert live. */
 write32(0x51000008,0x4000);run(400);CHECK(drain()==0); /* Stop holds output. */
 write32(0x51000008,0);CHECK(drain()==1&&edges[0].level==1); /* Invert stopped. */
 init();pwm(4,2,0);run(8);
 CHECK(drain()==1&&edges[0].tick==4&&edges[0].level==1);
 CHECK(a.soc.count[2]==0&&!(a.soc.tcon&0x1000));run(100);CHECK(drain()==0);
 init();write32(0x51000000,2u<<8);write32(0x51000004,1u<<8);pwm(8,4,0x8000);run(192);
 CHECK(drain()==4);CHECK(edges[0].tick==48&&edges[1].tick==96&&edges[2].tick==144&&edges[3].tick==192);
 /* Clock-gated output holds, GPIO remains independent of the PWM block. */
 write32(0x4c00000c,a.soc.clock[3]&~0x100u);run(192);CHECK(drain()==0);
 write32(0x56000010,0x10);write32(0x56000014,4);CHECK(drain()==1&&edges[0].level==1);
 /* Observer and drain must leave every serialized guest byte untouched. */
 init();pwm(7,3,0x8000);b=a;CHECK(orchard_buzzer_enable(&b,false)==ORCHARD_OK);
 for(unsigned i=0;i<23;i++){
  run(37);CHECK(o_run_reference(&b,37).status==ORCHARD_OK);(void)drain();
 }
 size_t n=orchard_checkpoint_size(&a);CHECK(n<=sizeof before);
 CHECK(orchard_checkpoint_save(&a,before,n)==ORCHARD_OK);
 CHECK(orchard_checkpoint_save(&b,after,n)==ORCHARD_OK);CHECK(equal(before,after,n));
 /* Rejection is fully atomic, including already queued host audio. */
 run(20);saved_buzzer=a.buzzer;before[n-1]^=1;
 CHECK(orchard_checkpoint_load(&a,before,n)==ORCHARD_BAD_ARGUMENT);
 CHECK(equal(&saved_buzzer,&a.buzzer,sizeof saved_buzzer));before[n-1]^=1;
 uint32_t epoch=a.buzzer.epoch;
 CHECK(orchard_checkpoint_load(&a,before,n)==ORCHARD_OK);
 orchard_get_buzzer_state(&a,&s);CHECK(s.enabled&&s.epoch==epoch+1&&s.queued==1);
 CHECK(drain()==1&&edges[0].tick==s.tick);CHECK(s.timebase_hz==12000000);
 orchard_reset(&a);orchard_get_buzzer_state(&a,&s);
 CHECK(s.enabled&&s.epoch==epoch+2&&s.tick==0&&s.queued==1&&s.level==0);
 CHECK(orchard_buzzer_enable(&a,false)==ORCHARD_OK);write32(0x56000010,0x10);write32(0x56000014,4);
 CHECK(drain()==0);CHECK(orchard_buzzer_enable(&a,true)==ORCHARD_OK);
 CHECK(drain()==1&&edges[0].level==1);
 /* Full queues resynchronize instead of stopping or silently deleting edges. */
 epoch=a.buzzer.epoch;
 for(unsigned i=0;i<ORCHARD_BUZZER_CAPACITY+7u;i++) {a.ticks++;write32(0x56000014,(i&1)?4u:0u);}
 orchard_get_buzzer_state(&a,&s);
 CHECK(a.stop.status==ORCHARD_OK&&s.overflows==1&&s.epoch==epoch+1&&s.queued==7);
 CHECK(orchard_buzzer_read(&a,NULL,12)==0);
 CHECK(orchard_buzzer_read(&a,edges,3)==3);CHECK(drain()==4);
 orchard_buzzer_clear(&a);CHECK(drain()==1&&edges[0].tick==a.ticks&&edges[0].level==s.level);
 /* Preserve the full timestamp above the 32-bit rollover. */
 a.ticks=UINT64_C(0x100000023);write32(0x56000014,4);CHECK(drain()==1&&edges[0].tick==a.ticks);
 return failures;
}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){regression();printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
