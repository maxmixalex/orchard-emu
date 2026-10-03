/* SPDX-License-Identifier: MIT */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(n)
#else
#define EXPORT(n) __attribute__((export_name(n)))
#endif
static unsigned checks, failures, first;
#define CHECK(x) do { ++checks; if (!(x)) { if(!failures)first=__LINE__; ++failures; } } while (0)
static int different(const void *x,const void *y,size_t n) {
 const uint8_t *a=x,*b=y;for(size_t i=0;i<n;i++)if(a[i]!=b[i])return 1;return 0;
}
static orchard_machine ma, mb;
static orchard_machine *a=&ma, *b=&mb;
static uint32_t seed = 0x2410920u;
static uint32_t rnd(void) { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; return seed; }
static void put(uint8_t *p, uint32_t op) { for (unsigned i=0;i<4;i++) p[i]=(uint8_t)(op>>(8*i)); }
static void init(void) {
    CHECK(orchard_init(a,sizeof(*a),4)==a);
    a->loaded=true; put(a->flash,0xeafffffe); a->soc.wtcon=0;
}
static void same(void) {
    o_soc x=a->soc,y=b->soc;
    o_zero(&x.eint_cache,sizeof(x.eint_cache)); o_zero(&y.eint_cache,sizeof(y.eint_cache));
    CHECK(!different(&a->cpu,&b->cpu,sizeof(a->cpu)));
    CHECK(!different(&x,&y,sizeof(x)));
    CHECK(!different(&a->stop,&b->stop,sizeof(a->stop)));
    CHECK(!different(a->ram,b->ram,sizeof(a->ram)));
    CHECK(a->ticks==b->ticks);
    CHECK(a->quiet_left==0 && a->deferred_ticks==0);
}
static void compare(unsigned budget) { (void)orchard_run(a,budget); (void)o_run_reference(b,budget); same(); }
static void guest_mmio(uint32_t address, uint32_t value, bool write) {
    init(); a->cpu.r[15]=O_RAM_BASE; a->cpu.r[0]=address; a->cpu.r[1]=value;
    put(a->ram,0xe1a00000); /* NOP first creates a nonempty quiet window. */
    put(a->ram+4,write?0xe5801000:0xe5901000);
    put(a->ram+8,0xeafffffc);
}
EXPORT("regression") unsigned regression(void) {
    checks=failures=first=0; seed=0x2410920u;
    for(unsigned trial=0;trial<1600;trial++) {
        init(); o_soc *s=&a->soc;
        s->rtc.phase=rnd()%O_FUNCTIONAL_TIMEBASE_HZ;
        s->rtc.divider=rnd()%32768; s->rtc.reg[1]=(uint8_t)rnd();
        s->rtc.tick_count=rnd() % ((s->rtc.reg[1]&127)+1);
        s->lcd[0]=(2u<<8)|0x21; s->lcd[1]=(rnd()%80)<<14;
        s->lcd[2]=(rnd()%256)<<8; s->lcd[3]=rnd()%4;
        s->lcd_phase=rnd()%20; s->lcd_line=rnd()%80;
        s->lcd[0x5c/4]=rnd()&3u;
        s->adc.remaining=1+rnd()%1280; s->adc.con=0; s->adc.sample=(uint16_t)(rnd()%1024);
        s->wtcon=32|4|((rnd()%4)<<3)|((rnd()%4)<<8); s->wtcnt=rnd()%8; s->wtdat=rnd()%8;
        for(unsigned ch=0;ch<5;ch++) { s->tcon|=1u<<(ch?ch*4+4:0); s->count[ch]=rnd()%10; s->tcntb[ch]=rnd()%10; }
        s->tcfg0=rnd()&0x303; s->tcfg1=rnd()&0x33333;
        s->intmsk=rnd(); s->intsubmsk=rnd()&0x7ff;
        s->usb.ep_pending=(uint8_t)(rnd()&31); s->usb.ep_enable=(uint8_t)(rnd()&31);
        *b=*a; compare(rnd()%2000);
        compare(rnd()%1000); /* state is also exact after every public boundary */
    }
    /* Live MMIO in the middle of a planned interval: includes conversion
       start/read, timer count/phase reset, LCD W1C/mask and pending relatch. */
    const uint32_t addr[]={0x58000000,0x5800000c,0x51000008,0x51000014,
        0x4d000000,0x4d000054,0x4d000058,0x4d00005c,0x4a000000,0x4a000010,
        0x57000040,0x57000044,0x53000000,0x53000008,0x52000158,0x56000088,0x59000000};
    for(unsigned i=0;i<sizeof(addr)/sizeof(addr[0]);i++) for(unsigned w=0;w<2;w++) {
        guest_mmio(addr[i], i==0?0x4041:0, w!=0);
        a->soc.adc.known=1; a->soc.adc.inputs[0]=777; a->soc.adc.valid=true;
        a->soc.adc.data=123; a->soc.srcpnd=0x100; a->soc.intpnd=0x100;
        *b=*a; compare(800); compare(1);
    }
    /* A single ADC start must shorten a previously planned RTC-only window.
       Divisor=2 is legal; divisor=1 would stop before exposing this bug. */
    guest_mmio(0x58000000,0x4041,true);
    put(a->ram+8,0xeafffffe);
    a->soc.adc.known=1;a->soc.adc.inputs[0]=777;
    *b=*a;compare(31);CHECK(a->soc.adc.valid&&a->soc.adc.data==777);
    /* Clearing the main USB source while its child latch is live must reassert
       next tick, even when the CPU has IRQs masked throughout this program. */
    guest_mmio(0x4a000000,1u<<25,true);put(a->ram+8,0xeafffffe);
    a->soc.usb.ep_pending=1;a->soc.usb.ep_enable=1;
    *b=*a;compare(35);CHECK((a->soc.srcpnd&(1u<<25))!=0);
    /* Changing a timer to manual load/start inside an existing quiet window. */
    guest_mmio(0x51000008,3,true);put(a->ram+8,0xeafffffe);
    a->soc.tcntb[0]=7;
    *b=*a;compare(67);CHECK((a->soc.srcpnd&(1u<<10))!=0);
    /* Exact stop tick at watchdog/invalid LCD boundaries; no skipped faults. */
    init();a->soc.wtcon=33;a->soc.wtcnt=2;*b=*a;compare(100);
    init();a->soc.lcd[0]=1;*b=*a;compare(100);
    /* Budget partition and sleeping CPU preserve every oscillator transition. */
    init();a->cpu.sleeping=true;*b=*a;
    for(unsigned i=0;i<100;i++)compare(i*37);
    CHECK(a->cpu.instructions==0);
    return failures;
}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){regression();printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
