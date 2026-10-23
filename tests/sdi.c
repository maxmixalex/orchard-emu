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
static uint8_t saved[1700000], expected[1700000], actual[1700000];
static uint8_t image_a[1048576], image_b[1048576];
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
static void wr_byte(uint8_t value) { CHECK(o_mmio_write(&a,0x5a00003c,1,value)); }
static uint8_t rd_byte(void) { uint32_t v=0; CHECK(o_mmio_read(&a,0x5a00003c,1,&v)); return (uint8_t)v; }
static uint32_t command(unsigned cmd,uint32_t argument,bool long_response) {
    wr(0x10,0x1e00); wr(8,argument); wr(0xc,0x140u|cmd|(cmd?0x200u:0u)|(long_response?0x400u:0u));
    step(a.soc.sdi.remaining);
    if(a.soc.sdi.remaining)step(a.soc.sdi.remaining);
    CHECK(!(rd(0x10)&0x500u));
    if(cmd)CHECK(rd(0x10)&0x200u);
    return rd(0x14);
}
static void ready(void) {
    command(0,0,false); CHECK(command(8,0x1aa,false)==0x1aa);
    CHECK(command(55,0,false)&0x20); CHECK(command(41,0x00ff8000,false)==0x80ff8000);
    command(2,0,true); CHECK(a.soc.sdi.card_state==2);
    CHECK((command(3,0,false)>>16)==1); command(9,1u<<16,true);
    uint32_t r[4]; for(unsigned i=0;i<4;i++)r[i]=rd(0x14u+4u*i);
    uint32_t csize=((r[1]&0x3ffu)<<2)|(r[2]>>30), mult=(r[2]>>15)&7u;
    CHECK((csize+1u)*(1u<<(mult+2u))*512u==sizeof image_a);
    command(7,1u<<16,false); CHECK(a.soc.sdi.card_state==4);
}
static void rx_start(unsigned blocks,uint32_t offset) {
    wr(0,2); wr(0x24,65535); wr(0x28,512); wr(0x2c,0xa2000u|blocks);
    command(blocks==1?17:18,offset,false);
}
static void tx_start(uint32_t offset) {
    wr(0,2); wr(0x24,65535); wr(0x28,512); wr(0x2c,0x123001);
    command(24,offset,false);
}
static void read_bytes(unsigned start,unsigned count) {
    for(unsigned i=0;i<count;i++) {
        if(!a.soc.sdi.fifo_count)step(16);
        CHECK(rd_byte()==image_a[start+i]);
    }
}
static void write_bytes(unsigned start,unsigned count) {
    for(unsigned i=0;i<count;i++) { wr_byte((uint8_t)((start+i)^0xa5u)); step(16); }
}
static void repair_crc(uint8_t *p,size_t n) {
    uint32_t c=UINT32_MAX;
    for(size_t i=32;i<n;i++) { c^=p[i]; for(unsigned bit=0;bit<8;bit++)c=(c>>1)^((0u-(c&1u))&0xedb88320u); }
    c=~c;for(unsigned i=0;i<4;i++)p[28+i]=(uint8_t)(c>>(8u*i));
}
static void media_tests(unsigned model) {
    init(model); for(unsigned i=0;i<sizeof image_a;i++)image_a[i]=(uint8_t)(i*13u+7u);
    CHECK(orchard_sd_bind(&a,a.ram,sizeof image_a)==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_sd_bind(&a,image_a,sizeof image_a)==ORCHARD_OK);
    CHECK(orchard_sd_insert(&a,512,false)==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_sd_insert(&a,sizeof image_a,false)==ORCHARD_OK);
    CHECK(orchard_sd_bind(&a,image_b,sizeof image_b)==ORCHARD_BAD_ARGUMENT);
    ready();
    CHECK(command(17,sizeof image_a,false)&(1u<<31));
    CHECK(command(17,1,false)&(1u<<30));
    /* A read is clock-driven, includes a finite FIFO, and survives either host. */
    rx_start(1,512); CHECK(rd(0x34)&1u); uint32_t left=a.soc.sdi.transfer_left;
    for(unsigned i=0;i<9;i++)rd(0x38);
    CHECK(a.soc.sdi.transfer_left==left);
    step(100); CHECK(a.soc.sdi.fifo_count>0);
    left=a.soc.sdi.transfer_left; command(13,1u<<16,false);
    CHECK(a.soc.sdi.transfer_left<left); /* Status polling must not restart RX. */
    uint32_t before=a.soc.sdi.data_remaining, count=a.soc.sdi.fifo_count;
    CHECK(o_mmio_write(&a,0x4c00000c,4,a.soc.clock[3]&~0x200u));step(1000);
    CHECK(a.soc.sdi.data_remaining==before&&a.soc.sdi.fifo_count==count);
    CHECK(o_mmio_write(&a,0x4c00000c,4,a.soc.clock[3]|0x200u));
    size_t n=orchard_checkpoint_size(&a); CHECK(n<sizeof saved);
    CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
    b=a; b.sd_storage=image_b; o_copy(image_b,image_a,sizeof image_a);
    step(1000);CHECK(o_run_reference(&b,1000).status==ORCHARD_OK);
    CHECK(orchard_checkpoint_save(&a,expected,n)==ORCHARD_OK);
    CHECK(orchard_checkpoint_save(&b,actual,n)==ORCHARD_OK);CHECK(equal(expected,actual,n));
    CHECK(a.soc.sdi.fifo_count==64); /* Backpressure never invents overflow bytes. */
    CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);
    read_bytes(512,512); CHECK((rd(0x34)&0x13u)==0x10u);
    CHECK(a.soc.sdi.read_blocks==1&&a.soc.sdi.card_state==4);
    CHECK(orchard_checkpoint_save(&a,expected,n)==ORCHARD_OK);
    CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);read_bytes(512,512);
    CHECK(orchard_checkpoint_save(&a,actual,n)==ORCHARD_OK);CHECK(equal(expected,actual,n));
    /* In-flight writes serialize their partial sector, not just completed data. */
    tx_start(1024);write_bytes(0,137);
    CHECK(a.soc.sdi.write_count==137&&image_a[1024]==7);
    CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
    o_copy(actual,saved,n); /* CRC-valid but inconsistent partial-sector offset. */
    for(unsigned i=0;i<4;i++)actual[4122+60+i]=0;
    repair_crc(actual,n);
    CHECK(orchard_checkpoint_load(&a,actual,n)==ORCHARD_BAD_ARGUMENT);
    CHECK(a.soc.sdi.write_count==137&&image_a[1024]==7);
    write_bytes(137,375);CHECK(a.soc.sdi.written_blocks==1&&a.sd_dirty);
    for(unsigned i=0;i<512;i++)CHECK(image_a[1024+i]==(uint8_t)(i^0xa5u));
    CHECK(orchard_checkpoint_save(&a,expected,n)==ORCHARD_OK);
    CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);
    CHECK(image_a[1024]==7&&a.soc.sdi.write_count==137);
    write_bytes(137,375);CHECK(orchard_checkpoint_save(&a,actual,n)==ORCHARD_OK);
    CHECK(equal(expected,actual,n));
    /* An unbound destination can validate/query, but cannot partially import. */
    CHECK(orchard_init(&b,sizeof b,model)==&b);
    CHECK(orchard_load_rom(&b,a.flash,a.profile->flash_bytes)==ORCHARD_OK);
    size_t required=0, empty=orchard_checkpoint_size(&b);
    CHECK(orchard_checkpoint_save(&b,actual,empty)==ORCHARD_OK);
    CHECK(orchard_checkpoint_sd_size(&b,saved,n,&required)==ORCHARD_OK&&required==sizeof image_a);
    CHECK(orchard_checkpoint_load(&b,saved,n)==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_checkpoint_save(&b,expected,empty)==ORCHARD_OK);CHECK(equal(expected,actual,empty));
    CHECK(orchard_sd_bind(&b,image_b,sizeof image_b)==ORCHARD_OK);
    CHECK(orchard_checkpoint_load(&b,saved,n)==ORCHARD_OK);
    CHECK(b.soc.sdi.write_count==137&&b.sd_bytes==sizeof image_b);
    o_copy(image_b,image_a,sizeof image_b);saved[n-1]^=1;
    CHECK(orchard_checkpoint_load(&b,saved,n)==ORCHARD_BAD_ARGUMENT);
    CHECK(equal(image_a,image_b,sizeof image_a));saved[n-1]^=1;
    /* Removal discards an incomplete sector and terminates the controller. */
    tx_start(2048);write_bytes(0,100);CHECK(image_a[2048]==7);
    CHECK(orchard_sd_eject(&a)==ORCHARD_OK);
    CHECK(image_a[2048]==7&&!(rd(0x34)&3u)&&(rd(0x34)&0x20u));
    CHECK(!a.sd_bytes&&!a.soc.sdi.data_remaining);
    CHECK(orchard_sd_insert(&a,sizeof image_a,true)==ORCHARD_OK);ready();
    CHECK(command(24,0,false)&(1u<<26));CHECK(command(38,0,false)&(1u<<26));
    /* A CRC-repaired session must not queue a write on protected media and
       defer its start until a later, otherwise valid SDIDCON write. */
    CHECK(!a.soc.sdi.data_event&&!a.soc.sdi.transfer_total&&!a.soc.sdi.transfer_left&&
          !a.soc.sdi.transfer_offset&&!a.soc.sdi.write_count);
    CHECK(orchard_checkpoint_save(&a,expected,n)==ORCHARD_OK);o_copy(actual,expected,n);
    actual[4122+52]=2;repair_crc(actual,n); /* Pending CARD_WRITE, no active data. */
    required=123;
    CHECK(orchard_checkpoint_sd_size(&a,actual,n,&required)==ORCHARD_BAD_ARGUMENT&&required==123);
    CHECK(orchard_checkpoint_load(&a,actual,n)==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);CHECK(equal(expected,saved,n));
    /* The controller start path also defends that invariant independently. */
    a.soc.sdi.transfer_kind=2;wr(0x28,512);wr(0x2c,0x123001);step(a.soc.sdi.data_remaining);
    CHECK(!a.soc.sdi.transfer_kind&&!a.soc.sdi.write_count&&!a.sd_dirty&&image_a[0]==7);
    orchard_reset(&a);CHECK(a.sd_bytes==sizeof image_a&&a.sd_write_protected);
    CHECK(a.soc.sdi.card_state==0&&a.soc.sdi.fifo_count==0&&image_a[1024]==0xa5);
}
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
        /* FILES initializes FIFO before card detection. Empty-slot data still
           times out; that valid register access must not hard-stop the CPU. */
        init(model);wr(0x24,3);wr(0x2c,0x2001);CHECK(rd(0x34)&1u);step(7);
        CHECK(!(rd(0x34)&0x20u));step(1);CHECK((rd(0x34)&0x23u)==0x20u);
        init(model);wr(0x3c,0x11223344);CHECK(rd_byte()==0x44);CHECK(rd_byte()==0x33);
        wr(0,0x12);wr(0x3c,0x11223344);CHECK(rd_byte()==0x11);CHECK(rd_byte()==0x22);
        CHECK(a.stop.status==ORCHARD_OK);
        init(model);CHECK(!o_mmio_write(&a,0x5a00002c,4,0x8000));CHECK(a.stop.status==ORCHARD_UNIMPLEMENTED_MMIO);
        init(model); uint32_t invalid_value=0; CHECK(!o_mmio_read(&a,0x5a000004,1,&invalid_value));
        CHECK(a.stop.status==ORCHARD_UNIMPLEMENTED_MMIO);
        init(model); wr(0xc,0x140); o_sdi before_sdi=a.soc.sdi;
        CHECK(!o_mmio_write(&a,0x5a00000c,4,0x341)); CHECK(equal(&a.soc.sdi,&before_sdi,sizeof before_sdi));
        init(model);
        if(model<5)CHECK(orchard_sd_bind(&a,image_a,sizeof image_a)==ORCHARD_BAD_ARGUMENT);
    }
    media_tests(5);media_tests(6);
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
