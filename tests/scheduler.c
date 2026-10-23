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
    CHECK(a->nor_id_mode==b->nor_id_mode && a->nor_sequence==b->nor_sequence);
    CHECK(a->sram_alias_reads==b->sram_alias_reads && a->sram_alias_writes==b->sram_alias_writes);
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
static void instruction_intervals(void) {
    /* Dependent ALU/flag chains cross many peripheral boundaries and public
       budget partitions. None may be decoded against an earlier CPSR/GPR. */
    for (unsigned trial=0;trial<64;trial++) {
        init(); a->cpu.r[15]=O_RAM_BASE;
        for (unsigned reg=0;reg<15;reg++) a->cpu.r[reg]=rnd();
        for (unsigned i=0;i<31;i++) {
            unsigned kind=rnd()%16, rd=rnd()%15, rn=rnd()%16;
            unsigned flags=(kind>=8 && kind<=11)?1:rnd()%2;
            put(a->ram+4*i,(rnd()%16)<<28 | 1u<<25 | kind<<21 |
                flags<<20 | rn<<16 | rd<<12 | (rnd()&0xfffu));
        }
        put(a->ram+124,0xeaffffdf); /* back to first instruction */
        a->soc.wtcon=32|4;a->soc.wtcnt=5;a->soc.wtdat=7;
        *b=*a;
        for(unsigned part=0;part<20;part++) compare(rnd()%1000);
    }
    /* Observe mask/ISA/sleep changes before another instruction issues, even
       inside a quiet interval. MSR may unmask IRQ; a failed WFI may not sleep. */
    const uint32_t tails[]={0xe121f004,0xee070f90,0x0e070f90,0xe12fff14,
        0xe5901000,0xe1b0f00e,0xee010f10,0xffffffff};
    for(unsigned which=0;which<sizeof(tails)/sizeof(*tails);which++) {
        init();a->cpu.r[15]=O_RAM_BASE;a->cpu.r[0]=0x4d000068;
        a->cpu.r[4]=which==3?O_RAM_BASE+33:O_SYS|O_F;
        a->soc.srcpnd=a->soc.intpnd=1u<<9;a->soc.intmsk=~(1u<<9);
        for(unsigned i=0;i<8;i++)put(a->ram+4*i,0xe2800001);
        put(a->ram+12,tails[which]);put(a->ram+32,0xe7fe2001);
        *b=*a;compare(2);compare(1);compare(1);compare(1);compare(300);
    }
    /* Fetches can have bus side effects too. Every MMIO fetch synchronizes
       deferred time, including a condition-failed instruction. */
    init();a->cpu.r[15]=0x4c000000;
    for(unsigned i=0;i<6;i++)a->soc.clock[i]=0x12800001;
    *b=*a;compare(6);compare(1);
    /* A page-table descriptor read from UART is consumed once. A second fetch
       must walk it again and fault instead of executing a speculative opcode. */
    init();a->cpu.r[15]=0x00900000;a->cpu.control|=1;
    a->cpu.ttb=0x50000000;a->cpu.domain=UINT32_MAX;
    put(a->flash,0xe2800001);CHECK(o_q_push(&a->soc.rx,2));
    *b=*a;compare(2);CHECK(a->cpu.exceptions==1);
    /* A successful last-page instruction commits before the next fetch fails;
       the fault still consumes its exact quantum and retains the first result. */
    init();a->cpu.r[15]=a->profile->flash_bytes-4;
    put(a->flash+a->profile->flash_bytes-4,0xe2800001);
    *b=*a;compare(3);CHECK(a->cpu.r[0]==1 && a->cpu.exceptions==1);
    /* Stores in a continuing interval must affect the very next fetch, even
       through an SRAM mirror. The block must not retain decoded opcodes. */
    for(unsigned mirror=0;mirror<2;mirror++) {
        init();a->cpu.r[15]=O_RAM_BASE;
        if(mirror)CHECK(orchard_sram_select(a,ORCHARD_SRAM_BANK1_MIRROR)==ORCHARD_OK);
        a->cpu.r[1]=O_RAM_BASE+8+mirror*a->profile->ram_bytes;
        a->cpu.r[2]=0xe2800009;
        put(a->ram,0xe1a00000);put(a->ram+4,0xe5812000);put(a->ram+8,0xe2800001);
        *b=*a;compare(3);CHECK(a->cpu.r[0]==9);
    }
    /* A guest STR changes the already-memoized instruction descriptor. The
       following fetch uses the new mapping or takes its permission fault. */
    for(unsigned fault=0;fault<2;fault++) {
        init();a->cpu.r[15]=0x10000000;a->cpu.control|=1;
        a->cpu.ttb=O_RAM_BASE+0x4000;a->cpu.domain=UINT32_MAX;
        a->cpu.r[1]=O_RAM_BASE+0x4400;a->cpu.r[2]=fault?0:O_RAM_BASE|0xc02;
        put(a->ram+0x4200,O_RAM_BASE|0xc02);put(a->ram+0x4400,0xc02);
        put(a->flash,0xe1a00000);put(a->flash+4,0xe5812000);put(a->flash+8,0xe2800001);
        put(a->ram+8,0xe2800009);
        *b=*a;compare(3);
        CHECK(fault?a->cpu.exceptions==1:a->cpu.r[0]==9);
    }
}
EXPORT("regression") unsigned regression(void) {
    checks=failures=first=0; seed=0x2410920u;
    instruction_intervals();
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
    return failures;
}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){regression();printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
