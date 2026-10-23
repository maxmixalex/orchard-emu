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
static void quiet_boundaries(void) {
    const unsigned budgets[] = {0,1,2,3,4,17,366,367,368};
    for (unsigned event=0;event<12;event++)
    for (unsigned part=0;part<sizeof(budgets)/sizeof(*budgets);part++) {
        init();
        for (unsigned vector=0;vector<32;vector+=4) put(a->flash+vector,0xeafffffeu);
        put(a->flash,0xe1a00000u); put(a->flash+4,0xe1a00000u);
        switch (event) {
        case 1: /* A latched IRQ survives with no unmasked source; MSR exposes it. */
            a->soc.intpnd=1u<<9; a->cpu.r[0]=O_SVC|O_F;
            put(a->flash+4,0xe121f000u); break; /* MSR CPSR_c,r0 */
        case 2: /* Pending FIQ is also excluded while its CPU mask is set. */
            a->soc.srcpnd=1u<<9; a->soc.intmod=1u<<9; a->soc.intmsk=~(1u<<9);
            a->cpu.r[0]=O_SVC|O_I; put(a->flash+4,0xe121f000u); break;
        case 3: /* A guest hardware-mask write invalidates the quiet interval. */
            a->soc.srcpnd=1u<<9; a->cpu.cpsr&=~O_I;
            a->cpu.r[0]=0x4a000008u; a->cpu.r[1]=~(1u<<9);
            put(a->flash+4,0xe5801000u); break; /* STR r1,[r0] */
        case 4: put(a->flash+4,0xee070f90u); break; /* CP15 wait for interrupt */
        case 5: put(a->flash+4,0xef000000u); break; /* SWI */
        case 6: /* A data abort retires its instruction, then enters the vector. */
            a->cpu.r[0]=0x60000000u; put(a->flash+4,0xe5901000u); break;
        case 7: /* A branch retires, but its following prefetch abort does not. */
            a->cpu.r[0]=0x60000000u; put(a->flash+4,0xe12fff10u); break;
        case 8: /* A diagnostic bus stop must not consume another quiet quantum. */
            a->cpu.r[0]=0x59000000u; put(a->flash+4,0xe5901000u); break;
        case 9: /* First-level descriptors in MMIO synchronize before a fault. */
            a->cpu.control|=1u; a->cpu.ttb=0x4a000000u;
            a->cpu.domain=UINT32_MAX; break;
        case 10: /* A second-level UART descriptor consumes the live RX byte. */
            a->cpu.control|=1u; a->cpu.ttb=0; a->cpu.domain=UINT32_MAX;
            a->cpu.r[15]=0x2400u; put(a->flash,0x50000001u);
            CHECK(o_q_push(&a->soc.rx,0x5c)); break;
        case 11: /* Instruction fetch itself can read a side-effectful device. */
            a->cpu.r[15]=0x50000024u; CHECK(o_q_push(&a->soc.rx,0x51)); break;
        default: break;
        }
        *b=*a; compare(budgets[part]);
        if (budgets[part]==3) {
            if (event>=1 && event<=3) {
                CHECK(a->cpu.exceptions==1 && a->cpu.instructions==2);
                CHECK((a->cpu.cpsr&31u)==(event==2?O_FIQ:O_IRQ));
            }
            if (event==4) CHECK(a->cpu.sleeping && a->cpu.instructions==2);
            if (event==5 || event==6) CHECK(a->cpu.exceptions==1 && a->cpu.instructions==3);
            if (event==7) CHECK(a->cpu.exceptions==1 && a->cpu.instructions==2);
            if (event==8) CHECK(a->ticks==2 && a->cpu.instructions==1 &&
                                a->stop.status==ORCHARD_UNIMPLEMENTED_MMIO);
        }
    }
    /* Read/swap/block-transfer/Thumb paths all share MMIO synchronization.
     * Start without a latched IRQ so the quiet continuation is eligible. */
    const uint32_t addresses[] = {0x50000024u,0x56000064u,0x52000158u,
                                  0x4d000068u,0x5800000cu,0x57000040u};
    const uint32_t operations[] = {0xe5902000u,0xe8900006u,0xe1002091u,0x6801u};
    const unsigned spans[] = {2,3,17,368};
    for (unsigned address=0;address<sizeof(addresses)/sizeof(*addresses);address++)
    for (unsigned operation=0;operation<sizeof(operations)/sizeof(*operations);operation++)
    for (unsigned span=0;span<sizeof(spans)/sizeof(*spans);span++) {
        init(); a->cpu.r[0]=addresses[address]; a->cpu.r[1]=0;
        a->soc.lcd_probe68_idle_zero=true; CHECK(o_q_push(&a->soc.rx,0x51));
        if (operation==3) {
            a->cpu.cpsr|=O_T;
            put(a->flash,0x46c0u|(operations[operation]<<16));
            put(a->flash+4,0xe7feu); /* Thumb NOP; LDR r1,[r0]; B . */
        } else {
            put(a->flash,0xe1a00000u); put(a->flash+4,operations[operation]);
            put(a->flash+8,0xeafffffeu);
        }
        *b=*a; compare(spans[span]);
    }
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
    /* UART0 level changes and W1C inside an RTC-only quiet interval must take
       effect on the next tick. The independent per-tick runner checks all
       architectural and peripheral state, including budget partitions. */
    const uint32_t uart_addr[]={0x50000004,0x50000004,0x50000008,0x50000008,
        0x4a000018,0x4a00001c,0x4a000008,0x4a000000,0x4a000010,0x50000020};
    const uint32_t uart_value[]={0x204,0,1,0,2,0x7fd,~(1u<<28),1u<<28,1u<<28,0x81};
    for(unsigned split=0;split<2;split++) for(unsigned i=0;i<sizeof(uart_addr)/sizeof(uart_addr[0]);i++) {
        guest_mmio(uart_addr[i],uart_value[i],true); put(a->ram+8,0xeafffffe);
        a->soc.uart[0][1]=i==0?0:0x204;
        a->soc.uart[0][2]=i==3?1:0;
        a->soc.intsubmsk=i==5?0x7ff:0x7fd;
        a->soc.intmsk=i==6?UINT32_MAX:~(1u<<28);
        *b=*a;
        if(split){compare(1);compare(1);compare(1);}else compare(3);
        compare(35); compare(400);
        if(i!=1 && i!=2) CHECK((a->soc.subsrcpnd&2u)!=0);
        if(i==9) CHECK(a->soc.tx.count==1 && a->soc.tx.data[0]==0x81);
        o_schedule_plan(a);CHECK(a->quiet_left>0);o_schedule_sync(a);same();
    }
    /* A pending empty level can wake a sleeping CPU when unmasked, including
       IRQ-masked wake and FIQ selection. Masked children leave it asleep. */
    for(unsigned mode=0;mode<4;mode++) {
        init(); a->cpu.sleeping=true; a->soc.uart[0][1]=0x204;
        a->soc.intsubmsk=mode==3?0x7ff:0x7fd;
        a->soc.intmsk=~(1u<<28);
        if(mode==0)a->cpu.cpsr&=~O_I;
        if(mode==1){a->soc.intmod=1u<<28;a->cpu.cpsr&=~O_F;}
        *b=*a;compare(1);compare(37);compare(400);
        CHECK(a->cpu.sleeping==(mode==3));
        CHECK((a->soc.subsrcpnd&2u)!=0);
    }
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
    /* Sleeping skips stop BEFORE an IRQ/FIQ or a latched CPU request. Test
       wake acceptance, masked sources, budget partitions and all phases. */
    for(unsigned mode=0;mode<4;mode++) for(unsigned phase=0;phase<16;phase++) {
        init();a->cpu.sleeping=true;a->soc.wtcon=32|4;a->soc.wtphase=phase;
        a->soc.wtcnt=2;a->soc.wtdat=3;a->soc.intmsk=~(1u<<9);
        if(mode==0)a->cpu.cpsr &= ~O_I;
        if(mode==1){a->cpu.cpsr &= ~O_F;a->soc.intmod=1u<<9;}
        if(mode==2){a->cpu.cpsr &= ~O_I;a->soc.intpnd=1u<<9;}
        if(mode==3)a->soc.intmsk=UINT32_MAX;
        *b=*a;
        for(unsigned part=1;part<=16;part++)compare(part);
    }
    quiet_boundaries();
    return failures;
}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){regression();printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
