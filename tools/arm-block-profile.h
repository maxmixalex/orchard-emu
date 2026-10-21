/* SPDX-License-Identifier: MIT
 * Diagnostic-only collector, included in a generated copy of cpu.c. Never
 * include it in production sources. It records no public opcode/PC trace.
 */
#ifndef ORCHARD_ARM_BLOCK_PROFILE_H
#define ORCHARD_ARM_BLOCK_PROFILE_H
#include "internal.h"

#ifdef __wasm__
#define O_PROFILE_EXPORT(n) __attribute__((export_name(n)))
#else
#define O_PROFILE_EXPORT(n)
#endif

enum {
    OP_FETCHED, OP_ARM, OP_THUMB, OP_SKIPPED, OP_BRANCH, OP_MEMORY,
    OP_OTHER, OP_PURE_DP, OP_PC_DP, OP_FAST_DP,
    OP_NATURAL_BLOCKS, OP_NATURAL_MAX, OP_BOUNDED_BLOCKS, OP_BOUNDED_MAX,
    OP_EVENT_CUTS, OP_RUN_CUTS, OP_NONCONTIGUOUS_CUTS, OP_OTHER_CUTS,
    OP_UNIQUE, OP_OVERFLOW, OP_PAIRS, OP_RUNS, OP_RUN_UNIQUE_SUM, OP_RUN_UNIQUE_MAX,
    OP_KINDS = 32, OP_FORMS = 48, OP_NATURAL_HIST = 64,
    OP_BOUNDED_HIST = 128, OP_KIND_PAIRS = 192,
    OP_CACHE_HITS = 448, OP_CACHE_MISSES = 452,
    OP_LOCAL_HITS = 456, OP_LOCAL_MISSES = 460,
    OP_RUN_UNIQUE_HIST = 464, OP_COUNT = 480
};
typedef struct { uint32_t opcode, used, run; } o_profile_opcode;
typedef struct { uint32_t opcode, epoch; } o_profile_cache;
static struct {
    uint64_t counts[OP_COUNT];
    o_profile_opcode opcodes[65536];
    o_profile_cache caches[2][4][4096];
    uint64_t previous_tick, previous_exceptions;
    uint32_t previous_pc, previous_mode, previous_quiet, previous_kind;
    uint32_t natural, bounded, run, run_unique;
    bool active;
} o_profile;

static void arm_block_profile_flush(bool natural) {
    uint32_t *length = natural ? &o_profile.natural : &o_profile.bounded;
    if (!*length) return;
    unsigned total = natural ? OP_NATURAL_BLOCKS : OP_BOUNDED_BLOCKS;
    unsigned maximum = natural ? OP_NATURAL_MAX : OP_BOUNDED_MAX;
    unsigned histogram = natural ? OP_NATURAL_HIST : OP_BOUNDED_HIST;
    ++o_profile.counts[total];
    if (*length > o_profile.counts[maximum]) o_profile.counts[maximum] = *length;
    ++o_profile.counts[histogram + (*length >= 64u ? 63u : *length - 1u)];
    *length = 0;
}
static void arm_block_profile_run_finish(void) {
    if (!o_profile.run) return;
    uint32_t n = o_profile.run_unique;
    o_profile.counts[OP_RUN_UNIQUE_SUM] += n;
    if (n > o_profile.counts[OP_RUN_UNIQUE_MAX]) o_profile.counts[OP_RUN_UNIQUE_MAX] = n;
    unsigned bin = 0;
    while (n && bin < 11u) { ++bin; n >>= 1; }
    ++o_profile.counts[OP_RUN_UNIQUE_HIST + bin];
    o_profile.run_unique = 0;
}
O_PROFILE_EXPORT("arm_block_profile_reset")
void arm_block_profile_reset(void) {
    uint8_t *p = (uint8_t *)&o_profile;
    for (size_t n = 0; n < sizeof o_profile; ++n) p[n] = 0;
    o_profile.active = true;
}
/* The harness calls this immediately before each original public run().
 * Natural streams may span host calls; bounded blocks and local cache tags
 * cannot. Neither operation advances or changes any guest state.
 */
