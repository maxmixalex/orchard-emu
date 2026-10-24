/* SPDX-License-Identifier: MIT
 * ARM920T functional TLB checks derived from DDI 0151C, not a host cache oracle.
 * Section/page mutations intentionally omit or issue real CP15 maintenance. */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#define EXPORT(n)
#else
#define EXPORT(n) __attribute__((export_name(n)))
#endif
static orchard_machine a,b;
static uint8_t saved[600000],legacy[600000];
static unsigned checks,failures,first;
#define CHECK(x) do{++checks;if(!(x)){if(!failures)first=__LINE__;++failures;}}while(0)
#define TTB (O_RAM_BASE+0x4000u)
#define TABLE (O_RAM_BASE+0x8000u)
static void put(uint8_t *p,uint32_t v){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(8u*i));}
static uint32_t crc(const uint8_t*p,size_t n){uint32_t v=~0u;for(size_t i=0;i<n;i++){v^=p[i];for(unsigned j=0;j<8;j++)v=(v>>1)^((0u-(v&1u))&0xedb88320u);}return ~v;}
static void repair(uint8_t*p,size_t n){put(p+12,(uint32_t)n);put(p+28,crc(p+32,n-32));}
static bool equal(const void*x,const void*y,size_t n){const uint8_t*p=x,*q=y;for(size_t i=0;i<n;i++)if(p[i]!=q[i])return false;return true;}
static void init(void){CHECK(orchard_init(&a,sizeof a,1)==&a);a.loaded=true;a.soc.wtcon=0;a.cpu.cpsr=O_SVC|O_I|O_F;a.cpu.control=0x79;a.cpu.ttb=TTB;a.cpu.domain=1;}
static void word(uint32_t addr,uint32_t v){CHECK(o_phys_write(&a,addr,4,v));}
static void section(uint32_t va,uint32_t pa,unsigned ap,unsigned domain){word(a.cpu.ttb+((va>>18)&0x3ffc),pa|(ap<<10)|(domain<<5)|2u);}
static void page(uint32_t va,uint32_t pa,unsigned kind,unsigned aps,unsigned domain,bool fine){
 word(a.cpu.ttb+((va>>18)&0x3ffc),TABLE|(domain<<5)|(fine?3u:1u));
 word(TABLE+(fine?((va>>8)&0xffc):((va>>10)&0x3fc)),pa|(aps<<4)|kind);
}
static void cp(unsigned crn,unsigned crm,unsigned op2,uint32_t v){a.cpu.r[0]=v;CHECK(o_cp15(&a,0xee000f10u|(crn<<16)|(op2<<5)|crm));}
static uint32_t cpread(unsigned crn,unsigned op2){CHECK(o_cp15(&a,0xee100f10u|(crn<<16)|(op2<<5)));return a.cpu.r[0];}
static void flush(unsigned crm){cp(8,crm,0,0);}
static void check_translation(uint32_t va,bool write,bool fetch,bool user,uint32_t expected,unsigned fault){
 a.cpu.data_abort=a.cpu.prefetch_abort=false;a.cpu.dfsr=a.cpu.ifsr=0;a.stop.status=ORCHARD_OK;
 uint32_t pa=0xdeadbeef;bool ok=o_translate(&a,va,write,fetch,user,&pa);
 CHECK(ok==(fault==0));
 if(!fault)CHECK(pa==expected);
 else {CHECK(pa==0xdeadbeef);CHECK(fetch?a.cpu.prefetch_abort:a.cpu.data_abort);CHECK((fetch?a.cpu.ifsr:a.cpu.dfsr)==fault);}
}
static unsigned count(unsigned bank){unsigned n=0;for(unsigned i=0;i<O_TLB_ENTRIES;i++)n+=a.tlb[bank].entry[i].valid;return n;}
static void stale_and_maintenance(void){
 init();const uint32_t va=0x10001234;
 section(va,0x08000000,3,0);
 check_translation(va,false,false,true,0x08001234,0);
 check_translation(va,false,true,true,0x08001234,0);
 section(va,0x08100000,3,0);
 check_translation(va,true,false,true,0x08001234,0);
 check_translation(va,false,true,true,0x08001234,0);
 cp(8,6,1,va);check_translation(va,false,false,true,0x08101234,0);
 check_translation(va,false,true,true,0x08001234,0);
 cp(8,5,1,va);check_translation(va,false,true,true,0x08101234,0);
 section(va,0x08200000,3,0);flush(6);
 check_translation(va,false,false,true,0x08201234,0);check_translation(va,false,true,true,0x08101234,0);
 flush(5);check_translation(va,false,true,true,0x08201234,0);
 section(va,0x08300000,3,0);flush(7);
 check_translation(va,false,false,true,0x08301234,0);check_translation(va,false,true,true,0x08301234,0);
 CHECK(count(0)==1&&count(1)==1);
 CHECK(!o_cp15(&a,0xee080f37u)); /* c8,c7,1 is not one of the five operations. */
 CHECK(!o_cp15(&a,0xee180f17u)); /* c8 is write-only. */
 a.cpu.cpsr=O_USR;CHECK(!o_cp15(&a,0xee080f17u));a.cpu.cpsr=O_SVC;
 /* Disabling the MMU and replacing TTBR do not invalidate a loaded entry. */
 cp(1,0,0,0x78);check_translation(va,false,false,true,va,0);
 cp(2,0,0,TTB+0xc000);section(va,0x08400000,3,0);
 cp(1,0,0,0x79);check_translation(va,false,false,true,0x08301234,0);
 flush(7);check_translation(va,false,false,true,0x08401234,0);
 /* FCSE tags are MVAs. A maintenance operand is not converted from VA. */
 init();cp(13,0,0,0x02000000);section(0x02000000,0x08000000,3,0);
 section(0x04000000,0x08100000,3,0);
 check_translation(0x123,false,false,true,0x08000123,0);
 cp(13,0,0,0x04000000);check_translation(0x123,false,false,true,0x08100123,0);
 section(0x02000000,0x08200000,3,0);cp(13,0,0,0x02000000);
 cp(8,6,1,0x123);check_translation(0x123,false,false,true,0x08000123,0);
 cp(8,6,1,0x02000123);check_translation(0x123,false,false,true,0x08200123,0);
}
static void sizes_and_replacement(void){
 init();
 /* Whole sections occupy one entry each, with independent I/D capacity. */
 for(unsigned i=0;i<65;i++)section(0x10000000u+i*0x100000u,0x08000000,3,0);
 for(unsigned i=0;i<64;i++)check_translation(0x10000000u+i*0x100000u,false,false,true,0x08000000,0);
 CHECK(count(0)==64&&count(1)==0);CHECK(((cpread(10,0)>>20)&63)==0);
 section(0x10000000,0x08100000,3,0);
 check_translation(0x10000000,false,false,true,0x08000000,0);
 check_translation(0x14000000,false,false,true,0x08000000,0);
 CHECK(((cpread(10,0)>>20)&63)==1);
 check_translation(0x10000000,false,false,true,0x08100000,0);
 CHECK(((cpread(10,0)>>20)&63)==2);
 /* 4 KiB pages with equal APs occupy one entry, not four. */
 init();page(0x10000000,0x08010000,2,0xff,0,false);
 check_translation(0x10000001,false,false,true,0x08010001,0);
 for(unsigned q=1;q<4;q++)check_translation(0x10000000+q*1024,false,false,true,0x08010000+q*1024,0);
 CHECK(count(0)==1&&a.tlb[0].entry[0].mask==0xfff);
 /* Unequal APs load one quarter and single-MVA invalidation affects only it. */
 init();page(0x10000000,0x08010000,2,0x7b,0,false);a.cpu.domain=3;
 for(unsigned q=0;q<4;q++)check_translation(0x10000000+q*1024,false,false,false,0x08010000+q*1024,0);
 CHECK(count(0)==4);for(unsigned i=0;i<4;i++)CHECK(a.tlb[0].entry[i].mask==0x3ff);
 cp(8,6,1,0x10000678);CHECK(count(0)==3);CHECK(!a.tlb[0].entry[1].valid);
 /* Large-page AP equality similarly distinguishes 64 KiB and 16 KiB entries. */
 init();page(0x10000000,0x08010000,1,0xff,0,false);
 check_translation(0x10000000,false,false,true,0x08010000,0);
 check_translation(0x1000fffc,false,false,true,0x0801fffc,0);CHECK(count(0)==1&&a.tlb[0].entry[0].mask==0xffff);
 init();a.cpu.domain=3;
 for(unsigned q=0;q<4;q++)page(0x10000000+q*16384,0x08010000,1,0x7b,0,false);
 for(unsigned q=0;q<4;q++)check_translation(0x10000000+q*16384,false,false,false,0x08010000+q*16384,0);
 CHECK(count(0)==4);for(unsigned i=0;i<4;i++)CHECK(a.tlb[0].entry[i].mask==0x3fff);
 cp(8,6,1,0x10008003);CHECK(count(0)==3);CHECK(!a.tlb[0].entry[2].valid);
 init();page(0x10000000,0x08010000,3,3,0,true);
 check_translation(0x100003ff,false,false,true,0x080103ff,0);CHECK(a.tlb[0].entry[0].mask==0x3ff);
 check_translation(0x10000400,false,false,true,0,7);
}
static void protection_and_faults(void){
 init();const uint32_t va=0x10000100;
 section(va,0x08000000,1,4);a.cpu.domain=1u<<8;
 check_translation(va,false,false,false,0x08000100,0);
 check_translation(va,false,false,true,0,0x4d);
 section(va,0x08100000,3,4); /* Cached AP1 still denies user mode. */
 check_translation(va,false,false,true,0,0x4d);
 cp(3,0,0,3u<<8);check_translation(va,true,false,true,0x08000100,0);
 cp(3,0,0,0);check_translation(va,false,false,false,0,0x49);
 cp(3,0,0,2u<<8);check_translation(va,false,false,false,0,0x49);
 cp(3,0,0,1u<<8);cp(8,6,1,va);check_translation(va,true,false,true,0x08100100,0);
 /* Faulting access to a valid PTE still loads its translation/protection. */
 init();page(va,0x08010000,2,0x55,0,false);
 check_translation(va,false,false,true,0,15);CHECK(count(0)==1);
 page(va,0x08020000,2,0xff,0,false);
 check_translation(va,false,false,true,0,15);
 check_translation(va,false,false,false,0x08010100,0);
 cp(8,6,1,va);check_translation(va,false,false,true,0x08020100,0);
 init();a.cpu.domain=0;page(va,0x08010000,2,0xff,0,false);
 check_translation(va,false,false,true,0,11);CHECK(count(0)==1);
 page(va,0x08020000,2,0xff,0,false);a.cpu.domain=1;
 check_translation(va,false,false,true,0x08010100,0);
 /* Invalid L2 beats a denied domain (Fig.3-14, Table3-9), and is not cached. */
 init();a.cpu.domain=0;page(va,0,0,0,0,false);
 check_translation(va,false,false,true,0,7);CHECK(count(0)==0&&a.tlb[0].lockdown==0);
 page(va,0x08020000,2,0xff,0,false);a.cpu.domain=1;
 check_translation(va,false,false,true,0x08020100,0);
 init();check_translation(va,false,false,true,0,5);CHECK(count(0)==0);
 section(va,0x08000000,3,0);check_translation(va,false,false,true,0x08000100,0);
 /* S/R permission bits are live even though the AP0 descriptor is cached. */
 init();section(va,0x08000000,0,0);
 for(unsigned sr=0;sr<4;sr++){
  cp(1,0,0,0x79|(sr<<8));
  check_translation(va,false,false,false,0x08000100,(sr==1||sr==2)?0:13);
  check_translation(va,false,false,true,0x08000100,sr==2?0:13);
  check_translation(va,true,false,false,0,13);
 }
 init();a.cpu.control|=2;uint32_t value;
 CHECK(!o_load(&a,va+1,4,false,&value));CHECK(a.cpu.dfsr==1&&count(0)==0);
 init();a.cpu.ttb=0x60000000;check_translation(va,false,false,true,0,12);CHECK(count(0)==0);
 init();word(TTB+((va>>18)&0x3ffc),0x60000001);check_translation(va,false,false,true,0,14);CHECK(count(0)==0);
}
static void lockdown(void){
 init();for(unsigned i=0;i<65;i++)section(0x10000000u+i*0x100000u,0x08000000,3,0);
 cp(10,0,0,1);check_translation(0x10000123,false,false,true,0x08000123,0);
 CHECK(cpread(10,0)==0x00100001&&a.tlb[0].entry[0].preserved);
 cp(10,0,0,0x04100000); /* Base=1, victim=1, P=0. */
 for(unsigned i=1;i<65;i++)check_translation(0x10000000u+i*0x100000u,false,false,true,0x08000000,0);
 CHECK(a.tlb[0].entry[0].valid&&a.tlb[0].entry[0].virtual_base==0x10000000);
 CHECK(((cpread(10,0)>>20)&63)==2);
 unsigned victim=(a.tlb[0].lockdown>>20)&63;flush(6);
 CHECK(count(0)==1&&((a.tlb[0].lockdown>>20)&63)==victim);
 cp(8,6,1,0x100fffff);CHECK(count(0)==0); /* MVA also removes preserved entry. */
 cp(10,0,1,0x08300001);CHECK(cpread(10,1)==0x08300001);CHECK(cpread(10,0)==0x04200000);
 check_translation(0x10100000,false,true,true,0x08000000,0);
 CHECK(a.tlb[1].entry[3].valid&&a.tlb[1].entry[3].preserved);
 flush(7);CHECK(count(1)==1);cp(8,5,1,0x10100000);CHECK(count(1)==0);
}
static void checkpoint_and_reference(void){
 init();section(0x10000000,0x08000000,3,0);cp(10,0,0,1);
 check_translation(0x10000123,false,false,true,0x08000123,0);
 check_translation(0x10000123,false,true,true,0x08000123,0);
 section(0x10000000,0x08100000,3,0);b=a;
 size_t n=orchard_checkpoint_size(&a);CHECK(n==277644&&n<sizeof saved);
 CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);CHECK(o_read_le(saved+8,4)==7);
 flush(7);a.tlb[0].entry[0].valid=false;CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);
 CHECK(equal(a.tlb,b.tlb,sizeof a.tlb));
 check_translation(0x10000123,false,false,true,0x08000123,0);
 uint32_t pa=0;CHECK(o_translate_reference(&b,0x10000123,false,false,true,&pa)&&pa==0x08000123);
 CHECK(equal(a.tlb,b.tlb,sizeof a.tlb));
 /* Valid CRC must not admit corrupt masks, alignment, booleans or indexes. */
 const unsigned offsets[]={9348,9360,9352,9364,9365,9366,9367};
 const uint32_t bad[]={2,0x1ff,1,4,16,2,2};
 for(unsigned i=0;i<sizeof offsets/sizeof offsets[0];i++){
  o_copy(legacy,saved,n);if(i<3)put(legacy+offsets[i],bad[i]);else legacy[offsets[i]]=(uint8_t)bad[i];repair(legacy,n);
  CHECK(orchard_checkpoint_load(&a,legacy,n)==ORCHARD_BAD_ARGUMENT);
  CHECK(equal(a.tlb,b.tlb,sizeof a.tlb));
 }
 /* v6 lacked TLB state. Its explicit migration is empty TLBs/reset c10. */
 o_copy(legacy,saved,9348);o_copy(legacy+9348,saved+11404,n-11404);put(legacy+8,6);repair(legacy,n-2056);
 CHECK(orchard_checkpoint_load(&a,legacy,n-2056)==ORCHARD_OK);CHECK(count(0)==0&&count(1)==0&&!a.tlb[0].lockdown&&!a.tlb[1].lockdown);
 check_translation(0x10000123,false,false,true,0x08100123,0);
 orchard_reset(&a);CHECK(count(0)==0&&count(1)==0&&!a.tlb[0].lockdown);
}
static void overlapping_hints(void){
 for(unsigned bank=0;bank<2;bank++){
  init();page(0x10000000,0x08010000,3,3,0,true);
  check_translation(0x10000000,false,bank!=0,true,0x08010000,0);
  section(0x10000000,0x08100000,3,0);
  check_translation(0x10001000,false,bank!=0,true,0x08101000,0);
  /* This address collides in the host hint table with the original tiny
     page. Both architectural entries remain valid; hints must not change
     the deterministic lowest-index match selected by the reference path. */
  check_translation(0x10010000,false,bank!=0,true,0x08110000,0);
  b=a;uint32_t physical=0;
  CHECK(o_translate_reference(&b,0x10000000,false,bank!=0,true,&physical));CHECK(physical==0x08010000);
  size_t n=orchard_checkpoint_size(&a);CHECK(orchard_checkpoint_save(&a,saved,n)==ORCHARD_OK);
  check_translation(0x10000000,false,bank!=0,true,physical,0);
  CHECK(orchard_checkpoint_load(&a,saved,n)==ORCHARD_OK);
  check_translation(0x10000000,false,bank!=0,true,physical,0);
  CHECK(equal(a.tlb,b.tlb,sizeof a.tlb));
  /* A fill at an explicitly selected earlier slot changes first-match
     priority for an already hinted MVA. Exact tags alone are insufficient. */
  init();cp(10,0,bank,1u<<20);
  page(0x10000000,0x08010000,3,3,0,true);
  check_translation(0x10000000,false,bank!=0,true,0x08010000,0);
  cp(10,0,bank,0);section(0x10000000,0x08100000,3,0);
  check_translation(0x10001000,false,bank!=0,true,0x08101000,0);
  check_translation(0x10000000,false,bank!=0,true,0x08100000,0);
 }
}
EXPORT("regression") unsigned regression(void){checks=failures=first=0;stale_and_maintenance();sizes_and_replacement();protection_and_faults();lockdown();checkpoint_and_reference();overlapping_hints();return failures;}
EXPORT("checks") unsigned get_checks(void){return checks;}
EXPORT("first_failure") unsigned get_first(void){return first;}
#ifndef __wasm__
int main(void){unsigned result=regression();printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u}\n",checks,failures,first);return result?1:0;}
#endif
