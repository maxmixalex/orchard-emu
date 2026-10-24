/* SPDX-License-Identifier: MIT
 * Host execution fast paths versus the retained full-checkpoint dispatcher
 * and page-table walker. No firmware and no external emulator implementation.
 */
#include "internal.h"
#ifndef __wasm__
#include <stdio.h>
#include <string.h>
#define EXPORT(name)
#else
#define EXPORT(name) __attribute__((export_name(name)))
#endif
static orchard_machine fast, reference;
static unsigned checks, failures, first_failure;
static void check(bool value, unsigned line) {
    ++checks;
    if (!value) { if (!failures) first_failure = line; ++failures; }
}
#define CHECK(x) check((x), __LINE__)
static bool equal(const void *a, const void *b, size_t n) {
#ifndef __wasm__
    return memcmp(a, b, n) == 0;
#else
    const uint8_t *x = a, *y = b;
    for (size_t i = 0; i < n; ++i) if (x[i] != y[i]) return false;
    return true;
#endif
}
static uint32_t random_word(uint32_t *s) {
    *s ^= *s << 13; *s ^= *s >> 17; *s ^= *s << 5; return *s;
}
static void pair_write(uint32_t a, uint32_t v) {
    CHECK(o_phys_write(&fast, a, 4, v));
    CHECK(o_phys_write(&reference, a, 4, v));
}
static void initialize(void) {
    CHECK(orchard_init(&fast, sizeof fast, 1) != NULL);
    CHECK(orchard_init(&reference, sizeof reference, 1) != NULL);
}
static void one_instruction(uint32_t op, bool thumb, uint32_t *seed) {
    o_cpu c;
    o_cpu_reset(&c);
    const unsigned modes[] = {O_USR, O_SYS, O_SVC, O_IRQ, O_FIQ, O_ABT, O_UND};
    uint32_t bits = random_word(seed);
    c.cpsr = (bits & 0xf00000c0u) | modes[bits % 7] | (thumb ? O_T : 0);
    c.next_pc = random_word(seed);
    uint32_t high = random_word(seed), low = random_word(seed);
    c.instructions = (uint64_t)high << 32 | low;
    c.exceptions = random_word(seed);
    for (unsigned i = 0; i < 15; ++i) {
        c.r[i] = (i % 3 == 0) ? O_RAM_BASE + 0x200 + 4u * i : random_word(seed);
    }
    for (unsigned i = 0; i < 7; ++i) c.usr[i] = c.fiq[i] = random_word(seed);
    for (unsigned i = 0; i < 4; ++i) for (unsigned j = 0; j < 2; ++j) c.bank[i][j] = random_word(seed);
    for (unsigned i = 0; i < 5; ++i) {
        bits = random_word(seed); c.spsr[i] = (bits & 0xf00000e0u) | modes[bits % 7];
    }
    c.r[15] = 0x100;
    fast.cpu = reference.cpu = c;
    o_zero(&fast.stop, sizeof fast.stop); o_zero(&reference.stop, sizeof reference.stop);
    for (unsigned i = 0; i < 4; ++i) fast.flash[0x100+i] = reference.flash[0x100+i] = (uint8_t)(op >> (i*8));
    o_cpu_step(&fast);
    o_cpu_step_reference(&reference);
    CHECK(equal(&fast.cpu, &reference.cpu, sizeof c));
    CHECK(equal(&fast.stop, &reference.stop, sizeof fast.stop));
    CHECK(equal(&fast.soc, &reference.soc, sizeof fast.soc));
    CHECK(equal(fast.ram, reference.ram, sizeof fast.ram));
    CHECK(fast.nor_sequence == reference.nor_sequence && fast.nor_id_mode == reference.nor_id_mode);
}
static void dispatch(void) {
    initialize();
    uint32_t seed = 0x2042920u;
    /* All DP opcodes, S/immediate/condition combinations, ordinary versus
       PC destinations and every register-shift source restriction. */
    for (unsigned kind = 0; kind < 16; ++kind)
    for (unsigned flags = 0; flags < 2; ++flags)
    for (unsigned imm = 0; imm < 2; ++imm)
    for (unsigned cond = 0; cond < 16; ++cond)
    for (unsigned pc = 0; pc < 2; ++pc) {
        uint32_t op = cond << 28 | imm << 25 | kind << 21 | flags << 20 |
                      3u << 16 | (pc ? 15u : 4u) << 12 | (random_word(&seed) & 0xfffu);
        one_instruction(op, false, &seed);
    }
    const uint32_t edges[] = {0xe12fff10, 0xe10f1000, 0xe129f001, 0xe169f001, 0xe1b0f00e,
        0xe0000291, 0xe0803291, 0xe0c03291, 0xe1002091, 0xe59100b0, 0xe59110b0,
        0xe890ffff, 0xe8d0ffff, 0xe8f0ffff, 0xe4801004, 0xe4b01004, 0xef000000,
        0xee110f10, 0xee010f10, 0xee070f90, 0xeafffffe, 0xeb7fffff, 0xea800000,
        0xe080ff11, 0xe080021f, 0xe08f0211, 0xe0800f11, 0xe0800091, 0xffffffff};
    for (unsigned i = 0; i < sizeof edges / sizeof *edges; ++i)
        for (unsigned j = 0; j < 16; ++j) one_instruction((edges[i]&0x0fffffffu)|(j<<28), false, &seed);
    for (unsigned i = 0; i < 8192; ++i) {
        one_instruction(random_word(&seed), false, &seed);
        if (i < 1024) one_instruction(random_word(&seed) & 0xffffu, true, &seed);
    }
}
/* Directed single-transfer rollback: every addressing flag combination,
 * PC/source/base overlap, alignment aborts and diagnostic MMIO stops. */
