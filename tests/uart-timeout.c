/* SPDX-License-Identifier: MIT
 * S3C2410A chapter 11: fixed PCLK FIFO idle-timeout deadlines. These are
 * functional decoded-byte cases, not optical/UEXTCLK or physical calibration.
 */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(n)
#else
#define EXPORT(n) __attribute__((export_name(n)))
#endif
static orchard_machine a,b;
static uint8_t saved[600000],again[600000];
static unsigned checks,failures,first;
#define CHECK(x) do{++checks;if(!(x)){if(!failures)first=__LINE__;++failures;}}while(0)
static void put(uint8_t *p,uint32_t n){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(n>>(8u*i));}
static bool equal(const void *x,const void *y,size_t n){const uint8_t *p=x,*q=y;for(size_t i=0;i<n;i++)if(p[i]!=q[i])return false;return true;}
static uint32_t crc(const uint8_t *p,size_t n){uint32_t v=~0u;for(size_t i=0;i<n;i++){v^=p[i];for(unsigned j=0;j<8;j++)v=(v>>1)^((0u-(v&1u))&0xedb88320u);}return ~v;}
static uint32_t base(unsigned ch){return 0x50000000u+ch*0x4000u;}
static uint32_t bit(unsigned ch){return 1u<<(ch*3u);}
static void init(void){CHECK(orchard_init(&a,sizeof a,2)==&a);a.loaded=true;a.soc.wtcon=0;put(a.flash,0xeafffffe);}
static void wr(unsigned ch,unsigned off,uint32_t n){CHECK(o_mmio_write(&a,base(ch)+off,4,n));}
static uint32_t rd(unsigned ch,unsigned off){uint32_t n=0;CHECK(o_mmio_read(&a,base(ch)+off,4,&n));return n;}
static void tick(uint32_t n){CHECK(orchard_run(&a,n).status==ORCHARD_OK);}
static void clear(unsigned ch){CHECK(o_mmio_write(&a,0x4a000018u,4,bit(ch)));}
static void setup(unsigned ch,uint32_t line,unsigned trigger,uint32_t divisor,bool level){
    wr(ch,0,line);wr(ch,0x28,divisor);wr(ch,8,1u|(trigger<<4));wr(ch,4,level?0x181:0x81);
}
static void send(unsigned ch,unsigned n){
    uint8_t bytes[16]={0};for(unsigned i=0;i<n;i++)bytes[i]=(uint8_t)(0x40+i);
    CHECK(orchard_uart_send_channel(&a,ch,bytes,n)==n);
    CHECK((rd(ch,0x18)&0x10fu)==(n==16?0x100u:n)); /* Admit at this MMIO boundary. */
}
static void deadlines(void){
    /* Fixed complete-frame sizes: start + data + optional parity + stop(s). */
    static const struct{unsigned line,bits;} formats[]={
        {0,7},{1,8},{2,9},{3,10},{7,11},{0x23,11},{0x27,12},{0x43,10},
    };
    for(unsigned ch=0;ch<3;ch++)for(unsigned trigger=0;trigger<4;trigger++)
    for(unsigned f=0;f<sizeof formats/sizeof *formats;f++)for(unsigned level=0;level<2;level++){
        init();setup(ch,formats[f].line,trigger,7,level!=0);send(ch,4*(trigger+1)-1);
        uint32_t deadline=3u*formats[f].bits*128u;
        CHECK(a.soc.uart_state[ch].rx_timeout_remaining==deadline);
        tick(deadline-1);CHECK(!(a.soc.subsrcpnd&bit(ch)));
        CHECK(a.soc.uart_state[ch].rx_timeout_remaining==1);
        tick(1);CHECK(a.soc.subsrcpnd&bit(ch));
        CHECK(a.soc.uart_state[ch].rx_timeout_latched==1);
        clear(ch);tick(1);CHECK(!!(a.soc.subsrcpnd&bit(ch))==!!level);
        while(a.soc.uart_state[ch].rx_count)(void)rd(ch,0x24);
        clear(ch);tick(deadline+1);CHECK(!(a.soc.subsrcpnd&bit(ch)));
        CHECK(!a.soc.uart_state[ch].rx_timeout_remaining&&!a.soc.uart_state[ch].rx_timeout_latched);
    }
}
static void restart_and_cancel(void){
    for(unsigned ch=0;ch<3;ch++){
        init();setup(ch,3,0,0,true);send(ch,1);tick(479);
        uint8_t byte=0x55;CHECK(orchard_uart_send_channel(&a,ch,&byte,1)==1);
        CHECK(rd(ch,0x18)==2);tick(479);CHECK(!(a.soc.subsrcpnd&bit(ch)));
        /* Reading one byte does not invent a new receive arrival. */
        CHECK(rd(ch,0x24)==0x40);tick(1);CHECK(a.soc.subsrcpnd&bit(ch));
        CHECK(rd(ch,0x24)==0x55);clear(ch);tick(500);CHECK(!(a.soc.subsrcpnd&bit(ch)));
        send(ch,1);tick(200);wr(ch,8,3);clear(ch);tick(500);
        CHECK(!(a.soc.subsrcpnd&bit(ch))&&!a.soc.uart_state[ch].rx_timeout_remaining);
        send(ch,1);wr(ch,4,0x101);tick(500);CHECK(!(a.soc.subsrcpnd&bit(ch)));
        wr(ch,4,0x181);tick(479);CHECK(!(a.soc.subsrcpnd&bit(ch)));tick(1);CHECK(a.soc.subsrcpnd&bit(ch));
        (void)rd(ch,0x24);clear(ch);wr(ch,8,0);send(ch,1);tick(1);
        CHECK(a.soc.subsrcpnd&bit(ch)); /* Holding-register ready, not a timeout. */
        CHECK(!a.soc.uart_state[ch].rx_timeout_remaining&&!a.soc.uart_state[ch].rx_timeout_latched);
        (void)rd(ch,0x24);clear(ch);tick(500);CHECK(!(a.soc.subsrcpnd&bit(ch)));
    }
}
static void threshold_after_idle(void){
    for(unsigned ch=0;ch<3;ch++)for(unsigned trigger=0;trigger<4;trigger++)
    for(unsigned level=0;level<2;level++){
        init();setup(ch,3,trigger,0,level!=0);send(ch,4*(trigger+1));tick(480);
        CHECK(a.soc.uart_state[ch].rx_timeout_latched==1);
        clear(ch);CHECK(rd(ch,0x24)==0x40);tick(1);
        /* The unread FIFO is now below trigger after three idle words. */
        CHECK(a.soc.subsrcpnd&bit(ch));
        clear(ch);CHECK(rd(ch,0x24)==0x41);tick(1);
        /* Further below-trigger reads do not emit another pulse. */
        CHECK(!!(a.soc.subsrcpnd&bit(ch))==!!level);
        uint8_t byte=0x55;CHECK(orchard_uart_send_channel(&a,ch,&byte,1)==1);
        CHECK(rd(ch,0x18)==4*(trigger+1)-1);
        CHECK(!a.soc.uart_state[ch].rx_timeout_latched&&
              a.soc.uart_state[ch].rx_timeout_remaining==480);
        clear(ch);tick(479);CHECK(!(a.soc.subsrcpnd&bit(ch)));
        tick(1);CHECK(a.soc.subsrcpnd&bit(ch));
        while(a.soc.uart_state[ch].rx_count)(void)rd(ch,0x24);
        clear(ch);tick(481);CHECK(!(a.soc.subsrcpnd&bit(ch)));
    }
}
static void clocks_and_isolation(void){
    init();for(unsigned ch=0;ch<3;ch++){setup(ch,3,0,ch,false);send(ch,1);}
    tick(479);CHECK(!(a.soc.subsrcpnd&0x49));tick(1);CHECK((a.soc.subsrcpnd&0x49)==1);
    tick(480);CHECK((a.soc.subsrcpnd&0x49)==9);tick(480);CHECK((a.soc.subsrcpnd&0x49)==0x49);
    for(unsigned ch=0;ch<3;ch++){
        init();setup(ch,3,0,0,true);send(ch,1);tick(17);
        uint32_t gate=a.soc.clock[3];CHECK(o_mmio_write(&a,0x4c00000c,4,gate&~(0x400u<<ch)));
        tick(1000);CHECK(a.soc.uart_state[ch].rx_timeout_remaining==463);
        CHECK(!(a.soc.subsrcpnd&bit(ch)));CHECK(o_mmio_write(&a,0x4c00000c,4,gate));
        tick(462);CHECK(!(a.soc.subsrcpnd&bit(ch)));tick(1);CHECK(a.soc.subsrcpnd&bit(ch));
        init();CHECK(o_mmio_write(&a,0x4c000014,4,1)); /* PCLK = reference / 2. */
        setup(ch,3,0,0,true);send(ch,1);tick(959);CHECK(!(a.soc.subsrcpnd&bit(ch)));
        CHECK(a.soc.pclk_phase==1&&a.soc.uart_state[ch].rx_timeout_remaining==1);
        tick(1);CHECK(a.soc.subsrcpnd&bit(ch));
        init();CHECK(o_mmio_write(&a,0x4c000004,4,0x1000)); /* PCLK = reference * 9/2. */
        setup(ch,3,0,0,true);send(ch,1);tick(106);CHECK(!(a.soc.subsrcpnd&bit(ch)));
        tick(1);CHECK(a.soc.subsrcpnd&bit(ch));
        init();setup(ch,0x27,0,65535,true);send(ch,1);
        CHECK(a.soc.uart_state[ch].rx_timeout_remaining==37748736u);
        wr(ch,0x28,0);CHECK(a.soc.uart_state[ch].rx_timeout_remaining==576);
        tick(575);CHECK(!(a.soc.subsrcpnd&bit(ch)));tick(1);CHECK(a.soc.subsrcpnd&bit(ch));
    }
}
static void checkpoint_and_legacy(void){
    init();o_copy(a.flash_base,a.flash,a.profile->flash_bytes);
    CHECK(o_mmio_write(&a,0x4c000014,4,1));
    for(unsigned ch=0;ch<3;ch++){setup(ch,3,0,ch,true);send(ch,1);}
    tick(157);size_t n=orchard_checkpoint_size(&a);CHECK(n<=sizeof saved);
    if(n>sizeof saved||n<a.profile->ram_bytes+O_BOOT_SRAM_SIZE+24u)return;
    CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK&&o_read_le(saved+8,4)==8);
    CHECK(orchard_init(&b,sizeof b,2)==&b);
    CHECK(orchard_load_rom(&b,a.flash_base,a.profile->flash_bytes)==ORCHARD_OK);
    CHECK(orchard_checkpoint_load(&b,saved,n)==ORCHARD_OK);
    tick(803);CHECK(o_run_reference(&b,803).status==ORCHARD_OK);
    CHECK((a.soc.subsrcpnd&0x49)==1);
    CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
    CHECK(orchard_checkpoint_save(&b,again,n)==ORCHARD_OK&&equal(saved,again,n));
    tick(1920);CHECK(o_run_reference(&b,1920).status==ORCHARD_OK);
    CHECK((a.soc.subsrcpnd&0x49)==0x49);
    CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
    CHECK(orchard_checkpoint_save(&b,again,n)==ORCHARD_OK&&equal(saved,again,n));
    /* A changed CRC cannot admit an impossible timeout state. */
    size_t extension=n-a.profile->ram_bytes-O_BOOT_SRAM_SIZE-24;
    CHECK(extension<=sizeof saved-24u);
    if(extension>sizeof saved-24u)return;
    put(saved+extension,1);put(saved+28,crc(saved+32,n-32));
    CHECK(orchard_checkpoint_load(&b,saved,n)==ORCHARD_BAD_ARGUMENT);
    /* v7 had no enabled FIFO timeout; migrate all represented state intact. */
    init();o_copy(a.flash_base,a.flash,a.profile->flash_bytes);setup(0,3,0,0,true);
    wr(0,4,0x101);send(0,1);CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
    o_copy(again,saved,extension);o_copy(again+extension,saved+extension+24,n-extension-24);
    put(again+8,7);put(again+12,(uint32_t)n-24);put(again+28,crc(again+32,n-24-32));
    CHECK(orchard_checkpoint_load(&a,again,n-24)==ORCHARD_OK);
    CHECK(a.soc.uart_state[0].rx_count==1&&!a.soc.uart_state[0].rx_timeout_remaining);
    CHECK(orchard_checkpoint_save(&a,again,n)==ORCHARD_OK&&equal(saved,again,n));
}
static void unknown_clock(void){
    for(unsigned ch=0;ch<3;ch++){
        init();setup(ch,3,0,0,true);
        CHECK(!o_mmio_write(&a,base(ch)+4,4,0x581));
        CHECK(a.stop.status==ORCHARD_UNIMPLEMENTED_MMIO&&a.soc.uart[ch][1]==0x181);
        init();wr(ch,4,0x581);
        CHECK(!o_mmio_write(&a,base(ch)+8,4,1));CHECK(a.soc.uart[ch][2]==0);
        /* Existing UEXTCLK decoded stream remains usable with timeout off. */
        init();wr(ch,0,3);wr(ch,4,0x501);wr(ch,8,1);send(ch,1);tick(2000);
        CHECK(!(a.soc.subsrcpnd&bit(ch))&&!a.soc.uart_state[ch].rx_timeout_remaining);
        CHECK(rd(ch,0x24)==0x40);
    }
}
EXPORT("regression") unsigned test(void){checks=failures=first=0;deadlines();restart_and_cancel();threshold_after_idle();clocks_and_isolation();checkpoint_and_legacy();unknown_clock();return failures;}
EXPORT("checks") unsigned count(void){return checks;}
EXPORT("first_failure") unsigned first_failure(void){return first;}
#ifndef __wasm__
int main(void){test();printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
