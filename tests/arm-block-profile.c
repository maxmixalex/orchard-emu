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
    start();
    for (unsigned i = 0; i < 100; ++i) feed(0, 4, true); /* zero opcode is a valid tag */
    arm_block_profile_finish();
    assert(arm_block_profile_count(OP_NATURAL_HIST + 63) == 1);
    assert(arm_block_profile_count(OP_NATURAL_MAX) == 100);
    assert(arm_block_profile_count(OP_UNIQUE) == 1);
    assert(arm_block_profile_count(OP_CACHE_MISSES) == 1);
    assert(arm_block_profile_count(OP_CACHE_HITS) == 99);
    uint64_t fetched = arm_block_profile_count(OP_FETCHED);
    feed(0, 4, true); arm_block_profile_run_boundary();
    assert(arm_block_profile_count(OP_FETCHED) == fetched); /* finished is inert */
    arm_block_profile_reset(); arm_block_profile_finish();
    for (unsigned i = 0; i < OP_COUNT; ++i) assert(arm_block_profile_count(i) == 0);
}
int main(void) {
    classifications(); boundaries();
    puts("ARM block collector classification, boundary, cache and state-isolation checks passed.");
    return 0;
}
