/* SPDX-License-Identifier: MIT
 * ROM-free NOR bus-width and explicitly selected SRAM decode regressions.
 * None of the test data is HP firmware. Assertions remain active in Release.
 */
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
        if (failures < 16) fprintf(stderr, "memory.c:%u failed\n", line);
#endif
    }
}
#define CHECK(x) check((x), __LINE__)
static void nor(void) {
    CHECK(orchard_init(&m, sizeof m, 4) != NULL);
    for (unsigned i=0; i<0x200000; ++i) m.flash[i]=(uint8_t)(i*37u+19u);
    CHECK(!o_phys_write(&m,0,4,0)); /* No part: strict, including word F0. */
    CHECK(m.stop.status==ORCHARD_UNIMPLEMENTED_FLASH);
    orchard_reset(&m);
    CHECK(orchard_nor_select(&m,ORCHARD_NOR_SST39VF1601)==ORCHARD_OK);
    CHECK(o_phys_write(&m,0,4,0));
    CHECK(m.stop.status==ORCHARD_OK);
    for(unsigned i=0;i<0x1000;i+=4) CHECK(o_phys_write(&m,i,4,0));
    for(unsigned i=0;i<0x200000;i+=127) CHECK(m.flash[i]==(uint8_t)(i*37u+19u));
    CHECK(o_phys_write(&m,0x1ffffc,4,0xffffffff));
    CHECK(!o_phys_write(&m,0x1ffffe,4,0)); /* No out-of-array second cycle. */
    /* Ordered cycles, not one truncated word or two writes at one address. */
    CHECK(o_phys_write(&m,0xaaa8,4,0x00aa0000));
    CHECK(m.nor_sequence==1);
    CHECK(o_phys_write(&m,0x5554,4,0x12340055));
    CHECK(m.nor_sequence==0); /* Low half advanced; high half aborted. */
    CHECK(o_phys_write(&m,0xaaaa,2,0xaa));
    CHECK(o_phys_write(&m,0x5554,2,0x55));
    CHECK(o_phys_write(&m,0xaaaa,2,0x90));
    uint32_t value=0;
    CHECK(o_phys_read(&m,0,4,&value) && value==0x234b00bf);
    CHECK(o_phys_write(&m,0,4,0xf0) && !m.nor_id_mode);
    CHECK(o_phys_write(&m,0xaaaa,2,0xaa));
    CHECK(o_phys_write(&m,0x5554,2,0x55));
    CHECK(!o_phys_write(&m,0xaaaa,2,0xa0)); /* Programming is still unsupported. */
    CHECK(m.stop.status==ORCHARD_UNIMPLEMENTED_FLASH);
    orchard_reset(&m);
    CHECK(o_nor_write(&m,0,4,0)); /* Shared upstream NOR adapter owns splitting. */
    orchard_reset(&m);
    CHECK(!o_phys_write(&m,1,4,0));
    orchard_reset(&m);
    CHECK(!o_phys_write(&m,0,1,0)); /* Byte-lane behavior not guessed. */
    orchard_reset(&m);
    CHECK(o_phys_write(&m,O_RAM_BASE+0x100,4,0xe5801000)); /* STR r1,[r0] */
    m.cpu.r[15]=O_RAM_BASE+0x100; m.cpu.r[0]=0;m.cpu.r[1]=0;
    o_cpu_step(&m);
    CHECK(m.stop.status==ORCHARD_OK && m.cpu.r[15]==O_RAM_BASE+0x104);
    CHECK(m.flash[0]==19 && m.flash[1]==56 && m.flash[2]==93 && m.flash[3]==130);
}
/* These contiguous cases have a sentinel on each side of the word. */
static void sram_word(uint32_t address, uint32_t offset, bool alias) {
    m.ram[offset-1]=0xa5;
    m.ram[offset]=m.ram[offset+1]=m.ram[offset+2]=m.ram[offset+3]=0xcc;
    m.ram[offset+4]=0x5a;
    uint64_t writes=orchard_sram_alias_writes(&m);
    CHECK(o_phys_write(&m,address,4,0x78563412));
    CHECK(m.ram[offset]==0x12 && m.ram[offset+1]==0x34 &&
          m.ram[offset+2]==0x56 && m.ram[offset+3]==0x78);
    CHECK(m.ram[offset-1]==0xa5 && m.ram[offset+4]==0x5a);
    CHECK(orchard_sram_alias_writes(&m)==writes+(alias?1u:0u));
}
static void sram(unsigned model) {
    CHECK(orchard_init(&m,sizeof m,model)!=NULL);
    uint32_t bytes=m.profile->ram_bytes, value=0xabcdef01;
    CHECK(m.sram_decode==ORCHARD_SRAM_EXACT);
    CHECK(!o_phys_read(&m,O_RAM_BASE+bytes,4,&value) && value==0xabcdef01);
    CHECK(!o_phys_write(&m,O_RAM_BASE+bytes,4,0));
    for (unsigned lane=1;lane<4;++lane)
        sram_word(O_RAM_BASE+0x100u+lane,0x100u+lane,false);
    m.ram[bytes-5]=0xa5; m.ram[0]=0x5a;
    uint64_t writes=orchard_sram_alias_writes(&m);
    CHECK(o_phys_write(&m,O_RAM_BASE+bytes-4,4,0x78563412));
    CHECK(m.ram[bytes-4]==0x12 && m.ram[bytes-3]==0x34 &&
          m.ram[bytes-2]==0x56 && m.ram[bytes-1]==0x78);
    CHECK(m.ram[bytes-5]==0xa5 && m.ram[0]==0x5a);
    CHECK(orchard_sram_alias_writes(&m)==writes);
    for (unsigned remaining=1;remaining<4;++remaining) {
        CHECK(!o_phys_write(&m,O_RAM_BASE+bytes-remaining,4,0xfedcba98));
        CHECK(m.ram[bytes-4]==0x12 && m.ram[bytes-3]==0x34 &&
              m.ram[bytes-2]==0x56 && m.ram[bytes-1]==0x78);
        CHECK(m.ram[bytes-5]==0xa5 && m.ram[0]==0x5a);
        CHECK(orchard_sram_alias_writes(&m)==writes && m.stop.status==ORCHARD_OK);
    }
    CHECK(orchard_sram_select(NULL,ORCHARD_SRAM_EXACT)==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_sram_select(&m,(orchard_sram_decode)2)==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_sram_select(&m,ORCHARD_SRAM_BANK1_MIRROR)==ORCHARD_OK);
    CHECK(m.profile->ram_bytes==bytes);
    for (unsigned lane=1;lane<4;++lane)
        sram_word(O_RAM_BASE+2*bytes+0x100u+lane,0x100u+lane,true);
    for (unsigned width=1;width<=4;width*=2) {
        uint32_t mask=width==4?UINT32_MAX:(1u<<(width*8u))-1u;
        for(unsigned j=0;j<64;++j) {
            uint32_t offset=(j*769u)&(bytes-4u), pattern=0x9e3779b9u*(j+1u);
            uint32_t alias=O_RAM_BASE+bytes*(1u+j)+offset;
            CHECK(o_phys_write(&m,O_RAM_BASE+offset,width,pattern));
            uint64_t reads=orchard_sram_alias_reads(&m);
            CHECK(o_phys_read(&m,alias,width,&value) && value==(pattern&mask));
            CHECK(orchard_sram_alias_reads(&m)==reads+1);
            uint64_t writes=orchard_sram_alias_writes(&m);
            CHECK(o_phys_write(&m,alias,width,~pattern));
            CHECK(orchard_sram_alias_writes(&m)==writes+1);
            CHECK(o_phys_read(&m,O_RAM_BASE+offset,width,&value) && value==((~pattern)&mask));
        }
    }
    for (unsigned copy=1;copy<=2;++copy) {
        m.ram[bytes-3]=0xa5; m.ram[2]=0x5a;
        writes=orchard_sram_alias_writes(&m);
        CHECK(o_phys_write(&m,O_RAM_BASE+copy*bytes-2,4,0x12345678));
        CHECK(m.ram[bytes-2]==0x78 && m.ram[bytes-1]==0x56 && m.ram[0]==0x34 && m.ram[1]==0x12);
        CHECK(m.ram[bytes-3]==0xa5 && m.ram[2]==0x5a);
        CHECK(orchard_sram_alias_writes(&m)==writes+1);
    }
    uint8_t out[4]={0};uint64_t reads=orchard_sram_alias_reads(&m);
    CHECK(orchard_read_memory(&m,O_RAM_BASE+2*bytes-2,out,4)==ORCHARD_OK);
    CHECK(out[0]==0x78 && out[1]==0x56 && out[2]==0x34 && out[3]==0x12);
    CHECK(orchard_sram_alias_reads(&m)==reads); /* Debug is observational. */
    CHECK(!o_sram_copy(&m,O_RAM_BASE,NULL,1));
    CHECK(!o_sram_copy(&m,O_RAM_BASE,out,SIZE_MAX));
    CHECK(!o_sram_copy(&m,UINT32_MAX,out,4));
    CHECK(o_phys_write(&m,0x0ffffffc,4,0xabcddcba));
    CHECK(o_phys_read(&m,O_RAM_BASE+bytes-4,4,&value) && value==0xabcddcba);
    CHECK(!o_phys_read(&m,0x10000000,4,&value));
    CHECK(!o_phys_write(&m,0x10000000,4,0));
    CHECK(!o_phys_write(&m,0x0fffffff,2,0));
    CHECK(!o_sram_read(&m,O_RAM_BASE,3,&value));
    CHECK(!o_sram_read(&m,O_RAM_BASE,4,NULL));
    CHECK(!o_sram_write(&m,O_RAM_BASE,3,0));
    uint64_t old_reads=orchard_sram_alias_reads(&m), old_writes=orchard_sram_alias_writes(&m);
    CHECK(orchard_sram_select(&m,ORCHARD_SRAM_EXACT)==ORCHARD_OK);
    CHECK(!o_phys_read(&m,O_RAM_BASE+bytes,4,&value));
    CHECK(orchard_sram_alias_reads(&m)==old_reads && orchard_sram_alias_writes(&m)==old_writes);
    CHECK(orchard_sram_select(&m,ORCHARD_SRAM_BANK1_MIRROR)==ORCHARD_OK);
    orchard_reset(&m);
    CHECK(m.sram_decode==ORCHARD_SRAM_BANK1_MIRROR);
    CHECK(!orchard_sram_alias_reads(&m) && !orchard_sram_alias_writes(&m));
    CHECK(o_phys_read(&m,O_RAM_BASE+bytes,4,&value) && value==0);
    /* Exact same guest lookahead, with and without selected high-address pins. */
    CHECK(o_phys_write(&m,O_RAM_BASE,4,0x12345678));
    CHECK(o_phys_write(&m,O_RAM_BASE+0x100,4,0xe5902008)); /* LDR r2,[r0,#8] */
    m.cpu.r[15]=O_RAM_BASE+0x100;m.cpu.r[0]=O_RAM_BASE+bytes-8;
    o_cpu_step(&m);
    CHECK(m.cpu.r[2]==0x12345678 && !m.cpu.dfsr && m.cpu.r[15]==O_RAM_BASE+0x104);
    CHECK(orchard_sram_select(&m,ORCHARD_SRAM_EXACT)==ORCHARD_OK);
    m.cpu.r[15]=O_RAM_BASE+0x100;m.cpu.r[2]=0xfeed;
    o_cpu_step(&m);
    CHECK(m.cpu.dfsr==8 && m.cpu.far==O_RAM_BASE+bytes && m.cpu.r[15]==0x10);
    CHECK(m.cpu.r[2]==0xfeed);
}
EXPORT("regression") unsigned run(void) {
    checks=failures=first_failure=0;
    nor();for(unsigned id=1;id<=6;++id)sram(id);
    return failures;
}
EXPORT("checks") unsigned get_checks(void) {return checks;}
EXPORT("first_failure") unsigned get_first(void) {return first_failure;}
#ifndef __wasm__
int main(void) {unsigned result=run();printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u}\n",checks,result,first_failure);return result?1:0;}
#endif