O_PROFILE_EXPORT("arm_block_profile_run_boundary")
void arm_block_profile_run_boundary(void) {
    if (!o_profile.active) return;
    if (o_profile.bounded) ++o_profile.counts[OP_RUN_CUTS];
    arm_block_profile_flush(false);
    arm_block_profile_run_finish();
    ++o_profile.run;
    ++o_profile.counts[OP_RUNS];
}
O_PROFILE_EXPORT("arm_block_profile_finish")
void arm_block_profile_finish(void) {
    if (!o_profile.active) return;
    arm_block_profile_flush(true); arm_block_profile_flush(false);
    arm_block_profile_run_finish();
    o_profile.active = false;
}
O_PROFILE_EXPORT("arm_block_profile_count")
uint64_t arm_block_profile_count(unsigned index) {
    return index < OP_COUNT ? o_profile.counts[index] : 0;
}
static void arm_block_profile_opcode(uint32_t opcode) {
    uint32_t h = opcode * UINT32_C(0x9e3779b9);
    unsigned slot = h >> 16;
    bool found = false;
    for (unsigned attempt = 0; attempt < 65536u; ++attempt) {
        o_profile_opcode *entry = &o_profile.opcodes[slot];
        if (!entry->used || entry->opcode == opcode) {
            if (!entry->used) {
                entry->used = 1; entry->opcode = opcode;
                ++o_profile.counts[OP_UNIQUE];
            }
            if (entry->run != o_profile.run) {
                entry->run = o_profile.run; ++o_profile.run_unique;
            }
            found = true; break;
        }
        slot = (slot + 1u) & 65535u;
    }
    if (!found) ++o_profile.counts[OP_OVERFLOW];
    const unsigned shifts[] = {26, 24, 22, 20};
    for (unsigned local = 0; local < 2; ++local) {
        uint32_t epoch = local ? o_profile.run : 1u;
        for (unsigned size = 0; size < 4; ++size) {
            o_profile_cache *entry = &o_profile.caches[local][size][h >> shifts[size]];
            bool hit = entry->epoch == epoch && entry->opcode == opcode;
            unsigned index = local ? (hit ? OP_LOCAL_HITS : OP_LOCAL_MISSES) :
                                     (hit ? OP_CACHE_HITS : OP_CACHE_MISSES);
            ++o_profile.counts[index + size];
            entry->opcode = opcode; entry->epoch = epoch;
        }
    }
}
static bool arm_block_profile_pure(uint32_t op) {
    if (op & 0x0c000000u) return false;
    unsigned kind = (op >> 21) & 15u, rd = (op >> 12) & 15u;
    bool test = kind >= 8u && kind <= 11u;
    if (test && !(op & (1u << 20))) return false;
    if (!(op & (1u << 25)) && (op & 16u) &&
        ((op & 128u) || ((op >> 8) & 15u) == 15u)) return false;
    /* Keep every live-PC input/output outside this deliberately narrow
     * estimate, even ignored Rn fields in MOV/MVN. Tests do not write Rd.
     */
    return (test || rd != 15u) && ((op >> 16) & 15u) != 15u &&
           ((op & (1u << 25)) || (op & 15u) != 15u);
}
static void arm_block_profile_fetch(const orchard_machine *m, uint32_t op,
                                    unsigned width, bool condition_passed) {
    if (!o_profile.active) return;
    const o_cpu *c = &m->cpu;
    ++o_profile.counts[OP_FETCHED];
    bool pure = false;
    if (width == 2u) ++o_profile.counts[OP_THUMB];
    else {
        ++o_profile.counts[OP_ARM];
        if (!condition_passed) ++o_profile.counts[OP_SKIPPED];
        else if ((op & 0x0e000000u) == 0x0a000000u) ++o_profile.counts[OP_BRANCH];
        else if ((op & 0x0c000000u) == 0x04000000u ||
                 (op & 0x0e000000u) == 0x08000000u) ++o_profile.counts[OP_MEMORY];
        else {
            pure = arm_block_profile_pure(op);
            unsigned kind = (op >> 21) & 15u;
            bool test = kind >= 8u && kind <= 11u;
            bool fast = !(op & 0x0c000000u) && !(test && !(op & (1u << 20))) &&
                !(!test && (op & (1u << 20)) && ((op >> 12) & 15u) == 15u) &&
                !(!(op & (1u << 25)) && (op & 16u) &&
                  ((op & 128u) || ((op >> 8) & 15u) == 15u));
            if (fast) ++o_profile.counts[OP_FAST_DP];
            if (pure) ++o_profile.counts[OP_PURE_DP];
            else ++o_profile.counts[fast ? OP_PC_DP : OP_OTHER];
        }
    }
    if (!pure) {
        if (o_profile.natural) ++o_profile.counts[OP_OTHER_CUTS];
        arm_block_profile_flush(true); arm_block_profile_flush(false);
        return;
    }
    unsigned kind = (op >> 21) & 15u;
    ++o_profile.counts[OP_KINDS + kind];
    unsigned form = op & (1u << 25) ? 0u : (op & 16u) ? 3u : (op & 0xff0u) ? 2u : 1u;
    ++o_profile.counts[OP_FORMS + form];
    arm_block_profile_opcode(op);
    bool contiguous = o_profile.natural && c->r[15] == o_profile.previous_pc + 4u &&
        m->ticks == o_profile.previous_tick + 1u &&
        c->exceptions == o_profile.previous_exceptions &&
        (c->cpsr & 255u) == o_profile.previous_mode;
    if (!contiguous) {
        if (o_profile.natural) ++o_profile.counts[OP_NONCONTIGUOUS_CUTS];
        arm_block_profile_flush(true); arm_block_profile_flush(false);
    } else {
        ++o_profile.counts[OP_PAIRS];
        ++o_profile.counts[OP_KIND_PAIRS + o_profile.previous_kind * 16u + kind];
        /* A positive quiet countdown that decreased by exactly one proves
         * the preceding boundary did not execute a scheduled event. This
         * is only a conservative grouping estimate, not permission to skip
         * live instruction fetches or per-instruction IRQ/fault semantics.
         */
        if (o_profile.bounded && (!o_profile.previous_quiet ||
            m->quiet_left != o_profile.previous_quiet - 1u)) {
            ++o_profile.counts[OP_EVENT_CUTS]; arm_block_profile_flush(false);
        }
    }
    ++o_profile.natural; ++o_profile.bounded;
    o_profile.previous_pc = c->r[15]; o_profile.previous_tick = m->ticks;
    o_profile.previous_exceptions = c->exceptions;
    o_profile.previous_mode = c->cpsr & 255u;
    o_profile.previous_quiet = m->quiet_left; o_profile.previous_kind = kind;
}
#undef O_PROFILE_EXPORT
#endif
