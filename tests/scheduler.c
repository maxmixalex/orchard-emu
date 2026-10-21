/* SPDX-License-Identifier: MIT */
#include "internal.h"
#include "orchard/clock.h"
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
    CHECK(!different(a->boot_sram,b->boot_sram,sizeof(a->boot_sram)));
    CHECK(a->sram_alias_reads==b->sram_alias_reads && a->sram_alias_writes==b->sram_alias_writes);
    CHECK(a->ticks==b->ticks);
    CHECK(a->quiet_left==0 && a->deferred_ticks==0);
    CHECK(a->boot_memo_active==0 && a->boot_memo_pages==0);
}
static void compare(unsigned budget) { (void)orchard_run(a,budget); (void)o_run_reference(b,budget); same(); }
static void guest_mmio(uint32_t address, uint32_t value, bool write) {
    init(); a->cpu.r[15]=O_RAM_BASE; a->cpu.r[0]=address; a->cpu.r[1]=value;
    put(a->ram,0xe1a00000); /* NOP first creates a nonempty quiet window. */
    put(a->ram+4,write?0xe5801000:0xe5901000);
    put(a->ram+8,0xeafffffc);
}
static void boot_program(void) {
    init();
    a->cpu.control=0x79;a->cpu.ttb=O_BOOT_SRAM_BASE;a->cpu.domain=UINT32_MAX;
    a->cpu.r[15]=0x10000000;a->cpu.r[0]=0x20000400;a->cpu.r[1]=2;
    a->cpu.r[2]=0xfeed;a->soc.clock[5]=0;
    put(a->boot_sram+0x400,O_RAM_BASE|2u); /* Code: VA 0x10000000 -> RAM. */
    put(a->boot_sram+0x800,O_BOOT_SRAM_BASE|2u); /* A guest table-write mapping. */
    put(a->ram,0xe1a00000);put(a->ram+4,0xe1a00000); /* Warm fetch before event. */
    put(a->ram+8,0xe5801000); /* STR r1,[r0]: remap the next fetch to NOR. */
    put(a->ram+12,0xe3a02011);put(a->flash+12,0xe3a02077);
}
static void boot_mapping_boundaries(void) {
    orchard_stop (*const runners[])(orchard_machine *,uint32_t)={
        orchard_run,orchard_run_divided,orchard_run_clocked,orchard_run_idle};
    /* Each policy must notice a descriptor write within this same call,
       without a guest TLB operation. Byte/halfword updates change its base. */
    for(unsigned policy=0;policy<4;policy++) for(unsigned width=0;width<3;width++) {
        boot_program();
        if(width==0){put(a->ram+8,0xe5c01000);a->cpu.r[0]+=3;a->cpu.r[1]=0;}
        if(width==1){put(a->ram+8,0xe1c010b0);a->cpu.r[0]+=2;a->cpu.r[1]=0;}
        *b=*a;(void)runners[policy](a,4);(void)o_run_reference(b,4);same();
        CHECK(a->cpu.r[2]==0x77 && a->cpu.instructions==4 && a->ticks==4);
    }
    /* The four slots of one divided/clocked quantum share the same rule. */
    for(unsigned policy=1;policy<=2;policy++) {
        boot_program();a->soc.clock[5]=3;a->cpu.control|=1u<<30;
        (void)runners[policy](a,1);
        CHECK(a->cpu.r[2]==0x77 && a->cpu.instructions==4 && a->ticks==1);
        CHECK(!a->boot_memo_active && !a->boot_memo_pages);
    }
    /* Zeroing an already hot L1 entry faults the very next fetch. */
    boot_program();a->cpu.r[1]=0;*b=*a;compare(4);
    CHECK(a->cpu.instructions==3 && a->cpu.exceptions==1 && a->cpu.ifsr==5);
    CHECK(a->cpu.r[15]==0x0c && a->cpu.r[2]==0xfeed);
    /* A hot two-level mapping watches both boot pages, but a RAM L2 table
       must stay live even when written through the selected SRAM alias. */
    for(unsigned changed=0;changed<4;changed++) {
        /* A different 1 KiB page avoids colliding with the code-fetch memo. */
        boot_program();a->cpu.r[3]=0x30000700;
        put(a->boot_sram+0xc00,O_BOOT_SRAM_BASE|1u);
        put(a->boot_sram+4,O_RAM_BASE|2u);
        put(a->ram+0x700,0x12345678);put(a->flash+0x700,0x9abcdef0);
        put(a->ram,0xe5932000);put(a->ram+4,0xe5932000);put(a->ram+12,0xe5932000);
        a->cpu.r[0]=changed==1?0x20000c00:0x20000004;
        a->cpu.r[1]=changed==1?0:2;
        if(changed>=2) {
            put(a->boot_sram+0xc00,(O_RAM_BASE+0x2000)|1u);
            put(a->ram+0x2004,O_RAM_BASE|2u);a->cpu.r[0]=0x10002004;
            if(changed==3) {
                CHECK(orchard_sram_select(a,ORCHARD_SRAM_BANK1_MIRROR)==ORCHARD_OK);
                a->cpu.r[0]+=a->profile->ram_bytes;
            }
        }
        *b=*a;compare(4);
        if(changed==1) {
            CHECK(a->cpu.instructions==4 && a->cpu.exceptions==1 && a->cpu.dfsr==5);
            CHECK(a->cpu.far==0x30000700 && a->cpu.r[2]==0x12345678);
        } else CHECK(a->cpu.r[2]==0x9abcdef0 && a->cpu.exceptions==0);
    }
    /* A legal last-word L2 descriptor is watched; a table beyond the boot
       bank still takes the bus and raises the original external-walk fault. */
    for(unsigned outside=0;outside<2;outside++) {
        boot_program();a->cpu.r[3]=0x300ffc00;
        put(a->boot_sram+0xc00,(O_BOOT_SRAM_BASE+0xc00)|1u);
        put(a->boot_sram+0xffc,O_RAM_BASE|2u);
        put(a->ram,0xe5932000);put(a->ram+4,0xe5932000);put(a->ram+12,0xe5932000);
        a->cpu.r[0]=outside?0x20000c00:0x20000ffc;
        a->cpu.r[1]=outside?(O_BOOT_SRAM_BASE+O_BOOT_SRAM_SIZE)|1u:2;
        put(a->flash+0xc00,0x76543210);
        *b=*a;compare(4);
        if(outside) CHECK(a->cpu.exceptions==1 && a->cpu.dfsr==14 && a->cpu.far==0x300ffc00);
        else CHECK(a->cpu.r[2]==0x76543210 && a->cpu.exceptions==0);
    }
    /* CP15 context writes follow hot code fetches in one public call. */
    for(unsigned context=0;context<4;context++) {
        boot_program();
        if(context==0) { /* AP=0 privileged reads depend on c1 S/R. */
            a->cpu.control=0x179;a->cpu.domain=1;a->cpu.r[0]=0x79;
            put(a->ram+8,0xee010f10); /* MCR p15,0,r0,c1,c0,0 */
        } else if(context==1) {
            a->cpu.r[0]=O_RAM_BASE+0x4000;put(a->ram+0x4400,2);
            put(a->ram+8,0xee020f10); /* MCR ... c2: new table maps code to NOR. */
        } else if(context==2) {
            a->cpu.r[0]=0;put(a->ram+8,0xee030f10); /* MCR ... c3: no domain access. */
        } else {
            a->cpu.r[15]=0;a->cpu.r[0]=0x02000000;
            put(a->boot_sram,O_RAM_BASE|2u);put(a->boot_sram+0x80,2);
            put(a->ram+8,0xee0d0f10); /* MCR ... c13: FCSE changes effective VA. */
        }
        *b=*a;compare(4);
        if(context==0 || context==2) {
            CHECK(a->cpu.instructions==3 && a->cpu.exceptions==1);
            CHECK(a->cpu.ifsr==(context==0?13u:9u) && a->cpu.r[2]==0xfeed);
        } else CHECK(a->cpu.r[2]==0x77 && a->cpu.instructions==4 && !a->cpu.exceptions);
    }
    /* Privilege changes use a different access key, even in the same scope. */
    boot_program();a->cpu.domain=1;a->cpu.r[0]=O_USR|O_I|O_F;
    put(a->boot_sram+0x400,O_RAM_BASE|0x402u);
    put(a->ram+8,0xe121f000); /* MSR CPSR_c,r0 */
    *b=*a;compare(4);CHECK(a->cpu.ifsr==13 && a->cpu.instructions==3 && a->cpu.exceptions==1);
    /* Public returns must admit direct host edits, including a zero budget
       between the old and new mappings. Standalone translation stays live. */
    boot_program();*b=*a;compare(2);compare(0);
    put(a->boot_sram+0x400,2);put(b->boot_sram+0x400,2);
    put(a->flash+8,0xe3a02077);put(b->flash+8,0xe3a02077);
    compare(1);CHECK(a->cpu.r[2]==0x77);
    put(a->boot_sram+0x400,O_RAM_BASE|2u);
    uint32_t physical=0;
    CHECK(o_translate(a,0x10000000,false,true,false,&physical) && physical==O_RAM_BASE);
    /* Reusing generation 1 after wrap must not revive the original mapping. */
    boot_program();*b=*a;compare(1);
    a->boot_memo_epoch=UINT32_MAX;b->boot_memo_epoch=UINT32_MAX;
    put(a->boot_sram+0x400,2);put(b->boot_sram+0x400,2);
    put(a->flash+4,0xe3a02077);put(b->flash+4,0xe3a02077);
    compare(1);CHECK(a->cpu.r[2]==0x77);
    /* Unlike ARM stores, the internal physical bus accepts unaligned spans.
       Open a scope explicitly here to test a write entering a watched page. */
    boot_program();o_boot_memo_advance(a);
    CHECK(o_translate(a,0x10000000,false,true,false,&physical) && physical==O_RAM_BASE);
    CHECK(o_translate(a,0x10000000,false,true,false,&physical) && physical==O_RAM_BASE);
    CHECK(o_phys_write(a,O_BOOT_SRAM_BASE+0x3ff,2,0));
    CHECK(!o_translate(a,0x10000000,false,true,false,&physical) && a->cpu.ifsr==5);
    CHECK(!o_phys_write(a,O_BOOT_SRAM_BASE+O_BOOT_SRAM_SIZE-1u,2,0));
    (void)orchard_run(a,0);CHECK(!a->boot_memo_active && !a->boot_memo_pages);
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
    boot_mapping_boundaries();
    return failures;
}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){regression();printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
