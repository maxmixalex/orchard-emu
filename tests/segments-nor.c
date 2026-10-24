/* SPDX-License-Identifier: MIT
 * Original ROM-free tests: vendor-defined NOR capacity/IDs and observational
 * packed-segment extraction. Synthetic routing does not certify a real panel.
 */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(name)
#else
#define EXPORT(name) __attribute__((export_name(name)))
#endif
static orchard_machine m;
static unsigned checks, failures, first;
static void check(bool ok, unsigned line) {
    ++checks;
    if (!ok) { if (!failures) first=line; ++failures; }
}
#define CHECK(x) check((x), __LINE__)
static void nor800(void) {
    CHECK(orchard_init(&m,sizeof m,1)!=NULL);
    CHECK(orchard_nor_select(&m,ORCHARD_NOR_SST39VF1601)==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_nor_select(&m,ORCHARD_NOR_SST39VF800A)==ORCHARD_OK);
    for(unsigned i=0;i<m.profile->flash_bytes;++i)m.flash[i]=(uint8_t)(i*17u+23u);
    for(unsigned i=0;i<0x1000;i+=4)CHECK(o_phys_write(&m,i,4,0));
    bool unchanged=true;
    for(unsigned i=0;i<m.profile->flash_bytes;++i)if(m.flash[i]!=(uint8_t)(i*17u+23u))unchanged=false;
    CHECK(unchanged);
    CHECK(o_phys_write(&m,0xaaa8,4,0x00aa0000)); CHECK(m.nor_sequence==1);
    CHECK(o_phys_write(&m,0x5554,2,0x55));CHECK(o_phys_write(&m,0xaaaa,2,0x90));
    uint32_t value=0;
    CHECK(o_phys_read(&m,0,4,&value)&&value==0x278100bf);
    CHECK(o_phys_read(&m,0,2,&value)&&value==0xbf);
    CHECK(o_phys_read(&m,2,2,&value)&&value==0x2781);
    CHECK(o_phys_write(&m,0,2,0xf0));CHECK(!m.nor_id_mode);
    CHECK(o_phys_write(&m,0xffffc,4,0));CHECK(!o_phys_write(&m,0xffffe,4,0));
    CHECK(o_phys_write(&m,0xaaaa,2,0xaa));CHECK(o_phys_write(&m,0x5554,2,0x55));
    CHECK(o_phys_write(&m,0xaaaa,2,0xa0));CHECK(m.nor_sequence==3);
    orchard_reset(&m);CHECK(m.nor_device==ORCHARD_NOR_SST39VF800A);
    CHECK(m.profile->ram_bytes==0x40000&&!o_phys_read(&m,0x08040000,4,&value));
    CHECK(orchard_init(&m,sizeof m,4)!=NULL);
    CHECK(orchard_nor_select(&m,ORCHARD_NOR_SST39VF800A)==ORCHARD_BAD_ARGUMENT);
}
static void segments(void) {
    uint8_t levels[6];
    CHECK(orchard_init(&m,sizeof m,4)!=NULL);
    CHECK(orchard_annunciators(NULL,levels)==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_annunciators(&m,NULL)==ORCHARD_BAD_ARGUMENT);
    CHECK(orchard_annunciators(&m,levels)==ORCHARD_OK);
    for(unsigned i=0;i<6;++i)CHECK(levels[i]==0);
    for(unsigned mode=0;mode<3;++mode) {
        unsigned bpp=1u<<mode,stride=20*bpp;
        m.soc.lcd[0]=0x21u|(mode<<1);m.soc.lcd[1]=63u<<14;
        m.soc.lcd[5]=(O_RAM_BASE+2)/2;m.soc.lcd[6]=((O_RAM_BASE+2+stride*64)/2)&0x1fffff;
        m.soc.lcd[7]=stride/2;m.soc.lcd[10]=0x159f;
        for(unsigned n=0;n<(1u<<bpp);++n) {
            o_zero(m.ram,sizeof m.ram);
            for(unsigned i=0;i<6;++i){unsigned v=(n+i)&((1u<<bpp)-1);m.ram[2+i*stride+(131*bpp)/8]=(uint8_t)(v<<((131*bpp)&7));}
            uint64_t tick=m.ticks,reads=m.sram_alias_reads,lcdreads=m.soc.lcd_probe68_reads;
            CHECK(orchard_annunciators(&m,levels)==ORCHARD_OK);
            for(unsigned i=0;i<6;++i){unsigned v=(n+i)&((1u<<bpp)-1);unsigned expected=bpp==2?((0x159fu>>(v*4))&15u)*17u:v*255/((1u<<bpp)-1);CHECK(levels[i]==expected);}
            CHECK(m.ticks==tick&&m.sram_alias_reads==reads&&m.soc.lcd_probe68_reads==lcdreads);
        }
        /* No recognized stride: unknown, not six fabricated off bits. */
        m.soc.lcd[7]--;CHECK(orchard_annunciators(&m,levels)==ORCHARD_UNSUPPORTED_LCD);m.soc.lcd[7]++;
        m.soc.lcd[6]=(O_RAM_BASE+2+stride*2)/2&0x1fffff;
        CHECK(orchard_annunciators(&m,levels)==ORCHARD_BUS_ERROR);
        for(unsigned i=0;i<6;++i)CHECK(levels[i]==0); /* No partly published result. */
    }
    m.soc.lcd[0]=0x27;CHECK(orchard_annunciators(&m,levels)==ORCHARD_UNSUPPORTED_LCD);
}
EXPORT("regression") unsigned run(void){checks=failures=first=0;nor800();segments();return failures;}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned first_failure(void){return first;}
#ifndef __wasm__
int main(void){unsigned r=run();printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u}\n",checks,r,first);return r?1:0;}
#endif