static void single_rollbacks(void) {
    const uint32_t addresses[]={O_RAM_BASE+0x300, O_RAM_BASE+0x301,
        O_RAM_BASE+0x3fffc, 0x60000000u, 0x50000020u, 0x4d000068u};
    for(unsigned flags=0;flags<64;flags++)
    for(unsigned addr=0;addr<6;addr++)
    for(unsigned dest=0;dest<3;dest++) {
        initialize();
        unsigned rd=dest==0?2u:dest==1?3u:15u;
        uint32_t op=0xe4000004u|(flags<<20)|(3u<<16)|(rd<<12);
        for(unsigned i=0;i<4;i++)fast.flash[0x100+i]=reference.flash[0x100+i]=(uint8_t)(op>>(8*i));
        fast.cpu.r[15]=reference.cpu.r[15]=0x100;
        fast.cpu.r[3]=reference.cpu.r[3]=addresses[addr];
        fast.cpu.r[2]=reference.cpu.r[2]=0x87654321;
        fast.cpu.r[4]=reference.cpu.r[4]=4;
        fast.cpu.control=reference.cpu.control=0x7a; /* alignment checking */
        fast.cpu.far=reference.cpu.far=0xdeadbeef;
        fast.cpu.dfsr=reference.cpu.dfsr=0x123;
        fast.cpu.next_pc=reference.cpu.next_pc=0xfeed;
        o_cpu_step(&fast);o_cpu_step_reference(&reference);
        CHECK(equal(&fast.cpu,&reference.cpu,sizeof fast.cpu));
        CHECK(equal(&fast.stop,&reference.stop,sizeof fast.stop));
        CHECK(equal(&fast.soc,&reference.soc,sizeof fast.soc));
        CHECK(equal(fast.ram,reference.ram,sizeof fast.ram));
    }
}
static void translate(uint32_t va, bool write, bool fetch, bool user) {
    o_zero(&fast.stop, sizeof fast.stop); o_zero(&reference.stop, sizeof reference.stop);
    fast.cpu.data_abort = fast.cpu.prefetch_abort = false;
    reference.cpu.data_abort = reference.cpu.prefetch_abort = false;
    uint32_t a = 0xdeadbeef, b = a;
    bool x = o_translate(&fast, va, write, fetch, user, &a);
    bool y = o_translate_reference(&reference, va, write, fetch, user, &b);
    CHECK(x == y && a == b);
    CHECK(equal(&fast.cpu, &reference.cpu, sizeof fast.cpu));
    CHECK(equal(fast.tlb, reference.tlb, sizeof fast.tlb));
    CHECK(equal(&fast.stop, &reference.stop, sizeof fast.stop));
    CHECK(fast.sram_alias_reads == reference.sram_alias_reads);
}
static void translations(void) {
    initialize();
    const uint32_t va = 0x10006a42u;
    const uint32_t ttb = O_RAM_BASE + 0x4000, table = O_RAM_BASE + 0x8000;
    for (unsigned layout = 0; layout < 4; ++layout) {
        bool section = layout == 0, fine = layout == 3;
        uint32_t first = ttb + ((va >> 18) & 0x3ffcu);
        uint32_t second = table + (fine ? ((va >> 8) & 0xffcu) : ((va >> 10) & 0x3fcu));
        for (unsigned ap = 0; ap < 4; ++ap)
        for (unsigned domain = 0; domain < 4; ++domain)
        for (unsigned sr = 0; sr < 4; ++sr) {
            o_zero(fast.tlb,sizeof fast.tlb);o_zero(reference.tlb,sizeof reference.tlb);
            uint32_t descriptor = section ? O_RAM_BASE | (ap << 10) | 2u : table | (fine ? 3u : 1u);
            pair_write(first, descriptor | (7u << 5));
            if (!section) pair_write(second, O_RAM_BASE | (layout == 1 ? 1u : layout == 2 ? 2u : 3u) | (ap * 0x550u));
            fast.cpu.ttb = reference.cpu.ttb = ttb;
            fast.cpu.control = reference.cpu.control = 0x79 | (sr << 8);
            fast.cpu.domain = reference.cpu.domain = domain << 14;
            for (unsigned access = 0; access < 8; ++access) {
                translate(va, access&1, access&2, access&4);
                translate(va, access&1, access&2, access&4); /* Warm hit. */
                translate((va&~1023u)+1023u, access&1, access&2, access&4);
            }
        }
        fast.cpu.control = reference.cpu.control = 0x79;
        fast.cpu.domain = reference.cpu.domain = UINT32_MAX;
        pair_write(first, (section ? O_RAM_BASE | 2u : table | (fine ? 3u : 1u)) | (7u << 5));
        if (!section) pair_write(second, O_RAM_BASE | (layout == 1 ? 1u : layout == 2 ? 2u : 3u));
        translate(va,false,false,false); translate(va,false,false,false);
        /* Guest RAM edits leave already loaded TLB entries intact. */
        if (!section) { pair_write(second, 0); translate(va,false,false,false); }
        pair_write(first, 0); translate(va,false,true,false);
    }
    /* Adjacent 1 KiB subpages can have different AP permissions. */
    fast.cpu.control = reference.cpu.control = 0x79;
    fast.cpu.domain = reference.cpu.domain = 1;
    fast.cpu.ttb = reference.cpu.ttb = ttb;
    pair_write(ttb+0x400,table|1u);
    pair_write(table,O_RAM_BASE|2u|(3u<<4));
    translate(0x100003fc,false,false,true); translate(0x100003fc,false,false,true);
    translate(0x10000400,false,true,true);
    /* Architectural TLB hits do not repeat a page-table bus read, even when
       a synthetic descriptor came from a side-effecting device. */
    fast.cpu.ttb = reference.cpu.ttb = 0x50000000u;
    fast.cpu.domain = reference.cpu.domain = UINT32_MAX;
    fast.soc.uart[0][0]=reference.soc.uart[0][0]=3;
    fast.soc.uart[0][1]=reference.soc.uart[0][1]=5;
    CHECK(o_q_push(&fast.soc.rx,2)); CHECK(o_q_push(&reference.soc.rx,2));
    translate(0x00900000,false,false,false);
    CHECK(fast.soc.rx.count==0 && reference.soc.rx.count==0);
    translate(0x00900000,false,false,false);
    /* Self-modified tables in boot SRAM, FCSE and context changes. */
    fast.cpu.ttb = reference.cpu.ttb = O_BOOT_SRAM_BASE;
    fast.cpu.domain = reference.cpu.domain = UINT32_MAX;
    fast.cpu.pid = reference.cpu.pid = 0x02000000;
    pair_write(O_BOOT_SRAM_BASE+128, O_RAM_BASE|2u);
    translate(0x123,false,false,false); translate(0x123,false,false,false);
    pair_write(O_BOOT_SRAM_BASE+128, 0x10000000|2u); translate(0x123,false,false,false);
    fast.cpu.pid = reference.cpu.pid = 0; pair_write(O_BOOT_SRAM_BASE,O_RAM_BASE|2u);
    translate(0x123,false,false,false);
    fast.cpu.control = reference.cpu.control = 0x78; translate(0x123,false,false,false);
    fast.cpu.control = reference.cpu.control = 0x79;
    fast.cpu.ttb = reference.cpu.ttb = O_RAM_BASE + 0x4000;
    pair_write(O_RAM_BASE+0x4000,O_RAM_BASE|2u);
    translate(0x123,false,false,false); translate(0x123,false,false,false);
    CHECK(orchard_sram_select(&fast,ORCHARD_SRAM_BANK1_MIRROR)==ORCHARD_OK);
    CHECK(orchard_sram_select(&reference,ORCHARD_SRAM_BANK1_MIRROR)==ORCHARD_OK);
    pair_write(O_RAM_BASE+fast.profile->ram_bytes+0x4000,0x10000000|2u);
    translate(0x123,false,false,false);
    /* Aliased table reads occur on a miss, not on subsequent TLB hits. */
    fast.cpu.ttb = reference.cpu.ttb = O_RAM_BASE+fast.profile->ram_bytes+0x4000;
    translate(0x123,false,false,false); translate(0x123,false,false,false);
    /* Changing a descriptor source does not implicitly invalidate a TLB. */
    fast.cpu.ttb = reference.cpu.ttb = 0;
    for (unsigned i=0;i<4;++i) fast.flash[i] = reference.flash[i] = (uint8_t)((O_RAM_BASE|2u)>>(8*i));
    translate(0x123,false,false,false); translate(0x123,false,false,false);
    fast.nor_id_mode = reference.nor_id_mode = true;
    translate(0x123,false,false,false);
    /* TLB entries contain addresses, not pointers into the original arena. */
    fast.nor_id_mode = reference.nor_id_mode = false;
    translate(0x123,false,false,false);
    reference = fast;
    fast.flash[0] = 0;
    uint32_t physical;
    CHECK(o_translate(&reference,0x123,false,false,false,&physical));
    CHECK(physical==O_RAM_BASE+0x123);
    orchard_reset(&fast);
    for(unsigned i=0;i<O_TRANSLATIONS;++i) CHECK(!fast.translations[0][i].valid && !fast.translations[1][i].valid);
}
EXPORT("regression") unsigned run(void) {
    checks=failures=first_failure=0;
    dispatch(); single_rollbacks(); translations();
    return failures;
}
EXPORT("checks") unsigned get_checks(void) { return checks; }
EXPORT("first_failure") unsigned get_first(void) { return first_failure; }
#ifndef __wasm__
int main(void) { unsigned result=run(); printf("{\"checks\":%u,\"failures\":%u,\"first_failure\":%u}\n",checks,result,first_failure); return result?1:0; }
#endif
