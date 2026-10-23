/* SPDX-License-Identifier: MIT */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(n)
#else
#define EXPORT(n) __attribute__((export_name(n)))
#endif
static bool equal(const void *x,const void *y,size_t n) {
    const uint8_t *a=x,*b=y;
    for(size_t i=0;i<n;i++) if(a[i]!=b[i]) return false;
    return true;
}

static orchard_machine a,b;
static uint8_t saved[600000], expected[600000], actual[600000];
static unsigned checks,failures,first;
#define CHECK(x) do { ++checks; if (!(x)) { if (!failures) first=__LINE__; ++failures; } } while (0)
static void init(unsigned model) {
    CHECK(orchard_init(&a,sizeof a,model)==&a);
    a.loaded=true; a.flash[0]=0xfe; a.flash[1]=a.flash[2]=0xff; a.flash[3]=0xea;
    a.soc.wtcon=0; a.cpu.cpsr=O_SVC|O_I|O_F;
}
static void wr(uint32_t offset,uint32_t value) { CHECK(o_mmio_write(&a,0x5a000000u+offset,4,value)); }
static uint32_t rd(uint32_t offset) { uint32_t value=0; CHECK(o_mmio_read(&a,0x5a000000u+offset,4,&value)); return value; }
static void step(unsigned n) { CHECK(orchard_run(&a,n).status==ORCHARD_OK); }
EXPORT("regression") unsigned regression(void) {
    checks=failures=first=0;
    for(unsigned model=1;model<=6;model++) {
        init(model); CHECK(rd(0x24)==0x2000); CHECK(rd(0x10)==0);
        wr(0,0xffffffffu); CHECK(rd(0)==0x1d); wr(4,0x101); CHECK(rd(4)==1);
        wr(8,0x12345678u); CHECK(rd(8)==0x12345678u);
        wr(0xc,0x140); CHECK(rd(0x10)==0x100);
        CHECK(a.soc.sdi.remaining==192); /* 48 serial clocks, PCLK/4. */
        for(unsigned i=0;i<3;i++) CHECK(rd(0x10)==0x100); /* Reads cannot complete it. */
        step(191); CHECK(rd(0x10)==0x100); step(1); CHECK(rd(0x10)==0x800);
        CHECK(!(rd(0xc)&0x100)); wr(0x10,0x800); CHECK(rd(0x10)==0);
        wr(0x40,1u<<15); wr(0xc,0x341); step(192); CHECK(rd(0x10)==0x900);
        /* Clearing sent during response wait must not restart the command phase. */
        wr(0x10,0x800); CHECK(rd(0x10)==0x100); step(255); CHECK(rd(0x10)==0x100);
        step(1); CHECK(rd(0x10)==0x400); CHECK(a.soc.srcpnd&(1u<<21));
        for(unsigned offset=0x14;offset<=0x20;offset+=4) CHECK(rd(offset)==0);
        wr(0x10,0x400); CHECK(rd(0x10)==0); CHECK(a.soc.srcpnd&(1u<<21));
        CHECK(o_mmio_write(&a,0x4a000000,4,1u<<21)); step(1); CHECK(!(a.soc.srcpnd&(1u<<21)));
        /* Clock gating freezes a live command, including scheduler fast-forward. */
        wr(0xc,0x340); step(7); uint32_t before=a.soc.sdi.remaining;
        CHECK(o_mmio_write(&a,0x4c00000c,4,a.soc.clock[3]&~0x200u)); step(1000);
        CHECK(a.soc.sdi.remaining==before);
        CHECK(o_mmio_write(&a,0x4c00000c,4,a.soc.clock[3]|0x200u));
        b=a; step(800); CHECK(o_run_reference(&b,800).status==ORCHARD_OK);
        size_t n=orchard_checkpoint_size(&a);
        CHECK(orchard_checkpoint_save(&a,expected,n)==ORCHARD_OK);
        CHECK(orchard_checkpoint_save(&b,actual,n)==ORCHARD_OK);
        CHECK(equal(expected,actual,n));
        /* Save/restore in either command phase preserves the next IRQ boundary. */
        for(unsigned elapsed=37;elapsed<300;elapsed+=192) {
            init(model); wr(4,1); wr(0x40,1u<<15); wr(0xc,0x341); step(elapsed);
            CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK); b=a;
            step(600); CHECK(orchard_checkpoint_save(&a,expected,n)==ORCHARD_OK);
            a=b; CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);
            step(600); CHECK(orchard_checkpoint_save(&a,actual,n)==ORCHARD_OK);
            CHECK(equal(expected,actual,n));
        }
        /* Never report success for absent media data/DMA/FIFO access. */
        init(model); CHECK(!o_mmio_write(&a,0x5a00002c,4,0x2001));
        CHECK(a.stop.status==ORCHARD_UNIMPLEMENTED_MMIO && a.soc.sdi.data_control==0);
        init(model); CHECK(!o_mmio_write(&a,0x5a00003c,4,1)); CHECK(a.stop.status==ORCHARD_UNIMPLEMENTED_MMIO);
        init(model); uint32_t invalid_value=0; CHECK(!o_mmio_read(&a,0x5a000004,1,&invalid_value));
        CHECK(a.stop.status==ORCHARD_UNIMPLEMENTED_MMIO);
        init(model); wr(0xc,0x140); o_sdi before_sdi=a.soc.sdi;
        CHECK(!o_mmio_write(&a,0x5a00000c,4,0x341)); CHECK(equal(&a.soc.sdi,&before_sdi,sizeof before_sdi));
    }
    return failures;
}
EXPORT("checks") unsigned get_checks(void) { return checks; }
EXPORT("first_failure") unsigned get_first(void) { return first; }
#ifndef __wasm__
int main(void) {
    regression();
    printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);
    return failures?1:0;
}
#endif
