/* SPDX-License-Identifier: MIT */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(name)
#else
#define EXPORT(name) __attribute__((export_name(name)))
#endif
static orchard_machine m;
static unsigned checks, failures, first_failure;
static void check(bool ok, unsigned line) {
    ++checks;
    if (!ok) {
        if (!failures) first_failure = line;
        ++failures;
#ifndef __wasm__
        if (failures < 20) fprintf(stderr,"usb.c:%u failed\n",line);
#endif
    }
}
#define CHECK(x) check((x),__LINE__)
#define BASE 0x52000000u
static void wr(unsigned offset, unsigned value) { CHECK(o_phys_write(&m,BASE+offset,4,value)); }
static uint32_t rd(unsigned offset) { uint32_t v=0xdeadbeef; CHECK(o_phys_read(&m,BASE+offset,4,&v)); return v; }
static bool equal(const void *a, const void *b, size_t n) {
    const uint8_t*x=a,*y=b;
    for(size_t i=0;i<n;++i)if(x[i]!=y[i])return false;
    return true;
}
static void bus(void) {
    orchard_reset(&m);
    CHECK(orchard_usb_connect(&m,true)==ORCHARD_OK);
    CHECK(orchard_usb_reset_signal(&m,true)==ORCHARD_OK);
    CHECK(orchard_usb_reset_signal(&m,false)==ORCHARD_OK);
    wr(0x158,7);wr(0x148,31);
}
static void setup(unsigned direction, unsigned length) {
    const uint8_t data[]={ (uint8_t)direction,6,0,1,0,0,(uint8_t)length,(uint8_t)(length>>8) };
    CHECK(orchard_usb_out(&m,0,0,true,0,data,8)==ORCHARD_USB_ACK);
    wr(0x178,0);
    CHECK(rd(0x184)&1);CHECK(rd(0x198)==8);
    for(unsigned i=0;i<8;++i)CHECK(rd(0x1c0)==data[i]);
    CHECK(rd(0x198)==0);
    CHECK(rd(0x184)&1); /* Draining alone never services EP0 OUT. */
    wr(0x184,64);wr(0x148,1);
}
static void registers(void) {
    orchard_reset(&m);
    CHECK(rd(0x140)==0&&rd(0x144)==0&&rd(0x148)==0&&rd(0x158)==0);
    CHECK(rd(0x15c)==31&&rd(0x16c)==4&&rd(0x170)==0&&rd(0x174)==0);
    for(unsigned ep=0;ep<5;++ep){wr(0x178,ep);CHECK(rd(0x180)==1);CHECK(rd(0x184)==0);CHECK(rd(0x188)==32);CHECK(rd(0x198)==0);}
    for(unsigned ep=0;ep<5;++ep){wr(0x178,ep);wr(0x180,ep==0?2:8);}
    for(unsigned ep=0;ep<5;++ep){wr(0x178,ep);CHECK(rd(0x180)==(ep==0?2u:8u));}
    CHECK(orchard_usb_reset_signal(&m,true)==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_usb_connect(&m,true)==ORCHARD_OK);m.ram[12]=99;m.cpu.r[3]=17;
    CHECK(orchard_usb_reset_signal(&m,true)==ORCHARD_OK);
    CHECK(rd(0x144)==8&&rd(0x158)==4&&rd(0x180)==1);
    CHECK(m.ram[12]==99&&m.cpu.r[3]==17&&m.soc.usb.resets==1);
    CHECK(orchard_usb_reset_signal(&m,true)==ORCHARD_OK&&m.soc.usb.resets==1);
    wr(0x144,0xfff9);CHECK(rd(0x144)==9); /* RO reset level and reserved lanes. */
    CHECK(orchard_usb_reset_signal(&m,false)==ORCHARD_OK);CHECK(rd(0x144)==1);
    CHECK(orchard_usb_sof(&m,2047)==ORCHARD_OK);CHECK(rd(0x170)==255&&rd(0x174)==7);
    CHECK(orchard_usb_sof(&m,2048)==ORCHARD_BAD_ARGUMENT);
    wr(0x16c,0);o_usb_tick(&m);CHECK(!(m.soc.srcpnd&(1u<<25)));
    wr(0x16c,4);o_usb_tick(&m);CHECK(m.soc.srcpnd&(1u<<25));
    wr(0x158,0);CHECK(rd(0x158)==4);wr(0x158,4);CHECK(rd(0x158)==0);
    m.soc.srcpnd=0;o_usb_tick(&m);CHECK(m.soc.srcpnd==0);
    orchard_usb_state before,after;orchard_get_usb_state(&m,&before);
    for(unsigned i=0;i<20;++i)orchard_get_usb_state(&m,&after);
    CHECK(equal(&before,&after,sizeof(before)));
    uint32_t value=0;
    CHECK(o_phys_read(&m,BASE+0x15c,1,&value)&&value==31);
    CHECK(o_phys_write(&m,BASE+0x15c,1,3));CHECK(rd(0x15c)==3);
    /* The two vendor-documented MAXP register layouts share indexed state.
       Check byte/word access, reserved bits, endpoint isolation and reset. */
    orchard_reset(&m);wr(0x178,2);wr(0x18c,0xf8);CHECK(rd(0x180)==8&&rd(0x18c)==8);
    CHECK(o_phys_write(&m,BASE+0x18c,1,4));CHECK(rd(0x180)==4);
    wr(0x178,1);CHECK(rd(0x180)==1&&rd(0x18c)==1);
    wr(0x180,8);CHECK(rd(0x18c)==8);
    orchard_reset(&m);CHECK(rd(0x180)==1&&rd(0x18c)==1);
    const unsigned bad[]={0x144+1,0x14c,0x150,0x164,0x17c,0x1bc,0x234};
    for(unsigned i=0;i<sizeof(bad)/sizeof(bad[0]);++i){orchard_reset(&m);CHECK(!o_phys_read(&m,BASE+bad[i],4,&value));}
    orchard_reset(&m);wr(0x178,255);CHECK(!o_phys_read(&m,BASE+0x184,4,&value));CHECK(m.stop.status==ORCHARD_UNSUPPORTED_USB);
    orchard_reset(&m);CHECK(!o_phys_read(&m,BASE+0x144,2,&value));
    orchard_reset(&m);CHECK(!o_phys_write(&m,BASE+0x144,4,4));CHECK(m.soc.usb.power==0);
    orchard_reset(&m);CHECK(!o_phys_read(&m,BASE+0x1c0,4,&value)); /* Empty is not fabricated zero. */
    orchard_reset(&m);wr(0x178,1);CHECK(!o_phys_write(&m,BASE+0x188,4,64));CHECK(m.soc.usb.ep[1].in2==32);
    for(unsigned i=0;i<4;++i){
        const unsigned bases[]={0x200,0x218,0x240,0x258};orchard_reset(&m);
        for(unsigned j=0;j<6;++j){wr(bases[i]+4*j,j?0xff:0);CHECK(rd(bases[i]+4*j)==(j==5?15u:j?255u:0u));}
        CHECK(!o_phys_write(&m,BASE+bases[i],4,1));CHECK(m.soc.usb.ep[i+1].dma[0]==0);
    }
}
static void control(void) {
    uint8_t data[64];size_t length;unsigned pid;
    bus();setup(128,18);
    for(unsigned packet=0;packet<3;++packet){
        unsigned n=packet==2?2:8;
        for(unsigned j=0;j<n;++j)wr(0x1c0,packet*8+j);
        wr(0x184,packet==2?10:2);
        CHECK(orchard_usb_in(&m,0,0,false,data,n-1,&length,&pid)==ORCHARD_USB_BUFFER_SMALL&&length==n);
        for(unsigned retry=0;retry<3;++retry){
            CHECK(orchard_usb_in(&m,0,0,false,data,sizeof(data),&length,&pid)==ORCHARD_USB_ACK);
            CHECK(length==n&&pid==(1u^(packet&1u))&&m.soc.usb.in_packets==packet);
            for(unsigned j=0;j<n;++j)CHECK(data[j]==packet*8+j);
        }
        CHECK(orchard_usb_in(&m,0,0,true,data,sizeof(data),&length,&pid)==ORCHARD_USB_ACK);
        CHECK(m.soc.usb.in_packets==packet+1&&rd(0x198)==0&&(rd(0x148)&1));
        wr(0x148,1);
    }
    CHECK(orchard_usb_out(&m,0,0,false,1,NULL,0)==ORCHARD_USB_ACK);
    CHECK(m.soc.usb.phase==0&&!(rd(0x184)&8)&&m.soc.usb.out_packets==1);
    /* Requested length cuts a control read before firmware's DATA_END. */
    bus();setup(128,8);for(unsigned j=0;j<8;++j)wr(0x1c0,j);wr(0x184,2);
    CHECK(orchard_usb_in(&m,0,0,true,data,sizeof(data),&length,&pid)==ORCHARD_USB_ACK);
    CHECK(orchard_usb_out(&m,0,0,false,1,NULL,0)==ORCHARD_USB_ACK);
    CHECK(rd(0x184)&16);wr(0x184,128);CHECK(!(rd(0x184)&16));
    /* SET_ADDRESS doesn't affect the status transaction's address. */
    bus();setup(0,0);wr(0x140,7);wr(0x184,8);
    CHECK(rd(0x140)==135&&m.soc.usb.active_address==0);
    CHECK(orchard_usb_in(&m,7,0,true,data,sizeof(data),&length,&pid)==ORCHARD_USB_NO_RESPONSE);
    CHECK(orchard_usb_in(&m,0,0,false,data,sizeof(data),&length,&pid)==ORCHARD_USB_ACK&&length==0&&pid==1);
    CHECK(m.soc.usb.active_address==0);
    CHECK(orchard_usb_in(&m,0,0,true,data,sizeof(data),&length,&pid)==ORCHARD_USB_ACK);
    CHECK(rd(0x140)==7&&m.soc.usb.active_address==7);
    CHECK(orchard_usb_in(&m,0,0,true,data,sizeof(data),&length,&pid)==ORCHARD_USB_NO_RESPONSE);
    /* Control write: DATA1, duplicate suppression, software service, status. */
    bus();setup(0,3);const uint8_t payload[]={11,22,33};
    CHECK(orchard_usb_out(&m,0,0,false,1,payload,3)==ORCHARD_USB_ACK);
    CHECK(orchard_usb_out(&m,0,0,false,1,payload,3)==ORCHARD_USB_ACK&&m.soc.usb.out_packets==1);
    CHECK(orchard_usb_out(&m,0,0,false,0,payload,3)==ORCHARD_USB_NAK);
    for(unsigned j=0;j<3;++j)CHECK(rd(0x1c0)==payload[j]);
    wr(0x184,72);CHECK(orchard_usb_in(&m,0,0,true,data,sizeof(data),&length,&pid)==ORCHARD_USB_ACK&&length==0);
    /* New SETUP preempts an unfinished control transfer and flushes TX. */
    bus();setup(128,18);wr(0x1c0,55);wr(0x184,2);wr(0x140,19);
    const uint8_t next[]={0,9,1,0,0,0,0,0};
    CHECK(orchard_usb_out(&m,0,0,true,0,next,8)==ORCHARD_USB_ACK);
    CHECK(rd(0x184)==17&&m.soc.usb.ep[0].tx_count==0&&rd(0x140)==0);
    wr(0x184,128);for(unsigned j=0;j<8;++j)CHECK(rd(0x1c0)==next[j]);
    wr(0x184,72);CHECK(orchard_usb_in(&m,0,0,true,data,sizeof(data),&length,&pid)==ORCHARD_USB_ACK);
    bus();setup(128,1);wr(0x184,32);CHECK(orchard_usb_in(&m,0,0,true,data,sizeof(data),&length,&pid)==ORCHARD_USB_STALL);
    CHECK(rd(0x184)&4);wr(0x184,0);CHECK(!(rd(0x184)&4));
    orchard_reset(&m);CHECK(!m.soc.usb.connected&&m.soc.usb.setups==0);
}
static void bulk(void) {
    uint8_t payload[64],bytes[64];size_t length;unsigned pid;
    for(unsigned ep=1;ep<5;++ep){
        for(unsigned n=0;n<=64;++n){
            bus();wr(0x178,ep);wr(0x180,8);wr(0x188,0); /* OUT */
            for(unsigned i=0;i<n;++i)payload[i]=(uint8_t)(i*7u+n);
            CHECK(orchard_usb_out(&m,0,ep,false,0,payload,n)==ORCHARD_USB_ACK);
            CHECK(rd(0x198)==n&&(rd(0x190)&1));
            CHECK(orchard_usb_out(&m,0,ep,false,1,payload,n)==ORCHARD_USB_NAK);
            wr(0x148,1u<<ep);
            CHECK(orchard_usb_out(&m,0,ep,false,0,payload,n)==ORCHARD_USB_ACK);
            CHECK(rd(0x148)==0&&m.soc.usb.out_packets==1);
            for(unsigned i=0;i<n;++i){CHECK(rd(0x1c0+ep*4)==payload[i]);CHECK(rd(0x198)==n-i-1);}
            CHECK(rd(0x190)&1);wr(0x190,0);
            CHECK(orchard_usb_out(&m,0,ep,false,1,payload,n)==ORCHARD_USB_ACK);
            wr(0x190,16);CHECK(rd(0x198)==0&&!(rd(0x190)&1));
            wr(0x188,32);wr(0x184,64); /* IN + reset toggle */
            CHECK(orchard_usb_in(&m,0,ep,true,bytes,sizeof(bytes),&length,&pid)==ORCHARD_USB_NAK);
            for(unsigned i=0;i<n;++i)wr(0x1c0+ep*4,payload[i]);
            wr(0x184,1);wr(0x148,31);
            CHECK(orchard_usb_in(&m,0,ep,false,bytes,sizeof(bytes),&length,&pid)==ORCHARD_USB_ACK&&length==n&&pid==0);
            CHECK(equal(bytes,payload,n)&&rd(0x148)==0&&m.soc.usb.in_packets==0);
            CHECK(orchard_usb_in(&m,0,ep,true,bytes,sizeof(bytes),&length,&pid)==ORCHARD_USB_ACK);
            CHECK((rd(0x148)&(1u<<ep))&&m.soc.usb.in_packets==1&&!(rd(0x184)&1));
            wr(0x184,16);CHECK(orchard_usb_in(&m,0,ep,true,bytes,sizeof(bytes),&length,&pid)==ORCHARD_USB_STALL);
            CHECK(rd(0x184)&32);wr(0x184,0);CHECK(rd(0x184)==0);
        }
        bus();wr(0x178,ep);wr(0x180,8);wr(0x188,160); /* AUTO_SET */
        for(unsigned i=0;i<64;++i)wr(0x1c0+ep*4,i);
        CHECK(rd(0x184)&1);
        CHECK(!o_phys_write(&m,BASE+0x1c0+ep*4,4,99)); /* Owns ready packet until ACK. */
        bus();wr(0x178,ep);wr(0x180,8);wr(0x188,0);wr(0x194,128);
        CHECK(orchard_usb_out(&m,0,ep,false,0,payload,1)==ORCHARD_USB_ACK);CHECK(rd(0x1c0+ep*4)==payload[0]);CHECK(!(rd(0x190)&1));
        bus();wr(0x178,ep);wr(0x180,4);
        CHECK(orchard_usb_out(&m,0,ep,false,0,payload,1)==ORCHARD_USB_UNSUPPORTED);
        CHECK(orchard_usb_in(&m,0,ep,true,bytes,sizeof(bytes),&length,&pid)==ORCHARD_USB_UNSUPPORTED);
    }
}
static void invalid(void) {
    bus();uint8_t b[65];o_zero(b,sizeof(b));size_t n;unsigned pid;
    CHECK(orchard_usb_out(NULL,0,0,true,0,b,8)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_out(&m,0,5,false,0,b,1)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_out(&m,128,0,true,0,b,8)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_out(&m,0,0,true,1,b,8)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_out(&m,0,0,true,0,b,7)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_out(&m,0,0,true,0,NULL,8)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_out(&m,0,1,false,0,b,65)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_in(&m,0,0,true,b,64,NULL,&pid)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_in(&m,0,0,true,b,64,&n,NULL)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(orchard_usb_in(&m,0,0,true,NULL,64,&n,&pid)==ORCHARD_USB_BAD_ARGUMENT);
    CHECK(m.soc.usb.setups==0&&m.soc.usb.in_packets==0&&m.soc.usb.out_packets==0);
    orchard_usb_connect(&m,false);CHECK(orchard_usb_out(&m,0,0,true,0,b,8)==ORCHARD_USB_NO_RESPONSE);
    CHECK(orchard_usb_sof(&m,0)==ORCHARD_BAD_ARGUMENT);
}
EXPORT("regression") unsigned run(void) {
    checks=failures=first_failure=0;
    if(!orchard_init(&m,sizeof(m),6))return 1;
    registers();control();bulk();invalid();return failures;
}
EXPORT("checks") unsigned get_checks(void) {return checks;}
EXPORT("first_failure") unsigned get_first(void) {return first_failure;}
#ifndef __wasm__
int main(void){unsigned result=run();printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u}\n",checks,result,first_failure);return result?1:0;}
#endif
