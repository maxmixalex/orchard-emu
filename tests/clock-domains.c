/* SPDX-License-Identifier: MIT
 * Generated programs only. Divided execution against a per-quantum,
 * full-checkpoint CPU oracle; legacy behavior stays independently tested. */
#include "internal.h"
#include "orchard/clock.h"
#ifndef __wasm__
#include <stdio.h>
#endif
static orchard_machine a, b;
static uint8_t saved[600000];
static unsigned count_checks, failures, first;
#define CHECK(x) do { ++count_checks; if (!(x)) { ++failures; if (!first) first=__LINE__; } } while (0)
static bool equal(const void *left, const void *right, size_t n) {
    const uint8_t *l=left, *r=right;
    for (size_t i=0;i<n;++i) if (l[i]!=r[i]) return false;
    return true;
}
static void word(uint8_t *p, uint32_t v) {
    for (unsigned i=0;i<4;++i) p[i]=(uint8_t)(v>>(8u*i));
}
static void init(unsigned model, unsigned div) {
    CHECK(orchard_init(&a,sizeof a,model)==&a);
    a.loaded=true; a.soc.wtcon=0; a.soc.clock[5]=div;
    word(a.flash,0xeafffffeu); /* B self */
}
static void duplicate(void) { o_copy(&b,&a,sizeof a); }
static void same_state(void) {
    o_soc sa=a.soc, sb=b.soc;
    o_zero(&sa.eint_cache,sizeof sa.eint_cache);
    o_zero(&sb.eint_cache,sizeof sb.eint_cache);
    CHECK(equal(&a.cpu,&b.cpu,sizeof a.cpu));
    CHECK(equal(&sa,&sb,sizeof sa));
    CHECK(equal(&a.stop,&b.stop,sizeof a.stop));
    CHECK(a.ticks==b.ticks);
    CHECK(equal(a.ram,b.ram,a.profile->ram_bytes));
    CHECK(equal(a.boot_sram,b.boot_sram,sizeof a.boot_sram));
    CHECK(a.quiet_left==0 && a.deferred_ticks==0);
    CHECK(a.sram_alias_reads==b.sram_alias_reads && a.sram_alias_writes==b.sram_alias_writes);
}
static void reference(uint32_t n) {
    for (uint32_t i=0;i<n && b.stop.status==ORCHARD_OK;++i) {
        static const unsigned ratio[4]={1,2,2,4};
        unsigned slots=ratio[b.soc.clock[5]&3u];
        ++b.ticks;
        o_soc_tick(&b);
        if (b.stop.status!=ORCHARD_OK) break;
        o_irq_update(&b.soc);
        for (unsigned j=0;j<slots && b.stop.status==ORCHARD_OK;++j) {
            uint32_t p=b.soc.srcpnd & ~b.soc.intmsk;
            if (p) b.cpu.sleeping=false;
            if ((p & b.soc.intmod) && !(b.cpu.cpsr&O_F)) o_exception(&b.cpu,O_FIQ,0x1c,b.cpu.r[15]+4u);
            else if (b.soc.intpnd && !(b.cpu.cpsr&O_I)) o_exception(&b.cpu,O_IRQ,0x18,b.cpu.r[15]+4u);
            else if (!b.cpu.sleeping) o_cpu_step_reference(&b);
        }
    }
}
static uint32_t rng=0x1932410u;
static uint32_t random32(void) { rng^=rng<<13; rng^=rng>>17; rng^=rng<<5; return rng; }
static void exercise(void) {
    CHECK(orchard_run_divided(NULL,1).status==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_clock_divisor(NULL)==0);
    for (unsigned model=1;model<=6;++model) {
        for (unsigned div=0;div<4;++div) {
            const unsigned ratio[4]={1,2,2,4};
            init(model,div); duplicate();
            CHECK(orchard_clock_divisor(&a)==ratio[div]);
            CHECK(orchard_run_divided(&a,1001).status==ORCHARD_OK);
            reference(1001); same_state();
            CHECK(a.cpu.instructions==1001u*ratio[div]);
            CHECK(a.ticks==1001);
            /* Legacy API still has one issue slot; RTC/PWM are not sped up. */
            init(model,div); duplicate();
            CHECK(orchard_run_divided(&a,1001).status==ORCHARD_OK);
            CHECK(orchard_run(&b,1001).status==ORCHARD_OK);
            CHECK(b.cpu.instructions==1001);
            CHECK(equal(&a.soc.rtc,&b.soc.rtc,sizeof a.soc.rtc));
            CHECK(equal(a.soc.phase,b.soc.phase,sizeof a.soc.phase));
            /* Sleep and a pending timer IRQ. Check every partition boundary. */
            init(model,div); a.soc.tcfg0=3; a.soc.tcon=9;
            a.soc.tcntb[0]=a.soc.count[0]=17;
            a.soc.intmsk=~(1u<<10); a.cpu.cpsr&=~O_I;
            word(a.flash,0xee070f90u); word(a.flash+4,0xeafffffeu);
            word(a.flash+0x18,0xeafffffeu); duplicate();
            for (unsigned i=0;i<32;++i) {
                uint32_t n=1+(random32()%97u);
                CHECK(orchard_run_divided(&a,n).status==ORCHARD_OK);
                reference(n); same_state();
            }
            CHECK(a.cpu.exceptions>0);
            /* A non-IRQ WFI is accelerated only through quiet intervals. */
            init(model,div); word(a.flash,0xee070f90u); duplicate();
            CHECK(orchard_run_divided(&a,5000).status==ORCHARD_OK);
            reference(5000); same_state(); CHECK(a.cpu.instructions==1); CHECK(a.cpu.sleeping);
        }
        /* Divider MMIO is latched at the next quantum, not mid-group. */
        init(model,3); a.cpu.r[0]=0x4c000014u; a.cpu.r[1]=0;
        word(a.flash,0xe5801000u); word(a.flash+4,0xeafffffeu); duplicate();
        CHECK(orchard_run_divided(&a,2).status==ORCHARD_OK); reference(2); same_state();
        CHECK(a.cpu.instructions==5); CHECK(orchard_clock_divisor(&a)==1);
        /* First-slot failures terminate the group rather than issuing 3 more. */
        init(model,3); word(a.flash,0xee000f10u); duplicate();
        CHECK(orchard_run_divided(&a,100).status!=ORCHARD_OK); reference(100); same_state();
        CHECK(a.ticks==1);
        /* Checkpoint wire version is unchanged; ratio is restored from CLKDIVN. */
        init(model,3); CHECK(orchard_run_divided(&a,19).status==ORCHARD_OK);
        size_t n=orchard_checkpoint_size(&a); CHECK(n<=sizeof saved);
        CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
        duplicate(); a.soc.clock[5]=0;
        CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);
        CHECK(orchard_clock_divisor(&a)==4); same_state();
        CHECK(orchard_run_divided(&a,0).status==ORCHARD_OK); same_state();
        for (unsigned trial=0;trial<32;++trial) {
            init(model,random32()&3u);
            a.soc.tcfg0=random32()&255u; a.soc.tcon=9;
            a.soc.count[0]=a.soc.tcntb[0]=1+(random32()&63u);
            a.soc.phase[0]=random32()%((a.soc.tcfg0+1u)*2u);
            a.soc.rtc.phase=random32()%O_FUNCTIONAL_TIMEBASE_HZ;
            a.cpu.r[0]=O_RAM_BASE; a.cpu.r[1]=random32();
            word(a.flash,0xe5801000u); /* STR r1,[r0] */
            word(a.flash+4,0xe5902000u); /* LDR r2,[r0] */
            word(a.flash+8,0xe2811001u); /* ADD r1,r1,#1 */
            word(a.flash+12,0xeafffffbu); /* B 0 */
            duplicate(); uint32_t quanta=1+(random32()%2000u);
            CHECK(orchard_run_divided(&a,quanta).status==ORCHARD_OK);
            reference(quanta); same_state();
        }
    }
}
#ifdef __wasm__
#define EXPORT(name) __attribute__((export_name(name)))
#else
#define EXPORT(name)
#endif
EXPORT("regression") unsigned regression(void) {
    count_checks=failures=first=0; rng=0x1932410u; exercise(); return failures;
}
EXPORT("checks") unsigned checks(void) { return count_checks; }
EXPORT("first_failure") unsigned first_failure(void) { return first; }
#ifndef __wasm__
int main(void) {
    (void)regression();
    printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u}\n",count_checks,failures,first);
    return failures ? 1 : 0;
}
#endif
