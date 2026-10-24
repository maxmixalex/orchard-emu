/* SPDX-License-Identifier: MIT
 * Directed SST39VF800A / SST39VF1601 state and persistence tests.
 * Command addresses and timing/poll bits are independent datasheet vectors.
 */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(n)
#else
#define EXPORT(n) __attribute__((export_name(n)))
#endif
static orchard_machine a,b;
static uint8_t saved[600000+O_FLASH_MAX+2048];
static unsigned checks,failures,first;
#define CHECK(x) do {++checks;if(!(x)){if(!failures)first=__LINE__;++failures;}}while(0)
static void put(uint8_t *p,uint32_t v){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(8*i));}
static uint32_t crc(const uint8_t *p,size_t n){uint32_t v=~0u;for(size_t i=0;i<n;i++){v^=p[i];for(unsigned j=0;j<8;j++)v=(v>>1)^((0u-(v&1u))&0xedb88320u);}return ~v;}
static void init(unsigned model){
 CHECK(orchard_init(&a,sizeof a,model)==&a);
 for(unsigned i=0;i<a.profile->flash_bytes;i++)a.flash[i]=255;
 put(a.flash,0xeafffffe);CHECK(orchard_load_rom(&a,a.flash,a.profile->flash_bytes)==ORCHARD_OK);
 CHECK(orchard_nor_select(&a,model==2?ORCHARD_NOR_SST39VF800A:ORCHARD_NOR_SST39VF1601)==ORCHARD_OK);
 a.soc.wtcon=0;
}
static void wr(uint32_t address,uint32_t value){CHECK(o_phys_write(&a,address,2,value));}
static uint32_t rd(uint32_t address){uint32_t value=0;CHECK(o_phys_read(&a,address,2,&value));return value;}
static void unlock(uint32_t command){wr(0xaaaa,0xaa);wr(0x5554,0x55);wr(0xaaaa,command);}
static void program(uint32_t address,uint32_t data){unlock(0xa0);wr(address,data);}
static void erase(uint32_t address,uint32_t command){unlock(0x80);wr(0xaaaa,0xaa);wr(0x5554,0x55);wr(address,command);}
static void tick(unsigned n){while(n--)o_nor_tick(&a);}
static void roundtrip(void){size_t n=orchard_checkpoint_size(&a);CHECK(n<=sizeof saved);
 CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);b=a;
 a.flash[0x3333]^=0xff;a.ram[0]=129;
 CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);
 CHECK(a.flash[0x3333]==b.flash[0x3333]&&a.ram[0]==b.ram[0]);
 CHECK(a.nor.remaining==b.nor.remaining&&a.nor.erase_remaining==b.nor.erase_remaining);
}
static void writes(unsigned model){
 init(model);unsigned delay=model==2?168:84;
 program(0x20002,0x12f0);CHECK(a.nor.remaining==delay&&a.flash[0x20002]==255);
 uint32_t x=rd(0x20002),y=rd(0x20002);CHECK(((x^y)&0x40)==0x40);CHECK(!(x&0x80));
 wr(0,0xf0);CHECK(a.nor.remaining==delay); /* Busy ignores software reset. */
 tick(delay-1);CHECK(a.flash[0x20002]==255&&a.nor.remaining==1);
 roundtrip();tick(1);CHECK(rd(0x20002)==0x12f0&&a.flash_base[0x20002]==255);
 program(0x20002,0x8fff);tick(delay);CHECK(rd(0x20002)==0x02f0); /* Cannot set a zero bit. */
 program(0x30000,0x55aa);tick(delay);program(0x31ffe,0x1234);tick(delay);
 erase(0x30002,0x30);CHECK(a.nor.address==0x30000&&a.nor.length==4096&&a.nor.remaining==216000);
 x=rd(0x30000);y=rd(0x30000);CHECK(!(x&0x80)&&((x^y)&0x40));
 if(model!=2)CHECK((x^y)&4);
 tick(215999);CHECK(a.flash[0x30000]==0xaa);tick(1);CHECK(rd(0x30000)==65535&&rd(0x31ffe)==0x1234);
 erase(0x31ffe,0x50);tick(216000);CHECK(rd(0x31ffe)==65535&&rd(0x20002)==0x02f0);
 /* Invalid unlock order is a no-op; aligned32 stores are two16-bit cycles. */
 wr(0xaaaa,0xa0);wr(0x44000,0);CHECK(rd(0x44000)==65535&&!a.nor.remaining);
 CHECK(!o_phys_write(&a,0xaaaa,4,0xaa)); /* Physical API rejects unaligned32. */
 orchard_reset(&a);a.soc.wtcon=0;
 unlock(0xa0);CHECK(o_phys_write(&a,0x44000,4,0x56781234));tick(delay);
 CHECK(rd(0x44000)==0x1234&&rd(0x44002)==65535);
 /* NOR internal work continues with SoC peripheral clocks disabled. */
 program(0x45000,0x3344);a.soc.clock[3]=0;a.soc.clock[4]=0xffffffffu;
 for(unsigned i=0;i<delay;i++)o_soc_tick(&a);
 CHECK(rd(0x45000)==0x3344);
 roundtrip();CHECK(rd(0x45000)==0x3344);
 erase(0xaaaa,0x10);tick(model==2?840000:480000);
 CHECK(rd(0)==65535&&rd(a.profile->flash_bytes-2)==65535);
 /* Full changed-flash state is bounded, requires the original base and can
    be restored atomically even though its reset vector was guest-erased. */
 roundtrip();CHECK(rd(0)==65535);CHECK(a.flash_base[0]==0xfe);
}
static void suspend(void){
 init(5);program(0x20000,0x1234);tick(84);erase(0x20000,0x30);tick(1000);
 wr(0,0xb0);CHECK(a.nor.suspend_wait==240);tick(239);CHECK(a.nor.remaining&&a.nor.suspend_wait==1);
 tick(1);CHECK(!a.nor.remaining&&a.nor.erase_remaining==214760);
 uint32_t x=rd(0x20000),y=rd(0x20000);CHECK((x&0x40)&&((x^y)&4));CHECK(rd(0x30000)==65535);
 program(0x20000,0);CHECK(!a.nor.remaining&&a.flash[0x20000]==0x34);
 program(0x30000,0x0080);CHECK(a.nor.remaining==84&&a.nor.erase_remaining==214760);
 roundtrip();tick(84);CHECK(rd(0x30000)==0x80&&a.nor.erase_remaining==214760);
 roundtrip();wr(0,0x30);CHECK(a.nor.remaining==214760&&!a.nor.erase_remaining);
 tick(214760);CHECK(rd(0x20000)==65535&&rd(0x30000)==0x80);
}
static void persistence(void){
 init(5);size_t base=orchard_checkpoint_size(&a);
 program(0x4000,0x1234);tick(84);program(0x8000,0xabcd);tick(84);
 a.soc.uart_state[2].rx_head=15;a.soc.uart_state[2].rx_count=2;
 a.soc.uart_state[2].rx[15]=0x37;a.soc.uart_state[2].rx[0]=0x82;
 a.soc.uart_rx[1].head=1023;a.soc.uart_rx[1].count=2;a.soc.uart_rx[1].data[1023]=0xd3;
 size_t n=orchard_checkpoint_size(&a);CHECK(n==base+2*(4096+4));
 CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);b=a;
 CHECK(o_read_le(saved+20,4)==crc(a.flash_base,a.profile->flash_bytes));
 /* Sorted unique sector addresses and all scalar invariants are validated
    before RAM, registers, media or any mutable flash are touched. */
 const uint32_t bad[]={0x4001,0x200000,0x8000};
 for(unsigned i=0;i<3;i++){
  put(saved+base,bad[i]);put(saved+28,crc(saved+32,n-32));
  CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_BAD_ARGUMENT);
  CHECK(a.flash[0x4000]==0x34&&a.flash[0x8000]==0xcd&&a.ram[0]==b.ram[0]);
 }
 put(saved+base,0x4000);put(saved+28,crc(saved+32,n-32));
 a.soc.uart_state[2].rx_count=0;a.flash[0x4000]=255;
 CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);
 CHECK(a.soc.uart_state[2].rx_count==2&&a.soc.uart_state[2].rx[15]==0x37&&a.soc.uart_state[2].rx[0]==0x82);
 CHECK(a.soc.uart_rx[1].head==1023&&a.soc.uart_rx[1].count==2&&a.soc.uart_rx[1].data[1023]==0xd3);
 CHECK(a.flash[0x4000]==0x34);
 /* A forged pending write cannot carry an impossible program duration, even
    with a repaired CRC. Rejection keeps the previous committed array. */
 const size_t nor=base-a.profile->ram_bytes-O_BOOT_SRAM_SIZE-44;
 put(saved+nor,1);put(saved+nor+4,85);put(saved+nor+8,0x4000);put(saved+nor+12,2);
 put(saved+28,crc(saved+32,n-32));
 CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_BAD_ARGUMENT);CHECK(a.flash[0x4000]==0x34);
 /* Restoring a pre-write state restores the original NOR, including sectors
    modified after the save, and reset preserves already committed writes. */
 init(5);n=orchard_checkpoint_size(&a);CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
 program(0x4000,0);tick(84);orchard_reset(&a);CHECK(a.flash[0x4000]==0);
 CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);CHECK(a.flash[0x4000]==255);
 /* Every sector may differ: verify the maximum delta size and restore it. */
 for(unsigned i=0;i<a.profile->flash_bytes;i++)a.flash[i]=0;
 n=orchard_checkpoint_size(&a);CHECK(n==base+(a.profile->flash_bytes/4096)*(4096+4));
 CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);a.flash[0x1fffff]=255;
 CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);CHECK(a.flash[0x1fffff]==0&&a.flash_base[0x1fffff]==255);
}
EXPORT("regression") unsigned regression(void){checks=failures=first=0;writes(2);writes(5);suspend();persistence();return failures;}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){regression();printf("{\"checks\":%u,\"failures\":%u,\"first\":%u}\n",checks,failures,first);return failures?1:0;}
#endif
