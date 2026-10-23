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
    CHECK(a->sram_alias_reads==b->sram_alias_reads && a->sram_alias_writes==b->sram_alias_writes);
    CHECK(a->nor_device==b->nor_device && a->nor_sequence==b->nor_sequence && a->nor_id_mode==b->nor_id_mode);
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
/* Exercise mapping reuse through the public runner, within one uninterrupted
 * call. The reference runner validates the live translation on every fetch.
 * Directed final-state checks also specify the guest-visible result. */
static void mapped_program(void) {
    init();
    a->cpu.control=0x79; a->cpu.ttb=O_RAM_BASE+0x4000;
    a->cpu.domain=UINT32_MAX; a->cpu.r[15]=0x10001000u;
    put(a->ram+0x4400,O_RAM_BASE|2u|(3u<<10));
    for(unsigned i=0;i<5;i++)put(a->ram+0x1000+4*i,0xe1a00000);
}
static void fetch_mapping_boundaries(void) {
    /* Consecutive ALU, failed condition and in-page branch keep executing
       current instruction bytes with normal architectural accounting. */
    mapped_program();
    put(a->ram+0x1000,0xe3a00007); /* MOV r0,#7 */
    put(a->ram+0x1004,0xe2800001); /* ADD r0,r0,#1 */
    put(a->ram+0x1008,0x05812000); /* STREQ r2,[r1], condition false */
    put(a->ram+0x100c,0xeafffffc); /* B to the ADD */
    a->cpu.r[1]=0x60000000u;
    *b=*a;compare(8);
    CHECK(a->cpu.r[0]==10 && a->cpu.instructions==8);
    CHECK(a->cpu.r[15]==0x10001008u && a->stop.status==ORCHARD_OK);

    /* Ordinary NOR and boot SRAM instruction pages preserve their original
       read semantics too; only the translation checks may be reused. */
    for(unsigned boot=0;boot<2;boot++) {
        mapped_program();a->cpu.r[15]=0x10000000u;
        put(a->ram+0x4400,(boot?O_BOOT_SRAM_BASE:0)|2u|(3u<<10));
        uint8_t *code=boot?a->boot_sram:a->flash;
        for(unsigned i=0;i<3;i++)put(code+4*i,0xe1a00000);
        *b=*a;compare(3);
        CHECK(a->cpu.r[15]==0x1000000cu && a->cpu.instructions==3);
    }

    /* A store rewrites the very next opcode after an eligible predecessor. */
    mapped_program();put(a->ram+0x1004,0xe5812000);put(a->ram+0x1008,0xe3a00001);
    a->cpu.r[1]=0x10001008u;a->cpu.r[2]=0xe3a00007;
    *b=*a;compare(3);
    CHECK(a->cpu.r[0]==7 && a->cpu.instructions==3);

    /* A real NOR command executed after a safe predecessor enters software
       ID mode; the following fetch must report the original NOR diagnostic. */
    mapped_program();put(a->ram+0x4400,2u|(3u<<10));
    put(a->flash+0x1000,0xe1a00000);put(a->flash+0x1004,0xe1c120b0);
    a->cpu.r[1]=0x1000aaaau;a->cpu.r[2]=0x90;
    CHECK(orchard_nor_select(a,ORCHARD_NOR_SST39VF1601)==ORCHARD_OK);
    a->nor_sequence=2;
    *b=*a;compare(3);
    CHECK(a->nor_id_mode && a->stop.status==ORCHARD_UNIMPLEMENTED_FLASH);
    CHECK(a->cpu.r[15]==0x10001008u && a->cpu.instructions==2);

    /* Guest page-table writes are visible without CP15 maintenance. */
    mapped_program();put(a->ram+0x1004,0xe5812000);
    a->cpu.r[1]=0x10004400u;a->cpu.r[2]=0;
    *b=*a;compare(3);
    CHECK(a->cpu.r[15]==0xc && a->cpu.ifsr==5 && a->cpu.instructions==2);

    /* Every CP15 context dependency is changed by an actual guest opcode. */
    const unsigned crn[]={1,2,3,13};
    const uint32_t value[]={0x78,O_RAM_BASE+0x8000,0,0x02000000};
    const unsigned fault[]={8,5,9,5};
    for(unsigned k=0;k<4;k++) {
        mapped_program();put(a->ram+0x1004,0xee000f10u|(crn[k]<<16));
        a->cpu.r[0]=value[k];
        if(crn[k]==13) {
            a->cpu.r[15]=0x1000;
            put(a->ram+0x4000,O_RAM_BASE|2u|(3u<<10));
        }
        *b=*a;compare(3);
        CHECK(a->cpu.r[15]==0xc && a->cpu.ifsr==fault[k] && a->cpu.instructions==2);
    }

    /* A privilege change via MSR or an SPSR return revokes privileged-only
       execute access even when the next PC is on the same 1 KiB subpage. */
    for(unsigned restore=0;restore<2;restore++) {
        mapped_program();a->cpu.domain=1;
        put(a->ram+0x4400,O_RAM_BASE|2u|(1u<<10));
        put(a->ram+0x1004,restore?0xe1b0f00e:0xe121f000);
        a->cpu.r[0]=O_USR|O_I|O_F;a->cpu.r[14]=0x10001008u;
        a->cpu.spsr[2]=O_USR|O_I|O_F;
        *b=*a;compare(3);
        CHECK(a->cpu.r[15]==0xc && a->cpu.ifsr==13 && a->cpu.instructions==2);
    }

    /* Small pages have independent permissions at each 1 KiB boundary. */
    mapped_program();a->cpu.domain=1;a->cpu.cpsr=O_USR|O_I|O_F;
    a->cpu.r[15]=0x100003fcu;
    put(a->ram+0x4400,(O_RAM_BASE+0x8000)|1u);
    put(a->ram+0x8000,O_RAM_BASE|2u|(3u<<4));put(a->ram+0x3fc,0xe1a00000);
    *b=*a;compare(2);
    CHECK(a->cpu.r[15]==0xc && a->cpu.ifsr==15 && a->cpu.instructions==1);

    /* Sequential PC wrap is a new mapping, not continuation of the last page. */
    mapped_program();a->cpu.r[15]=0xfffffffcu;
    put(a->ram+0x7ffc,2u|(3u<<10));put(a->flash+0xffffc,0xe1a00000);
    *b=*a;compare(2);
    CHECK(a->cpu.r[15]==0xc && a->cpu.ifsr==5 && a->cpu.instructions==1);

    /* Aliased descriptor reads keep their access counts on every fetch. An
       aliased instruction source also retains the original physical bus. */
    for(unsigned source=0;source<2;source++) {
        mapped_program();
        CHECK(orchard_sram_select(a,ORCHARD_SRAM_BANK1_MIRROR)==ORCHARD_OK);
        if(source)put(a->ram+0x4400,(O_RAM_BASE+0x100000)|2u|(3u<<10));
        else a->cpu.ttb+=a->profile->ram_bytes;
        *b=*a;compare(3);
        CHECK(a->sram_alias_reads==3 && b->sram_alias_reads==3);
        CHECK(a->cpu.r[15]==0x1000100cu && a->cpu.instructions==3);
    }

    /* A descriptor read from UART RX consumes the legal descriptor once;
       the next fetch observes the empty FIFO, not a retained mapping. */
    mapped_program();a->cpu.ttb=0x50000000u;a->cpu.r[15]=0x00900000u;
    put(a->flash,0xe1a00000);CHECK(o_q_push(&a->soc.rx,2));
    *b=*a;compare(2);
    CHECK(a->soc.rx.count==0 && a->cpu.r[15]==0xc && a->cpu.ifsr==5);
    CHECK(a->cpu.instructions==1);

    /* Accepted IRQ/FIQ changes banks and privilege before the next fetch.
       User code and privileged vectors intentionally share a 1 KiB key,
       exercising interrupt acceptance after a reusable mapping was created. */
    for(unsigned fiq=0;fiq<2;fiq++) {
        mapped_program();a->cpu.r[15]=0x100;
        put(a->ram+0x4000,O_RAM_BASE|2u|(3u<<10));
        put(a->ram+0x100,0xeafffffe);
        put(a->ram+0x18,0xeafffffe);put(a->ram+0x1c,0xeafffffe);
        a->cpu.cpsr=O_USR;
        a->soc.wtcon=32|4;a->soc.wtphase=12;a->soc.wtcnt=1;a->soc.wtdat=3;
        a->soc.intmsk=~(1u<<9);a->soc.intmod=fiq?1u<<9:0;
        *b=*a;compare(5);
        CHECK((a->cpu.cpsr&31u)==(fiq?O_FIQ:O_IRQ));
        CHECK(a->cpu.r[15]==(fiq?0x1cu:0x18u) && a->cpu.instructions==4);
        CHECK(a->cpu.exceptions==1 && a->ticks==5);
    }

    /* A data abort and a diagnostic stop do not carry the predecessor's
       proof through rollback. Prefetch aborts never retire an instruction. */
    for(unsigned diagnostic=0;diagnostic<2;diagnostic++) {
        mapped_program();put(a->ram+0x1004,0xe5910000);
        a->cpu.r[1]=diagnostic?0x20000068u:0x20000000u;
        put(a->ram+0x4800,diagnostic?(0x4d000000u|2u):0);
        *b=*a;compare(2);
        if(diagnostic)CHECK(a->stop.status!=ORCHARD_OK && a->cpu.instructions==1);
        else CHECK(a->cpu.r[15]==0x10 && a->cpu.dfsr==5 && a->cpu.instructions==2);
    }

    /* Public call boundaries cannot retain a mapping across external writes;
       a standalone step between calls likewise always sees current tables. */
    mapped_program();*b=*a;compare(2);
    put(a->ram+0x4400,0);put(b->ram+0x4400,0);
    compare(1);
    CHECK(a->cpu.r[15]==0xc && a->cpu.ifsr==5 && a->cpu.instructions==2);
    mapped_program();*b=*a;compare(2);
    put(a->ram+0x4400,0);put(b->ram+0x4400,0);
    o_cpu_step(a);o_cpu_step_reference(b);same();
    CHECK(a->cpu.r[15]==0xc && a->cpu.ifsr==5 && a->cpu.instructions==2);
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
    fetch_mapping_boundaries();
    return failures;
}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){regression();printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
