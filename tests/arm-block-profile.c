/* SPDX-License-Identifier: MIT
 * Collector-only tests. No guest execution, firmware or performance timing.
 */
#include "../tools/arm-block-profile.h"
#ifdef NDEBUG
#undef NDEBUG /* Collector assertions must also execute in Release CTest. */
#endif
#include <assert.h>
#include <stdio.h>
#include <string.h>
static orchard_machine machine, before;
static void start(void) {
    memset(&machine, 0, sizeof machine);
    machine.cpu.cpsr = O_SVC | O_I | O_F;
    machine.cpu.r[15] = 0x1000; machine.ticks = 100;
    machine.quiet_left = 1000;
    arm_block_profile_reset(); arm_block_profile_run_boundary();
}
static void feed(uint32_t op, unsigned width, bool passed) {
    memcpy(&before, &machine, sizeof machine);
    arm_block_profile_fetch(&machine, op, width, passed);
    assert(memcmp(&before, &machine, sizeof machine) == 0);
    machine.cpu.r[15] += width; ++machine.ticks; --machine.quiet_left;
}
static uint64_t pair_count(uint32_t key, unsigned field) {
    for (unsigned slot = 0; slot < 65536u; ++slot)
        if (arm_block_profile_pair(slot, 0) == (uint64_t)key + 1u)
            return arm_block_profile_pair(slot, field);
    return 0;
}
static void operands(void) {
    start();
    o_profile_operand v = arm_block_profile_operand(&machine.cpu, 0xe1a30001u); /* MOV r0,r1: Rn ignored. */
    assert(v.kind == 13 && v.form == 2 && v.reads == 2 && v.writes == 1);
    assert(v.flags_written == 0 && !v.carry_input && v.condition_flags == 0);
    v = arm_block_profile_operand(&machine.cpu, 0xe150f001u); /* CMP r0,r1: Rd ignored. */
    assert(v.reads == 3 && v.writes == 0 && v.flags_written == (O_N | O_Z | O_C | O_V));
    v = arm_block_profile_operand(&machine.cpu, 0xe3b02001u); /* MOVS r2,#1 preserves C,V. */
    assert(v.form == 0 && v.reads == 0 && v.writes == 4 && v.flags_written == (O_N | O_Z));
    v = arm_block_profile_operand(&machine.cpu, 0xe3b02401u); /* Rotated immediate supplies C. */
    assert(v.form == 1 && v.flags_written == (O_N | O_Z | O_C) && !v.carry_input);
    v = arm_block_profile_operand(&machine.cpu, 0xe1a00061u); /* MOV r0,r1,RRX uses C without S. */
    assert(v.form == 7 && v.carry_input && v.flags_written == 0);
    v = arm_block_profile_operand(&machine.cpu, 0xe2a32000u); /* ADC r2,r3,#0 uses C. */
    assert(v.carry_input && v.reads == 8 && v.writes == 4 && v.flags_written == 0);
    for (unsigned shift = 0; shift < 4; ++shift) {
        v = arm_block_profile_operand(&machine.cpu, 0xe1b00081u | (shift << 5));
        assert(v.form == 3u + shift && v.flags_written == (O_N | O_Z | O_C));
        v = arm_block_profile_operand(&machine.cpu, 0xe1b00001u | (shift << 5));
        assert(v.form == (shift == 0 ? 2u : shift == 3 ? 7u : 3u + shift));
        assert(v.flags_written == (O_N | O_Z | (shift ? O_C : 0)));
        for (unsigned amount = 0; amount <= 256; ++amount) {
            machine.cpu.r[2] = amount;
            v = arm_block_profile_operand(&machine.cpu, 0xe1b00211u | (shift << 5));
            assert(v.form == 8u + shift && v.reads == 6 && !v.carry_input);
            assert(v.flags_written == (O_N | O_Z | ((amount & 255u) ? O_C : 0)));
        }
    }
    const uint32_t flags[] = {O_Z, O_Z, O_C, O_C, O_N, O_N, O_V, O_V,
        O_C | O_Z, O_C | O_Z, O_N | O_V, O_N | O_V,
        O_N | O_Z | O_V, O_N | O_Z | O_V, 0, 0};
    for (unsigned i = 0; i < 16; ++i) {
        v = arm_block_profile_operand(&machine.cpu, (i << 28) | 0x01a00001u);
        assert(v.condition_flags == flags[i]);
    }
}
static void operand_pairs(void) {
    /* Independent moves have no false dependency on MOV's ignored Rn. */
    start(); feed(0xe1a30001u, 4, true); feed(0xe1a03002u, 4, true);
    arm_block_profile_finish();
    uint32_t key = 13u | (13u << 4) | (2u << 8) | (2u << 12);
    assert(pair_count(key, 1) == 1 && pair_count(key, 2) == 1);
    start(); feed(0xe1a00001u, 4, true); feed(0xe1a01000u, 4, true);
    arm_block_profile_finish();
    assert(pair_count(key | (1u << 16) | (1u << 17), 1) == 1); /* RAW and WAR. */
    start(); feed(0xe1a00001u, 4, true); feed(0xe1a00002u, 4, true);
    arm_block_profile_finish();
    assert(pair_count(key | (1u << 18), 1) == 1); /* WAW only. */
    /* MOVS without a shift does not produce C for the ADC; a shift does. */
    for (unsigned shifted = 0; shifted < 2; ++shifted) {
        start(); feed(0xe1b00001u | (shifted << 7), 4, true); feed(0xe2a32000u, 4, true);
        arm_block_profile_finish();
        key = 13u | (5u << 4) | ((2u + shifted) << 8) | (1u << 23);
        if (shifted) key |= 1u << 20;
        assert(pair_count(key, 1) == 1);
    }
    /* A CMP writes flags but has no destination despite a nonzero Rd field. */
    start(); feed(0xe1513000u, 4, true); feed(0x01a02003u, 4, true);
    arm_block_profile_finish();
    key = 10u | (13u << 4) | (2u << 8) | (2u << 12) |
          (1u << 19) | (1u << 23) | (1u << 26);
    assert(pair_count(key, 1) == 1);
    start(); feed(0x01b00001u, 4, true); feed(0xe1b02003u, 4, true);
    arm_block_profile_finish();
    key = 13u | (13u << 4) | (2u << 8) | (2u << 12) |
          (1u << 21) | (1u << 22) | (1u << 23) | (1u << 24) | (1u << 25);
    assert(pair_count(key, 1) == 1);
    assert(arm_block_profile_pair(65536, 0) == 0);
    assert(arm_block_profile_pair(0, 3) == 0);
    /* Zero is a real structural signature, not an empty-table sentinel. */
    start(); feed(0xe2010001u, 4, true); feed(0xe2032002u, 4, true);
    arm_block_profile_finish();
    assert(pair_count(0, 1) == 1 && pair_count(0, 2) == 1);
    start();
    for (unsigned slot = 0; slot < 65536u; ++slot) {
        o_profile.pairs[slot].used = 1;
        o_profile.pairs[slot].key = slot;
    }
    o_profile.previous_operand.writes = 1;
    o_profile_operand current = {0}; current.reads = 1;
    arm_block_profile_pair_record(current);
    assert(arm_block_profile_count(OP_PAIR_OVERFLOW) == 1);
    arm_block_profile_reset(); arm_block_profile_finish();
    for (unsigned slot = 0; slot < 65536u; ++slot)
        assert(arm_block_profile_pair(slot, 0) == 0);
}
static void classifications(void) {
    const uint32_t opcodes[] = {0xe0000001,0xe0200001,0xe0400001,0xe0600001,
        0xe0800001,0xe0a00001,0xe0c00001,0xe0e00001,
        0xe1100001,0xe1300001,0xe1500001,0xe1700001,
        0xe1800001,0xe1a00001,0xe1c00001,0xe1e00001};
    start();
    for (unsigned i = 0; i < 16; ++i) feed(opcodes[i], 4, true);
    arm_block_profile_finish();
    assert(arm_block_profile_count(OP_PURE_DP) == 16);
    assert(arm_block_profile_count(OP_UNIQUE) == 16);
    assert(arm_block_profile_count(OP_NATURAL_BLOCKS) == 1);
    assert(arm_block_profile_count(OP_BOUNDED_BLOCKS) == 1);
    assert(arm_block_profile_count(OP_NATURAL_HIST + 15) == 1);
    assert(arm_block_profile_count(OP_BOUNDED_HIST + 15) == 1);
    assert(arm_block_profile_count(OP_PAIRS) == 15);
    assert(arm_block_profile_count(OP_BOUNDED_PAIRS) == 15);
    assert(arm_block_profile_count(OP_DISJOINT_PAIRS) == 8);
    assert(arm_block_profile_count(OP_ODD_BLOCKS) == 0);
    for (unsigned i = 0; i < 16; ++i) {
        assert(arm_block_profile_count(OP_KINDS + i) == 1);
        if (i) assert(arm_block_profile_count(OP_KIND_PAIRS + (i - 1) * 16 + i) == 1);
    }
    start();
    feed(0xe2800001, 4, false); /* condition failed */
    feed(0x2001, 2, true);      /* Thumb */
    feed(0xea000000, 4, true);  /* branch */
    feed(0xe5901000, 4, true);  /* LDR */
    feed(0xe8800003, 4, true);  /* STM */
    feed(0xe08f0001, 4, true);  /* Rn=PC */
    feed(0xe080f001, 4, true);  /* Rd=PC */
    feed(0xe080000f, 4, true);  /* Rm=PC */
    feed(0xe1b0f00e, 4, true);  /* exception return */
    feed(0xe0000091, 4, true);  /* multiply overlap */
    feed(0xe0800f11, 4, true);  /* invalid Rs=PC */
    feed(0xe12fff10, 4, true);  /* BX */
    feed(0xe110f001, 4, true);  /* TST has no destination register */
    arm_block_profile_finish();
    assert(arm_block_profile_count(OP_FETCHED) == 13);
    assert(arm_block_profile_count(OP_SKIPPED) == 1);
    assert(arm_block_profile_count(OP_THUMB) == 1);
    assert(arm_block_profile_count(OP_BRANCH) == 1);
    assert(arm_block_profile_count(OP_MEMORY) == 2);
    assert(arm_block_profile_count(OP_PC_DP) == 3);
    assert(arm_block_profile_count(OP_OTHER) == 4);
    assert(arm_block_profile_count(OP_PURE_DP) == 1);
}
static void boundaries(void) {
    start();
    for (unsigned i = 0; i < 3; ++i) feed(0xe2800001, 4, true);
    arm_block_profile_run_boundary();
    for (unsigned i = 0; i < 2; ++i) feed(0xe2800001, 4, true);
    arm_block_profile_finish(); arm_block_profile_finish();
    assert(arm_block_profile_count(OP_NATURAL_BLOCKS) == 1);
    assert(arm_block_profile_count(OP_NATURAL_HIST + 4) == 1);
    assert(arm_block_profile_count(OP_BOUNDED_BLOCKS) == 2);
    assert(arm_block_profile_count(OP_BOUNDED_HIST + 2) == 1);
    assert(arm_block_profile_count(OP_BOUNDED_HIST + 1) == 1);
    assert(arm_block_profile_count(OP_RUN_CUTS) == 1);
    assert(arm_block_profile_count(OP_BOUNDED_PAIRS) == 3);
    assert(arm_block_profile_count(OP_DISJOINT_PAIRS) == 2);
    assert(arm_block_profile_count(OP_ODD_BLOCKS) == 1);
    assert(arm_block_profile_count(OP_PAIR_SIGNATURES) == 1);
    assert(arm_block_profile_count(OP_RUN_UNIQUE_SUM) == 2);
    assert(arm_block_profile_count(OP_RUN_UNIQUE_HIST + 1) == 2);
    for (unsigned i = 0; i < 4; ++i) {
        assert(arm_block_profile_count(OP_CACHE_MISSES + i) == 1);
        assert(arm_block_profile_count(OP_CACHE_HITS + i) == 4);
        assert(arm_block_profile_count(OP_LOCAL_MISSES + i) == 2);
        assert(arm_block_profile_count(OP_LOCAL_HITS + i) == 3);
    }
    start();
    feed(0xe2800001, 4, true); feed(0xe2800001, 4, true);
    machine.quiet_left = 500;
    feed(0xe2800001, 4, true); feed(0xe2800001, 4, true);
    arm_block_profile_finish();
    assert(arm_block_profile_count(OP_NATURAL_HIST + 3) == 1);
    assert(arm_block_profile_count(OP_BOUNDED_HIST + 1) == 2);
    assert(arm_block_profile_count(OP_EVENT_CUTS) == 1);
    assert(arm_block_profile_count(OP_BOUNDED_PAIRS) == 2);
    assert(arm_block_profile_count(OP_DISJOINT_PAIRS) == 2);
    assert(arm_block_profile_count(OP_ODD_BLOCKS) == 0);
    start();
    feed(0xe2800001, 4, true);
    ++machine.cpu.exceptions; feed(0xe2800001, 4, true);
    ++machine.ticks; feed(0xe2800001, 4, true);
    machine.cpu.r[15] += 4; feed(0xe2800001, 4, true);
    machine.cpu.cpsr ^= O_I; feed(0xe2800001, 4, true);
    feed(0xea000000, 4, true); feed(0xe2800001, 4, true);
    arm_block_profile_finish();
    assert(arm_block_profile_count(OP_NATURAL_HIST) == 6);
    assert(arm_block_profile_count(OP_NONCONTIGUOUS_CUTS) == 4);
    assert(arm_block_profile_count(OP_OTHER_CUTS) == 1);
    assert(arm_block_profile_count(OP_BOUNDED_PAIRS) == 0);
    assert(arm_block_profile_count(OP_DISJOINT_PAIRS) == 0);
    assert(arm_block_profile_count(OP_ODD_BLOCKS) == 6);
    start();
    for (unsigned i = 0; i < 100; ++i) feed(0, 4, true); /* zero opcode is a valid tag */
    arm_block_profile_finish();
    assert(arm_block_profile_count(OP_NATURAL_HIST + 63) == 1);
    assert(arm_block_profile_count(OP_NATURAL_MAX) == 100);
    assert(arm_block_profile_count(OP_UNIQUE) == 1);
    assert(arm_block_profile_count(OP_CACHE_MISSES) == 1);
    assert(arm_block_profile_count(OP_CACHE_HITS) == 99);
    assert(arm_block_profile_count(OP_BOUNDED_PAIRS) == 99);
    assert(arm_block_profile_count(OP_DISJOINT_PAIRS) == 50);
    uint64_t fetched = arm_block_profile_count(OP_FETCHED);
    feed(0, 4, true); arm_block_profile_run_boundary();
    assert(arm_block_profile_count(OP_FETCHED) == fetched); /* finished is inert */
    arm_block_profile_reset(); arm_block_profile_finish();
    for (unsigned i = 0; i < OP_COUNT; ++i) assert(arm_block_profile_count(i) == 0);
}
int main(void) {
    classifications(); boundaries(); operands(); operand_pairs();
    puts("ARM block collector classification, boundary, operand dependencies, disjoint pairs, cache and state-isolation checks passed.");
    return 0;
}
