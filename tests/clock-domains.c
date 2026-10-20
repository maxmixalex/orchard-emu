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
/* Only generated fixture stores listed here request IDLE in the oracle.
   The reference machine never enables the production MMIO policy flag. */
static uint32_t reference_idle_pc[2] = {UINT32_MAX, UINT32_MAX};
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
    reference_idle_pc[0]=reference_idle_pc[1]=UINT32_MAX;
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
    CHECK(!a.idle_write_enabled && !b.idle_write_enabled);
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
/* Independent table and unscheduled peripheral / reference-CPU stepping.
 * Do not call orchard_clock_slots or the production run loop from this oracle. */
static const unsigned clocked_ratio[4][8] = {
    {1,2,1,2,1,0,0,0}, {1,2,2,4,4,0,0,0},
    {0,0,0,0,0,0,0,0}, {1,2,2,4,4,0,0,0}
};
static void policy_reference(uint32_t n, bool use_ratio) {
    for (uint32_t i=0;i<n && b.stop.status==ORCHARD_OK;++i) {
        unsigned mode=b.cpu.control>>30;
        unsigned slots=use_ratio?clocked_ratio[mode][b.soc.clock[5]&7u]:1u;
        if (!slots) {
            o_stop(&b,mode==2?ORCHARD_UNSUPPORTED_CP15:ORCHARD_UNPREDICTABLE,
                   mode==2?b.cpu.r[15]:0x4c000014u,
                   mode==2?b.cpu.control:b.soc.clock[5]);
            break;
        }
        ++b.ticks; o_soc_tick(&b);
        if (b.stop.status!=ORCHARD_OK) break;
        o_irq_update(&b.soc);
        for (unsigned j=0;j<slots && b.stop.status==ORCHARD_OK;++j) {
            uint32_t p=b.soc.srcpnd & ~b.soc.intmsk;
            if (p) b.cpu.sleeping=false;
            if ((p & b.soc.intmod) && !(b.cpu.cpsr&O_F)) o_exception(&b.cpu,O_FIQ,0x1c,b.cpu.r[15]+4u);
            else if (b.soc.intpnd && !(b.cpu.cpsr&O_I)) o_exception(&b.cpu,O_IRQ,0x18,b.cpu.r[15]+4u);
            else if (!b.cpu.sleeping) {
                uint32_t pc=b.cpu.r[15];
                o_cpu_step_reference(&b);
                if (pc==reference_idle_pc[0] || pc==reference_idle_pc[1]) {
                    CHECK(!b.idle_write_enabled && b.stop.status==ORCHARD_OK);
                    CHECK(!b.cpu.data_abort && b.cpu.r[15]==pc+4);
                    b.cpu.sleeping=true;
                }
            }
        }
    }
}
static void clocked_reference(uint32_t n) { policy_reference(n,true); }
static bool idle_uses_ratio;
static orchard_stop idle_run(uint32_t n) {
    return idle_uses_ratio?orchard_run_clocked(&a,n):orchard_run_idle(&a,n);
}
static void idle_program(unsigned model, unsigned mode, unsigned div) {
    init(model,div); a.cpu.control|=mode<<30;
    a.cpu.r[15]=0x100; a.cpu.r[0]=0x4c00000cu; a.cpu.r[1]=0x61b4;
    word(a.flash+0x100,0xe5801000u); /* STR r1,[r0]: first IDLE request */
    word(a.flash+0x104,0xe2822001u); /* ADD r2,r2,#1: resume work */
    word(a.flash+0x108,0xe2822001u); /* ADD r2,r2,#1: sticky bit is inert */
    word(a.flash+0x10c,0xe5801000u); /* STR r1,[r0]: repeated IDLE request */
    word(a.flash+0x110,0xe2833001u); /* ADD r3,r3,#1 */
    word(a.flash+0x114,0xeafffffeu); /* B self */
    word(a.flash+0x18,0xeafffffeu); word(a.flash+0x1c,0xeafffffeu);
    reference_idle_pc[0]=0x100; reference_idle_pc[1]=0x10c;
}
static void idle_steps(uint32_t n) {
    CHECK(idle_run(n).status==ORCHARD_OK);
    policy_reference(n,idle_uses_ratio); same_state();
}
static void exercise_idle(bool use_ratio) {
    idle_uses_ratio=use_ratio;
    for (unsigned model=1;model<=6;++model) {
        /* The writing instruction completes, then all remaining issue slots
           sleep. Peripheral time keeps moving at every supported ratio. */
        for (unsigned mode=0;mode<4;++mode) if (mode!=2)
            for (unsigned div=0;div<=4;++div) {
                idle_program(model,mode,div); duplicate(); idle_steps(5000);
                CHECK(a.cpu.sleeping && a.cpu.instructions==1);
                CHECK(a.cpu.r[15]==0x104 && a.cpu.r[2]==0 && a.cpu.r[3]==0);
                CHECK(a.soc.clock[3]==0x61b4 && a.ticks==5000);
            }
        /* INTMSK prevents wake; CPSR.I alone does not. After wake the sticky
           IDLE bit must allow both ADDs, then another write of one must sleep. */
        idle_program(model,0,0); duplicate(); idle_steps(1);
        a.soc.srcpnd=b.soc.srcpnd=1u<<10; idle_steps(500);
        CHECK(a.cpu.sleeping && a.cpu.instructions==1);
        a.soc.intmsk=b.soc.intmsk=~(1u<<10); idle_steps(1);
        CHECK(!a.cpu.sleeping && a.cpu.r[2]==1 && a.cpu.exceptions==0);
        a.soc.srcpnd=b.soc.srcpnd=a.soc.intpnd=b.soc.intpnd=0;
        idle_steps(1); CHECK(!a.cpu.sleeping && a.cpu.r[2]==2);
        idle_steps(500);
        CHECK(a.cpu.sleeping && a.cpu.instructions==4 && a.cpu.r[3]==0);
        CHECK(a.soc.clock[3]==0x61b4 && a.cpu.r[15]==0x110);
        /* Existing pending requests prevent the core from getting stuck in
           IDLE even when the ARM interrupt mask defers exception delivery. */
        idle_program(model,3,3); a.soc.srcpnd=1u<<10;
        a.soc.intmsk=~(1u<<10); duplicate(); idle_steps(5);
        CHECK(!a.cpu.sleeping && a.cpu.r[2]==2 && a.cpu.r[3]==1);
        CHECK(a.cpu.instructions==5u*(use_ratio?4u:1u) && a.cpu.exceptions==0);
        /* IRQ and FIQ both wake before the next slot and preserve CLKCON. */
        for (unsigned fiq=0;fiq<2;++fiq) {
            idle_program(model,3,3); duplicate(); idle_steps(1);
            a.soc.srcpnd=b.soc.srcpnd=1u<<10;
            a.soc.intmsk=b.soc.intmsk=~(1u<<10);
            if (fiq) {
                a.soc.intmod=b.soc.intmod=1u<<10;
                a.cpu.cpsr&=~O_F; b.cpu.cpsr&=~O_F;
            } else { a.cpu.cpsr&=~O_I; b.cpu.cpsr&=~O_I; }
            idle_steps(1);
            CHECK(!a.cpu.sleeping && a.cpu.exceptions==1);
            CHECK((a.cpu.cpsr&31u)==(fiq?O_FIQ:O_IRQ));
            CHECK(a.cpu.r[15]==(fiq?0x1cu:0x18u) && a.soc.clock[3]==0x61b4);
        }
        /* Timer boundary is independently known: 17 decrements at 8 quanta.
           Compare the whole state immediately before and at the first IRQ. */
        idle_program(model,3,3); a.soc.tcfg0=3; a.soc.tcon=9;
        a.soc.tcntb[0]=a.soc.count[0]=17; a.soc.intmsk=~(1u<<10);
        a.cpu.cpsr&=~O_I; duplicate(); idle_steps(135);
        CHECK(a.cpu.sleeping && a.cpu.instructions==1 && a.cpu.exceptions==0);
        idle_steps(1); CHECK(!a.cpu.sleeping && a.cpu.exceptions==1);
        for (unsigned i=0;i<8;++i) idle_steps(1+random32()%97u);
        /* An actual external pin edge supplied between calls wakes IDLE at
           the first peripheral quantum; a cached quiet interval cannot hide it. */
        idle_program(model,3,3);
        CHECK(orchard_keyboard_attach(&a,true)==ORCHARD_OK);
        a.soc.gpio[0x50/4]=2; a.soc.gpio[0x88/4]=4;
        a.soc.intmsk=~1u; a.cpu.cpsr&=~O_I; duplicate(); idle_steps(41);
        CHECK(a.cpu.sleeping && a.cpu.exceptions==0);
        CHECK(orchard_keyboard_dedicated(&a,0,true)==ORCHARD_OK);
        CHECK(orchard_keyboard_dedicated(&b,0,true)==ORCHARD_OK);
        idle_steps(1); CHECK(!a.cpu.sleeping && a.cpu.exceptions==1);
        /* Sleeping state is already in checkpoint v1. Policy scope is not. */
        idle_program(model,3,3); duplicate(); idle_steps(63);
        size_t n=orchard_checkpoint_size(&a); CHECK(n<=sizeof saved);
        CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
        CHECK(saved[8]==1 && saved[9]==0 && saved[10]==0 && saved[11]==0);
        a.cpu.sleeping=false; a.soc.clock[3]=0; a.idle_write_enabled=true;
        CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK); same_state();
        a.soc.srcpnd=b.soc.srcpnd=1u<<10;
        a.soc.intmsk=b.soc.intmsk=~(1u<<10); idle_steps(19);
        /* Pre-existing register values are never interpreted as fresh writes. */
        init(model,3); a.cpu.control|=0xc0000000u;
        CHECK(o_mmio_write(&a,0x4c00000cu,4,0x61b4)); duplicate(); idle_steps(101);
        CHECK(!a.cpu.sleeping && a.cpu.instructions==101u*(use_ratio?4u:1u));
        /* Clearing IDLE, or writing another clock register, must not sleep. */
        for (unsigned other=0;other<2;++other) {
            idle_program(model,3,3);
            if (other) a.cpu.r[0]=0x4c000000u; else a.cpu.r[1]=0x61b0;
            reference_idle_pc[0]=reference_idle_pc[1]=UINT32_MAX;
            duplicate(); idle_steps(101);
            CHECK(!a.cpu.sleeping && a.cpu.instructions==101u*(use_ratio?4u:1u) && a.cpu.r[3]==1);
        }
        /* Byte stores retain the existing explicit MMIO fault and must not
           leave the call-scoped flag active after a stop or zero-budget call. */
        idle_program(model,3,3); word(a.flash+0x100,0xe5c01000u);
        reference_idle_pc[0]=reference_idle_pc[1]=UINT32_MAX; duplicate();
        CHECK(idle_run(101).status==ORCHARD_UNIMPLEMENTED_MMIO);
        policy_reference(101,use_ratio); same_state(); CHECK(!a.cpu.sleeping);
        CHECK(idle_run(0).status==ORCHARD_UNIMPLEMENTED_MMIO);
        CHECK(!a.idle_write_enabled);
        orchard_reset(&a); CHECK(!a.idle_write_enabled && !a.cpu.sleeping);
        /* Neither legacy runner gains new write side effects, including when
           an IDLE-aware runner was selected before it with zero budget. */
        for (unsigned divided=0;divided<2;++divided) {
            idle_program(model,3,3);
            CHECK(idle_run(0).status==ORCHARD_OK); duplicate();
            if (divided) { CHECK(orchard_run_divided(&a,101).status==ORCHARD_OK); reference(101); }
            else { CHECK(orchard_run(&a,101).status==ORCHARD_OK); CHECK(o_run_reference(&b,101).status==ORCHARD_OK); }
            same_state(); CHECK(!a.cpu.sleeping && a.cpu.r[2]==2 && a.cpu.r[3]==1);
            CHECK(a.cpu.instructions==101u*(divided?4u:1u) && a.soc.clock[3]==0x61b4);
        }
    }
}
static void exercise_one_slot(void) {
    CHECK(orchard_run_idle(NULL,1).status==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_init(&a,sizeof a,1)==&a);
    CHECK(orchard_run_idle(&a,1).status==ORCHARD_NO_ROM);
    for (unsigned model=1;model<=6;++model) {
        /* This is a deliberately separate functional policy: no CP15/divider
           encoding changes its one-slot budget or inherits research-mode stops. */
        for (unsigned mode=0;mode<4;++mode) for (unsigned div=0;div<8;++div) {
            init(model,div); a.cpu.control|=mode<<30; duplicate();
            CHECK(orchard_run_idle(&a,101).status==ORCHARD_OK);
            policy_reference(101,false); same_state();
            CHECK(a.ticks==101 && a.cpu.instructions==101);
        }
        init(model,3); a.cpu.control|=0xc0000000u;
        word(a.flash,0xee070f90u); duplicate();
        CHECK(orchard_run_idle(&a,5000).status==ORCHARD_OK);
        policy_reference(5000,false); same_state();
        CHECK(a.cpu.instructions==1 && a.cpu.sleeping);
        /* CP15 and divider writes still take place, without changing issue rate. */
        init(model,3); a.cpu.r[1]=0xc0000078u;
        word(a.flash,0xee011f10u); word(a.flash+4,0xeafffffeu); duplicate();
        CHECK(orchard_run_idle(&a,2).status==ORCHARD_OK);
        policy_reference(2,false); same_state();
        CHECK(a.cpu.instructions==2 && orchard_clock_slots(&a)==4);
        init(model,3); a.cpu.r[0]=0x4c000014u; a.cpu.r[1]=4;
        word(a.flash,0xe5801000u); word(a.flash+4,0xeafffffeu); duplicate();
        CHECK(orchard_run_idle(&a,2).status==ORCHARD_OK);
        policy_reference(2,false); same_state();
        CHECK(a.cpu.instructions==2 && a.soc.clock[5]==4);
    }
}
static void exercise_clocked(void) {
    CHECK(orchard_run_clocked(NULL,1).status==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_clock_slots(NULL)==0);
    CHECK(orchard_init(&a,sizeof a,1)==&a);
    CHECK(orchard_run_clocked(&a,1).status==ORCHARD_NO_ROM);
    for (unsigned model=1;model<=6;++model) {
        for (unsigned mode=0;mode<4;++mode) for (unsigned div=0;div<8;++div) {
            init(model,div); a.cpu.control|=mode<<30; duplicate();
            unsigned slots=clocked_ratio[mode][div];
            CHECK(orchard_clock_slots(&a)==slots);
            orchard_stop stop=orchard_run_clocked(&a,101);
            clocked_reference(101); same_state();
            if (!slots) {
                CHECK(stop.status!=ORCHARD_OK); CHECK(a.ticks==0); CHECK(a.cpu.instructions==0);
                continue;
            }
            CHECK(stop.status==ORCHARD_OK); CHECK(a.ticks==101);
            CHECK(a.cpu.instructions==101u*slots);
            /* WFI quiet skipping, timer wake and partition boundaries. */
            init(model,div); a.cpu.control|=mode<<30;
            a.soc.tcfg0=3; a.soc.tcon=9; a.soc.tcntb[0]=a.soc.count[0]=17;
            a.soc.intmsk=~(1u<<10); a.cpu.cpsr&=~O_I;
            word(a.flash,0xee070f90u); word(a.flash+4,0xeafffffeu);
            word(a.flash+0x18,0xeafffffeu); duplicate();
            for (unsigned i=0;i<8;++i) {
                uint32_t n=1+random32()%97u;
                CHECK(orchard_run_clocked(&a,n).status==ORCHARD_OK);
                clocked_reference(n); same_state();
            }
            CHECK(a.cpu.exceptions>0);
            init(model,div); a.cpu.control|=mode<<30;
            word(a.flash,0xee070f90u); duplicate();
            CHECK(orchard_run_clocked(&a,5000).status==ORCHARD_OK);
            clocked_reference(5000); same_state();
            CHECK(a.cpu.instructions==1 && a.cpu.sleeping);
            /* Fixed peripheral time remains independent of the issue ratio. */
            init(model,div); a.cpu.control|=mode<<30; duplicate();
            CHECK(orchard_run_clocked(&a,1001).status==ORCHARD_OK);
            CHECK(orchard_run(&b,1001).status==ORCHARD_OK);
            CHECK(equal(&a.soc.rtc,&b.soc.rtc,sizeof a.soc.rtc));
            CHECK(equal(a.soc.phase,b.soc.phase,sizeof a.soc.phase));
        }
        /* The CP15 write changes FastBus 2 slots to asynchronous 4 slots at
           the next quantum, not during the current two-instruction group. */
        init(model,3); a.cpu.r[1]=0xc0000078u;
        word(a.flash,0xee011f10u); word(a.flash+4,0xeafffffeu); duplicate();
        CHECK(orchard_run_clocked(&a,2).status==ORCHARD_OK);
        clocked_reference(2); same_state();
        CHECK(a.cpu.instructions==6 && orchard_clock_slots(&a)==4);
        /* Reverse mode transition and special 1:4:4 MMIO transition. */
        init(model,3); a.cpu.control|=0xc0000000u; a.cpu.r[1]=0x78u;
        word(a.flash,0xee011f10u); word(a.flash+4,0xeafffffeu); duplicate();
        CHECK(orchard_run_clocked(&a,2).status==ORCHARD_OK);
        clocked_reference(2); same_state(); CHECK(a.cpu.instructions==6);
        init(model,3); a.cpu.r[0]=0x4c000014u; a.cpu.r[1]=4;
        word(a.flash,0xe5801000u); word(a.flash+4,0xeafffffeu); duplicate();
        CHECK(orchard_run_clocked(&a,2).status==ORCHARD_OK);
        clocked_reference(2); same_state();
        CHECK(a.cpu.instructions==3 && orchard_clock_slots(&a)==1);
        /* A fault in the second of four slots terminates precisely. */
        init(model,3); a.cpu.control|=0xc0000000u;
        word(a.flash,0xe1a00000u); word(a.flash+4,0xee000f10u); duplicate();
        CHECK(orchard_run_clocked(&a,100).status!=ORCHARD_OK);
        clocked_reference(100); same_state(); CHECK(a.ticks==1);
        /* Mode and divider already belong to the portable checkpoint. */
        init(model,4); a.cpu.control|=0xc0000000u;
        CHECK(orchard_run_clocked(&a,19).status==ORCHARD_OK);
        size_t n=orchard_checkpoint_size(&a); CHECK(n<=sizeof saved);
        CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK); duplicate();
        a.soc.clock[5]=0; a.cpu.control=0x78u;
        CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);
        CHECK(orchard_clock_slots(&a)==4); same_state();
        CHECK(orchard_run_clocked(&a,0).status==ORCHARD_OK); same_state();
    }
}
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
    count_checks=failures=first=0; rng=0x1932410u;
    exercise(); exercise_clocked(); exercise_idle(true); exercise_idle(false); exercise_one_slot();
    return failures;
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
