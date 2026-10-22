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
    OP_BOUNDED_PAIRS, OP_DISJOINT_PAIRS, OP_ODD_BLOCKS, OP_PAIR_SIGNATURES,
    OP_PAIR_OVERFLOW,
    OP_KINDS = 32, OP_FORMS = 48, OP_NATURAL_HIST = 64,
    OP_BOUNDED_HIST = 128, OP_KIND_PAIRS = 192,
    OP_CACHE_HITS = 448, OP_CACHE_MISSES = 452,
    OP_LOCAL_HITS = 456, OP_LOCAL_MISSES = 460,
    OP_RUN_UNIQUE_HIST = 464, OP_COUNT = 480
};
typedef struct { uint32_t opcode, used, run; } o_profile_opcode;
typedef struct { uint32_t opcode, epoch; } o_profile_cache;
typedef struct { uint32_t key, used; uint64_t adjacent, disjoint; } o_profile_pair;
typedef struct {
    uint32_t reads, writes, flags_written, condition_flags;
    unsigned kind, form;
    bool carry_input;
} o_profile_operand;
static struct {
    uint64_t counts[OP_COUNT];
    o_profile_opcode opcodes[65536];
    o_profile_cache caches[2][4][4096];
    o_profile_pair pairs[65536];
    o_profile_operand previous_operand;
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
    if (!natural && (*length & 1u)) ++o_profile.counts[OP_ODD_BLOCKS];
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
/* Only structural tags and frequencies leave this private diagnostic table.
 * Zero denotes an unused slot; a stored tag is returned plus one, so tag zero
 * remains representable. No opcode, PC, register number or value is exposed.
 */
O_PROFILE_EXPORT("arm_block_profile_pair")
uint64_t arm_block_profile_pair(unsigned slot, unsigned field) {
    if (slot >= 65536u || !o_profile.pairs[slot].used) return 0;
    const o_profile_pair *entry = &o_profile.pairs[slot];
    return field == 0u ? (uint64_t)entry->key + 1u :
           field == 1u ? entry->adjacent : field == 2u ? entry->disjoint : 0;
}
static uint32_t arm_block_profile_condition_flags(unsigned condition) {
    switch (condition) {
    case 0: case 1: return O_Z;
    case 2: case 3: return O_C;
    case 4: case 5: return O_N;
    case 6: case 7: return O_V;
    case 8: case 9: return O_C | O_Z;
    case 10: case 11: return O_N | O_V;
    case 12: case 13: return O_N | O_Z | O_V;
    default: return 0;
    }
}
static o_profile_operand arm_block_profile_operand(const o_cpu *c, uint32_t op) {
    o_profile_operand out = {0};
    out.kind = (op >> 21) & 15u;
    bool test = out.kind >= 8u && out.kind <= 11u;
    bool arithmetic = (out.kind >= 2u && out.kind <= 7u) ||
                      out.kind == 10u || out.kind == 11u;
    if (out.kind != 13u && out.kind != 15u) out.reads |= 1u << ((op >> 16) & 15u);
    if (!test) out.writes = 1u << ((op >> 12) & 15u);
    bool shifter_writes_carry = false;
    if (op & (1u << 25)) {
        out.form = (op & 0xf00u) ? 1u : 0u;
        shifter_writes_carry = out.form == 1u;
    } else {
        out.reads |= 1u << (op & 15u);
        unsigned shift = (op >> 5) & 3u, amount = (op >> 7) & 31u;
        if (op & 16u) {
            unsigned rs = (op >> 8) & 15u;
            out.reads |= 1u << rs; out.form = 8u + shift;
            shifter_writes_carry = (c->r[rs] & 255u) != 0;
        } else {
            out.form = shift == 0u && !amount ? 2u :
                       shift == 3u && !amount ? 7u : 3u + shift;
            shifter_writes_carry = out.form != 2u;
            out.carry_input = out.form == 7u; /* RRX consumes C even without S. */
        }
    }
    out.carry_input = out.carry_input || (out.kind >= 5u && out.kind <= 7u);
    if (op & (1u << 20)) {
        out.flags_written = O_N | O_Z;
        if (arithmetic) out.flags_written |= O_C | O_V;
        else if (shifter_writes_carry) out.flags_written |= O_C;
    }
    out.condition_flags = arm_block_profile_condition_flags(op >> 28);
    return out;
}
static uint32_t arm_block_profile_pair_key(o_profile_operand a, o_profile_operand b) {
    uint32_t key = a.kind | (b.kind << 4) | (a.form << 8) | (b.form << 12);
    if (a.writes & b.reads) key |= 1u << 16;  /* RAW */
    if (a.reads & b.writes) key |= 1u << 17;  /* WAR */
    if (a.writes & b.writes) key |= 1u << 18; /* WAW */
    if (a.flags_written & b.condition_flags) key |= 1u << 19;
    if ((a.flags_written & O_C) && b.carry_input) key |= 1u << 20;
    if ((a.condition_flags | (a.carry_input ? O_C : 0)) & b.flags_written)
        key |= 1u << 21;
    if (a.flags_written & b.flags_written) key |= 1u << 22;
    if (a.flags_written) key |= 1u << 23;
    if (b.flags_written) key |= 1u << 24;
    if (a.condition_flags) key |= 1u << 25;
    if (b.condition_flags) key |= 1u << 26;
    return key;
}
static void arm_block_profile_pair_record(o_profile_operand current) {
    uint32_t key = arm_block_profile_pair_key(o_profile.previous_operand, current);
    unsigned slot = (key * UINT32_C(0x9e3779b9)) >> 16;
    bool disjoint = (o_profile.bounded & 1u) != 0;
    ++o_profile.counts[OP_BOUNDED_PAIRS];
    if (disjoint) ++o_profile.counts[OP_DISJOINT_PAIRS];
    for (unsigned attempt = 0; attempt < 65536u; ++attempt) {
        o_profile_pair *entry = &o_profile.pairs[slot];
        if (!entry->used || entry->key == key) {
            if (!entry->used) {
                entry->used = 1; entry->key = key;
                ++o_profile.counts[OP_PAIR_SIGNATURES];
            }
            ++entry->adjacent;
            if (disjoint) ++entry->disjoint;
            return;
        }
        slot = (slot + 1u) & 65535u;
    }
    ++o_profile.counts[OP_PAIR_OVERFLOW];
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
    o_profile_operand operand = arm_block_profile_operand(c, op);
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
    if (o_profile.bounded) arm_block_profile_pair_record(operand);
    ++o_profile.natural; ++o_profile.bounded;
    o_profile.previous_operand = operand;
    o_profile.previous_pc = c->r[15]; o_profile.previous_tick = m->ticks;
    o_profile.previous_exceptions = c->exceptions;
    o_profile.previous_mode = c->cpsr & 255u;
    o_profile.previous_quiet = m->quiet_left; o_profile.previous_kind = kind;
}
#undef O_PROFILE_EXPORT
#endif
