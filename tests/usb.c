/* SPDX-License-Identifier: MIT */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#endif
static orchard_machine m;
static unsigned checks_count, failures_count, failure_line;
#define CHECK(x) do { ++checks_count; if (!(x)) { ++failures_count; if (!failure_line) failure_line = __LINE__; } } while (0)
static void fresh(void) { CHECK(orchard_init(&m, sizeof(m), 6) == &m); }
static uint32_t readreg(unsigned offset) {
    uint32_t v = 0xdeadbeef;
    CHECK(o_phys_read(&m, 0x52000000u + offset, 4, &v)); return v;
}
static void wr(unsigned offset, uint32_t v) { CHECK(o_phys_write(&m, 0x52000000u + offset, 4, v)); }
static void same(const void *a, const void *b, size_t size) {
    const uint8_t *x = a, *y = b;
    bool equal = true; for (size_t i=0; i<size; ++i) if (x[i]!=y[i]) equal=false;
    CHECK(equal);
}
static void connected(void) {
    fresh(); CHECK(orchard_usb_attach(&m, true) == ORCHARD_OK);
    CHECK(orchard_usb_bus_reset(&m, true) == ORCHARD_USB_ACK);
    CHECK(readreg(0x144) == 8); CHECK(readreg(0x158) == 4);
    CHECK((m.soc.srcpnd & (1u<<25)) != 0);
    CHECK(orchard_usb_bus_reset(&m, false) == ORCHARD_USB_ACK);
    wr(0x158,4); m.soc.srcpnd = 0;
}
static void setup(unsigned addr, bool input, unsigned length) {
    const uint8_t p[8] = {(uint8_t)(input?0x80:0),6,0,1,0,0,(uint8_t)length,(uint8_t)(length>>8)};
    CHECK(orchard_usb_setup(&m, addr, p, 8) == ORCHARD_USB_ACK);
    CHECK(readreg(0x198) == 8);
    CHECK(readreg(0x184) & 1u);
    for(unsigned i=0; i<8; ++i) { CHECK(readreg(0x1c0)==p[i]); CHECK(readreg(0x198)==7-i); }
    CHECK(readreg(0x184)&1u); /* Reading last byte does not service EP0. */
    wr(0x184,0x40); wr(0x148,1);
}
static void registers(void) {
    fresh(); CHECK(readreg(0x140)==0); CHECK(readreg(0x144)==0);
    CHECK(readreg(0x148)==0); CHECK(readreg(0x158)==0);
    CHECK(readreg(0x15c)==31); CHECK(readreg(0x16c)==4);
    for (unsigned ep=0; ep<5; ++ep) {
        wr(0x178,ep); CHECK(readreg(0x178)==ep); CHECK(readreg(0x180)==1);
        CHECK(readreg(0x184)==0); CHECK(readreg(0x188)==0x20);
        wr(0x180,ep?8:2); wr(0x188,ep&1?0:0x20);
    }
    for(unsigned ep=0; ep<5; ++ep) {
        wr(0x178,ep); CHECK(readreg(0x180)==(ep?8u:2u));
        CHECK(readreg(0x188)==(ep&1?0:0x20));
    }
    wr(0x144,0xfffffffbu); CHECK(readreg(0x144)==1); /* RO RESET not forged. */
    wr(0x15c,0xffffffff); CHECK(readreg(0x15c)==31);
    wr(0x16c,0xff); CHECK(readreg(0x16c)==5);
    uint32_t snap[48], guard[48];
    CHECK(orchard_usb_snapshot(&m,snap,48)==48);
    o_copy(guard,snap,sizeof(snap)); CHECK(!orchard_usb_snapshot(&m,snap,47)); same(snap,guard,sizeof(snap));
    for(unsigned i=0; i<20; ++i) CHECK(orchard_usb_snapshot(&m,snap,48)==48);
    same(snap,guard,sizeof(snap));
    wr(0x178,1); wr(0x180,8);
    for(unsigned i=0;i<64;++i)wr(0x1c4,i);
    CHECK(m.soc.usb.ep[1].tx_size==64); wr(0x184,1); CHECK(readreg(0x184)==1);
    wr(0x184,8); CHECK(readreg(0x184)==0); CHECK(m.soc.usb.ep[1].tx_size==0);
    CHECK(readreg(0x148)==2);wr(0x148,0);CHECK(readreg(0x148)==2);wr(0x148,2);CHECK(readreg(0x148)==0);
    wr(0x188,0xa0);wr(0x180,1);for(unsigned i=0;i<8;++i)wr(0x1c4,i);
    CHECK(readreg(0x184)==1); /* AUTO_SET. */
}
static void input_transfers(void) {
    for(unsigned max=8;max<=16;max+=8) for(unsigned total=1; total<=37; ++total) {
        connected(); wr(0x180,max/8); setup(0,true,total);
        uint8_t bytes[16]; size_t n;
        CHECK(orchard_usb_in(&m,0,bytes,16,&n)==ORCHARD_USB_NAK);
        for(unsigned pos=0;pos<total;) {
            unsigned len=total-pos; if(len>max)len=max;
            for(unsigned j=0;j<len;++j)wr(0x1c0,(pos+j)*7+3);
            wr(0x184,2u | (pos+len==total?8u:0u));
            o_usb before; o_copy(&before,&m.soc.usb,sizeof(before));
            CHECK(orchard_usb_in(&m,0,bytes,len-1,&n)==ORCHARD_USB_BAD_ARGUMENT);
            same(&before,&m.soc.usb,sizeof(before));
            CHECK(orchard_usb_in(&m,0,bytes,16,&n)==ORCHARD_USB_ACK); CHECK(n==len);
            for(unsigned j=0;j<len;++j) CHECK(bytes[j]==(uint8_t)((pos+j)*7+3));
            CHECK(!(readreg(0x184)&2u)); CHECK(readreg(0x148)&1u);wr(0x148,1);pos+=len;
        }
        CHECK(readreg(0x184)&8u);
        CHECK(orchard_usb_out(&m,0,NULL,0)==ORCHARD_USB_ACK);
        CHECK(readreg(0x184)==0); CHECK(m.soc.usb.stage==0);CHECK(readreg(0x148)&1u);
        CHECK(orchard_usb_out(&m,0,NULL,0)==ORCHARD_USB_NAK);
    }
}
static void staged_reply(void) {
    connected();const uint8_t p[8]={128,8,0,0,0,0,1,0};
    CHECK(orchard_usb_setup(&m,0,p,8)==ORCHARD_USB_ACK);
    for(unsigned i=0;i<8;++i) CHECK(readreg(0x1c0)==p[i]);
    wr(0x1c0,0x55); /* TX can be staged after SETUP drained, before service. */
    wr(0x184,0x48);uint8_t reply=0;size_t n=9;
    CHECK(orchard_usb_in(&m,0,&reply,1,&n)==ORCHARD_USB_NAK);
    CHECK(n==0);CHECK(m.soc.usb.ep[0].tx_size==1);
    wr(0x184,0x0a);
    CHECK(orchard_usb_in(&m,0,&reply,1,&n)==ORCHARD_USB_ACK);
    CHECK(n==1 && reply==0x55);CHECK(orchard_usb_out(&m,0,NULL,0)==ORCHARD_USB_ACK);
}
static void early_status(void) {
    connected();setup(0,true,8);
    for(unsigned i=0;i<8;++i)wr(0x1c0,i);
    wr(0x184,2);uint8_t packet[16];size_t n;
    CHECK(orchard_usb_in(&m,0,packet,16,&n)==ORCHARD_USB_ACK);CHECK(n==8);
    wr(0x1c0,0xaa);wr(0x184,2); /* Guest preloads more before host status. */
    CHECK(orchard_usb_out(&m,0,NULL,0)==ORCHARD_USB_ACK);
    CHECK(readreg(0x184)==16);CHECK(m.soc.usb.ep[0].tx_size==0);
    CHECK(m.soc.usb.ep_pending&1u);wr(0x184,128);CHECK(readreg(0x184)==0);
    setup(0,true,8);wr(0x1c0,1);wr(0x184,2);
    CHECK(orchard_usb_in(&m,0,packet,16,&n)==ORCHARD_USB_ACK);CHECK(n==1);
    CHECK(orchard_usb_out(&m,0,NULL,0)==ORCHARD_USB_ACK);
    CHECK(readreg(0x184)&16u);
    uint32_t v=0;CHECK(!o_phys_read(&m,0x520001c0,4,&v));
    CHECK(m.stop.status==ORCHARD_UNIMPLEMENTED_MMIO);
}
static void output_transfers(void) {
    for(unsigned max=8;max<=16;max+=8) {
        connected();wr(0x180,max/8);setup(0,false,23);
        uint8_t data[16];for(unsigned i=0;i<16;++i)data[i]=(uint8_t)(31-i);
        unsigned pos=0;
        while(pos<23) {
            unsigned n=23-pos;if(n>max)n=max;
            CHECK(orchard_usb_out(&m,0,data,n)==ORCHARD_USB_ACK);
            o_usb before; o_copy(&before,&m.soc.usb,sizeof(before));
            CHECK(orchard_usb_out(&m,0,data,n)==ORCHARD_USB_NAK);same(&before,&m.soc.usb,sizeof(before));
            for(unsigned i=0;i<n;++i)CHECK(readreg(0x1c0)==data[i]);
            CHECK(readreg(0x184)&1u); pos+=n;
            wr(0x184,0x40u|(pos==23?8u:0u));
        }
        size_t n=99;CHECK(orchard_usb_in(&m,0,NULL,0,&n)==ORCHARD_USB_ACK);CHECK(n==0);
        CHECK(m.soc.usb.stage==0);CHECK(m.soc.usb.ep[0].in1==0);
    }
}
static void address_and_reset(void) {
    for(unsigned address=0;address<128;++address) {
        connected();setup(0,false,0);
        wr(0x140,0x80u|address);wr(0x184,8);
        CHECK(readreg(0x140)==(0x80u|address));CHECK(m.soc.usb.active_address==0);
        size_t n;uint8_t b[8];
        if(address)CHECK(orchard_usb_in(&m,address,b,8,&n)==ORCHARD_USB_NO_DEVICE);
        CHECK(orchard_usb_in(&m,0,b,8,&n)==ORCHARD_USB_ACK);CHECK(n==0);
        CHECK(m.soc.usb.active_address==address);CHECK(readreg(0x140)==address);
        setup(address,true,4);for(unsigned i=0;i<4;++i)wr(0x1c0,i);wr(0x184,10);
        CHECK(orchard_usb_bus_reset(&m,true)==ORCHARD_USB_ACK);
        CHECK(m.soc.usb.stage==0);CHECK(m.soc.usb.ep[0].tx_size==0);
        CHECK(orchard_usb_in(&m,0,b,8,&n)==ORCHARD_USB_NO_DEVICE);
        CHECK(orchard_usb_bus_reset(&m,false)==ORCHARD_USB_ACK);
        CHECK(readreg(0x140)==0);CHECK(readreg(0x180)==1);
    }
    connected();wr(0x16c,0);wr(0x158,4);m.soc.srcpnd=0;
    m.soc.usb.usb_pending=4;o_usb_tick(&m);CHECK(m.soc.srcpnd==0);
    wr(0x16c,4);o_usb_tick(&m);CHECK(m.soc.srcpnd==(1u<<25));
    m.soc.srcpnd=0;o_usb_tick(&m);CHECK(m.soc.srcpnd==(1u<<25));
    wr(0x158,4);m.soc.srcpnd=0;o_usb_tick(&m);CHECK(m.soc.srcpnd==0);
    CHECK(orchard_usb_sof(&m,0x7ff)==ORCHARD_USB_ACK);
    CHECK(readreg(0x170)==255);CHECK(readreg(0x174)==7);
    CHECK(orchard_usb_sof(&m,0)==ORCHARD_USB_ACK);CHECK(readreg(0x170)==0);
    m.ram[7]=42;m.cpu.r[2]=99;CHECK(orchard_usb_attach(&m,false)==ORCHARD_OK);
    CHECK(m.ram[7]==42);CHECK(m.cpu.r[2]==99);
}
static void interrupted_and_stall(void) {
    connected();setup(0,true,8);wr(0x1c0,7);wr(0x184,10);wr(0x140,0x8b);
    const uint8_t p[8]={0,5,9,0,0,0,0,0};
    CHECK(orchard_usb_setup(&m,0,p,8)==ORCHARD_USB_ACK);
    CHECK(readreg(0x184)==17);CHECK(readreg(0x140)==0);
    CHECK(m.soc.usb.ep[0].tx_size==0);wr(0x184,128);
    for(unsigned i=0;i<8;++i)CHECK(readreg(0x1c0)==p[i]);
    wr(0x184,0x60);uint8_t data[16];size_t n;
    CHECK(orchard_usb_in(&m,0,data,16,&n)==ORCHARD_USB_STALL);
    CHECK(readreg(0x184)&4u);CHECK(readreg(0x148)&1u);
    CHECK(orchard_usb_setup(&m,0,p,8)==ORCHARD_USB_ACK);
    CHECK(!(readreg(0x184)&0x34u));wr(0x184,0x48);
    CHECK(orchard_usb_in(&m,0,data,16,&n)==ORCHARD_USB_ACK);CHECK(n==0);
}
static void rejection(void) {
    static const unsigned offsets[]={0x150,0x154,0x17c,0x18c,0x1a0,0x230};
    for(unsigned i=0;i<sizeof(offsets)/sizeof(offsets[0]);++i) {
        fresh();o_usb before; o_copy(&before,&m.soc.usb,sizeof(before));uint32_t v=0;
        CHECK(!o_phys_read(&m,0x52000000u+offsets[i],4,&v));
        CHECK(m.stop.status==ORCHARD_UNIMPLEMENTED_MMIO);same(&before,&m.soc.usb,sizeof(before));
    }
    for(unsigned ep=5;ep<256;ep+=17) {
        fresh();wr(0x178,ep);uint32_t v=0;CHECK(!o_phys_read(&m,0x52000184,4,&v));CHECK(m.stop.detail==ep);
    }
    fresh();uint32_t v=0;CHECK(!o_phys_read(&m,0x52000144,2,&v));
    fresh();CHECK(!o_phys_write(&m,0x52000147,1,1));
    fresh();CHECK(!o_phys_write(&m,0x52000180,4,3));
    fresh();CHECK(!o_phys_write(&m,0x52000200,4,1));
    fresh();CHECK(!o_phys_write(&m,0x52000188,4,64));
    fresh();CHECK(!o_phys_read(&m,0x520001c0,1,&v));
    fresh();CHECK(!o_phys_write(&m,0x52000144,4,4));
    connected();o_usb before; o_copy(&before,&m.soc.usb,sizeof(before));
    const uint8_t p[8]={0};size_t n;
    CHECK(orchard_usb_setup(&m,0,p,7)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_setup(&m,1,p,8)==ORCHARD_USB_NO_DEVICE);
    CHECK(orchard_usb_setup(&m,128,p,8)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_sof(&m,2048)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_in(&m,0,NULL,16,&n)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_out(&m,0,p,17)==ORCHARD_USB_BAD_ARGUMENT);
    same(&before,&m.soc.usb,sizeof(before));CHECK(m.stop.status==0);
    orchard_reset(&m);CHECK(!m.soc.usb.attached);
    CHECK(orchard_usb_setup(&m,0,p,8)==ORCHARD_USB_NO_DEVICE);
}
#ifdef __wasm__
#define EXPORT(n) __attribute__((export_name(n)))
#else
#define EXPORT(n)
#endif
EXPORT("regression") unsigned regression(void) {
    checks_count=failures_count=failure_line=0;
    registers();staged_reply();early_status();input_transfers();output_transfers();address_and_reset();interrupted_and_stall();rejection();
    return failures_count;
}
EXPORT("checks") unsigned checks(void){return checks_count;}
EXPORT("first_failure") unsigned first_failure(void){return failure_line;}
#ifndef __wasm__
int main(void) { regression(); printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u}\n",checks_count,failures_count,failure_line);return failures_count?1:0; }
#endif
